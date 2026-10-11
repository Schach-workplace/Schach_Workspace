package platform

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"sort"
	"time"
)

// Resolve real instants for a wall minute. A fold chooses the earliest; a gap
// advances wall minutes until valid, including a zone that skips an entire date.
func resolveReportOccurrence(localDate, localMinute, zone string) (time.Time, error) {
	if !validDate(localDate) || localDate == "" || len(localMinute) != 5 {
		return time.Time{}, invalid("Choose a calendar date and HH:MM.")
	}
	wall, e := time.Parse("2006-01-02 15:04", localDate+" "+localMinute)
	if e != nil {
		return time.Time{}, invalid("Choose a valid local minute.")
	}
	loc, e := time.LoadLocation(zone)
	if e != nil || zone == "" {
		return time.Time{}, invalid("Choose an IANA schedule zone.")
	}
	offsets := map[int]bool{}
	for h := -72; h <= 72; h++ {
		_, offset := wall.Add(time.Duration(h) * time.Hour).In(loc).Zone()
		offsets[offset] = true
	}
	for n := 0; n <= 2880; n++ {
		target := wall.Add(time.Duration(n) * time.Minute)
		candidates := []time.Time{}
		for offset := range offsets {
			candidate := target.Add(-time.Duration(offset) * time.Second)
			if candidate.In(loc).Format("2006-01-02 15:04") == target.Format("2006-01-02 15:04") {
				candidates = append(candidates, candidate)
			}
		}
		if len(candidates) > 0 {
			sort.Slice(candidates, func(i, j int) bool { return candidates[i].Before(candidates[j]) })
			return candidates[0].UTC(), nil
		}
	}
	return time.Time{}, invalid("No valid schedule minute was found.")
}
func nextReportOccurrence(schedule ReportSchedule, after time.Time) (time.Time, error) {
	loc, e := time.LoadLocation(schedule.ScheduleZone)
	if e != nil {
		return time.Time{}, e
	}
	day := after.In(loc)
	base := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	for n := 0; n < 15; n++ {
		date := base.AddDate(0, 0, n)
		allowed := false
		for _, weekday := range schedule.Weekdays {
			if int(date.Weekday()) == weekday {
				allowed = true
			}
		}
		if !allowed {
			continue
		}
		at, e := resolveReportOccurrence(date.Format("2006-01-02"), schedule.LocalMinute, schedule.ScheduleZone)
		if e != nil {
			return time.Time{}, e
		}
		if at.After(after) {
			return at, nil
		}
	}
	return time.Time{}, invalid("No future schedule occurrence is available.")
}
func latestReportOccurrence(schedule ReportSchedule, now time.Time) (time.Time, error) {
	loc, e := time.LoadLocation(schedule.ScheduleZone)
	if e != nil {
		return time.Time{}, e
	}
	local := now.In(loc)
	base := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	for n := 0; n < 15; n++ {
		date := base.AddDate(0, 0, -n)
		allowed := false
		for _, weekday := range schedule.Weekdays {
			if int(date.Weekday()) == weekday {
				allowed = true
			}
		}
		if !allowed {
			continue
		}
		at, e := resolveReportOccurrence(date.Format("2006-01-02"), schedule.LocalMinute, schedule.ScheduleZone)
		if e != nil {
			return time.Time{}, e
		}
		if !at.After(now) {
			return at, nil
		}
	}
	return time.Time{}, invalid("No completed schedule occurrence is available.")
}
func (s *Server) updateReportSchedule(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey                  string `json:"retryKey"`
		ExpectedDefinitionVersion int64  `json:"expectedDefinitionVersion"`
		ExpectedScheduleVersion   int64  `json:"expectedScheduleVersion"`
		Weekdays                  []int  `json:"weekdays"`
		LocalMinute               string `json:"localMinute"`
		ScheduleZone              string `json:"scheduleZone"`
		State                     string `json:"state"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if input.ExpectedDefinitionVersion < 1 || input.ExpectedScheduleVersion < 0 || !in(input.State, "active", "paused", "deleted") || len(input.Weekdays) < 1 || len(input.Weekdays) > 7 {
		return invalid("Choose valid schedule versions, weekdays and state.")
	}
	seen := map[int]bool{}
	for _, day := range input.Weekdays {
		if day < 0 || day > 6 || seen[day] {
			return invalid("Weekdays must be distinct values0–6.")
		}
		seen[day] = true
	}
	if _, e := resolveReportOccurrence(time.Now().UTC().Format("2006-01-02"), input.LocalMinute, input.ScheduleZone); e != nil {
		return e
	}
	var schedule ReportSchedule
	var definition SavedReportDefinition
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		out, e := businessMutation(tx, a, "report.schedule.update", input.RetryKey, []any{r.PathValue("id"), input.ExpectedDefinitionVersion, input.ExpectedScheduleVersion, input.Weekdays, input.LocalMinute, input.ScheduleZone, input.State}, func() error {
			var e error
			definition, e = savedDefinition(tx, a, r.PathValue("id"), true)
			if e != nil {
				return e
			}
			if definition.State != "active" {
				return conflict()
			}
			return validateSavedConfiguration(tx, a, definition.Configuration)
		}, func(out BusinessResult) error { _, e := savedDefinition(tx, a, out.IDs[0], true); return e }, func() (BusinessResult, error) {
			if definition.Version != input.ExpectedDefinitionVersion {
				return BusinessResult{}, conflict()
			}
			q := tx.Where("company_id=? AND definition_id=?", a.Company.ID, definition.ID).Find(&schedule)
			if q.Error != nil {
				return BusinessResult{}, q.Error
			}
			if q.RowsAffected == 0 {
				if input.ExpectedScheduleVersion != 0 {
					return BusinessResult{}, conflict()
				}
				schedule = ReportSchedule{ID: newID("rs"), CompanyID: a.Company.ID, DefinitionID: definition.ID}
			} else if schedule.Version != input.ExpectedScheduleVersion {
				return BusinessResult{}, conflict()
			}
			old := definition.Version
			definition.Version++
			definition.UpdatedAt = time.Now().UTC()
			schedule.Version++
			schedule.DefinitionRevision = definition.Version
			schedule.Weekdays = append([]int{}, input.Weekdays...)
			schedule.LocalMinute = input.LocalMinute
			schedule.ScheduleZone = input.ScheduleZone
			schedule.State = input.State
			schedule.FailureCode = ""
			schedule.FailureCount = 0
			schedule.AttemptCount = 0
			schedule.NextAttemptAt = nil
			next, e := nextReportOccurrence(schedule, time.Now().UTC())
			if e != nil {
				return BusinessResult{}, e
			}
			schedule.NextOccurrenceUTC = next
			if e := tx.Save(&schedule).Error; e != nil {
				return BusinessResult{}, e
			}
			q = tx.Model(&SavedReportDefinition{}).Where("id=? AND version=?", definition.ID, old).Updates(map[string]any{"version": definition.Version, "updated_at": definition.UpdatedAt})
			if q.Error != nil {
				return BusinessResult{}, q.Error
			}
			if q.RowsAffected != 1 {
				return BusinessResult{}, conflict()
			}
			if e := tx.Create(&SavedReportRevision{a.Company.ID, definition.ID, definition.Version, definition.State, definition.Configuration, definition.UpdatedAt}).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := cancelReportDefinitionOutputs(tx, a.Company.ID, definition.ID, old); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "report_schedule", IDs: []string{definition.ID, schedule.ID}, Versions: []int64{definition.Version, schedule.Version}}, nil
		})
		if e != nil {
			return e
		}
		if e := tx.First(&schedule, "id=?", out.IDs[1]).Error; e != nil {
			return e
		}
		if e := committedSavedDefinition(tx, a.Company.ID, out, &definition); e != nil {
			return e
		}
		// The original request is bound to this receipt. Return only committed
		// authored schedule fields, never runtime timing from an unseen current row.
		schedule = ReportSchedule{ID: out.IDs[1], CompanyID: a.Company.ID, DefinitionID: out.IDs[0], DefinitionRevision: out.Versions[0], Version: out.Versions[1], Weekdays: append([]int{}, input.Weekdays...), LocalMinute: input.LocalMinute, ScheduleZone: input.ScheduleZone, State: input.State}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"definition": definition, "schedule": map[string]any{"id": schedule.ID, "version": schedule.Version, "definitionRevision": schedule.DefinitionRevision, "weekdays": schedule.Weekdays, "localMinute": schedule.LocalMinute, "scheduleZone": schedule.ScheduleZone, "state": schedule.State}})
}
func (s *Server) RunReportSchedules(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	var schedules []ReportSchedule
	if e := s.db.WithContext(ctx).Where("state='active' AND next_occurrence_utc<=? AND (next_attempt_at IS NULL OR next_attempt_at<=?)", now, now).Order("next_occurrence_utc,id").Limit(limit).Find(&schedules).Error; e != nil {
		return 0, e
	}
	created := 0
	var failures []error
	for _, candidate := range schedules {
		// Reserve part of the maintenance budget for a durable diagnostic and later
		// candidates. A single capture must not consume every tick indefinitely.
		budget := 5 * time.Second
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return created, errors.Join(append(failures, ctx.Err())...)
			}
			budget = min(budget, remaining-min(500*time.Millisecond, remaining/2))
		}
		scheduleCtx, cancel := context.WithTimeout(ctx, budget)
		perSchedule := 0
		e := s.db.WithContext(scheduleCtx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, candidate.CompanyID); e != nil {
				return e
			}
			var schedule ReportSchedule
			if e := tx.First(&schedule, "id=?", candidate.ID).Error; e != nil {
				return e
			}
			if schedule.State != "active" || schedule.NextOccurrenceUTC.After(now) || (schedule.NextAttemptAt != nil && schedule.NextAttemptAt.After(now)) {
				return nil
			}
			var definition SavedReportDefinition
			if e := tx.First(&definition, "id=? AND company_id=?", schedule.DefinitionID, schedule.CompanyID).Error; e != nil {
				return e
			}
			if created+len(definition.Configuration.RecipientIDs) > 100 {
				return nil
			}
			owner, e := currentAttentionActorLocked(tx, schedule.CompanyID, definition.OwnerID)
			if e != nil || definition.State != "active" || definition.Version != schedule.DefinitionRevision || owner.Member.Role == "viewer" {
				if e := cancelReportDefinitionOutputs(tx, schedule.CompanyID, definition.ID, definition.Version); e != nil {
					return e
				}
				return tx.Model(&schedule).Updates(map[string]any{"state": "paused", "failure_code": "owner_ineligible"}).Error
			}
			if e := validateSavedRuntimeConfiguration(tx, owner, definition.Configuration); e != nil {
				if e := cancelReportDefinitionOutputs(tx, schedule.CompanyID, definition.ID, definition.Version); e != nil {
					return e
				}
				return tx.Model(&schedule).Updates(map[string]any{"state": "paused", "failure_code": "configuration_unavailable"}).Error
			}
			occurrence, e := latestReportOccurrence(schedule, now)
			if e != nil {
				return e
			}
			if occurrence.Before(schedule.NextOccurrenceUTC) {
				return nil
			}
			request, e := resolveSavedReportRequest(definition.Configuration, owner.Company.Timezone, occurrence)
			if e != nil {
				return e
			}
			transient := false
			schedule.FailureCode = ""
			schedule.FailureCount = 0
			for _, uid := range definition.Configuration.RecipientIDs {
				identity := payloadHash([]any{schedule.CompanyID, definition.ID, definition.Version, uid, occurrence.UTC().Format(time.RFC3339Nano)})
				var failure ReportScheduleFailure
				q := tx.Where("scheduled_identity=? AND state='failed'", identity).Find(&failure)
				if q.Error != nil {
					return q.Error
				}
				if q.RowsAffected > 0 {
					schedule.FailureCount++
					schedule.FailureCode = failure.FailureCode
					continue
				}
				var existing ReportExportJob
				q = tx.Where("scheduled_identity=?", identity).Find(&existing)
				if q.Error != nil {
					return q.Error
				}
				if q.RowsAffected > 0 {
					continue
				}
				// The savepoint removes partial observations/snapshots/job state for a failed
				// recipient while retaining successful independently authorized recipients.
				recipientError := tx.Transaction(func(recipientTx *gorm.DB) error {
					recipient, e := currentAttentionActorLocked(recipientTx, schedule.CompanyID, uid)
					if e != nil {
						return e
					}
					snap, e := captureHistoricalReportTx(recipientTx, recipient, request, &ReportDefinitionBasis{definition.ID, definition.Version})
					if e != nil {
						return e
					}
					job := newReportExportJob(recipient, snap, now)
					job.RequestActorID = definition.OwnerID
					job.ScheduleID = schedule.ID
					job.ScheduleVersion = schedule.Version
					job.OccurrenceUTC = &occurrence
					job.ScheduledIdentity = &identity
					if e := recipientTx.Create(&job).Error; e != nil {
						return e
					}
					if _, e := authorizeReportExportJob(recipientTx, recipient, job.ID); e != nil {
						return e
					}
					return nil
				})
				if recipientError == nil {
					perSchedule++
					continue
				}
				code, state := "transient_failure", "retry"
				if api, ok := recipientError.(*apiError); ok && api.Status < 500 {
					code, state = "access_changed", "failed"
					if api.Code == "range_too_large" {
						code = api.Code
					}
				}
				if state == "retry" && schedule.AttemptCount >= 4 {
					state = "failed"
				}
				if state == "retry" {
					transient = true
					failures = append(failures, recipientError)
				}
				schedule.FailureCount++
				schedule.FailureCode = code
				failure = ReportScheduleFailure{ID: newID("rsf"), CompanyID: schedule.CompanyID, DefinitionID: definition.ID, DefinitionRevision: definition.Version, ScheduleID: schedule.ID, ScheduleVersion: schedule.Version, RecipientID: uid, OccurrenceUTC: occurrence, ScheduledIdentity: identity, State: state, FailureCode: code, AttemptCount: schedule.AttemptCount + 1, UpdatedAt: now}
				if e := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "scheduled_identity"}}, DoUpdates: clause.AssignmentColumns([]string{"state", "failure_code", "attempt_count", "updated_at"})}).Create(&failure).Error; e != nil {
					return e
				}
			}
			if transient {
				schedule.AttemptCount++
				next := now.Add(time.Duration(5*(1<<(schedule.AttemptCount-1))) * time.Second)
				schedule.NextAttemptAt = &next
				return tx.Save(&schedule).Error
			}
			schedule.AttemptCount = 0
			schedule.NextAttemptAt = nil
			if occurrence.After(schedule.NextOccurrenceUTC) {
				from, to := schedule.NextOccurrenceUTC, occurrence
				schedule.SkippedFrom = &from
				schedule.SkippedTo = &to
			}
			schedule.LastOccurrenceUTC = &occurrence
			next, e := nextReportOccurrence(schedule, now)
			if e != nil {
				return e
			}
			schedule.NextOccurrenceUTC = next
			return tx.Save(&schedule).Error
		}, s.reportCaptureOptions())
		cancel()
		if e != nil {
			failures = append(failures, e)
			if ctx.Err() != nil {
				return created, errors.Join(failures...)
			}
			// A whole-schedule transient failure also receives bounded backoff, fenced
			// against a concurrent definition/schedule edit. Later schedules still run.
			attempt := candidate.AttemptCount + 1
			next := now.Add(time.Duration(5*(1<<min(attempt-1, 4))) * time.Second)
			state := "active"
			if attempt >= 5 {
				state = "paused"
			}
			if diagnosticError := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				if e := lockCompany(tx, candidate.CompanyID); e != nil {
					return e
				}
				return tx.Model(&ReportSchedule{}).Where("id=? AND version=? AND state='active' AND next_occurrence_utc=? AND attempt_count=?", candidate.ID, candidate.Version, candidate.NextOccurrenceUTC, candidate.AttemptCount).Updates(map[string]any{"failure_code": "transient_failure", "attempt_count": attempt, "next_attempt_at": next, "state": state}).Error
			}); diagnosticError != nil {
				failures = append(failures, diagnosticError)
			}
			continue
		}
		created += perSchedule
	}
	return created, errors.Join(failures...)
}
