package platform

import (
	"gorm.io/gorm"
	"net/http"
	"time"
)

type CommunicationRecordRevision struct {
	RecordID  string `gorm:"primaryKey;size:80"`
	Revision  int64  `gorm:"primaryKey"`
	CompanyID string
	Title     string
	Body      string
	Options   []string `gorm:"serializer:json;type:jsonb"`
	DueAt     string
	Reason    string
	CreatedAt string
}

func recordSnapshot(tx *gorm.DB, r CommunicationRecord, reason string) error {
	return tx.Create(&CommunicationRecordRevision{RecordID: r.ID, Revision: r.Revision, CompanyID: r.CompanyID, Title: r.Title, Body: r.Body, Options: r.Options, DueAt: r.DueAt, Reason: reason, CreatedAt: nowString()}).Error
}
func (s *Server) editCommunicationRecord(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		ExpectedRevision int64    `json:"expectedRevision"`
		Title            string   `json:"title"`
		Body             string   `json:"body"`
		Options          []string `json:"options"`
		DueAt            string   `json:"dueAt"`
		Reason           string   `json:"reason"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !clean(input.Title, 240) || len(input.Body) > 10000 || !clean(input.Reason, 4000) {
		return invalid("Provide a title, updated content and reason for the new revision.")
	}
	if input.Options == nil {
		input.Options = []string{}
	}
	if input.DueAt != "" {
		d, e := time.Parse(time.RFC3339, input.DueAt)
		if e != nil || !d.After(time.Now()) {
			return invalid("Choose a future response deadline with an offset.")
		}
		input.DueAt = d.UTC().Format(time.RFC3339)
	}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		record, e := s.record(tx, a, r.PathValue("record"))
		if e != nil {
			return e
		}
		if record.CreatedBy != a.UserID {
			return denied()
		}
		if record.Revision != input.ExpectedRevision {
			return conflict()
		}
		if record.Kind == "poll" {
			if len(input.Options) < 2 || len(input.Options) > 10 {
				return invalid("Choose 2–10 poll options.")
			}
			seen := map[string]bool{}
			for _, v := range input.Options {
				if !clean(v, 120) || seen[v] {
					return invalid("Poll options must be unique.")
				}
				seen[v] = true
			}
		} else if len(input.Options) > 0 {
			return invalid("Only polls have options.")
		}
		old := []CommunicationRecipient{}
		if e := tx.Where("record_id=? AND revision=?", record.ID, record.Revision).Find(&old).Error; e != nil {
			return e
		}
		record.Title = input.Title
		record.Body = input.Body
		record.Options = input.Options
		record.DueAt = input.DueAt
		record.Revision++
		record.State = "open"
		if e := tx.Save(&record).Error; e != nil {
			return e
		}
		if e := recordSnapshot(tx, record, input.Reason); e != nil {
			return e
		}
		for _, recipient := range old {
			recipient.Revision = record.Revision
			recipient.Response = ""
			recipient.RespondedAt = ""
			if e := tx.Create(&recipient).Error; e != nil {
				return e
			}
		}
		source, e := scopedMessage(tx, a, record.AnchorMessageID)
		if e != nil {
			return e
		}
		if e := syncRecordAttention(tx, a, record); e != nil {
			return e
		}
		return appendCommunicationEvent(tx, a, "record_revised", source.ID, source.Sequence)
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("record"))
}
