package platform

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"time"
)

type IntelligenceLease struct {
	Job                 IntelligenceJob
	Token               string
	CancellationVersion int64
}

func (s *Server) withIntelligenceWorkerFence(ctx context.Context, job IntelligenceJob, fn func(*gorm.DB, *access) error) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := lockIntelligenceCompany(tx, job.CompanyID); e != nil {
			return e
		}
		a, e := currentAttentionActorLocked(tx, job.CompanyID, job.ActorID)
		if e != nil {
			return e
		}
		return fn(tx, a)
	})
}
func (s *Server) claimIntelligence(ctx context.Context) (*IntelligenceLease, error) {
	if s.opts.Intelligence == nil {
		return nil, nil
	}
	var candidate IntelligenceJob
	e := s.db.WithContext(ctx).Omit("result_json").Where("state IN ? AND next_attempt_at<=? AND expires_at>?", []string{"queued", "retry_wait"}, time.Now().UTC(), time.Now().UTC()).Order("created_at,id").First(&candidate).Error
	if e == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var lease *IntelligenceLease
	e = s.withIntelligenceWorkerFence(ctx, candidate, func(tx *gorm.DB, a *access) error {
		q := tx
		if tx.Dialector.Name() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		var j IntelligenceJob
		if e := q.Omit("result_json").First(&j, "id=? AND state IN ?", candidate.ID, []string{"queued", "retry_wait"}).Error; e == gorm.ErrRecordNotFound {
			return nil
		} else if e != nil {
			return e
		}
		if e := intelligenceOriginalAuthority(tx, a, j); e != nil {
			return retireIntelligenceJob(tx, j.ID, "invalidated", "source_unavailable")
		}
		if j.Attempts >= 3 {
			return retireIntelligenceJob(tx, j.ID, "failed", "retry_exhausted")
		}
		if !s.intelligenceAvailable(j.Operation) || j.Provider != s.opts.Intelligence.Identity {
			return retireIntelligenceJob(tx, j.ID, "failed", "provider_unavailable")
		}
		now := time.Now().UTC()
		token := newID("lease")
		j.State = "running"
		j.Attempts++
		j.LeaseToken = token
		j.LeaseUntil = now.Add(240 * time.Second)
		j.UpdatedAt = now
		if e := tx.Model(&IntelligenceJob{}).Where("id=?", j.ID).Updates(map[string]any{"state": j.State, "attempts": j.Attempts, "lease_token": token, "lease_until": j.LeaseUntil, "updated_at": now}).Error; e != nil {
			return e
		}
		lease = &IntelligenceLease{Job: j, Token: token, CancellationVersion: j.CancellationVersion}
		return nil
	})
	return lease, e
}
func (s *Server) checkIntelligenceLease(tx *gorm.DB, a *access, lease IntelligenceLease) (IntelligenceJob, SourceManifest, error) {
	var job IntelligenceJob
	empty := SourceManifest{}
	if e := tx.Omit("result_json").First(&job, "id=? AND state='running' AND lease_token=? AND cancellation_version=? AND lease_until>? AND expires_at>?", lease.Job.ID, lease.Token, lease.CancellationVersion, time.Now().UTC(), time.Now().UTC()).Error; e != nil {
		return job, empty, intelligenceError(409, "lease_lost")
	}
	if e := intelligenceOriginalAuthority(tx, a, job); e != nil {
		return job, empty, intelligenceError(403, "source_unavailable")
	}
	manifest, e := loadIntelligenceManifest(tx, job)
	if e != nil {
		return job, empty, e
	}
	if e = s.authorizeIntelligenceSources(tx, a, manifest, IntelligenceExactCurrent); e != nil {
		return job, empty, e
	}
	return job, manifest, nil
}
func (s *Server) runIntelligenceLease(parent context.Context, lease IntelligenceLease) error {
	release, e := s.opts.LocalProviderBudget.Acquire(parent)
	if e != nil {
		return e
	}
	defer release()
	return s.runIntelligenceLeaseAdmitted(parent, lease)
}
func (s *Server) runIntelligenceLeaseAdmitted(parent context.Context, lease IntelligenceLease) error {
	timeout := 120 * time.Second
	if lease.Job.Operation == "transcript" {
		timeout = 180 * time.Second
	}
	if c := s.opts.Intelligence; c != nil {
		if lease.Job.Operation == "transcript" && c.VoiceTimeout > 0 && c.VoiceTimeout < timeout {
			timeout = c.VoiceTimeout
		}
		if lease.Job.Operation != "transcript" && c.SummaryTimeout > 0 && c.SummaryTimeout < timeout {
			timeout = c.SummaryTimeout
		}
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	watchDone := make(chan struct{})
	watchExit := make(chan struct{})
	go func() {
		defer close(watchExit)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		lastRenew := time.Now()
		for {
			select {
			case <-watchDone:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				e := s.withIntelligenceWorkerFence(ctx, lease.Job, func(tx *gorm.DB, a *access) error {
					_, _, e := s.checkIntelligenceLease(tx, a, lease)
					if e != nil {
						return e
					}
					if time.Since(lastRenew) >= 15*time.Second {
						lastRenew = time.Now()
						return tx.Model(&IntelligenceJob{}).Where("id=? AND lease_token=? AND state='running'", lease.Job.ID, lease.Token).Update("lease_until", time.Now().UTC().Add(240*time.Second)).Error
					}
					return nil
				})
				if e != nil {
					cancel()
					return
				}
			}
		}
	}()
	defer func() { close(watchDone); cancel(); <-watchExit }()
	var manifest SourceManifest
	facts := DeterministicFacts{}
	e := s.withIntelligenceWorkerFence(ctx, lease.Job, func(tx *gorm.DB, a *access) error {
		job, _, e := s.checkIntelligenceLease(tx, a, lease)
		if e != nil {
			return e
		}
		manifest, e = s.captureIntelligenceSources(tx, a, job.Selection)
		if e != nil {
			return e
		}
		if job.Operation == "report_explanation" {
			facts, e = buildIntelligenceFacts(manifest)
		}
		return e
	})
	if e != nil {
		s.failIntelligenceLease(lease, e)
		return e
	}
	var raw []byte
	if lease.Job.Operation == "transcript" {
		raw, e = s.transcribeIntelligence(ctx, lease, manifest, facts)
	} else {
		sources := []GroundedSource{}
		for _, b := range manifest.Sources {
			text := b.Label + "\n" + b.Text
			if lease.Job.Operation == "report_explanation" {
				text = b.Label
			} // The complete deterministic facts are supplied separately.
			sources = append(sources, GroundedSource{Key: b.SourceKey, Text: text})
		}
		var output ProviderOutput
		output, e = s.opts.Intelligence.Summary.Generate(ctx, GroundedInput{Operation: lease.Job.Operation, Sources: sources, Language: lease.Job.Selection.Language, Facts: facts})
		raw = output.Raw
	}
	if e != nil {
		s.failIntelligenceLease(lease, e)
		return e
	}
	result, e := validateIntelligenceOutput(lease.Job.Operation, raw, manifest, facts)
	if e != nil {
		s.failIntelligenceLease(lease, e)
		return e
	}
	result.ProviderIdentity = lease.Job.Provider
	e = s.commitIntelligenceResult(ctx, lease, result)
	if e != nil {
		s.failIntelligenceLease(lease, e)
	}
	return e
}
func (s *Server) commitIntelligenceResult(ctx context.Context, lease IntelligenceLease, result IntelligenceResult) error {
	raw, e := json.Marshal(result)
	if e != nil || len(raw) > 65536 {
		return intelligenceError(422, "invalid_output")
	}
	hash, e := intelligenceHash(result)
	if e != nil {
		return e
	}
	return s.withIntelligenceWorkerFence(ctx, lease.Job, func(tx *gorm.DB, a *access) error {
		job, _, e := s.checkIntelligenceLease(tx, a, lease)
		if e != nil {
			return e
		}
		if result.SourceSetHash != job.SourceSetHash {
			return conflict()
		}
		updated := tx.Model(&IntelligenceJob{}).Where("id=? AND lease_token=? AND state='running' AND cancellation_version=?", job.ID, lease.Token, lease.CancellationVersion).Updates(map[string]any{"state": "ready", "result_json": string(raw), "result_hash": hash, "lease_token": "", "lease_until": time.Time{}, "updated_at": time.Now().UTC()})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return conflict()
		}
		return nil
	})
}
func (s *Server) failIntelligenceLease(lease IntelligenceLease, cause error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.withIntelligenceWorkerFence(ctx, lease.Job, func(tx *gorm.DB, a *access) error {
		var j IntelligenceJob
		if e := tx.Omit("result_json").First(&j, "id=? AND state='running' AND lease_token=?", lease.Job.ID, lease.Token).Error; e != nil {
			return nil
		}
		code := "provider_failed"
		state := "failed"
		var api *apiError
		if errors.As(cause, &api) {
			code = api.Code
			if inString(code, "source_unavailable", "source_changed") {
				state = "invalidated"
			}
		}
		if errors.Is(cause, context.Canceled) {
			code = "cancelled"
			state = "cancelled"
		}
		if errors.Is(cause, context.DeadlineExceeded) {
			code = "provider_timeout"
		}
		if code == "provider_transient" && j.Attempts < 3 {
			backoff := 5 * time.Second
			if j.Attempts > 1 {
				backoff = 30 * time.Second
			}
			return tx.Model(&j).Updates(map[string]any{"state": "retry_wait", "next_attempt_at": time.Now().UTC().Add(backoff), "lease_token": "", "lease_until": time.Time{}, "reason_code": code}).Error
		}
		return retireIntelligenceJob(tx, j.ID, state, code)
	})
}
func (s *Server) RunIntelligenceWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	maintenanceCtx, stopMaintenance := context.WithCancel(ctx)
	maintenanceDone := make(chan struct{})
	go func() {
		defer close(maintenanceDone)
		// Raw retention is independent of optional provider availability and admission.
		_, _ = s.RunIntelligenceMaintenance(maintenanceCtx, time.Now().UTC(), 100)
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-maintenanceCtx.Done():
				return
			case <-ticker.C:
				_, _ = s.RunIntelligenceMaintenance(maintenanceCtx, time.Now().UTC(), 100)
			}
		}
	}()
	defer func() { stopMaintenance(); <-maintenanceDone }()
	if s.opts.Intelligence == nil || s.opts.Intelligence.DisabledReason != "" {
		<-ctx.Done()
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		release, admissionErr := s.opts.LocalProviderBudget.Acquire(ctx)
		if admissionErr != nil {
			return
		}
		claimCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		lease, e := s.claimIntelligence(claimCtx)
		cancel()
		if e == nil && lease != nil {
			_ = s.runIntelligenceLeaseAdmitted(ctx, *lease)
			release()
			continue
		}
		release()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Server) RunIntelligenceMaintenance(ctx context.Context, now time.Time, limit int) (int, error) {
	if e := s.sweepIntelligenceScratch(ctx, now); e != nil {
		return 0, e
	}
	if limit < 1 || limit > 100 {
		limit = 100
	}
	var rows []IntelligenceJob
	if e := s.db.WithContext(ctx).Omit("result_json").Where("state IN ?", []string{"queued", "running", "retry_wait", "ready"}).Order("updated_at,id").Limit(limit).Find(&rows).Error; e != nil {
		return 0, e
	}
	n := 0
	for _, job := range rows {
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockIntelligenceCompany(tx, job.CompanyID); e != nil {
				return e
			}
			var current IntelligenceJob
			if e := tx.Omit("result_json").First(&current, "id=?", job.ID).Error; e != nil {
				return e
			}
			job = current
			if !inString(job.State, "queued", "running", "retry_wait", "ready") {
				return nil
			}
			a, e := currentAttentionActorLocked(tx, job.CompanyID, job.ActorID)
			if e != nil {
				var api *apiError
				if errors.As(e, &api) && api.Status < 500 {
					n++
					return retireIntelligenceJob(tx, job.ID, "invalidated", "source_unavailable")
				}
				return e
			}
			if !job.ExpiresAt.After(now) {
				n++
				return retireIntelligenceJob(tx, job.ID, "expired", "expired")
			}
			if e := intelligenceOriginalAuthority(tx, a, job); e != nil {
				n++
				return retireIntelligenceJob(tx, job.ID, "invalidated", "source_unavailable")
			}
			m, e := loadIntelligenceManifest(tx, job)
			if e != nil {
				return e
			}
			if e = s.authorizeIntelligenceSources(tx, a, m, IntelligenceExactCurrent); e != nil {
				n++
				return retireIntelligenceJob(tx, job.ID, "invalidated", "source_unavailable")
			}
			if job.State == "running" && !job.LeaseUntil.After(now) {
				n++
				if job.Attempts >= 3 {
					return retireIntelligenceJob(tx, job.ID, "failed", "retry_exhausted")
				}
				return tx.Model(&IntelligenceJob{}).Where("id=? AND lease_token=?", job.ID, job.LeaseToken).Updates(map[string]any{"state": "retry_wait", "lease_token": "", "next_attempt_at": now.Add(5 * time.Second)}).Error
			}
			return tx.Model(&IntelligenceJob{}).Where("id=?", job.ID).Update("updated_at", now).Error
		})
		if e != nil {
			return n, e
		}
	}
	return n, nil
}

// M10 never changes a company key (including slug) or deletes a company. Its
// only company writes are canonical task/expense number counters. Keep the
// same writer/authority exclusion while allowing private-writer FK KEY SHARE
// checks, which can occur after that writer's session/member/conversation locks.
// All ordinary callers and key mutators retain lockCompany's strongest fence.
func lockIntelligenceCompany(tx *gorm.DB, cid string) error {
	if tx.Dialector.Name() != "postgres" {
		return lockCompany(tx, cid)
	}
	var c Company
	return tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).First(&c, "id=?", cid).Error
}
func (s *Server) withIntelligenceAccessTransaction(r *http.Request, a *access, fn func(*gorm.DB) error, opts ...*sql.TxOptions) error {
	if s.db.Dialector.Name() == "postgres" && len(opts) > 0 && opts[0] != nil && opts[0].Isolation == sql.LevelRepeatableRead {
		current := *opts[0]
		current.Isolation = sql.LevelReadCommitted
		opts = []*sql.TxOptions{&current}
	}
	return s.withCompanyAccessFenceUsing(r, a, nil, lockIntelligenceCompany, fn, opts...)
}
