package platform

import (
	"context"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

type CommunicationEvent struct {
	ID              string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID       string `json:"-" gorm:"index"`
	ConversationID  string `json:"conversationId" gorm:"uniqueIndex:event_order"`
	Sequence        int64  `json:"sequence" gorm:"uniqueIndex:event_order"`
	Kind            string `json:"kind"`
	MessageID       string `json:"messageId"`
	MessageSequence int64  `json:"-"`
	CreatedAt       string `json:"createdAt"`
}
type CommunicationOutbox struct {
	EventID        string `gorm:"primaryKey;size:80"`
	CompanyID      string `gorm:"index"`
	ConversationID string
	LeaseToken     string
	LeaseUntil     *time.Time
	Attempts       int
	Delivered      bool
}
type CommunicationInbox struct {
	EventID        string `json:"eventId" gorm:"primaryKey;size:80"`
	UserID         string `json:"-" gorm:"primaryKey;size:80"`
	CompanyID      string `json:"-"`
	ConversationID string `json:"conversationId"`
	Read           bool   `json:"read"`
}

func appendCommunicationEvent(tx *gorm.DB, a *conversationScope, kind, mid string, messageSequence int64) error {
	var c Conversation
	if e := tx.Where("company_id = ? AND id = ?", a.CompanyID, a.Conversation.ID).First(&c).Error; e != nil {
		return e
	}
	event := CommunicationEvent{ID: newID("evt"), CompanyID: a.CompanyID, ConversationID: c.ID, Sequence: c.NextEvent + 1, Kind: kind, MessageID: mid, MessageSequence: messageSequence, CreatedAt: nowString()}
	if e := tx.Create(&event).Error; e != nil {
		return e
	}
	if e := tx.Create(&CommunicationOutbox{EventID: event.ID, CompanyID: a.CompanyID, ConversationID: c.ID}).Error; e != nil {
		return e
	}
	updates := map[string]any{"next_event": event.Sequence}
	if kind == "message_created" {
		updates["next_sequence"] = messageSequence
	}
	return tx.Model(&Conversation{}).Where("company_id = ? AND id = ?", a.CompanyID, c.ID).Updates(updates).Error
}

// RunCommunicationOutbox claims bounded leases. Recipient intents contain no
// private text and are reauthorized at creation and again at read/delivery.
func (s *Server) RunCommunicationOutbox(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 1000 {
		limit = 100
	}
	claimed := []CommunicationOutbox{}
	token := newID("lease")
	until := time.Now().UTC().Add(time.Minute)
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Where("delivered = ? AND (lease_until IS NULL OR lease_until < ?)", false, time.Now().UTC()).Order("event_id").Limit(limit)
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		if e := query.Find(&claimed).Error; e != nil {
			return e
		}
		for _, row := range claimed {
			if e := tx.Model(&CommunicationOutbox{}).Where("event_id = ?", row.EventID).Updates(map[string]any{"lease_token": token, "lease_until": until, "attempts": gorm.Expr("attempts+1")}).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return 0, e
	}
	delivered := 0
	for _, row := range claimed {
		e = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// Do not lock an outbox row before recipient membership rows.
			var event CommunicationEvent
			if e := tx.First(&event, "id = ?", row.EventID).Error; e != nil {
				return e
			}
			var members []Membership
			if e := lockCommunicationRow(tx, "SHARE").Where("company_id = ? AND active = ?", row.CompanyID, true).Order("user_id").Find(&members).Error; e != nil {
				return e
			}
			var c Conversation
			if e := lockCommunicationRow(tx, "UPDATE").First(&c, "company_id = ? AND id = ?", row.CompanyID, row.ConversationID).Error; e != nil {
				return e
			}
			var current CommunicationOutbox
			if e := lockCommunicationRow(tx, "UPDATE").First(&current, "event_id = ?", row.EventID).Error; e != nil {
				return e
			}
			if current.Delivered || current.LeaseToken != token {
				return nil
			}
			for _, m := range members {
				a, e := conversationAccess(tx, m.UserID, row.CompanyID, row.ConversationID)
				if e != nil {
					continue
				}
				if event.MessageSequence != 0 && event.MessageSequence < a.HistoryFromSequence {
					continue
				}
				if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&CommunicationInbox{EventID: event.ID, UserID: m.UserID, CompanyID: row.CompanyID, ConversationID: row.ConversationID}).Error; e != nil {
					return e
				}
			}
			if e := tx.Model(&current).Updates(map[string]any{"delivered": true, "lease_until": nil, "lease_token": ""}).Error; e != nil {
				return e
			}
			delivered++
			return nil
		})
		if e != nil {
			// Failed delivery is retryable after a bounded backoff, including a dead worker.
			backoff := time.Now().UTC().Add(5 * time.Second)
			_ = s.db.Model(&CommunicationOutbox{}).Where("event_id = ? AND lease_token = ?", row.EventID, token).Update("lease_until", backoff).Error
			return delivered, e
		}
	}
	return delivered, nil
}
