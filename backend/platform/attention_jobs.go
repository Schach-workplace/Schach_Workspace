package platform

import (
	"context"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strconv"
	"time"
)

func attentionClock(value string) (int, error) {
	t, e := time.Parse("15:04", value)
	if e != nil || t.Format("15:04") != value {
		return 0, invalid("Use a valid HH:MM clock.")
	}
	return t.Hour()*60 + t.Minute(), nil
}
func attentionAllowed(p AttentionPreference, local time.Time) bool {
	minute := local.Hour()*60 + local.Minute()
	day := int(local.Weekday())
	if day == 0 {
		day = 7
	}
	if p.WorkingHoursEnabled {
		start, _ := attentionClock(p.WorkingStart)
		end, _ := attentionClock(p.WorkingEnd)
		startDay := day
		allowed := false
		if start < end {
			allowed = minute >= start && minute < end
		} else {
			allowed = minute >= start || minute < end
			if minute < end {
				startDay--
				if startDay == 0 {
					startDay = 7
				}
			}
		}
		found := false
		for _, d := range p.WorkingDays {
			if d == startDay {
				found = true
			}
		}
		if !allowed || !found {
			return false
		}
	}
	if p.QuietStart != "" {
		start, _ := attentionClock(p.QuietStart)
		end, _ := attentionClock(p.QuietEnd)
		if start < end {
			if minute >= start && minute < end {
				return false
			}
		} else if minute >= start || minute < end {
			return false
		}
	}
	return true
}
func nextAttentionWindow(p AttentionPreference, zone string, now time.Time) (time.Time, error) {
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return time.Time{}, invalid("Company timezone is invalid.")
	}
	if p.WorkingHoursEnabled {
		if len(p.WorkingDays) == 0 {
			return time.Time{}, invalid("Choose at least one working weekday.")
		}
		start, e := attentionClock(p.WorkingStart)
		if e != nil {
			return time.Time{}, e
		}
		end, e := attentionClock(p.WorkingEnd)
		if e != nil {
			return time.Time{}, e
		}
		if start == end {
			return time.Time{}, invalid("Working window must not be empty.")
		}
		seen := map[int]bool{}
		for _, d := range p.WorkingDays {
			if d < 1 || d > 7 || seen[d] {
				return time.Time{}, invalid("Working days must be unique ISO weekdays.")
			}
			seen[d] = true
		}
	}
	if (p.QuietStart == "") != (p.QuietEnd == "") {
		return time.Time{}, invalid("Set both quiet-hour clocks.")
	}
	if p.QuietStart != "" {
		start, e := attentionClock(p.QuietStart)
		if e != nil {
			return time.Time{}, e
		}
		end, e := attentionClock(p.QuietEnd)
		if e != nil {
			return time.Time{}, e
		}
		if start == end {
			return time.Time{}, invalid("All-day quiet leaves no delivery window.")
		}
	}
	now = now.UTC()
	if attentionAllowed(p, now.In(loc)) {
		return now, nil
	}
	candidate := now.Truncate(time.Minute).Add(time.Minute)
	end := now.In(loc).AddDate(0, 0, 14)
	for !candidate.After(end) {
		if attentionAllowed(p, candidate.In(loc)) {
			return candidate, nil
		}
		candidate = candidate.Add(time.Minute)
	}
	return time.Time{}, invalid("No allowed attention window in the next 14 local days.")
}

// RunAttention bounds both identifier scheduling and local delivery. Lease claims
// are independent short transactions; final authorization locks business company,
// current sorted directory, private conversation, then the claimed dependent row.
func (s *Server) RunAttention(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	now = now.UTC()
	var items []AttentionItem
	q := s.db.WithContext(ctx).Where("state=? AND NOT EXISTS (SELECT 1 FROM attention_reminders r WHERE r.company_id=attention_items.company_id AND r.item_id=attention_items.id AND r.stage='initial' AND r.window_key=CAST(attention_items.version AS TEXT))", "open")
	if e := q.Order("updated_at,id").Limit(limit).Find(&items).Error; e != nil {
		return 0, e
	}
	for _, item := range items {
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, item.CompanyID); e != nil {
				return e
			}
			a, e := currentAttentionActorLocked(tx, item.CompanyID, item.RecipientID)
			if e != nil {
				if attentionMissing(e) {
					return deferAttentionAttempt(tx, item)
				}
				return e
			}
			if _, e = attentionSource(tx, a, item); e != nil {
				if attentionMissing(e) {
					return deferAttentionAttempt(tx, item)
				}
				return e
			}
			if e = lockCommunicationRow(tx, "UPDATE").First(&item, "id=?", item.ID).Error; e != nil {
				return e
			}
			if item.State != "open" {
				return nil
			}
			pref, e := attentionPreference(tx, item.CompanyID, item.RecipientID)
			if e != nil {
				return e
			}
			at := now
			if item.DueAt != nil && item.DueAt.After(at) {
				at = *item.DueAt
			}
			if item.SnoozedUntil != nil && item.SnoozedUntil.After(at) {
				at = *item.SnoozedUntil
			}
			at, e = nextAttentionWindow(pref, a.Company.Timezone, at)
			if e != nil {
				return deferAttentionAttempt(tx, item)
			}
			key := strconv.FormatInt(item.Version, 10)
			if e = scheduleAttentionReminder(tx, item, "initial", key, at); e != nil {
				return e
			}
			if pref.EscalationEnabled {
				escalateAt := item.CreatedAt.Add(time.Duration(pref.EscalationAfterMinutes) * time.Minute)
				if escalateAt.Before(at) {
					escalateAt = at
				}
				if e = attentionCanRoute(tx, a, item, pref.EscalationUserID); e == nil {
					targetPref, e := attentionPreference(tx, item.CompanyID, pref.EscalationUserID)
					if e != nil {
						return e
					}
					escalateAt, e = nextAttentionWindow(targetPref, a.Company.Timezone, escalateAt)
					if e == nil {
						return scheduleAttentionReminder(tx, item, "escalation", key, escalateAt)
					}
				}
			}
			return nil
		})
		if e != nil {
			return 0, e
		}
	}
	delivered := 0
	for n := 0; n < limit; n++ {
		var job AttentionReminder
		token := newID("lease")
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			q := lockCommunicationRow(tx, "UPDATE")
			if tx.Dialector.Name() == "postgres" {
				q = tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
			}
			if e := q.Where("delivered_at IS NULL AND cancelled_at IS NULL AND available_at<=? AND (lease_until IS NULL OR lease_until<=?)", now, now).Order("available_at,id").First(&job).Error; e != nil {
				return e
			}
			until := now.Add(time.Minute)
			return tx.Model(&job).Updates(map[string]any{"lease_token": token, "lease_until": until, "attempts": gorm.Expr("attempts+1")}).Error
		})
		if e == gorm.ErrRecordNotFound {
			break
		}
		if e != nil {
			return delivered, e
		}
		completed := false
		e = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, job.CompanyID); e != nil {
				return e
			}
			cancel := false
			a, e := currentAttentionActorLocked(tx, job.CompanyID, job.RecipientID)
			if e != nil {
				if !attentionMissing(e) {
					return e
				}
				cancel = true
			}
			var item AttentionItem
			if e := tx.First(&item, "company_id=? AND id=?", job.CompanyID, job.ItemID).Error; e != nil {
				if e != gorm.ErrRecordNotFound {
					return e
				}
				cancel = true
			}
			if !cancel {
				if _, e := attentionSource(tx, a, item); e != nil {
					if !attentionMissing(e) {
						return e
					}
					cancel = true
				}
			}
			if item.State != "open" || strconv.FormatInt(item.Version, 10) != job.WindowKey {
				cancel = true
			}
			var locked AttentionReminder
			if e := lockCommunicationRow(tx, "UPDATE").First(&locked, "id=? AND lease_token=? AND delivered_at IS NULL AND cancelled_at IS NULL", job.ID, token).Error; e != nil {
				if e == gorm.ErrRecordNotFound {
					return nil
				}
				return e
			}
			if locked.LeaseUntil == nil || !locked.LeaseUntil.After(now) {
				return nil
			}
			updates := map[string]any{"lease_until": nil, "lease_token": ""}
			if cancel {
				updates["cancelled_at"] = now
				return tx.Model(&locked).Where("lease_token=?", token).Updates(updates).Error
			}
			pref, e := attentionPreference(tx, item.CompanyID, item.RecipientID)
			if e != nil {
				return e
			}
			recipient := item.RecipientID
			allowedPref := pref
			if job.Stage == "escalation" {
				if !pref.EscalationEnabled || attentionCanRoute(tx, a, item, pref.EscalationUserID) != nil {
					updates["cancelled_at"] = now
					return tx.Model(&locked).Where("lease_token=?", token).Updates(updates).Error
				}
				recipient = pref.EscalationUserID
				allowedPref, e = attentionPreference(tx, item.CompanyID, recipient)
				if e != nil {
					return e
				}
			}
			at := now
			if item.SnoozedUntil != nil && item.SnoozedUntil.After(at) {
				at = *item.SnoozedUntil
			}
			at, e = nextAttentionWindow(allowedPref, a.Company.Timezone, at)
			if e != nil {
				updates["cancelled_at"] = now
				return tx.Model(&locked).Where("lease_token=?", token).Updates(updates).Error
			}
			if at.After(now) {
				updates["available_at"] = at
				return tx.Model(&locked).Where("lease_token=?", token).Updates(updates).Error
			}
			if job.Stage == "escalation" {
				target := item
				target.ID = newID("attention")
				target.RecipientID = recipient
				target.OccurrenceKey = "escalation:" + rootAttentionOccurrence(item.OccurrenceKey) + ":" + payloadHash([]string{item.ID, job.WindowKey})
				target.Version = 1
				target.SnoozedUntil = nil
				target.CreatedAt = now
				target.UpdatedAt = now
				if item.SourceKind == "record" {
					scope, e := conversationAccess(tx, recipient, item.CompanyID, item.ConversationID)
					if e != nil {
						return e
					}
					target.RecipientEpoch = scope.Epoch
				}
				if e := ensureAttentionItem(tx, target); e != nil {
					return e
				}
			}
			delivery := AttentionDelivery{ID: job.ID, CompanyID: job.CompanyID, ItemID: job.ItemID, RecipientID: recipient, Stage: job.Stage, CreatedAt: now}
			if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&delivery).Error; e != nil {
				return e
			}
			updates["delivered_at"] = now
			completed = true
			return tx.Model(&locked).Where("lease_token=?", token).Updates(updates).Error
		})
		if e != nil {
			return delivered, e
		}
		if completed {
			delivered++
		}
	}
	return delivered, nil
}
func scheduleAttentionReminder(tx *gorm.DB, item AttentionItem, stage, key string, at time.Time) error {
	claimed, e := claimAutomation(tx, item.CompanyID, "attention:"+item.ID+":"+stage+":"+key)
	if e != nil || !claimed {
		return e
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&AttentionReminder{ID: newID("reminder"), CompanyID: item.CompanyID, ItemID: item.ID, RecipientID: item.RecipientID, Stage: stage, WindowKey: key, AvailableAt: at}).Error
}

// Inaccessible/invalid-policy candidates remain retryable without claiming a stage.
// Advance their scan position so a bounded revoked prefix cannot starve later work.
func deferAttentionAttempt(tx *gorm.DB, item AttentionItem) error {
	return tx.Model(&AttentionItem{}).Where("id=? AND version=?", item.ID, item.Version).Update("updated_at", time.Now().UTC()).Error
}
