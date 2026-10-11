package platform

import (
	"context"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"net/url"
	"time"
)

type GoalReminderPreference struct {
	MembershipEpoch int64      `json:"-" gorm:"not null;default:1"`
	CompanyID       string     `json:"-" gorm:"primaryKey"`
	GoalID          string     `json:"goalId" gorm:"primaryKey"`
	UserID          string     `json:"userId" gorm:"primaryKey"`
	Version         int64      `json:"version"`
	Enabled         bool       `json:"enabled"`
	Cadence         string     `json:"cadence"`
	Weekday         int        `json:"weekday"`
	MonthDay        int        `json:"monthDay"`
	LocalTime       string     `json:"localTime"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	CheckedAt       *time.Time `json:"-"`
}
type goalOccurrence struct {
	Key, Period       string
	Start, End, DueAt time.Time
}

// Resolve a local clock by matching actual minutes: first fold instant, then
// first valid minute after a gap. UTC stepping avoids Go's implicit gap choice.
func goalWallClock(date, clock, zone string) (time.Time, error) {
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return time.Time{}, invalid("Invalid company timezone.")
	}
	if _, e := attentionClock(clock); e != nil {
		return time.Time{}, e
	}
	day, e := time.Parse("2006-01-02", date)
	if e != nil {
		return time.Time{}, e
	}
	target := date + "T" + clock
	start := day.Add(-26 * time.Hour)
	end := day.Add(50 * time.Hour)
	var next time.Time
	for at := start; at.Before(end); at = at.Add(time.Minute) {
		local := at.In(loc)
		wall := local.Format("2006-01-02T15:04")
		if wall == target {
			return at.UTC(), nil
		}
		if local.Format("2006-01-02") == date && wall > target && (next.IsZero() || wall < next.In(loc).Format("2006-01-02T15:04")) {
			next = at
		}
	}
	if !next.IsZero() {
		return next.UTC(), nil
	}
	return time.Time{}, invalid("Scheduled local date has no valid minute.")
}
func latestGoalOccurrence(p GoalReminderPreference, zone string, now time.Time) (goalOccurrence, error) {
	var o goalOccurrence
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return o, invalid("Invalid company timezone.")
	}
	if !in(p.Cadence, "weekly", "monthly") || p.Weekday < 1 || p.Weekday > 7 || p.MonthDay < 1 || p.MonthDay > 28 {
		return o, invalid("Invalid goal reminder cadence.")
	}
	local := now.In(loc)
	var start time.Time
	if p.Cadence == "weekly" {
		start = time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -(int(local.Weekday())+6)%7)
	} else {
		start = time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	for i := 0; i < 2; i++ {
		dueDate := start.AddDate(0, 0, p.Weekday-1)
		end := start.AddDate(0, 0, 7)
		year, week := start.ISOWeek()
		period := fmt.Sprintf("%04d-W%02d", year, week)
		if p.Cadence == "monthly" {
			dueDate = start.AddDate(0, 0, p.MonthDay-1)
			end = start.AddDate(0, 1, 0)
			period = start.Format("2006-01")
		}
		due, e := goalWallClock(dueDate.Format("2006-01-02"), p.LocalTime, zone)
		if e != nil {
			return o, e
		}
		if !due.After(now) {
			begin, e := goalWallClock(start.Format("2006-01-02"), "00:00", zone)
			if e != nil {
				return o, e
			}
			finish, e := goalWallClock(end.Format("2006-01-02"), "00:00", zone)
			if e != nil {
				return o, e
			}
			o = goalOccurrence{Period: period, Start: begin, End: finish, DueAt: due, Key: fmt.Sprintf("goal-update:%s:%s:%s:%s:%s:%d:%d:%s", p.CompanyID, p.GoalID, p.UserID, p.Cadence, period, p.Version, p.MembershipEpoch, payloadHash([]any{zone, "fold_first_gap_next_v1"})[:12])}
			return o, nil
		}
		if p.Cadence == "weekly" {
			start = start.AddDate(0, 0, -7)
		} else {
			start = start.AddDate(0, -1, 0)
		}
	}
	return o, invalid("Could not resolve reminder period.")
}
func goalReminderPreference(tx *gorm.DB, a *access, g Goal) (GoalReminderPreference, error) {
	p := GoalReminderPreference{CompanyID: a.Company.ID, GoalID: g.ID, UserID: a.User.ID, Cadence: "weekly", Weekday: 1, MonthDay: 1, LocalTime: "09:00"}
	e := tx.First(&p, "company_id=? AND goal_id=? AND user_id=?", a.Company.ID, g.ID, a.User.ID).Error
	if e == gorm.ErrRecordNotFound {
		return p, nil
	}
	return p, e
}
func goalReminderOwner(tx *gorm.DB, a *access, id string) (Goal, error) {
	g, e := scopedGoal(tx, a, id)
	if e != nil {
		return g, e
	}
	if g.OwnerID != a.User.ID {
		return g, denied()
	}
	return g, measureAuthority(tx, a, g)
}
func (s *Server) goalReminderRead(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var p GoalReminderPreference
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		g, e := goalReminderOwner(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		p, e = goalReminderPreference(tx, a, g)
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"preference": p})
}

type goalReminderInput struct {
	RetryKey        string `json:"retryKey"`
	ExpectedVersion int64  `json:"expectedVersion"`
	Reason          string `json:"reason"`
	Enabled         bool   `json:"enabled"`
	Cadence         string `json:"cadence"`
	Weekday         int    `json:"weekday"`
	MonthDay        int    `json:"monthDay"`
	LocalTime       string `json:"localTime"`
}

func (s *Server) goalReminderWrite(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var i goalReminderInput
	if e = decode(w, r, &i); e != nil {
		return e
	}
	if !clean(i.Reason, 4000) || !in(i.Cadence, "weekly", "monthly") || i.Weekday < 1 || i.Weekday > 7 || i.MonthDay < 1 || i.MonthDay > 28 {
		return invalid("Choose weekly/monthly, weekday1–7, month day1–28 and explain the preference.")
	}
	if _, e = attentionClock(i.LocalTime); e != nil {
		return e
	}
	id := r.PathValue("id")
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var g Goal
		authorize := func() error { var e error; g, e = goalReminderOwner(tx, a, id); return e }
		var e error
		result, e = businessMutation(tx, a, "goal_reminder", i.RetryKey, []any{id, i}, authorize, func(result BusinessResult) error { _, e := goalReminderOwner(tx, a, result.IDs[0]); return e }, func() (BusinessResult, error) {
			p, e := goalReminderPreference(tx, a, g)
			if e != nil {
				return BusinessResult{}, e
			}
			if p.Version != i.ExpectedVersion {
				return BusinessResult{}, conflict()
			}
			now := time.Now().UTC().Truncate(time.Microsecond)
			p.Version++
			p.MembershipEpoch = a.Member.AccessEpoch
			p.Enabled = i.Enabled
			p.Cadence = i.Cadence
			p.Weekday = i.Weekday
			p.MonthDay = i.MonthDay
			p.LocalTime = i.LocalTime
			p.UpdatedAt = now
			p.CheckedAt = nil
			if p.CreatedAt.IsZero() {
				p.CreatedAt = now
			}
			if e = tx.Save(&p).Error; e != nil {
				return BusinessResult{}, e
			}
			if e = syncGoalAttention(tx, a, &g, g); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "goal_reminder", IDs: []string{id}, Versions: []int64{p.Version}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": id, "preferenceVersion": result.Versions[0]})
}
func goalPeriodMeasured(tx *gorm.DB, g Goal, o goalOccurrence, now time.Time) (bool, error) {
	var n int64
	e := tx.Model(&GoalMeasurement{}).Where("company_id=? AND goal_id=? AND unit=? AND effective_at>=? AND effective_at<? AND created_at<=?", g.CompanyID, g.ID, g.Unit, o.Start, o.End, now).Count(&n).Error
	return n > 0, e
}
func projectGoalAttention(tx *gorm.DB, a *access, item AttentionItem, replay bool, v AttentionView) (AttentionView, error) {
	g, e := scopedGoal(tx, a, item.SourceID)
	if e != nil {
		return v, e
	}
	if g.OwnerID != a.User.ID || measureAuthority(tx, a, g) != nil || item.Kind != "update" {
		return v, missing()
	}
	p, e := goalReminderPreference(tx, a, g)
	if e != nil {
		return v, e
	}
	if p.MembershipEpoch != a.Member.AccessEpoch || !p.Enabled || p.Version != item.GoalPreferenceVersion || a.Company.Timezone != item.GoalTimezone {
		return v, missing()
	}
	if !replay {
		o, e := latestGoalOccurrence(p, a.Company.Timezone, time.Now().UTC())
		if e != nil {
			return v, e
		}
		if o.Key != item.OccurrenceKey || o.DueAt.Before(p.UpdatedAt) {
			return v, missing()
		}
		measured, e := goalPeriodMeasured(tx, g, o, time.Now().UTC())
		if e != nil {
			return v, e
		}
		if measured {
			return v, missing()
		}
	}
	v.Title = "Goal update reminder"
	v.Summary = "Record an independently measured update when ready. Resolving this reminder does not update the measured result."
	v.SourceVersion = g.Version
	v.Link = "#goals?company=" + url.QueryEscape(a.Company.ID) + "&goal=" + url.QueryEscape(g.ID)
	v.CanRoute = false
	v.CanDecide = false
	return v, nil
}
func syncGoalAttention(tx *gorm.DB, a *access, before *Goal, after Goal) error {
	var items []AttentionItem
	if e := tx.Where("company_id=? AND source_kind='goal' AND source_id=? AND state='open'", after.CompanyID, after.ID).Find(&items).Error; e != nil {
		return e
	}
	for _, item := range items {
		other := attentionForMember(a, item.RecipientID)
		if _, e := projectGoalAttention(tx, other, item, false, AttentionView{}); e != nil {
			if !attentionMissing(e) {
				return e
			}
			if e := tx.Model(&AttentionItem{}).Where("id=?", item.ID).Updates(map[string]any{"state": "superseded", "version": gorm.Expr("version+1"), "updated_at": time.Now().UTC()}).Error; e != nil {
				return e
			}
			if e := tx.Model(&AttentionReminder{}).Where("item_id=? AND delivered_at IS NULL AND cancelled_at IS NULL", item.ID).Update("cancelled_at", time.Now().UTC()).Error; e != nil {
				return e
			}
		}
	}
	return nil
}
func ensureGoalReminder(tx *gorm.DB, a *access, p GoalReminderPreference, now time.Time) error {
	g, e := scopedGoal(tx, a, p.GoalID)
	if e != nil {
		if attentionMissing(e) {
			return nil
		}
		return e
	}
	if p.MembershipEpoch != a.Member.AccessEpoch || !p.Enabled || g.OwnerID != p.UserID || measureAuthority(tx, a, g) != nil {
		return nil
	}
	o, e := latestGoalOccurrence(p, a.Company.Timezone, now)
	if e != nil {
		return e
	}
	if o.DueAt.Before(p.UpdatedAt) {
		return nil
	}
	measured, e := goalPeriodMeasured(tx, g, o, now)
	if e != nil {
		return e
	}
	if measured {
		return syncGoalAttention(tx, a, &g, g)
	}
	if e = supersedeAttention(tx, g.CompanyID, "goal", g.ID, "update", o.Key); e != nil {
		return e
	}
	claimed, e := claimAutomation(tx, g.CompanyID, o.Key)
	if e != nil || !claimed {
		return e
	}
	return ensureAttentionItem(tx, AttentionItem{CompanyID: g.CompanyID, RecipientID: p.UserID, SourceKind: "goal", SourceID: g.ID, SourceRevision: g.Version, Kind: "update", OccurrenceKey: o.Key, DueAt: &o.DueAt, GoalPreferenceVersion: p.Version, GoalPeriodStart: &o.Start, GoalPeriodEnd: &o.End, GoalTimezone: a.Company.Timezone})
}
func (s *Server) generateGoalReminders(ctx context.Context, now time.Time, limit int) error {
	var prefs []GoalReminderPreference
	if e := s.db.WithContext(ctx).Where("enabled=?", true).Order("checked_at ASC NULLS FIRST,company_id,goal_id,user_id").Limit(limit).Find(&prefs).Error; e != nil {
		return e
	}
	for _, p := range prefs {
		if e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, p.CompanyID); e != nil {
				return e
			}
			a, e := currentAttentionActorLocked(tx, p.CompanyID, p.UserID)
			if e != nil {
				if !attentionMissing(e) {
					return e
				}
			} else {
				var current GoalReminderPreference
				if e = tx.First(&current, "company_id=? AND goal_id=? AND user_id=?", p.CompanyID, p.GoalID, p.UserID).Error; e != nil {
					return e
				}
				if e = ensureGoalReminder(tx, a, current, now); e != nil {
					return e
				}
			}
			return tx.Model(&GoalReminderPreference{}).Where("company_id=? AND goal_id=? AND user_id=?", p.CompanyID, p.GoalID, p.UserID).UpdateColumn("checked_at", now).Error
		}); e != nil {
			return e
		}
	}
	return nil
}
func goalAttentionCandidates(tx *gorm.DB, a *access) *gorm.DB {
	return tx.Model(&AttentionItem{}).Where(`company_id=? AND recipient_id=? AND source_kind='goal' AND kind='update' AND goal_timezone=? AND source_id IN (?) AND EXISTS (SELECT 1 FROM goal_reminder_preferences p JOIN goals g ON g.company_id=p.company_id AND g.id=p.goal_id WHERE p.company_id=attention_items.company_id AND p.goal_id=attention_items.source_id AND p.user_id=attention_items.recipient_id AND p.enabled=? AND p.membership_epoch=attention_items.membership_epoch AND p.version=attention_items.goal_preference_version AND g.owner_id=p.user_id AND attention_items.due_at>=p.updated_at AND NOT EXISTS (SELECT 1 FROM goal_measurements m WHERE m.company_id=g.company_id AND m.goal_id=g.id AND m.unit=g.unit AND m.effective_at>=attention_items.goal_period_start AND m.effective_at<attention_items.goal_period_end))`, a.Company.ID, a.User.ID, a.Company.Timezone, goalReadQuery(tx, a).Select("id").Where("owner_id=?", a.User.ID), true)
}
