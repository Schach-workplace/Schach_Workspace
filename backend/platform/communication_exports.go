package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"time"
)

type CommunicationExportAudit struct {
	ID             string `gorm:"primaryKey;size:80"`
	CompanyID      string
	ConversationID string
	ActorID        string
	Purpose        string
	SelectionHash  string
	CreatedAt      string
}

func (s *Server) exportSelectedCommunication(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		ExpectedPolicyVersion       int64    `json:"expectedPolicyVersion"`
		MessageIDs                  []string `json:"messageIds"`
		Purpose                     string   `json:"purpose"`
		AcknowledgedIndependentCopy bool     `json:"acknowledgedIndependentCopy"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if len(input.MessageIDs) < 1 || len(input.MessageIDs) > 100 || !clean(input.Purpose, 1000) || !input.AcknowledgedIndependentCopy {
		return invalid("Select 1–100 messages, a purpose and confirm the independent copy disclosure.")
	}
	rows := []Message{}
	auditID := ""
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if a.Role != "owner" || !a.canPost() || a.Conversation.Forwarding != "selected" {
			return denied()
		}
		if a.Version != input.ExpectedPolicyVersion {
			return conflict()
		}
		seen := map[string]bool{}
		for _, id := range input.MessageIDs {
			if seen[id] {
				return invalid("Select each message once.")
			}
			seen[id] = true
			m, e := scopedMessage(tx, a, id)
			if e != nil {
				return e
			}
			if m.Removed {
				return missing()
			}
			rows = append(rows, projectMessage(tx, a, m))
		}
		data, _ := json.Marshal(rows)
		auditID = newID("export")
		if e := tx.Create(&CommunicationExportAudit{ID: auditID, CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, ActorID: a.UserID, Purpose: input.Purpose, SelectionHash: hashToken(string(data)), CreatedAt: nowString()}).Error; e != nil {
			return e
		}
		return appendCommunicationEvent(tx, a, "selected_content_exported", "", 0)
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"auditId": auditID, "exportedAt": nowString(), "messages": rows, "notice": "This is an independent selected copy. It does not include media bytes, historical revisions or private content outside your current history window. Exported copies cannot be recalled by membership removal."})
}

// Briefings consume explicitly published work only; private text is never queried.
func (s *Server) publishedWorkBriefing(w http.ResponseWriter, r *http.Request) error {
	states := map[string]int{}
	total, openRequests := 0, 0
	oldestSeconds := int64(0)
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, scope *conversationScope) error {
		a, e := communicationWorkAccess(tx, scope)
		if e != nil {
			return e
		}
		var tasks []Task
		if e := tx.Where("company_id=?", a.Company.ID).Find(&tasks).Error; e != nil {
			return e
		}
		for _, task := range tasks {
			if a.canRead(task) {
				total++
				states[task.Status]++
			}
		}
		var requests []CommunicationRequest
		if e := tx.Where("company_id=? AND state=?", a.Company.ID, "open").Find(&requests).Error; e != nil {
			return e
		}
		for _, item := range requests {
			if a.canReadIntake(item) {
				openRequests++
				if at, e := time.Parse(time.RFC3339Nano, item.CreatedAt); e == nil {
					oldestSeconds = max(oldestSeconds, int64(time.Since(at).Seconds()))
				}
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"visibleTaskCount": total, "taskStates": states, "visibleOpenRequestCount": openRequests, "oldestVisibleOpenRequestAgeSeconds": oldestSeconds, "notice": "Counts reflect your current published work permissions. They do not summarize private conversations or score employees."})
}
