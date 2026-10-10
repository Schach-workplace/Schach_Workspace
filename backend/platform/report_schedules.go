package platform

import (
	"context"
	"gorm.io/gorm"
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
		return tx.First(&definition, "id=?", out.IDs[0]).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"definition": definition, "schedule": schedule})
}
func (s *Server) RunReportSchedules(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	var schedules []ReportSchedule
	if e := s.db.WithContext(ctx).Where("state='active' AND next_occurrence_utc<=?", now).Order("next_occurrence_utc,id").Limit(limit).Find(&schedules).Error; e != nil {
		return 0, e
	}
	created := 0
	for _, candidate := range schedules {
		perSchedule := 0
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, candidate.CompanyID); e != nil {
				return e
			}
			var schedule ReportSchedule
			if e := tx.First(&schedule, "id=?", candidate.ID).Error; e != nil {
				return e
			}
			if schedule.State != "active" || schedule.NextOccurrenceUTC.After(now) {
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
				return tx.Model(&schedule).Update("state", "paused").Error
			}
			if e := validateSavedConfiguration(tx, owner, definition.Configuration); e != nil {
				if e := cancelReportDefinitionOutputs(tx, schedule.CompanyID, definition.ID, definition.Version); e != nil {
					return e
				}
				return tx.Model(&schedule).Update("state", "paused").Error
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
			for _, uid := range definition.Configuration.RecipientIDs {
				recipient, e := currentAttentionActorLocked(tx, schedule.CompanyID, uid)
				if e != nil {
					continue
				}
				identity := payloadHash([]any{schedule.CompanyID, definition.ID, definition.Version, uid, occurrence.UTC().Format(time.RFC3339Nano)})
				var existing ReportExportJob
				q := tx.Where("scheduled_identity=?", identity).Find(&existing)
				if q.Error != nil {
					return q.Error
				}
				if q.RowsAffected > 0 {
					continue
				}
				snap, e := captureHistoricalReportTx(tx, recipient, request, &ReportDefinitionBasis{definition.ID, definition.Version})
				if e != nil {
					return e
				}
				job := newReportExportJob(recipient, snap, now)
				job.RequestActorID = definition.OwnerID
				job.ScheduleID = schedule.ID
				job.ScheduleVersion = schedule.Version
				job.OccurrenceUTC = &occurrence
				job.ScheduledIdentity = &identity
				if e := tx.Create(&job).Error; e != nil {
					return e
				}
				if _, e := authorizeReportExportJob(tx, recipient, job.ID); e != nil {
					return e
				}
				perSchedule++
			}
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
		if e != nil {
			return created, e
		}
		created += perSchedule
	}
	return created, nil
}
