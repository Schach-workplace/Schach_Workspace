package platform

import (
	"gorm.io/gorm"
	"net/http"
	"time"
)

// Caller holds the company and current directory User fence. Reading the
// original session here must not acquire an earlier-class session lock.
func intelligenceOriginalAuthority(tx *gorm.DB, a *access, j IntelligenceJob) error {
	if j.ActorID != a.User.ID || j.CompanyID != a.Company.ID || a.User.SessionEpoch <= 0 || a.User.SessionEpoch != j.CapturedUserEpoch || a.Company.PermissionEpoch != j.CapturedCompanyAuthorityEpoch {
		return intelligenceError(403, "source_unavailable")
	}
	return financeOriginalSession(tx, j.CompanyID, j.ActorID, j.OriginatingSessionRef)
}
func loadIntelligenceManifest(tx *gorm.DB, j IntelligenceJob) (SourceManifest, error) {
	out := SourceManifest{Sources: []BoundIntelligenceSource{}, SourceSetHash: j.SourceSetHash, ExpiresAt: j.ExpiresAt}
	var rows []IntelligenceSource
	if e := tx.Where("job_id=? AND company_id=?", j.ID, j.CompanyID).Order("source_key").Find(&rows).Error; e != nil {
		return out, e
	}
	if len(rows) == 0 || len(rows) > 50 {
		return out, intelligenceError(403, "source_unavailable")
	}
	for _, row := range rows {
		out.Sources = append(out.Sources, row.Binding)
	}
	return out, nil
}

func (s *Server) intelligenceAvailable(operation IntelligenceOperation) bool {
	c := s.opts.Intelligence
	if c == nil || c.DisabledReason != "" {
		return false
	}
	if operation == "transcript" {
		return c.Transcription != nil
	}
	return c.Summary != nil
}
func (s *Server) intelligenceEnqueue(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input IntelligenceEnqueue
	if e = decodeIntelligence(w, r, &input); e != nil {
		return e
	}
	if !clean(input.RetryKey, 100) || !input.OptIn.Accepted || input.OptIn.PolicyVersion != intelligencePolicy {
		return invalid("Explicit local-processing consent and a stable retry key are required.")
	}
	if !s.intelligenceAvailable(input.Operation) {
		return intelligenceError(503, "provider_unavailable")
	}
	client, effective, e := hashIntelligenceIntent(input, s.opts.Intelligence.Identity)
	if e != nil {
		return e
	}
	ref, e := financeSessionRef(r)
	if e != nil {
		return e
	}
	var job IntelligenceJob
	e = s.withIntelligenceAccessTransaction(r, a, func(tx *gorm.DB) error {
		var found IntelligenceJob
		err := tx.Omit("result_json").Where("company_id=? AND actor_id=? AND retry_key=?", a.Company.ID, a.User.ID, input.RetryKey).First(&found).Error
		if err == nil {
			if found.Operation != input.Operation || found.ClientIntentHash != client {
				return conflict()
			}
			if found.Provider != s.opts.Intelligence.Identity {
				return intelligenceError(503, "provider_unavailable")
			}
			if e := intelligenceOriginalAuthority(tx, a, found); e != nil {
				return intelligenceError(403, "source_unavailable")
			}
			manifest, e := loadIntelligenceManifest(tx, found)
			if e != nil {
				return e
			}
			if e = s.authorizeIntelligenceSources(tx, a, manifest, IntelligenceExactCurrent); e != nil {
				return e
			}
			job = found
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		manifest, e := s.captureIntelligenceSources(tx, a, input.IntelligenceSelection)
		if e != nil {
			return e
		}
		if manifest.SourceSetHash != input.SelectionHash {
			return conflict()
		}
		var own, total int64
		q := tx.Model(&IntelligenceJob{}).Where("company_id=? AND state IN ?", a.Company.ID, []string{"queued", "running", "retry_wait"})
		if e := q.Count(&total).Error; e != nil {
			return e
		}
		if e := q.Where("actor_id=?", a.User.ID).Count(&own).Error; e != nil {
			return e
		}
		if own >= 10 || total >= 100 {
			return intelligenceError(429, "queue_full")
		}
		now := time.Now().UTC()
		expiry := earlierIntelligenceExpiry(now.Add(24*time.Hour), manifest.ExpiresAt)
		var session SessionRecord
		if e := tx.First(&session, "token_hash=? AND user_id=?", ref, a.User.ID).Error; e != nil {
			return unauthenticated()
		}
		expiry = earlierIntelligenceExpiry(expiry, session.ExpiresAt)
		selection, e := normalizedIntelligenceSelection(input.IntelligenceSelection)
		if e != nil {
			return e
		}
		job = IntelligenceJob{ID: newID("intel"), CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: input.Operation, RetryKey: input.RetryKey, OriginatingSessionRef: ref, CapturedUserEpoch: a.User.SessionEpoch, CapturedCompanyAuthorityEpoch: a.Company.PermissionEpoch, ClientIntentHash: client, EffectiveRequestHash: effective, SourceSetHash: manifest.SourceSetHash, OptInVersion: intelligencePolicy, Provider: s.opts.Intelligence.Identity, Selection: selection, State: "queued", CreatedAt: now, UpdatedAt: now, NextAttemptAt: now, ExpiresAt: expiry}
		if e := intelligenceOriginalAuthority(tx, a, job); e != nil {
			return e
		}
		if e := tx.Create(&job).Error; e != nil {
			return e
		}
		for _, b := range manifest.Sources {
			row := IntelligenceSource{JobID: job.ID, SourceKey: b.SourceKey, CompanyID: job.CompanyID, Kind: b.Request.Kind, SourceID: b.Request.ID, Binding: b}
			if e := tx.Create(&row).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	w.Header().Set("Cache-Control", "no-store")
	return respond(w, 202, IntelligenceJobView{JobID: job.ID, State: job.State, ExpiresAt: job.ExpiresAt})
}
func retireIntelligenceJob(tx *gorm.DB, id, state, code string) error {
	return tx.Model(&IntelligenceJob{}).Where("id=?", id).Updates(map[string]any{"state": state, "reason_code": code, "result_json": "", "lease_token": "", "lease_until": time.Time{}, "cancellation_version": gorm.Expr("cancellation_version + 1"), "updated_at": time.Now().UTC()}).Error
}
