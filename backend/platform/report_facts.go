package platform

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

func reportTaskState(tx *gorm.DB, t Task) (ReportTaskState, error) {
	var c Company
	if e := tx.First(&c, "id=?", t.CompanyID).Error; e != nil {
		return ReportTaskState{}, e
	}
	state := ReportTaskState{Code: t.Code, Title: t.Title, CreatedAtRaw: t.CreatedAt, OwnerID: t.OwnerID, ReviewerID: t.ReviewerID, CreatorID: t.CreatedBy, DepartmentID: t.DepartmentID, ProjectID: t.ProjectID, Status: t.Status, Priority: t.Priority, StartDate: t.StartDate, Progress: t.Progress, EstimatedHours: t.EstimatedHours, ActualHours: t.ActualHours, RequiresApproval: t.RequiresApproval, Original: ReportDeadline{t.OriginalDeadlineMode, t.OriginalDueDate, string(t.OriginalDueAt), t.OriginalDueTimezone}, Current: ReportDeadline{t.DeadlineMode, t.DueDate, string(t.DueAt), t.DueTimezone}, DeadlineReason: t.DeadlineChangeReason, CompletedAtRaw: t.CompletedAt, CompanyPolicyZone: c.Timezone, ParentID: t.ParentID, Dependencies: append([]string{}, t.Dependencies...)}
	if tx.Dialector.Name() == "postgres" {
		var previous TaskFact
		q := tx.Where("company_id=? AND task_id=?", t.CompanyID, t.ID).Order("task_version DESC").Limit(1).Find(&previous)
		if q.Error != nil {
			return state, q.Error
		}
		if q.RowsAffected > 0 {
			preserveExactDeadline(&state.Original, previous.State.Original)
			preserveExactDeadline(&state.Current, previous.State.Current)
		}
	}
	return state, nil
}

// PostgreSQL indexes round instants to microseconds. Retain the recorded source
// string for an unchanged SQL value instead of inventing a rounded commitment.
func preserveExactDeadline(current *ReportDeadline, previous ReportDeadline) {
	if current.Mode != previous.Mode || current.Date != previous.Date || current.Zone != previous.Zone {
		return
	}
	a, e := time.Parse(time.RFC3339Nano, current.At)
	if e != nil {
		return
	}
	b, e := time.Parse(time.RFC3339Nano, previous.At)
	if e != nil {
		return
	}
	if a.Nanosecond()%1000 == 0 && a.Equal(b.Truncate(time.Microsecond)) {
		current.At = previous.At
	}
}
func reportStateHash(v ReportTaskState) string {
	v.CompanyPolicyZone = "" // Policy belongs to the event, not the task revision identity.
	b, _ := json.Marshal(v)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
func ensureObservedTaskState(tx *gorm.DB, t Task, at time.Time) error {
	state, e := reportTaskState(tx, t)
	if e != nil {
		return e
	}
	hash := reportStateHash(state)
	var c TaskHistoryCoverage
	q := tx.Where("company_id=? AND task_id=?", t.CompanyID, t.ID).Find(&c)
	if q.Error != nil {
		return q.Error
	}
	if q.RowsAffected > 0 && c.LastRecordedVersion == t.Version {
		if c.StateHash != hash && !c.Inconsistent {
			var prev TaskFact
			if e := tx.First(&prev, "id=?", c.LastFactID).Error; e != nil {
				return e
			}
			gap := TaskHistoryGap{ID: newID("gap"), CompanyID: t.CompanyID, TaskID: t.ID, FromExclusive: prev.EffectiveAt, Reason: "same_version_divergence", BeforeFactID: prev.ID}
			if e := tx.Create(&gap).Error; e != nil {
				return e
			}
			return tx.Model(&c).Update("inconsistent", true).Error
		}
		return nil
	}
	f := TaskFact{ID: newID("tf"), CompanyID: t.CompanyID, TaskID: t.ID, TaskVersion: t.Version, RecordedAt: at, EffectiveAt: at, EffectiveAtRaw: at.UTC().Format(time.RFC3339Nano), Operation: "observation", ActorKind: "observation", Provenance: "observed_current_state", KnownFrom: at, UnknownBefore: true, StateHash: hash, State: state}
	if q.RowsAffected > 0 {
		f.KnownFrom = c.FirstKnownAt
		f.UnknownBefore = c.UnknownBefore
	}
	if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&f).Error; e != nil {
		return e
	}
	if q.RowsAffected > 0 {
		if e := recordReportGap(tx, c, f); e != nil {
			return e
		}
	} else {
		c = TaskHistoryCoverage{CompanyID: t.CompanyID, TaskID: t.ID, FirstKnownAt: at, UnknownBefore: true}
	}
	c.LastRecordedVersion = t.Version
	c.StateHash = hash
	c.LastFactID = f.ID
	c.Inconsistent = false
	if e := tx.Save(&c).Error; e != nil {
		return e
	}
	var entries []TimeEntry
	if e := tx.Where("company_id=? AND task_id=?", t.CompanyID, t.ID).Find(&entries).Error; e != nil {
		return e
	}
	for _, entry := range entries {
		if e := appendTaskTimeFact(tx, entry, t, f.ID, "observed_time_entry", at); e != nil {
			return e
		}
	}
	return nil
}
func recordReportGap(tx *gorm.DB, c TaskHistoryCoverage, f TaskFact) error {
	if f.TaskVersion == c.LastRecordedVersion+1 && !c.Inconsistent {
		return nil
	}
	var prev TaskFact
	if e := tx.First(&prev, "id=?", c.LastFactID).Error; e != nil {
		return e
	}
	end := f.EffectiveAt
	gap := TaskHistoryGap{ID: newID("gap"), CompanyID: f.CompanyID, TaskID: f.TaskID, FromExclusive: prev.EffectiveAt, ToExclusive: &end, Reason: "skipped_versions", BeforeFactID: prev.ID, AfterFactID: f.ID}
	return tx.Create(&gap).Error
}
func appendTaskFact(tx *gorm.DB, before *Task, after Task, actor ReportFactActor, operation string, at time.Time) error {
	if !in(operation, "create", "patch", "approve", "request_changes", "evidence", "time", "recurrence") {
		return invalid("Unsupported report fact operation.")
	}
	if actor.Kind == "" {
		actor.Kind = "user"
	}
	if actor.Kind == "user" && actor.ID == "" {
		return denied()
	}
	if before != nil {
		if e := ensureObservedTaskState(tx, *before, at); e != nil {
			return e
		}
	}
	state, e := reportTaskState(tx, after)
	if e != nil {
		return e
	}
	hash := reportStateHash(state)
	c := TaskHistoryCoverage{CompanyID: after.CompanyID, TaskID: after.ID, FirstKnownAt: at}
	if before != nil {
		if e := tx.First(&c, "company_id=? AND task_id=?", after.CompanyID, after.ID).Error; e != nil {
			return e
		}
	}
	f := TaskFact{ID: newID("tf"), CompanyID: after.CompanyID, TaskID: after.ID, TaskVersion: after.Version, RecordedAt: at, EffectiveAt: at, EffectiveAtRaw: at.UTC().Format(time.RFC3339Nano), Operation: operation, ActorID: actor.ID, ActorKind: actor.Kind, Provenance: "native_event", KnownFrom: c.FirstKnownAt, UnknownBefore: c.UnknownBefore, StateHash: hash, State: state}
	if e := tx.Create(&f).Error; e != nil {
		return e
	}
	if before != nil {
		if e := recordReportGap(tx, c, f); e != nil {
			return e
		}
	}
	c.LastRecordedVersion = after.Version
	c.StateHash = hash
	c.LastFactID = f.ID
	c.Inconsistent = false
	if e := tx.Save(&c).Error; e != nil {
		return e
	}
	genuine := after.Status == "done" && (before == nil || before.Status != "done") && in(operation, "create", "patch", "approve")
	if genuine {
		kind := "direct_completion"
		if operation == "approve" {
			if actor.ID == after.OwnerID {
				return denied()
			}
			kind = "independent_review"
		} else if after.RequiresApproval {
			return invalid("Independent acceptance is required.")
		}
		accepted, e := time.Parse(time.RFC3339Nano, after.CompletedAt)
		if e != nil {
			return e
		}
		return tx.Create(&TaskAcceptanceFact{ID: newID("af"), CompanyID: after.CompanyID, TaskID: after.ID, TaskVersion: after.Version, TaskFactID: f.ID, AcceptedAt: accepted, AcceptedAtRaw: after.CompletedAt, ActorID: actor.ID, AcceptanceKind: kind, State: state}).Error
	}
	return nil
}
func appendTaskTimeFact(tx *gorm.DB, entry TimeEntry, t Task, factID, provenance string, at time.Time) error {
	f := TaskTimeFact{ID: newID("ttf"), CompanyID: entry.CompanyID, TimeEntryID: entry.ID, TaskID: t.ID, TaskVersion: t.Version, TaskFactID: factID, RecordedAt: at, RecordedAtRaw: at.UTC().Format(time.RFC3339Nano), EntryDate: entry.Date, Hours: entry.Hours, ActorID: entry.UserID, Provenance: provenance}
	if provenance == "observed_time_entry" {
		f.ObservedAt = &at
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&f).Error
}
func (s *Server) InitializeReportHistory(ctx context.Context, now time.Time, limit int) (int, bool, error) {
	if limit == 0 {
		limit = 100
	}
	if limit < 1 || limit > 1000 {
		return 0, false, invalid("Observation limit must be 1–1000.")
	}
	var tasks []Task
	if e := s.db.WithContext(ctx).Where("NOT EXISTS (SELECT 1 FROM task_history_coverages c WHERE c.company_id=tasks.company_id AND c.task_id=tasks.id)").Order("company_id,id").Limit(limit + 1).Find(&tasks).Error; e != nil {
		return 0, false, e
	}
	more := len(tasks) > limit
	if more {
		tasks = tasks[:limit]
	}
	n := 0
	for _, t := range tasks {
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var c Company
			q := tx
			if tx.Dialector.Name() == "postgres" {
				q = q.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if e := q.First(&c, "id=?", t.CompanyID).Error; e != nil {
				return e
			}
			var fresh Task
			if e := tx.First(&fresh, "id=? AND company_id=?", t.ID, t.CompanyID).Error; e != nil {
				return e
			}
			return ensureObservedTaskState(tx, fresh, now)
		})
		if e != nil {
			return n, more, e
		}
		n++
	}
	return n, more, nil
}
