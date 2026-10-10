package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
)

type CommunicationRequest struct {
	ID              string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID       string `json:"companyId" gorm:"index;uniqueIndex:intake_retry"`
	ConversationID  string `json:"-"`
	AnchorMessageID string `json:"-"`
	SourceRevision  int64  `json:"-"`
	CreatedBy       string `json:"createdBy" gorm:"uniqueIndex:intake_retry"`
	RetryKey        string `json:"-" gorm:"uniqueIndex:intake_retry"`
	RequestHash     string `json:"-"`
	DepartmentID    string `json:"departmentId"`
	Title           string `json:"title"`
	Summary         string `json:"summary"`
	State           string `json:"state"`
	Version         int64  `json:"version"`
	TaskID          string `json:"taskId"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

func (a *access) canReadIntake(item CommunicationRequest) bool {
	return leadership(a.Member.Role) || a.Member.Role == "viewer" || item.CreatedBy == a.User.ID || a.Member.Role == "head" && a.Member.DepartmentID != "" && a.Member.DepartmentID == item.DepartmentID
}
func (a *access) canTriageIntake(item CommunicationRequest) bool {
	return leadership(a.Member.Role) || a.Member.Role == "head" && a.Member.DepartmentID != "" && a.Member.DepartmentID == item.DepartmentID
}

type communicationRequestInput struct {
	RetryKey              string `json:"retryKey"`
	AnchorMessageID       string `json:"anchorMessageId"`
	SourceRevision        int64  `json:"sourceRevision"`
	ExpectedPolicyVersion int64  `json:"expectedPolicyVersion"`
	DepartmentID          string `json:"departmentId"`
	Title                 string `json:"title"`
	Summary               string `json:"summary"`
}

func (s *Server) previewCommunicationRequest(w http.ResponseWriter, r *http.Request) error {
	var input communicationRequestInput
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !clean(input.Title, 240) || len(input.Summary) > 10000 {
		return invalid("Supply a selected title and summary.")
	}
	audience := []string{}
	e := s.conversionTransaction(r, func(tx *gorm.DB, a *access, scope *conversationScope) error {
		if scope.Conversation.Forwarding != "selected" {
			return denied()
		}
		if scope.Version != input.ExpectedPolicyVersion {
			return conflict()
		}
		source, e := scopedMessage(tx, scope, input.AnchorMessageID)
		if e != nil {
			return e
		}
		if source.Removed {
			return missing()
		}
		if source.Revision != input.SourceRevision {
			return conflict()
		}
		if input.DepartmentID == "" || !departmentExists(tx, a.Company.ID, input.DepartmentID) {
			return invalid("Choose the responsible triage department.")
		}
		item := CommunicationRequest{CreatedBy: a.User.ID, DepartmentID: input.DepartmentID}
		for uid, member := range a.Members {
			other := *a
			other.Member = member
			other.User = a.Users[uid]
			if member.Active && other.canReadIntake(item) {
				audience = append(audience, uid)
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"audienceUserIds": audience, "notice": "The selected title and summary become an independent work request visible to the current listed audience. Future roles and department changes can change access. Source messages stay private; publishing does not retract previously disclosed work records."})
}
func (s *Server) createCommunicationRequest(w http.ResponseWriter, r *http.Request) error {
	var input communicationRequestInput
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !clean(input.RetryKey, 100) || !clean(input.Title, 240) || len(input.Summary) > 10000 {
		return invalid("Supply a retry key, request title and selected summary.")
	}
	id := ""
	e := s.conversionTransaction(r, func(tx *gorm.DB, a *access, scope *conversationScope) error {
		if scope.Conversation.Forwarding != "selected" {
			return denied()
		}
		if input.ExpectedPolicyVersion != scope.Version {
			return conflict()
		}
		source, e := scopedMessage(tx, scope, input.AnchorMessageID)
		if e != nil {
			return e
		}
		if source.Removed {
			return missing()
		}
		if input.DepartmentID == "" || !departmentExists(tx, a.Company.ID, input.DepartmentID) {
			return invalid("Choose the responsible triage department.")
		}
		var old CommunicationRequest
		e = tx.First(&old, "company_id=? AND created_by=? AND retry_key=?", a.Company.ID, a.User.ID, input.RetryKey).Error
		if e == nil {
			if old.RequestHash != payloadHash(input) {
				return conflict()
			}
			if !a.canReadIntake(old) {
				return missing()
			}
			id = old.ID
			return nil
		}
		if e != gorm.ErrRecordNotFound {
			return e
		}
		if source.Revision != input.SourceRevision {
			return conflict()
		}
		item := CommunicationRequest{ID: newID("request"), CompanyID: a.Company.ID, ConversationID: scope.Conversation.ID, AnchorMessageID: source.ID, SourceRevision: source.Revision, CreatedBy: a.User.ID, RetryKey: input.RetryKey, RequestHash: payloadHash(input), DepartmentID: input.DepartmentID, Title: input.Title, Summary: input.Summary, State: "open", Version: 1, CreatedAt: nowString(), UpdatedAt: nowString()}
		if e := tx.Create(&item).Error; e != nil {
			return e
		}
		id = item.ID
		if e := syncIntakeAttention(tx, a, item); e != nil {
			return e
		}
		return appendCommunicationEvent(tx, scope, "request_published", source.ID, source.Sequence)
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) listCommunicationRequests(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	rows := []CommunicationRequest{}
	query := s.db.Where("company_id=?", a.Company.ID)
	if !leadership(a.Member.Role) && a.Member.Role != "viewer" {
		department := ""
		if a.Member.Role == "head" {
			department = a.Member.DepartmentID
		}
		query = query.Where("created_by=? OR (department_id<>'' AND department_id=?)", a.User.ID, department)
	}
	if e = query.Order("created_at,id").Limit(100).Find(&rows).Error; e != nil {
		return e
	}
	for i, item := range rows {
		if item.TaskID != "" {
			if _, e := scopedTask(s.db, a, item.TaskID); e != nil {
				rows[i].TaskID = ""
			}
		}
	}
	return respond(w, 200, map[string]any{"requests": rows})
}
func (s *Server) assignCommunicationRequest(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		ExpectedVersion int64                      `json:"expectedVersion"`
		Task            map[string]json.RawMessage `json:"task"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	id := ""
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var item CommunicationRequest
		if e := tx.First(&item, "company_id=? AND id=?", a.Company.ID, r.PathValue("request")).Error; e != nil {
			return missing()
		}
		if !a.canTriageIntake(item) {
			return denied()
		}
		if item.Version != input.ExpectedVersion {
			return conflict()
		}
		if item.State != "open" {
			return conflict()
		}
		// The request already contains explicitly published work content. Triage does
		// not gain access to its private source and never serializes source metadata.
		for key := range input.Task {
			if !in(key, createTaskFields...) {
				return invalid("Unknown task field: " + key)
			}
		}
		task, e := makeTask(a, input.Task)
		if e != nil {
			return e
		}
		if task.DepartmentID != item.DepartmentID {
			return invalid("Assigned work must belong to the triage department.")
		}
		if e = validateTask(tx, a, &task); e != nil {
			return e
		}
		if !a.canCreate(task.OwnerID, task.DepartmentID) {
			return denied()
		}
		if e = setWorkflow(tx, &task, "", false); e != nil {
			return e
		}
		var claim CommunicationAction
		e = tx.First(&claim, "company_id=? AND anchor_message_id=? AND action_id=?", a.Company.ID, item.AnchorMessageID, "primary").Error
		if e == nil {
			existing, e := scopedTask(tx, a, claim.TaskID)
			if e != nil {
				return missing()
			}
			if existing.DepartmentID != item.DepartmentID {
				return invalid("The existing primary task belongs to a different triage department; declare a separate work action.")
			}
			id = existing.ID
		} else if e == gorm.ErrRecordNotFound {
			if e = insertTask(tx, a, &task); e != nil {
				return e
			}
			id = task.ID
			if e := tx.Create(&CommunicationAction{CompanyID: a.Company.ID, AnchorMessageID: item.AnchorMessageID, ActionID: "primary", ConversationID: item.ConversationID, TaskID: id, CreatedBy: a.User.ID, CreatedAt: nowString()}).Error; e != nil {
				return e
			}
		} else {
			return e
		}
		item.TaskID = id
		item.State = "assigned"
		item.Version++
		item.UpdatedAt = nowString()
		if e := tx.Save(&item).Error; e != nil {
			return e
		}
		if e := syncIntakeAttention(tx, a, item); e != nil {
			return e
		}
		return audit(tx, a.Company.ID, id, a.User.ID, "intake_assigned", item.Title+" assigned through the existing task workflow.")
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) patchCommunicationRequest(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		ExpectedVersion int64  `json:"expectedVersion"`
		State           string `json:"state"`
		Reason          string `json:"reason"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !in(input.State, "resolved", "cancelled") || !clean(input.Reason, 4000) {
		return invalid("Choose resolved/cancelled and explain the outcome.")
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var item CommunicationRequest
		if e := tx.First(&item, "company_id=? AND id=?", a.Company.ID, r.PathValue("request")).Error; e != nil {
			return missing()
		}
		if !a.canReadIntake(item) {
			return missing()
		}
		if a.Member.Role == "viewer" || !a.canTriageIntake(item) && item.CreatedBy != a.User.ID {
			return denied()
		}
		if item.Version != input.ExpectedVersion {
			return conflict()
		}
		if in(item.State, "resolved", "cancelled") {
			return conflict()
		}
		if input.State == "resolved" {
			task, e := scopedTask(tx, a, item.TaskID)
			if e != nil {
				return e
			}
			if task.Status != "done" {
				return invalid("Resolve intake only after its assigned task is accepted.")
			}
		}
		item.State = input.State
		item.Version++
		item.UpdatedAt = nowString()
		if e := tx.Save(&item).Error; e != nil {
			return e
		}
		if e := syncIntakeAttention(tx, a, item); e != nil {
			return e
		}
		return audit(tx, a.Company.ID, item.TaskID, a.User.ID, "intake_"+input.State, input.Reason)
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("request"))
}
func (s *Server) intakeRoutes() {
	s.route("POST /api/companies/{cid}/conversations/{id}/requests", s.createCommunicationRequest)
	s.route("POST /api/companies/{cid}/conversations/{id}/requests/preview", s.previewCommunicationRequest)
	s.route("GET /api/companies/{cid}/communication/requests", s.listCommunicationRequests)
	s.route("POST /api/companies/{cid}/communication/requests/{request}/assign", s.assignCommunicationRequest)
	s.route("PATCH /api/companies/{cid}/communication/requests/{request}", s.patchCommunicationRequest)
}
