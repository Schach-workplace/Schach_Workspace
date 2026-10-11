package platform

import (
	"context"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

type CommunicationEvent struct {
	AudienceCaptured bool   `json:"-" gorm:"not null;default:false"`
	ID               string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID        string `json:"-" gorm:"index"`
	ConversationID   string `json:"conversationId" gorm:"uniqueIndex:event_order"`
	Sequence         int64  `json:"sequence" gorm:"uniqueIndex:event_order"`
	Kind             string `json:"kind"`
	MessageID        string `json:"messageId"`
	MessageSequence  int64  `json:"-"`
	CreatedAt        string `json:"createdAt"`
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
type CommunicationAudience struct {
	EventID         string `gorm:"primaryKey;size:80"`
	UserID          string `gorm:"primaryKey;size:80"`
	MembershipEpoch int64
	RecipientEpoch  int64
}
type CommunicationInbox struct {
	MembershipEpoch int64  `json:"-"`
	RecipientEpoch  int64  `json:"-"`
	EventID         string `json:"eventId" gorm:"primaryKey;size:80"`
	UserID          string `json:"-" gorm:"primaryKey;size:80"`
	CompanyID       string `json:"-"`
	ConversationID  string `json:"conversationId"`
	Read            bool   `json:"read"`
}

func appendCommunicationEvent(tx *gorm.DB, a *conversationScope, kind, mid string, messageSequence int64) error {
	var c Conversation
	if e := tx.Where("company_id = ? AND id = ?", a.CompanyID, a.Conversation.ID).First(&c).Error; e != nil {
		return e
	}
	event := CommunicationEvent{AudienceCaptured: true, ID: newID("evt"), CompanyID: a.CompanyID, ConversationID: c.ID, Sequence: c.NextEvent + 1, Kind: kind, MessageID: mid, MessageSequence: messageSequence, CreatedAt: nowString()}
	if e := tx.Create(&event).Error; e != nil {
		return e
	}
	if e := captureCommunicationAudience(tx, event); e != nil {
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
			ids := []string{}
			for _, m := range members {
				ids = append(ids, m.UserID)
			}
			var users []User
			if e := lockCommunicationRow(tx, "SHARE").Where("id IN ?", ids).Order("id").Find(&users).Error; e != nil {
				return e
			}
			eligible := map[string]bool{}
			for _, u := range users {
				eligible[u.ID] = !u.Suspended
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
				if !eligible[m.UserID] {
					continue
				}
				a, e := conversationAccess(tx, m.UserID, row.CompanyID, row.ConversationID)
				if e != nil {
					continue
				}
				var audience CommunicationAudience
				if e := tx.First(&audience, "event_id=? AND user_id=? AND membership_epoch=? AND recipient_epoch=?", event.ID, m.UserID, m.AccessEpoch, a.Epoch).Error; e == gorm.ErrRecordNotFound {
					continue
				} else if e != nil {
					return e
				}
				if event.MessageSequence != 0 && event.MessageSequence < a.HistoryFromSequence {
					continue
				}
				if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&CommunicationInbox{MembershipEpoch: m.AccessEpoch, RecipientEpoch: a.Epoch, EventID: event.ID, UserID: m.UserID, CompanyID: row.CompanyID, ConversationID: row.ConversationID}).Error; e != nil {
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

// Capture recipient identity at the source event, so a delayed worker cannot
// create a prior-membership or prior-private-interval episode after rejoin.
func captureCommunicationAudience(tx *gorm.DB, event CommunicationEvent) error {
	var members []Membership
	if e := tx.Where("company_id=? AND active=?", event.CompanyID, true).Order("user_id").Find(&members).Error; e != nil {
		return e
	}
	for _, m := range members {
		scope, e := conversationAccess(tx, m.UserID, event.CompanyID, event.ConversationID)
		if e != nil {
			if _, ok := e.(*apiError); ok {
				continue
			}
			return e
		}
		if event.MessageSequence != 0 && event.MessageSequence < scope.HistoryFromSequence {
			continue
		}
		audience := CommunicationAudience{EventID: event.ID, UserID: m.UserID, MembershipEpoch: m.AccessEpoch, RecipientEpoch: scope.Epoch}
		if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&audience).Error; e != nil {
			return e
		}
	}
	return nil
}
func migrateCommunicationAudience(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if e := tx.Exec(`UPDATE communication_inboxes SET membership_epoch=COALESCE((SELECT access_epoch FROM memberships m WHERE m.company_id=communication_inboxes.company_id AND m.user_id=communication_inboxes.user_id),1),recipient_epoch=COALESCE((SELECT epoch FROM conversation_members cm WHERE cm.company_id=communication_inboxes.company_id AND cm.conversation_id=communication_inboxes.conversation_id AND cm.user_id=communication_inboxes.user_id AND cm.active=true),0) WHERE membership_epoch=0`).Error; e != nil {
			return e
		}
		for {
			var events []CommunicationEvent
			if e := tx.Where("audience_captured=?", false).Order("id").Limit(100).Find(&events).Error; e != nil {
				return e
			}
			if len(events) == 0 {
				return nil
			}
			for _, event := range events {
				if e := captureCommunicationAudience(tx, event); e != nil {
					return e
				}
				if e := tx.Model(&event).Update("audience_captured", true).Error; e != nil {
					return e
				}
			}
		}
	})
}
