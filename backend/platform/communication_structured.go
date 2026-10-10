package platform

import (
	"gorm.io/gorm"
	"net/http"
	"time"
)

type CommunicationRecord struct {
	ID              string   `json:"id" gorm:"primaryKey;size:80"`
	CompanyID       string   `json:"-" gorm:"uniqueIndex:record_retry"`
	RetryKey        string   `json:"-" gorm:"uniqueIndex:record_retry"`
	RequestHash     string   `json:"-"`
	ConversationID  string   `json:"conversationId" gorm:"index"`
	AnchorMessageID string   `json:"anchorMessageId"`
	SourceRevision  int64    `json:"sourceRevision"`
	Kind            string   `json:"kind"`
	Title           string   `json:"title"`
	Body            string   `json:"body"`
	Options         []string `json:"options" gorm:"serializer:json;type:jsonb"`
	CreatedBy       string   `json:"createdBy" gorm:"uniqueIndex:record_retry"`
	ReviewerID      string   `json:"reviewerId"`
	Revision        int64    `json:"revision"`
	State           string   `json:"state"`
	DueAt           string   `json:"dueAt"`
	CreatedAt       string   `json:"createdAt"`
}
type CommunicationRecipient struct {
	RecordID       string `json:"recordId" gorm:"primaryKey;size:80"`
	Revision       int64  `json:"revision" gorm:"primaryKey"`
	UserID         string `json:"userId" gorm:"primaryKey;size:80"`
	CompanyID      string `json:"-"`
	ConversationID string `json:"conversationId"`
	Response       string `json:"response"`
	RespondedAt    string `json:"respondedAt"`
}

func (s *Server) createCommunicationRecord(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		RetryKey        string   `json:"retryKey"`
		Kind            string   `json:"kind"`
		AnchorMessageID string   `json:"anchorMessageId"`
		SourceRevision  int64    `json:"sourceRevision"`
		Title           string   `json:"title"`
		Body            string   `json:"body"`
		Options         []string `json:"options"`
		RecipientIDs    []string `json:"recipientIds"`
		ReviewerID      string   `json:"reviewerId"`
		DueAt           string   `json:"dueAt"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !clean(input.RetryKey, 100) || !in(input.Kind, "ack", "poll", "event", "decision") || !clean(input.Title, 240) || len(input.Body) > 10000 || len(input.RecipientIDs) > 100 {
		return invalid("Choose a structured record, title and fixed audience of up to 100 recipients.")
	}
	if input.Options == nil {
		input.Options = []string{}
	}
	if input.Kind == "poll" {
		if len(input.Options) < 2 || len(input.Options) > 10 {
			return invalid("Polls require 2–10 options.")
		}
		seen := map[string]bool{}
		for _, o := range input.Options {
			if !clean(o, 120) || seen[o] {
				return invalid("Poll options must be unique, nonempty and up to 120 characters.")
			}
			seen[o] = true
		}
	}
	if input.DueAt != "" {
		instant, e := time.Parse(time.RFC3339, input.DueAt)
		if e != nil || !instant.After(time.Now()) {
			return invalid("Choose a future event/response deadline with an offset.")
		}
		input.DueAt = instant.UTC().Format(time.RFC3339)
	}
	extras := append([]string{}, input.RecipientIDs...)
	if input.ReviewerID != "" {
		extras = append(extras, input.ReviewerID)
	}
	id := newID("record")
	e := s.withCommunicationTransaction(r, extras, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		source, e := scopedMessage(tx, a, input.AnchorMessageID)
		if e != nil {
			return e
		}
		if source.Removed {
			return missing()
		}
		var old CommunicationRecord
		e = tx.First(&old, "company_id=? AND created_by=? AND retry_key=?", a.CompanyID, a.UserID, input.RetryKey).Error
		if e == nil {
			if old.RequestHash != payloadHash(input) || old.ConversationID != a.Conversation.ID {
				return conflict()
			}
			if _, e = s.record(tx, a, old.ID); e != nil {
				return e
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
		if input.Kind == "decision" {
			if input.ReviewerID == "" || input.ReviewerID == a.UserID {
				return invalid("Decisions require an independent authorized reviewer.")
			}
			scope, e := conversationAccess(tx, input.ReviewerID, a.CompanyID, a.Conversation.ID)
			if e != nil || scope.Role == "viewer" || source.Sequence < scope.HistoryFromSequence {
				return invalid("Reviewer must be an authorized conversation participant with source access.")
			}
		}
		recipients := input.RecipientIDs
		if input.Kind == "decision" {
			recipients = []string{input.ReviewerID}
		}
		if len(recipients) == 0 {
			recipients = []string{a.UserID}
		}
		seen := map[string]bool{}
		for _, uid := range recipients {
			scope, e := conversationAccess(tx, uid, a.CompanyID, a.Conversation.ID)
			if e != nil || source.Sequence < scope.HistoryFromSequence {
				return invalid("Recipients must have current source access.")
			}
			if seen[uid] {
				return invalid("Recipients must be unique.")
			}
			seen[uid] = true
		}
		record := CommunicationRecord{ID: id, RetryKey: input.RetryKey, RequestHash: payloadHash(input), CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, AnchorMessageID: source.ID, SourceRevision: source.Revision, Kind: input.Kind, Title: input.Title, Body: input.Body, Options: input.Options, CreatedBy: a.UserID, ReviewerID: input.ReviewerID, Revision: 1, State: "open", DueAt: input.DueAt, CreatedAt: nowString()}
		if e := tx.Create(&record).Error; e != nil {
			return e
		}
		if e := recordSnapshot(tx, record, "Initial revision"); e != nil {
			return e
		}
		for _, uid := range recipients {
			if e := tx.Create(&CommunicationRecipient{RecordID: id, Revision: 1, CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, UserID: uid}).Error; e != nil {
				return e
			}
		}
		return appendCommunicationEvent(tx, a, "record_created", source.ID, source.Sequence)
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) record(tx *gorm.DB, a *conversationScope, id string) (CommunicationRecord, error) {
	var record CommunicationRecord
	if e := tx.First(&record, "company_id=? AND conversation_id=? AND id=?", a.CompanyID, a.Conversation.ID, id).Error; e != nil {
		return record, missing()
	}
	source, e := scopedMessage(tx, a, record.AnchorMessageID)
	if e != nil || source.Removed {
		return record, missing()
	}
	return record, nil
}
func (s *Server) respondCommunicationRecord(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		ExpectedRevision int64  `json:"expectedRevision"`
		Response         string `json:"response"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		record, e := s.record(tx, a, r.PathValue("record"))
		if e != nil {
			return e
		}
		if input.ExpectedRevision != record.Revision {
			return conflict()
		}
		if record.State != "open" || record.DueAt != "" && record.DueAt < nowString() {
			return conflict()
		}
		var recipient CommunicationRecipient
		if e := tx.First(&recipient, "record_id=? AND revision=? AND user_id=?", record.ID, record.Revision, a.UserID).Error; e != nil {
			return missing()
		}
		switch record.Kind {
		case "ack":
			if input.Response != "acknowledged" {
				return invalid("Acknowledgements confirm receipt only.")
			}
		case "poll":
			if !in(input.Response, record.Options...) {
				return invalid("Choose a poll option.")
			}
		case "event":
			if !in(input.Response, "attending", "maybe", "declined") {
				return invalid("Choose an RSVP response.")
			}
		case "decision":
			if a.UserID == record.CreatedBy || a.UserID != record.ReviewerID {
				return denied()
			}
			if !in(input.Response, "confirmed", "rejected") {
				return invalid("Choose confirmed or rejected.")
			}
			if e := tx.Model(&record).Update("state", input.Response).Error; e != nil {
				return e
			}
		}
		recipient.Response = input.Response
		recipient.RespondedAt = nowString()
		if e := tx.Save(&recipient).Error; e != nil {
			return e
		}
		source, e := scopedMessage(tx, a, record.AnchorMessageID)
		if e != nil {
			return e
		}
		return appendCommunicationEvent(tx, a, "record_response", source.ID, source.Sequence)
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("record"))
}
func (s *Server) listCommunicationRecords(w http.ResponseWriter, r *http.Request) error {
	records := []CommunicationRecord{}
	responses := []CommunicationRecipient{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if e := tx.Table("communication_records AS records").Select("records.*").Joins("JOIN messages m ON m.company_id=records.company_id AND m.conversation_id=records.conversation_id AND m.id=records.anchor_message_id").Where("records.company_id=? AND records.conversation_id=? AND m.sequence>=? AND m.removed=?", a.CompanyID, a.Conversation.ID, a.HistoryFromSequence, false).Where("(records.created_by=? OR EXISTS (SELECT 1 FROM communication_recipients recipient WHERE recipient.company_id=records.company_id AND recipient.record_id=records.id AND recipient.revision=records.revision AND recipient.user_id=?))", a.UserID, a.UserID).Order("records.created_at DESC").Limit(100).Find(&records).Error; e != nil {
			return e
		}
		ids := []string{}
		for _, record := range records {
			ids = append(ids, record.ID)
		}
		if len(ids) > 0 {
			return tx.Where("company_id=? AND record_id IN ?", a.CompanyID, ids).Find(&responses).Error
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"records": records, "responses": responses})
}
func (s *Server) structuredRoutes() {
	s.route("POST /api/companies/{cid}/conversations/{id}/records", s.createCommunicationRecord)
	s.route("PATCH /api/companies/{cid}/conversations/{id}/records/{record}", s.editCommunicationRecord)
	s.route("GET /api/companies/{cid}/conversations/{id}/records", s.listCommunicationRecords)
	s.route("POST /api/companies/{cid}/conversations/{id}/records/{record}/respond", s.respondCommunicationRecord)
}
