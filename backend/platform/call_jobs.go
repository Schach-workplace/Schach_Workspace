package platform

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

type CommunicationCallJob struct {
	CallID     string `gorm:"primaryKey;size:80"`
	Operation  string `gorm:"primaryKey;size:40"`
	Identity   string `gorm:"primaryKey;size:180"`
	CompanyID  string
	Room       string
	Attempts   int
	LeaseUntil *time.Time
	LeaseToken string
	Done       bool
}

func enqueueCallJob(tx *gorm.DB, call CommunicationCall, operation, identity string) error {
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&CommunicationCallJob{CallID: call.ID, CompanyID: call.CompanyID, Room: call.Room, Operation: operation, Identity: identity}).Error
}
func (s *Server) RunCallCleanup(ctx context.Context) (int, error) {
	if !s.callsConfigured() {
		return 0, nil
	}
	jobs := []CommunicationCallJob{}
	token := newID("lease")
	until := time.Now().UTC().Add(time.Minute)
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := tx.Where("done=? AND (lease_until IS NULL OR lease_until<?)", false, time.Now().UTC()).Order("call_id,operation,identity").Limit(100)
		if tx.Dialector.Name() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		if e := q.Find(&jobs).Error; e != nil {
			return e
		}
		for _, job := range jobs {
			if e := tx.Model(&job).Updates(map[string]any{"lease_token": token, "lease_until": until, "attempts": gorm.Expr("attempts+1")}).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return 0, e
	}
	count := 0
	for _, job := range jobs {
		body := map[string]string{"room": job.Room}
		if job.Identity != "" {
			body["identity"] = job.Identity
		}
		e := s.liveKitAdmin(ctx, job.Operation, body)
		q := s.db.WithContext(ctx).Model(&CommunicationCallJob{}).Where("call_id=? AND operation=? AND identity=? AND lease_token=?", job.CallID, job.Operation, job.Identity, token)
		if e != nil {
			backoff := time.Now().UTC().Add(time.Duration(min(job.Attempts+1, 60)) * time.Second)
			_ = q.Update("lease_until", backoff).Error
			return count, e
		}
		if e := q.Updates(map[string]any{"done": true, "lease_until": nil, "lease_token": ""}).Error; e != nil {
			return count, e
		}
		count++
	}
	return count, nil
}

// Removing provider participants is required in addition to closing signaling.
// Never remove an identity if a newer authorized grant currently owns it.
func (s *Server) RunCallRevocations(ctx context.Context) (int, error) {
	if !s.callsConfigured() {
		return 0, nil
	}
	grants := []CommunicationCallGrant{}
	if e := s.db.WithContext(ctx).Where("active=?", true).Order("checked_at,id").Limit(1000).Find(&grants).Error; e != nil {
		return 0, e
	}
	count := 0
	for _, grant := range grants {
		if e := s.db.WithContext(ctx).Model(&CommunicationCallGrant{}).Where("id=?", grant.ID).Update("checked_at", time.Now().UTC()).Error; e != nil {
			return count, e
		}
		metadata := `{"schachGrant":"` + grant.ID + `"}`
		var call CommunicationCall
		if e := s.db.WithContext(ctx).First(&call, "company_id=? AND id=?", grant.CompanyID, grant.CallID).Error; e != nil {
			return count, e
		}
		claims := liveKitClaims{Subject: grant.Identity, Metadata: metadata, Video: map[string]any{"room": call.Room}}
		if e := s.authorizeCallGrant(ctx, claims, grant.CompanyID, grant.CallID, false); e == nil {
			continue
		} else {
			var api *apiError
			if !errors.As(e, &api) {
				return count, e
			}
		}
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var c Conversation
			if e := lockCommunicationRow(tx, "UPDATE").First(&c, "company_id=? AND id=?", grant.CompanyID, grant.ConversationID).Error; e != nil {
				return e
			}
			if e := tx.Model(&CommunicationCallGrant{}).Where("id=?", grant.ID).Update("active", false).Error; e != nil {
				return e
			}
			var newer int64
			if e := tx.Model(&CommunicationCallGrant{}).Where("call_id=? AND identity=? AND active=? AND id<>?", grant.CallID, grant.Identity, true, grant.ID).Count(&newer).Error; e != nil {
				return e
			}
			if newer == 0 {
				return enqueueCallJob(tx, call, "RemoveParticipant", grant.Identity)
			}
			return nil
		})
		if e != nil {
			return count, e
		}
		count++
	}
	return count, nil
}

// A call is unanswered until a different company user has actually upgraded
// provider signaling. Merely issuing a token does not count as an answer.
func (s *Server) RunMissedCalls(ctx context.Context, now time.Time) (int, error) {
	rows := []CommunicationCall{}
	if e := s.db.WithContext(ctx).Where("state=? AND created_at<? AND NOT EXISTS (SELECT 1 FROM communication_call_grants g WHERE g.call_id=communication_calls.id AND g.user_id<>communication_calls.created_by AND g.joined_at IS NOT NULL)", "active", now.UTC().Add(-time.Minute).Format(time.RFC3339Nano)).Order("created_at,id").Limit(100).Find(&rows).Error; e != nil {
		return 0, e
	}
	count := 0
	for _, row := range rows {
		changed := false
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var conv Conversation
			if e := lockCommunicationRow(tx, "UPDATE").First(&conv, "company_id=? AND id=?", row.CompanyID, row.ConversationID).Error; e != nil {
				return e
			}
			var call CommunicationCall
			if e := lockCommunicationRow(tx, "UPDATE").First(&call, "id=?", row.ID).Error; e != nil {
				return e
			}
			if call.State != "active" {
				return nil
			}
			var answered int64
			if e := tx.Model(&CommunicationCallGrant{}).Where("call_id=? AND user_id<>? AND joined_at IS NOT NULL", call.ID, call.CreatedBy).Count(&answered).Error; e != nil {
				return e
			}
			if answered > 0 {
				return nil
			}
			call.State = "missed"
			call.EndedAt = now.UTC().Format(time.RFC3339Nano)
			call.Version++
			if e := tx.Save(&call).Error; e != nil {
				return e
			}
			if e := tx.Model(&CommunicationCallGrant{}).Where("call_id=?", call.ID).Update("active", false).Error; e != nil {
				return e
			}
			if e := enqueueCallJob(tx, call, "DeleteRoom", ""); e != nil {
				return e
			}
			changed = true
			return appendCommunicationEvent(tx, &conversationScope{CompanyID: row.CompanyID, Conversation: conv}, "call_missed", "", 0)
		})
		if e != nil {
			return count, e
		}
		if changed {
			count++
		}
	}
	return count, nil
}
