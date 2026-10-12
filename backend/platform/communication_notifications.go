package platform

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"time"
)

// PushHint carries only opaque identifiers. Exactly one of ConversationID
// (communication inbox) or AttentionID (Inbox attention item) is set.
type PushHint struct {
	EventID        string `json:"eventId"`
	CompanyID      string `json:"companyId"`
	ConversationID string `json:"conversationId,omitempty"`
	AttentionID    string `json:"attentionId,omitempty"`
}
type PushSender interface {
	Send(context.Context, CommunicationDevice, PushHint) error
}

var ErrPushDeviceGone = errors.New("push registration expired")

type CommunicationPush struct {
	EventID    string `gorm:"primaryKey;size:80"`
	DeviceID   string `gorm:"primaryKey;size:80"`
	CompanyID  string
	UserID     string
	Attempts   int
	Done       bool
	LeaseUntil *time.Time
	LeaseToken string
}

func quietAttention(p CommunicationPreference, now time.Time) bool {
	if p.Muted {
		return true
	}
	if p.QuietStart == "" || p.QuietEnd == "" {
		return false
	}
	zone, e := time.LoadLocation(p.Timezone)
	if e != nil {
		return true
	}
	clock := now.In(zone).Format("15:04")
	if p.QuietStart == p.QuietEnd {
		return true
	}
	if p.QuietStart < p.QuietEnd {
		return clock >= p.QuietStart && clock < p.QuietEnd
	}
	return clock >= p.QuietStart || clock < p.QuietEnd
}
func (s *Server) RunCommunicationPush(ctx context.Context, now time.Time) (int, error) {
	if s.opts.PushSender == nil {
		return 0, nil
	}
	now = now.UTC()
	// Populate bounded deduplicated device intents. No message body leaves this process.
	var candidates []CommunicationPush
	if e := s.db.WithContext(ctx).Table("communication_inboxes i").Select("i.event_id,d.id AS device_id,i.company_id,i.user_id").Joins("JOIN communication_devices d ON d.user_id=i.user_id AND d.active=? AND d.push_provider<>'' AND d.push_token<>''", true).Joins("JOIN sessions ss ON ss.token_hash=d.session_hash AND ss.user_id=d.user_id AND ss.expires_at>?", now).Joins("JOIN users pu ON pu.id=ss.user_id AND pu.suspended=false AND pu.session_epoch=ss.session_epoch AND pu.session_epoch>0").Joins("JOIN memberships pm ON pm.user_id=i.user_id AND pm.company_id=i.company_id AND pm.active=true AND pm.access_epoch=i.membership_epoch").Joins("LEFT JOIN communication_pushes p ON p.event_id=i.event_id AND p.device_id=d.id").Where("i.read=? AND p.event_id IS NULL", false).Order("i.event_id,d.id").Limit(100).Scan(&candidates).Error; e != nil {
		return 0, e
	}
	for _, job := range candidates {
		if e := s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&job).Error; e != nil {
			return 0, e
		}
	}
	claimed := []CommunicationPush{}
	token := newID("lease")
	until := now.Add(time.Minute)
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := tx.Where("done=? AND (lease_until IS NULL OR lease_until<?)", false, now).Order("event_id,device_id").Limit(100)
		if tx.Dialector.Name() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		if e := q.Find(&claimed).Error; e != nil {
			return e
		}
		for _, job := range claimed {
			if e := tx.Model(&job).Updates(map[string]any{"lease_until": until, "lease_token": token, "attempts": gorm.Expr("attempts+1")}).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return 0, e
	}
	sent := 0
	for _, job := range claimed {
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var device CommunicationDevice
			if e := tx.First(&device, "id=? AND user_id=? AND active=?", job.DeviceID, job.UserID, true).Error; e != nil {
				if e == gorm.ErrRecordNotFound {
					return finishPush(tx, job, token)
				}
				return e
			}
			var session SessionRecord
			if e := lockCommunicationRow(tx, "SHARE").First(&session, "user_id=? AND token_hash=? AND expires_at>?", job.UserID, device.SessionHash, now).Error; e != nil {
				if e == gorm.ErrRecordNotFound {
					return finishPush(tx, job, token)
				}
				return e
			}
			var member Membership
			if e := lockCommunicationRow(tx, "SHARE").First(&member, "company_id=? AND user_id=? AND active=?", job.CompanyID, job.UserID, true).Error; e != nil {
				if e == gorm.ErrRecordNotFound {
					return finishPush(tx, job, token)
				}
				return e
			}
			if _, e := fenceSessionUser(tx, session, "SHARE"); e != nil {
				return finishPush(tx, job, token)
			}
			var event CommunicationEvent
			if e := tx.First(&event, "id=? AND company_id=?", job.EventID, job.CompanyID).Error; e != nil {
				return e
			}
			var c Conversation
			if e := lockCommunicationRow(tx, "UPDATE").First(&c, "company_id=? AND id=?", job.CompanyID, event.ConversationID).Error; e != nil {
				return e
			}
			scope, e := conversationAccess(tx, job.UserID, job.CompanyID, c.ID)
			if e != nil {
				var api *apiError
				if errors.As(e, &api) {
					return finishPush(tx, job, token)
				}
				return e
			}
			if event.MessageSequence != 0 && event.MessageSequence < scope.HistoryFromSequence {
				return finishPush(tx, job, token)
			}
			var inbox CommunicationInbox
			if e := tx.First(&inbox, "event_id=? AND user_id=?", job.EventID, job.UserID).Error; e != nil {
				return e
			}
			if inbox.Read || inbox.MembershipEpoch != member.AccessEpoch || inbox.RecipientEpoch != scope.Epoch {
				return finishPush(tx, job, token)
			}
			var pref CommunicationPreference
			e = tx.First(&pref, "company_id=? AND device_id=?", job.CompanyID, job.DeviceID).Error
			if e != nil && e != gorm.ErrRecordNotFound {
				return e
			}
			if quietAttention(pref, now) {
				return tx.Model(&CommunicationPush{}).Where("event_id=? AND device_id=? AND lease_token=?", job.EventID, job.DeviceID, token).Updates(map[string]any{"lease_until": now.Add(time.Minute), "lease_token": ""}).Error
			}
			if pref.MentionsOnly {
				if event.MessageID == "" {
					return finishPush(tx, job, token)
				}
				m, e := scopedMessage(tx, scope, event.MessageID)
				if e != nil || !m.MentionAll && !in(job.UserID, m.MentionIDs...) {
					return finishPush(tx, job, token)
				}
			}
			bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			e = s.opts.PushSender.Send(bounded, device, PushHint{EventID: event.ID, CompanyID: job.CompanyID, ConversationID: c.ID})
			if errors.Is(e, ErrPushDeviceGone) {
				if e := tx.Model(&device).Update("push_token", "").Error; e != nil {
					return e
				}
				return finishPush(tx, job, token)
			}
			if e != nil {
				return e
			}
			if e := finishPush(tx, job, token); e != nil {
				return e
			}
			sent++
			return nil
		})
		if e != nil {
			_ = s.db.WithContext(ctx).Model(&CommunicationPush{}).Where("event_id=? AND device_id=? AND lease_token=?", job.EventID, job.DeviceID, token).Update("lease_until", now.Add(30*time.Second)).Error
			return sent, e
		}
	}
	return sent, nil
}
func finishPush(tx *gorm.DB, job CommunicationPush, token string) error {
	return tx.Model(&CommunicationPush{}).Where("event_id=? AND device_id=? AND lease_token=?", job.EventID, job.DeviceID, token).Updates(map[string]any{"done": true, "lease_until": nil, "lease_token": ""}).Error
}
func (s *Server) ackCommunicationInbox(w http.ResponseWriter, r *http.Request) error {
	var event CommunicationEvent
	if e := s.db.First(&event, "company_id=? AND id=?", r.PathValue("cid"), r.PathValue("event")).Error; e != nil {
		return missing()
	}
	r.SetPathValue("id", event.ConversationID)
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if event.MessageSequence != 0 && event.MessageSequence < a.HistoryFromSequence {
			return missing()
		}
		var member Membership
		if e := tx.First(&member, "company_id=? AND user_id=?", a.CompanyID, a.UserID).Error; e != nil {
			return e
		}
		row := tx.Model(&CommunicationInbox{}).Where("membership_epoch=? AND recipient_epoch=?", member.AccessEpoch, a.Epoch).Where("company_id=? AND user_id=? AND event_id=?", a.CompanyID, a.UserID, event.ID).Update("read", true)
		if row.Error != nil {
			return row.Error
		}
		if row.RowsAffected == 0 {
			return missing()
		}
		return nil
	})
	if e != nil {
		return e
	}
	return ok(w, "")
}
