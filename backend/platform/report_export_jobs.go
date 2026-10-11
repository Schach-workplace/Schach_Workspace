package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Server) reportExportRoutes() {
	const root = "/api/companies/{cid}/reports"
	s.route("POST "+root+"/exports", s.createReportExport)
	s.route("GET "+root+"/exports/{id}", s.readReportExport)
	s.route("POST "+root+"/exports/{id}/cancel", s.cancelReportExport)
	s.route("GET "+root+"/artifacts/{id}", s.downloadReportArtifact)
}
func authorizeReportExportJob(tx *gorm.DB, a *access, id string) (ReportExportJob, error) {
	var job ReportExportJob
	if e := tx.First(&job, "id=? AND company_id=? AND recipient_id=?", id, a.Company.ID, a.User.ID).Error; e != nil {
		if e == gorm.ErrRecordNotFound {
			return job, missing()
		}
		return job, e
	}
	if e := authorizeHistoricalSources(tx, a, job.SnapshotID); e != nil {
		return job, e
	}
	if job.DefinitionID != "" {
		var d SavedReportDefinition
		if e := tx.First(&d, "id=? AND company_id=?", job.DefinitionID, a.Company.ID).Error; e != nil {
			return job, historicalAccessChanged()
		}
		if d.State != "active" || d.Version != job.DefinitionRevision || !a.activeUser(d.OwnerID) {
			return job, historicalAccessChanged()
		}
		if job.ScheduleID != "" {
			if !in(job.RecipientID, d.Configuration.RecipientIDs...) {
				return job, historicalAccessChanged()
			}
			var schedule ReportSchedule
			if e := tx.First(&schedule, "id=? AND company_id=? AND definition_id=?", job.ScheduleID, a.Company.ID, d.ID).Error; e != nil || schedule.State != "active" || schedule.Version != job.ScheduleVersion {
				return job, historicalAccessChanged()
			}
		}
		owner, e := currentAttentionActorLocked(tx, a.Company.ID, d.OwnerID)
		if e != nil || owner.Member.Role == "viewer" {
			return job, historicalAccessChanged()
		}
		if e := validateSavedConfiguration(tx, owner, d.Configuration); e != nil {
			return job, historicalAccessChanged()
		}
		var sources []ReportSnapshotSource
		if e := tx.Where("company_id=? AND snapshot_id=?", a.Company.ID, job.SnapshotID).Find(&sources).Error; e != nil {
			return job, e
		}
		for start := 0; start < len(sources); start += 100 {
			end := start + 100
			if end > len(sources) {
				end = len(sources)
			}
			ids := []string{}
			for _, source := range sources[start:end] {
				ids = append(ids, source.TaskID)
			}
			var count int64
			if e := taskReadQuery(tx, owner).Where("id IN ?", ids).Count(&count).Error; e != nil {
				return job, e
			}
			if count != int64(len(ids)) {
				return job, historicalAccessChanged()
			}
		}
	}
	return job, nil
}
func newReportExportJob(a *access, snap HistoricalReportSnapshot, now time.Time) ReportExportJob {
	return ReportExportJob{ID: newID("rj"), CompanyID: a.Company.ID, RequestActorID: a.User.ID, RecipientID: a.User.ID, DefinitionID: snap.DefinitionID, DefinitionRevision: snap.DefinitionRevision, SnapshotID: snap.ID, PayloadHash: payloadHash([]any{snap.ID, 1, snap.RequestHash}), CSVSchemaVersion: 1, Period: snap.Period, State: "queued", NextAttemptAt: now, CreatedAt: now, UpdatedAt: now}
}
func (s *Server) createReportExport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey   string `json:"retryKey"`
		SnapshotID string `json:"snapshotId"`
		Schema     int    `json:"csvSchemaVersion"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if input.Schema != 1 {
		return invalid("Only historical CSV schema1 is supported.")
	}
	if s.opts.ReportArtifactStore == nil {
		return &apiError{Status: 503, Code: "export_unavailable", Message: "Report export storage is unavailable."}
	}
	var job ReportExportJob
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		out, e := businessMutation(tx, a, "report.export.create", input.RetryKey, []any{input.SnapshotID, input.Schema}, func() error { return authorizeHistoricalSources(tx, a, input.SnapshotID) }, func(out BusinessResult) error { _, e := authorizeReportExportJob(tx, a, out.IDs[0]); return e }, func() (BusinessResult, error) {
			var snap HistoricalReportSnapshot
			if e := tx.First(&snap, "id=?", input.SnapshotID).Error; e != nil {
				return BusinessResult{}, e
			}
			job = newReportExportJob(a, snap, time.Now().UTC())
			if e := tx.Create(&job).Error; e != nil {
				return BusinessResult{}, e
			}
			if _, e := authorizeReportExportJob(tx, a, job.ID); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "report_export", IDs: []string{job.ID}, Versions: []int64{1}}, nil
		})
		if e != nil {
			return e
		}
		return tx.First(&job, "id=?", out.IDs[0]).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"job": job})
}
func (s *Server) readReportExport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var job ReportExportJob
	var artifact *ReportArtifact
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		job, e = authorizeReportExportJob(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if job.ArtifactID != "" {
			var v ReportArtifact
			if e := tx.First(&v, "id=? AND company_id=?", job.ArtifactID, a.Company.ID).Error; e != nil {
				return e
			}
			if !time.Now().UTC().Before(v.ExpiresAt) {
				job.State = "expired"
				job.ArtifactID = ""
			} else if v.State == "ready" && job.State == "ready" {
				artifact = &v
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return respond(w, 200, map[string]any{"job": job, "artifact": artifact})
}
func (s *Server) cancelReportExport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey string `json:"retryKey"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		_, e := businessMutation(tx, a, "report.export.cancel", input.RetryKey, r.PathValue("id"), func() error { _, e := authorizeReportExportJob(tx, a, r.PathValue("id")); return e }, func(out BusinessResult) error { _, e := authorizeReportExportJob(tx, a, out.IDs[0]); return e }, func() (BusinessResult, error) {
			if e := tx.Model(&ReportExportJob{}).Where("id=?", r.PathValue("id")).Updates(map[string]any{"state": "cancelled", "lease_token": "", "lease_until": nil, "failure_code": "user_cancelled", "updated_at": time.Now().UTC()}).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Model(&ReportDeliveryIntent{}).Where("job_id=?", r.PathValue("id")).Update("state", "cancelled").Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "report_export", IDs: []string{r.PathValue("id")}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("id"))
}
func (s *Server) claimReportExport(ctx context.Context, now time.Time) (ReportExportJob, string, error) {
	var job ReportExportJob
	token := newID("lease")
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := tx.Model(&ReportExportJob{}).Where("attempt_count>=5 AND ((state='running' AND lease_until<=?) OR state='queued')", now).Updates(map[string]any{"state": "failed", "failure_code": "attempt_limit", "lease_token": "", "lease_until": nil, "updated_at": now}).Error; e != nil {
			return e
		}
		q := tx.Where("attempt_count<5 AND ((state='queued' AND next_attempt_at<=?) OR (state='running' AND lease_until<=?))", now, now).Order("next_attempt_at,id")
		if tx.Dialector.Name() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		if e := q.First(&job).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return nil
			}
			return e
		}
		until := now.Add(time.Minute)
		result := tx.Model(&ReportExportJob{}).Where("id=? AND ((state='queued' AND next_attempt_at<=?) OR (state='running' AND lease_until<=?))", job.ID, now, now).Updates(map[string]any{"state": "running", "lease_token": token, "lease_until": until, "attempt_count": gorm.Expr("attempt_count+1"), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return conflict()
		}
		return tx.First(&job, "id=?", job.ID).Error
	})
	if e == nil && job.ID == "" {
		e = gorm.ErrRecordNotFound
	}
	return job, token, e
}
func (s *Server) renewReportExport(ctx context.Context, id, token string, now time.Time) error {
	q := s.db.WithContext(ctx).Model(&ReportExportJob{}).Where("id=? AND state='running' AND lease_token=? AND lease_until>?", id, token, now).Updates(map[string]any{"lease_until": now.Add(time.Minute), "updated_at": now})
	if q.Error != nil {
		return q.Error
	}
	if q.RowsAffected != 1 {
		return conflict()
	}
	return nil
}
func (s *Server) reportJobTransaction(ctx context.Context, job ReportExportJob, fn func(*gorm.DB, *access, ReportExportJob) error) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := lockCompany(tx, job.CompanyID); e != nil {
			return e
		}
		a, e := currentAttentionActorLocked(tx, job.CompanyID, job.RecipientID)
		if e != nil {
			return e
		}
		current, e := authorizeReportExportJob(tx, a, job.ID)
		if e != nil {
			return e
		}
		return fn(tx, a, current)
	})
}
func historicalCSVHeader() []string {
	return []string{"schema", "basis", "from", "to", "report_zone", "row_id", "kind", "task_id", "task_version", "fact_id", "acceptance_id", "time_fact_id", "code", "title", "status", "owner_id", "owner_label", "department_id", "project_id", "label_basis", "original_mode", "original_date", "original_at", "original_zone", "current_mode", "current_date", "current_at", "current_zone", "company_policy_zone", "accepted_at", "acceptance_kind", "entry_date", "hours", "state_actual_hours", "provenance", "coverage_reason", "matching_episode_ids"}
}
func historicalCSVRow(snap HistoricalReportSnapshot, r HistoricalReportRow) []string {
	s := r.State
	return []string{"1", snap.Basis, snap.Request.From, snap.Request.To, snap.Request.ReportZone, r.RowID, r.Kind, r.TaskID, strconv.FormatInt(r.TaskVersion, 10), r.FactID, r.AcceptanceID, r.TimeFactID, s.Code, s.Title, s.Status, s.OwnerID, r.OwnerLabel, s.DepartmentID, s.ProjectID, r.LabelBasis, s.Original.Mode, s.Original.Date, s.Original.At, s.Original.Zone, s.Current.Mode, s.Current.Date, s.Current.At, s.Current.Zone, s.CompanyPolicyZone, r.AcceptedAtRaw, r.AcceptanceKind, r.EntryDate, strconv.FormatFloat(r.Hours, 'f', -1, 64), strconv.FormatFloat(s.ActualHours, 'f', -1, 64), r.Provenance, r.Reason, strings.Join(snap.Summary.Metrics["acceptance.unique_tasks"].EpisodeIDsByRow[r.RowID], "|")}
}
func (s *Server) generateReportExport(ctx context.Context, job ReportExportJob, token string) error {
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	heartbeatDone := make(chan struct{})
	defer close(heartbeatDone)
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-heartbeatDone:
				return
			case <-ticker.C:
				if e := s.renewReportExport(ctx, job.ID, token, time.Now().UTC()); e != nil {
					cancel()
					return
				}
			}
		}
	}()
	var snap HistoricalReportSnapshot
	if e := s.reportJobTransaction(ctx, job, func(tx *gorm.DB, a *access, current ReportExportJob) error {
		if current.State != "running" || current.LeaseToken != token || current.LeaseUntil == nil || !time.Now().UTC().Before(*current.LeaseUntil) {
			return conflict()
		}
		return tx.First(&snap, "id=?", current.SnapshotID).Error
	}); e != nil {
		return e
	}
	var content bytes.Buffer
	writer := csv.NewWriter(&content)
	write := func(cells []string) error {
		for i := range cells {
			cells[i] = safeCSV(cells[i])
		}
		if e := writer.Write(cells); e != nil {
			return e
		}
		writer.Flush()
		if e := writer.Error(); e != nil {
			return e
		}
		if int64(content.Len()) > reportCSVByteLimit {
			return rangeTooLarge()
		}
		return ctx.Err()
	}
	if e := write(historicalCSVHeader()); e != nil {
		return e
	}
	for offset := 0; offset < snap.RowCount; offset += 100 {
		var rows []HistoricalReportRow
		if e := s.reportJobTransaction(ctx, job, func(tx *gorm.DB, a *access, current ReportExportJob) error {
			if current.State != "running" || current.LeaseToken != token {
				return conflict()
			}
			return tx.Where("snapshot_id=?", snap.ID).Order("row_order").Offset(offset).Limit(100).Find(&rows).Error
		}); e != nil {
			return e
		}
		for _, row := range rows {
			if e := write(historicalCSVRow(snap, row)); e != nil {
				return e
			}
		}
	}
	key := newID("rpt")
	artifact := ReportArtifact{ID: newID("ra"), CompanyID: job.CompanyID, JobID: job.ID, SnapshotID: snap.ID, RecipientID: job.RecipientID, StoreKey: key, SchemaVersion: 1, SHA256: fmt.Sprintf("%x", sha256.Sum256(content.Bytes())), Length: int64(content.Len()), CreatedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(s.opts.ReportArtifactTTL), State: "ready"}
	if e := s.opts.ReportArtifactStore.Put(ctx, key, bytes.NewReader(content.Bytes())); e != nil {
		return e
	}
	published := false
	defer func() {
		if !published {
			cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = s.opts.ReportArtifactStore.Delete(cleanup, key)
		}
	}()
	e := s.reportJobTransaction(ctx, job, func(tx *gorm.DB, a *access, current ReportExportJob) error {
		now := time.Now().UTC()
		if current.State != "running" || current.LeaseToken != token || current.LeaseUntil == nil || !now.Before(*current.LeaseUntil) {
			return conflict()
		}
		if e := tx.Create(&artifact).Error; e != nil {
			return e
		}
		q := tx.Model(&ReportExportJob{}).Where("id=? AND state='running' AND lease_token=? AND lease_until>?", job.ID, token, now).Updates(map[string]any{"state": "ready", "artifact_id": artifact.ID, "lease_token": "", "lease_until": nil, "updated_at": now})
		if q.Error != nil {
			return q.Error
		}
		if q.RowsAffected != 1 {
			return conflict()
		}
		return tx.Create(&ReportDeliveryIntent{ID: newID("rdi"), CompanyID: job.CompanyID, JobID: job.ID, RecipientID: job.RecipientID, State: "pending", CreatedAt: now, UpdatedAt: now}).Error
	})
	if e == nil {
		published = true
	}
	return e
}
func (s *Server) failReportExport(ctx context.Context, job ReportExportJob, token string, cause error) error {
	now := time.Now().UTC()
	state, code := "queued", "transient_failure"
	next := now.Add(time.Duration(5*(1<<max(job.AttemptCount-1, 0))) * time.Second)
	if api, ok := cause.(*apiError); ok {
		state = "failed"
		code = api.Code
		if job.ScheduleID != "" && api.Code == "access_changed" {
			state = "cancelled"
		}
	}
	if job.AttemptCount >= 5 {
		state = "failed"
	}
	if cause == context.Canceled || cause == context.DeadlineExceeded {
		code = "generation_cancelled"
	}
	return s.db.WithContext(ctx).Model(&ReportExportJob{}).Where("id=? AND state='running' AND lease_token=?", job.ID, token).Updates(map[string]any{"state": state, "failure_code": code, "lease_token": "", "lease_until": nil, "next_attempt_at": next, "updated_at": now}).Error
}
