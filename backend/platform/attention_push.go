package platform

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

// AttentionPush is the per-item, per-device native push intent for an Inbox
// attention item. It is separate from CommunicationPush because that worker
// resolves every claimed row as a CommunicationEvent.
type AttentionPush struct {
	ItemID     string `gorm:"primaryKey;size:80"`
	DeviceID   string `gorm:"primaryKey;size:80"`
	EventID    string `gorm:"size:80"`
	CompanyID  string
	UserID     string
	Attempts   int
	Done       bool
	LeaseUntil *time.Time
	LeaseToken string
	CreatedAt  time.Time
}

// Locally delivered items older than this never start a native push, so a new
// device or this feature's rollout cannot replay an old Inbox backlog.
const attentionPushFreshness = 24 * time.Hour

// A provider error (other than an expired registration) retries at most this many attempts.
const attentionPushMaxAttempts = 5

// RunAttentionPush sends body-free {eventId, companyId, attentionId} hints for
// open Inbox items after RunAttention has locally delivered them, i.e. after the
// recipient's attention working/quiet-hour, due and snooze policy allowed it.
// Every send re-authorizes the recipient exactly as GET /attention does.
func (s *Server) RunAttentionPush(ctx context.Context, now time.Time) (int, error) {
	if s.opts.PushSender == nil {
		return 0, nil
	}
	now = now.UTC()
	var candidates []AttentionPush
	if e := s.db.WithContext(ctx).Table("attention_items i").Distinct("i.id AS item_id", "dv.id AS device_id", "i.company_id", "i.recipient_id AS user_id").
		Joins("JOIN attention_deliveries ad ON ad.company_id=i.company_id AND ad.item_id=i.id AND ad.recipient_id=i.recipient_id AND ad.created_at>?", now.Add(-attentionPushFreshness)).
		Joins("JOIN communication_devices dv ON dv.user_id=i.recipient_id AND dv.active=? AND dv.push_provider<>'' AND dv.push_token<>''", true).
		Joins("JOIN sessions ss ON ss.token_hash=dv.session_hash AND ss.user_id=dv.user_id AND ss.expires_at>?", now).
		Joins("JOIN users pu ON pu.id=ss.user_id AND pu.suspended=false AND pu.session_epoch=ss.session_epoch AND pu.session_epoch>0").
		Joins("JOIN memberships pm ON pm.user_id=i.recipient_id AND pm.company_id=i.company_id AND pm.active=true AND pm.access_epoch=i.membership_epoch").
		Joins("LEFT JOIN attention_pushes p ON p.item_id=i.id AND p.device_id=dv.id").
		Where("i.state=? AND p.item_id IS NULL", "open").Order("item_id,device_id").Limit(100).Scan(&candidates).Error; e != nil {
		return 0, e
	}
	for _, job := range candidates {
		job.EventID = newID("attnpush")
		job.CreatedAt = now
		if e := s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&job).Error; e != nil {
			return 0, e
		}
	}
	claimed := []AttentionPush{}
	token := newID("lease")
	until := now.Add(time.Minute)
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := tx.Where("done=? AND (lease_until IS NULL OR lease_until<?)", false, now).Order("item_id,device_id").Limit(100)
		if tx.Dialector.Name() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		if e := q.Find(&claimed).Error; e != nil {
			return e
		}
		for _, job := range claimed {
			if e := tx.Model(&AttentionPush{}).Where("item_id=? AND device_id=?", job.ItemID, job.DeviceID).Updates(map[string]any{"lease_until": until, "lease_token": token, "attempts": gorm.Expr("attempts+1")}).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return 0, e
	}
	sent := 0
	var failure error
	for _, job := range claimed {
		device, hint, send, e := s.authorizeAttentionPush(ctx, job, token, now)
		if e != nil {
			_ = s.db.WithContext(ctx).Model(&AttentionPush{}).Where("item_id=? AND device_id=? AND lease_token=?", job.ItemID, job.DeviceID, token).Update("lease_until", now.Add(30*time.Second)).Error
			return sent, e
		}
		if !send {
			continue
		}
		// No transaction or lock is held across the provider call.
		bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
		e = s.opts.PushSender.Send(bounded, device, hint)
		cancel()
		e = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			switch {
			case errors.Is(e, ErrPushDeviceGone):
				if e := tx.Model(&CommunicationDevice{}).Where("id=? AND push_token=?", device.ID, device.PushToken).Update("push_token", "").Error; e != nil {
					return e
				}
				return finishAttentionPush(tx, job, token)
			case e != nil:
				if failure == nil {
					failure = e
				}
				if job.Attempts+1 >= attentionPushMaxAttempts {
					return finishAttentionPush(tx, job, token)
				}
				return tx.Model(&AttentionPush{}).Where("item_id=? AND device_id=? AND lease_token=?", job.ItemID, job.DeviceID, token).Updates(map[string]any{"lease_until": now.Add(30 * time.Second), "lease_token": ""}).Error
			default:
				if e := finishAttentionPush(tx, job, token); e != nil {
					return e
				}
				sent++
				return nil
			}
		})
		if e != nil {
			return sent, e
		}
	}
	return sent, failure
}

// authorizeAttentionPush re-authorizes one leased intent in a short transaction
// and commits before any provider call. It retires denied/stale intents, defers
// quiet ones, and otherwise returns the device and opaque hint to send.
func (s *Server) authorizeAttentionPush(ctx context.Context, job AttentionPush, token string, now time.Time) (CommunicationDevice, PushHint, bool, error) {
	var device CommunicationDevice
	var hint PushHint
	send := false
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		retire := func() error { return finishAttentionPush(tx, job, token) }
		later := func() error {
			return tx.Model(&AttentionPush{}).Where("item_id=? AND device_id=? AND lease_token=?", job.ItemID, job.DeviceID, token).Updates(map[string]any{"lease_until": now.Add(time.Minute), "lease_token": ""}).Error
		}
		// Deferred intents never outlive the delivery freshness window.
		if job.CreatedAt.Before(now.Add(-attentionPushFreshness)) {
			return retire()
		}
		if e := tx.First(&device, "id=? AND user_id=? AND active=?", job.DeviceID, job.UserID, true).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return retire()
			}
			return e
		}
		if device.PushProvider == "" || device.PushToken == "" {
			return retire()
		}
		// Lock order matches HTTP access fences (session, sorted memberships,
		// users, then private source rows) without the company write fence.
		var session SessionRecord
		if e := lockCommunicationRow(tx, "SHARE").First(&session, "user_id=? AND token_hash=? AND expires_at>?", job.UserID, device.SessionHash, now).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return retire()
			}
			return e
		}
		a, e := currentAttentionActorLocked(tx, job.CompanyID, job.UserID)
		if e != nil {
			if attentionMissing(e) {
				return retire()
			}
			return e
		}
		// Retire only on a definite session denial; transient errors retry.
		var u User
		if e := lockCommunicationRow(tx, "SHARE").First(&u, "id=?", session.UserID).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return retire()
			}
			return e
		}
		if !validCurrentSession(session, u) {
			return retire()
		}
		var item AttentionItem
		if e := tx.First(&item, "company_id=? AND recipient_id=? AND id=?", job.CompanyID, job.UserID, job.ItemID).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return retire()
			}
			return e
		}
		if item.State != "open" {
			return retire()
		}
		// Same live SQL scope and source projection as GET /attention.
		var visible int64
		if e := attentionCandidates(tx, a).Where("id=?", item.ID).Count(&visible).Error; e != nil {
			return e
		}
		if visible == 0 {
			return retire()
		}
		if _, e := attentionSource(tx, a, item); e != nil {
			if attentionMissing(e) {
				return retire()
			}
			return e
		}
		var devicePref CommunicationPreference
		e = tx.First(&devicePref, "company_id=? AND device_id=?", job.CompanyID, job.DeviceID).Error
		if e != nil && e != gorm.ErrRecordNotFound {
			return e
		}
		if devicePref.Muted {
			return retire()
		}
		if item.SnoozedUntil != nil && item.SnoozedUntil.After(now) {
			return later()
		}
		pref, e := attentionPreference(tx, item.CompanyID, item.RecipientID)
		if e != nil {
			return e
		}
		at, e := nextAttentionWindow(pref, a.Company.Timezone, now)
		if e != nil {
			return retire()
		}
		if at.After(now) || quietAttention(devicePref, now) {
			return later()
		}
		// Keep the lease for the send; extend it in case earlier sends were slow.
		until := now
		if real := time.Now().UTC(); real.After(until) {
			until = real
		}
		r := tx.Model(&AttentionPush{}).Where("item_id=? AND device_id=? AND lease_token=? AND done=?", job.ItemID, job.DeviceID, token, false).Update("lease_until", until.Add(time.Minute))
		if r.Error != nil {
			return r.Error
		}
		send = r.RowsAffected == 1
		hint = PushHint{EventID: job.EventID, CompanyID: job.CompanyID, AttentionID: item.ID}
		return nil
	})
	return device, hint, send, e
}
func finishAttentionPush(tx *gorm.DB, job AttentionPush, token string) error {
	return tx.Model(&AttentionPush{}).Where("item_id=? AND device_id=? AND lease_token=?", job.ItemID, job.DeviceID, token).Updates(map[string]any{"done": true, "lease_until": nil, "lease_token": ""}).Error
}
