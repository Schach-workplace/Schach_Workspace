package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"io"
	"net/http"
)

type CommunicationAction struct {
	CompanyID       string `gorm:"primaryKey;size:80"`
	AnchorMessageID string `gorm:"primaryKey;size:80"`
	ActionID        string `gorm:"primaryKey;size:80"`
	ConversationID  string
	TaskID          string
	CreatedBy       string
	CreatedAt       string
}
type CommunicationRetry struct {
	CompanyID   string `gorm:"primaryKey;size:80"`
	ActorID     string `gorm:"primaryKey;size:80"`
	Operation   string `gorm:"primaryKey;size:80"`
	RetryKey    string `gorm:"primaryKey;size:100"`
	RequestHash string
	TaskID      string
}
type CommunicationWorkSource struct {
	CompanyID       string `json:"-"`
	ConversationID  string `json:"conversationId"`
	TaskID          string `json:"taskId" gorm:"primaryKey;size:80"`
	MessageID       string `json:"messageId" gorm:"primaryKey;size:80"`
	Revision        int64  `json:"revision"`
	CurrentRevision int64  `json:"currentRevision" gorm:"-"`
	OutOfDate       bool   `json:"outOfDate" gorm:"-"`
}
type ConversionInput struct {
	IntelligenceBasis *IntelligenceBasis `json:"intelligenceBasis,omitempty"`
	RetryKey          string             `json:"retryKey"`
	AnchorMessageID   string             `json:"anchorMessageId"`
	ActionID          string             `json:"actionId"`
	Sources           []struct {
		MessageID string `json:"messageId"`
		Revision  int64  `json:"revision"`
	} `json:"sources"`
	Task        map[string]json.RawMessage `json:"task"`
	Publication struct {
		Excerpt       string   `json:"excerpt"`
		AttachmentIDs []string `json:"attachmentIds"`
	} `json:"publication"`
	ExpectedPolicyVersion int64 `json:"expectedPolicyVersion"`
}

// Optional company business lock is acquired before session/member/conversation
// rows. This invokes the existing task engine, not a parallel task model.
func (s *Server) conversionTransaction(r *http.Request, fn func(*gorm.DB, *access, *conversationScope) error) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	if a.Member.Role == "viewer" {
		return denied()
	}
	return s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var c Conversation
		if e := lockCommunicationRow(tx, "UPDATE").First(&c, "company_id = ? AND id = ?", a.Company.ID, r.PathValue("id")).Error; e != nil {
			return missing()
		}
		scope, e := conversationAccess(tx, a.User.ID, a.Company.ID, c.ID)
		if e != nil {
			return e
		}
		if !scope.canPost() {
			return denied()
		}
		return fn(tx, a, scope)
	})
}
func verifyConversionSources(tx *gorm.DB, a *conversationScope, input ConversionInput, revisions bool) error {
	if a.Conversation.Forwarding != "selected" {
		return denied()
	}
	if input.ExpectedPolicyVersion != a.Version {
		return conflict()
	}
	if len(input.Sources) < 1 || len(input.Sources) > 50 || !clean(input.RetryKey, 100) {
		return invalid("Select 1–50 exact source revisions and a retry key.")
	}
	if input.ActionID != "" && input.ActionID != "primary" {
		var action CommunicationBundleAction
		if e := tx.First(&action, "company_id=? AND conversation_id=? AND anchor_message_id=? AND id=?", a.CompanyID, a.Conversation.ID, input.AnchorMessageID, input.ActionID).Error; e != nil {
			return missing()
		}
	}
	anchor := false
	seen := map[string]bool{}
	for _, source := range input.Sources {
		if seen[source.MessageID] {
			return invalid("Source messages must be unique.")
		}
		seen[source.MessageID] = true
		m, e := scopedMessage(tx, a, source.MessageID)
		if e != nil {
			return e
		}
		if m.Removed {
			return missing()
		}
		if revisions && m.Revision != source.Revision {
			return conflict()
		}
		if source.MessageID == input.AnchorMessageID {
			anchor = true
		}
	}
	if !anchor {
		return invalid("The primary anchor must be among the selected sources.")
	}
	if len(input.Publication.Excerpt) > 20000 {
		return invalid("Published excerpt is too long.")
	}
	if len(input.Publication.AttachmentIDs) > 10 {
		return invalid("Publish at most 10 selected evidence files.")
	}
	for _, id := range input.Publication.AttachmentIDs {
		var media CommunicationMedia
		if e := tx.First(&media, "company_id=? AND conversation_id=? AND id=? AND state=?", a.CompanyID, a.Conversation.ID, id, "clean").Error; e != nil {
			return missing()
		}
		current, e := eligibleCommunicationMedia(tx, a, id)
		if e != nil {
			return e
		}
		media = current
		if !seen[media.MessageID] {
			return invalid("Published evidence must belong to a selected source message.")
		}
		if media.Size > maxUpload {
			return invalid("Task evidence retains its 10-MiB limit.")
		}
	}
	return nil
}
func taskAudience(a *access, t Task) []string {
	ids := []string{}
	for uid, m := range a.Members {
		if !m.Active {
			continue
		}
		other := *a
		other.User = a.Users[uid]
		other.Member = m
		if other.canRead(t) {
			ids = append(ids, uid)
		}
	}
	return ids
}
func (s *Server) previewTaskConversion(w http.ResponseWriter, r *http.Request) error {
	var input ConversionInput
	if e := decode(w, r, &input); e != nil {
		return e
	}
	var audience []string
	reviewHash := ""
	e := s.conversionTransaction(r, func(tx *gorm.DB, a *access, scope *conversationScope) error {
		if e := verifyConversionSources(tx, scope, input, true); e != nil {
			return e
		}
		for key := range input.Task {
			if !in(key, createTaskFields...) {
				return invalid("Unknown task field: " + key)
			}
		}
		task, e := makeTask(a, input.Task)
		if e != nil {
			return e
		}
		if e = validateTask(tx, a, &task); e != nil {
			return e
		}
		if !a.canCreate(task.OwnerID, task.DepartmentID) {
			return denied()
		}
		if input.IntelligenceBasis != nil {
			m, e := s.intelligencePublicationManifest(tx, a, input.IntelligenceBasis, true)
			if e != nil {
				return e
			}
			if e = intelligencePublicationScope(m, scope.Conversation.ID, conversionIntelligenceMessages(input)); e != nil {
				return e
			}
		}
		audience = taskAudience(a, task)
		reviewHash = intelligenceReviewedHash(a, input.IntelligenceBasis, input, audience)
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"intelligenceReviewHash": reviewHash, "audienceUserIds": audience, "policyVersion": input.ExpectedPolicyVersion, "notice": "Task titles, descriptions and selected excerpts become work records visible to this broader audience. Future roles and reporting changes can change the audience. Source removal does not retract published work records."})
}
func (s *Server) convertMessageToTask(w http.ResponseWriter, r *http.Request) error {
	var input ConversionInput
	if e := decode(w, r, &input); e != nil {
		return e
	}
	id := ""
	e := s.conversionTransaction(r, func(tx *gorm.DB, a *access, scope *conversationScope) error {
		if e := verifyConversionSources(tx, scope, input, false); e != nil {
			return e
		}
		if e := s.intelligencePublicationAccess(tx, a, input.IntelligenceBasis, scope.Conversation.ID, conversionIntelligenceMessages(input)); e != nil {
			return e
		}
		hash := payloadHash(input)
		var retry CommunicationRetry
		e := tx.First(&retry, "company_id = ? AND actor_id = ? AND operation = ? AND retry_key = ?", a.Company.ID, a.User.ID, "task_conversion", input.RetryKey).Error
		if e == nil {
			if retry.RequestHash != hash {
				return conflict()
			}
			if _, e := scopedTask(tx, a, retry.TaskID); e != nil {
				return missing()
			}
			id = retry.TaskID
			return nil
		}
		if e != gorm.ErrRecordNotFound {
			return e
		}
		if e := verifyConversionSources(tx, scope, input, true); e != nil {
			return e
		}
		actionID := input.ActionID
		if actionID == "" {
			actionID = "primary"
		}
		var claim CommunicationAction
		e = tx.First(&claim, "company_id = ? AND anchor_message_id = ? AND action_id = ?", a.Company.ID, input.AnchorMessageID, actionID).Error
		if e == nil {
			if _, e := scopedTask(tx, a, claim.TaskID); e != nil {
				return missing()
			}
			id = claim.TaskID
			return tx.Create(&CommunicationRetry{CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: "task_conversion", RetryKey: input.RetryKey, RequestHash: hash, TaskID: id}).Error
		}
		if e != gorm.ErrRecordNotFound {
			return e
		}
		for key := range input.Task {
			if !in(key, createTaskFields...) {
				return invalid("Unknown task field: " + key)
			}
		}
		task, e := makeTask(a, input.Task)
		if e != nil {
			return e
		}
		if input.Publication.Excerpt != "" {
			task.Description += "\n\nPublished conversation excerpt:\n" + input.Publication.Excerpt
		}
		if e = validateTask(tx, a, &task); e != nil {
			return e
		}
		if !a.canCreate(task.OwnerID, task.DepartmentID) {
			return denied()
		}
		if e = s.intelligencePublicationFirstWrite(tx, a, input.IntelligenceBasis, scope.Conversation.ID, conversionIntelligenceMessages(input), input, taskAudience(a, task)); e != nil {
			return e
		}
		if e = setWorkflow(tx, &task, "", false); e != nil {
			return e
		}
		if e = insertTask(tx, a, &task); e != nil {
			return e
		}
		id = task.ID
		if e = s.recordIntelligencePublication(tx, a, input.IntelligenceBasis, "task", id, "task_conversion", input.RetryKey, input); e != nil {
			return e
		}
		for _, mediaID := range input.Publication.AttachmentIDs {
			if s.opts.MediaStore == nil {
				return missing()
			}
			var media CommunicationMedia
			if e := tx.First(&media, "company_id=? AND conversation_id=? AND id=?", a.Company.ID, scope.Conversation.ID, mediaID).Error; e != nil {
				return e
			}
			reader, e := s.opts.MediaStore.Open(r.Context(), media.ID)
			if e != nil {
				return e
			}
			data, e := io.ReadAll(io.LimitReader(reader, maxUpload+1))
			_ = reader.Close()
			if e != nil {
				return e
			}
			if e := appendTaskEvidence(tx, a, id, Attachment{FileName: media.FileName, Data: data}); e != nil {
				return e
			}
		}

		if e := tx.Create(&CommunicationAction{CompanyID: a.Company.ID, AnchorMessageID: input.AnchorMessageID, ActionID: actionID, ConversationID: scope.Conversation.ID, TaskID: id, CreatedBy: a.User.ID, CreatedAt: nowString()}).Error; e != nil {
			return e
		}
		if e := tx.Create(&CommunicationRetry{CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: "task_conversion", RetryKey: input.RetryKey, RequestHash: hash, TaskID: id}).Error; e != nil {
			return e
		}
		for _, source := range input.Sources {
			if e := tx.Create(&CommunicationWorkSource{CompanyID: a.Company.ID, ConversationID: scope.Conversation.ID, TaskID: id, MessageID: source.MessageID, Revision: source.Revision}).Error; e != nil {
				return e
			}
		}
		anchor, e := scopedMessage(tx, scope, input.AnchorMessageID)
		if e != nil {
			return e
		}
		return appendCommunicationEvent(tx, scope, "work_linked", input.AnchorMessageID, anchor.Sequence)
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) conversationWorkLinks(w http.ResponseWriter, r *http.Request) error {
	links := []Task{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, scope *conversationScope) error {
		a, e := communicationWorkAccess(tx, scope)
		if e != nil {
			return e
		}
		var claims []CommunicationAction
		if e := tx.Where("company_id = ? AND conversation_id = ?", a.Company.ID, scope.Conversation.ID).Find(&claims).Error; e != nil {
			return e
		}
		for _, claim := range claims {
			source, e := scopedMessage(tx, scope, claim.AnchorMessageID)
			if e != nil || source.Removed {
				continue
			}
			task, e := scopedTask(tx, a, claim.TaskID)
			if e != nil {
				continue
			}
			links = append(links, task)
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"tasks": links})
}
