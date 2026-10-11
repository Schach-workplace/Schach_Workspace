package platform

import (
	"bytes"
	"context"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

// Company/session/directory precede source locks. External work never holds these locks.
func (s *Server) withFinanceJobAccess(ctx context.Context, job FinanceAssistanceJob, fn func(*gorm.DB, *access) error) error {
	return s.withFinanceClaimAccess(ctx, job, false, fn)
}
func (s *Server) withFinanceClaimAccess(ctx context.Context, job FinanceAssistanceJob, exhausted bool, fn func(*gorm.DB, *access) error) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := lockCompany(tx, job.CompanyID); e != nil {
			return e
		}
		if e := financeOriginalSession(tx, job.CompanyID, job.RequesterID, job.SessionRef); e != nil {
			return e
		}
		a, e := currentAttentionActorLocked(tx, job.CompanyID, job.RequesterID)
		if e != nil {
			return e
		}
		var owned FinanceAssistanceJob
		claim := lockCommunicationRow(tx, "UPDATE").Select("id").Where("id=? AND company_id=? AND requester_id=? AND lease_token=? AND status='running'", job.ID, job.CompanyID, job.RequesterID, job.LeaseToken)
		if exhausted {
			claim = claim.Where("attempts>=3 AND lease_until<=?", time.Now())
		} else {
			claim = claim.Where("lease_until>?", time.Now())
		}
		if e := claim.First(&owned).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return missing()
			}
			return e
		}
		if e = authorizeFinanceJobSource(tx, a, job, true); e != nil {
			return e
		}
		return fn(tx, a)
	})
}
func authorizeFinanceJobSource(tx *gorm.DB, a *access, j FinanceAssistanceJob, versions bool) error {
	if j.CompanyID != a.Company.ID || j.RequesterID != a.User.ID || !time.Now().Before(j.ExpiresAt) || in(j.Status, "cancelled", "stale") {
		return missing()
	}
	if e := financeOriginalSession(tx, j.CompanyID, j.RequesterID, j.SessionRef); e != nil {
		return e
	}
	if j.SourceKind == "intake" {
		i, e := authorizeFinanceIntake(tx, a, j.SourceID)
		if e != nil {
			return e
		}
		if i.InternalSHA256 != j.InternalHash || i.ContentGeneration != j.ContentGeneration {
			return missing()
		}
		if j.Operation == "scan_intake" {
			if i.State != "scanning" && i.State != "clean" {
				return missing()
			}
		} else if i.State != "clean" || i.Purpose != "receipt" || i.CleanGeneration != j.CleanGeneration {
			return missing()
		}
		if versions && i.Version != j.SourceVersion {
			return financeConflict()
		}
	} else {
		receipt, parent, e := scopedFinanceReceipt(tx, a, j.SourceID)
		if e != nil {
			return e
		}
		if parent.ID != j.SourceParentID || financeDigest(receipt.Data) != j.InternalHash {
			return missing()
		}
		if versions && parent.Version != j.SourceVersion {
			return financeConflict()
		}
		if j.Operation == "extract_receipt" {
			var fingerprint ReceiptEvidenceFingerprint
			if e := tx.First(&fingerprint, "company_id=? AND receipt_id=? AND sha256=? AND state='clean'", a.Company.ID, receipt.ID, j.InternalHash).Error; e != nil || fingerprint.Generation != j.CleanGeneration {
				return missing()
			}
		}
	}
	if j.Operation == "extract_receipt" {
		if j.CompanyCurrency != a.Company.Currency || !a.canCreateExpense(j.DestinationDepartmentID) || !departmentExists(tx, a.Company.ID, j.DestinationDepartmentID) {
			return missing()
		}
		if j.TargetExpenseID != "" {
			target, e := scopedExpense(tx, a, j.TargetExpenseID)
			if e != nil {
				return e
			}
			if target.CreatedBy != a.User.ID || target.DepartmentID != j.DestinationDepartmentID {
				return missing()
			}
			if versions && (target.Version != j.TargetVersion || target.Status != "draft") {
				return financeConflict()
			}
		}
	}
	return nil
}
func (s *Server) claimFinanceJob(ctx context.Context, now time.Time) (FinanceAssistanceJob, error) {
	var j FinanceAssistanceJob
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := tx.Where("expires_at>? AND attempts<3 AND ((status='queued' AND available_at<=?) OR (status='running' AND lease_until<=?))", now, now, now).Order("available_at,id")
		if tx.Dialector.Name() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		if e := q.First(&j).Error; e != nil {
			return e
		}
		token := newID("lease")
		res := tx.Model(&FinanceAssistanceJob{}).Where("id=? AND version=? AND status=?", j.ID, j.Version, j.Status).Updates(map[string]any{"status": "running", "lease_token": token, "lease_until": now.Add(120 * time.Second), "attempts": gorm.Expr("attempts+1"), "version": gorm.Expr("version+1"), "updated_at": now})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		j.Status = "running"
		j.LeaseToken = token
		j.LeaseUntil = now.Add(120 * time.Second)
		j.Attempts++
		j.Version++
		return nil
	})
	return j, e
}
func (s *Server) financeJobBytes(ctx context.Context, j FinanceAssistanceJob) ([]byte, string, error) {
	var i FinanceAssistanceIntake
	var receipt ExpenseReceipt
	e := s.withFinanceJobAccess(ctx, j, func(tx *gorm.DB, a *access) error {
		if j.SourceKind == "intake" {
			return tx.First(&i, "id=? AND company_id=?", j.SourceID, j.CompanyID).Error
		}
		var e error
		receipt, _, e = scopedFinanceReceipt(tx, a, j.SourceID)
		return e
	})
	if e != nil {
		return nil, "", e
	}
	if j.SourceKind == "intake" {
		data, e := s.readFinanceIntakeBytes(ctx, i)
		if e == nil {
			e = s.withFinanceJobAccess(ctx, j, func(*gorm.DB, *access) error { return nil })
		}
		return data, i.MimeType, e
	}
	if receipt.Size > 10<<20 || int64(len(receipt.Data)) != receipt.Size {
		return nil, "", missing()
	}
	return receipt.Data, receipt.MimeType, nil
}
func (s *Server) RunFinanceAssistanceJobs(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		limit = 1
	}
	var exhausted []FinanceAssistanceJob
	if e := s.db.WithContext(ctx).Where("status='running' AND attempts>=3 AND lease_until<=?", now).Order("id").Limit(limit).Find(&exhausted).Error; e != nil {
		return 0, e
	}
	for _, job := range exhausted {
		if e := s.publishFinanceFailure(ctx, job, "failed", "retry_exhausted", true); e != nil {
			return 0, e
		}
	}

	done := 0
	for n := 0; n < limit; n++ {
		j, e := s.claimFinanceJob(ctx, now)
		if e == gorm.ErrRecordNotFound {
			return done, nil
		}
		if e != nil {
			return done, e
		}
		work, cancel := context.WithTimeout(ctx, 45*time.Second)
		data, mime, e := s.financeJobBytes(work, j)
		var extracted ReceiptOCRText
		var candidates ReceiptCandidates
		if e == nil {
			if s.opts.FinanceScanner == nil {
				e = invalid("Clean assessment unavailable.")
			} else {
				e = s.opts.FinanceScanner.Scan(work, bytes.NewReader(data))
			}
		}
		if e == nil && j.Operation == "extract_receipt" {
			if s.opts.ReceiptOCRProvider == nil || s.opts.FinanceOCRFingerprint != j.ProviderFingerprint {
				e = invalid("Receipt extraction unavailable.")
			} else {
				var release func()
				release, e = s.opts.LocalProviderBudget.Acquire(work)
				if e == nil {
					latest, _, err := s.financeJobBytes(work, j)
					if err != nil {
						e = err
					} else if financeDigest(latest) != financeDigest(data) || s.opts.FinanceOCRFingerprint != j.ProviderFingerprint {
						e = missing()
					} else {
						extracted, e = s.opts.ReceiptOCRProvider.Extract(work, ReceiptOCRInput{Reader: bytes.NewReader(data), Size: int64(len(data)), MIME: mime, Language: "eng", ConfigFingerprint: j.ProviderFingerprint})
					}
					release()
					if e == nil {
						candidates, e = parseReceiptCandidates(extracted.Text, j.CompanyCurrency)
					}
				}
			}
		}
		if e == nil {
			latest, _, err := s.financeJobBytes(work, j)
			if err != nil {
				e = err
			} else if financeDigest(latest) != financeDigest(data) {
				e = missing()
			}
		}
		cancel()
		if e != nil {
			if failure := s.failFinanceJob(ctx, j, e); failure != nil {
				return done, failure
			}
			done++
			continue
		}
		e = s.withFinanceJobAccess(ctx, j, func(tx *gorm.DB, a *access) error {
			var fresh FinanceAssistanceJob
			if e := tx.First(&fresh, "id=? AND lease_token=? AND status='running' AND lease_until>?", j.ID, j.LeaseToken, time.Now()).Error; e != nil {
				return missing()
			}
			if j.Operation == "extract_receipt" {
				if s.opts.FinanceOCRFingerprint != j.ProviderFingerprint {
					return missing()
				}
				result := ReceiptExtractionResult{ID: newID("fres"), CompanyID: j.CompanyID, JobID: j.ID, RequesterID: j.RequesterID, Revision: 1, Engine: extracted.Engine, EngineVersion: extracted.Version, Language: extracted.Language, Candidates: candidates, CreatedAt: time.Now().UTC(), ExpiresAt: j.ExpiresAt}
				if e := tx.Create(&result).Error; e != nil {
					return e
				}
				if e := syncFinanceExtractionAttention(tx, j, result.Revision); e != nil {
					return e
				}
				fresh.ResultID = result.ID
				if e := tx.Model(&fresh).Update("result_id", result.ID).Error; e != nil {
					return e
				}
			} else if j.Operation == "scan_intake" {
				var i FinanceAssistanceIntake
				if e := tx.First(&i, "id=?", j.SourceID).Error; e != nil {
					return e
				}
				i.State = "clean"
				i.CleanGeneration = i.ContentGeneration
				i.Version++
				if e := tx.Save(&i).Error; e != nil {
					return e
				}
			} else {
				receipt, _, e := scopedFinanceReceipt(tx, a, j.SourceID)
				if e != nil {
					return e
				}
				fingerprint := ReceiptEvidenceFingerprint{ID: newID("fass"), CompanyID: j.CompanyID, ReceiptID: j.SourceID, ExpenseID: j.SourceParentID, RequesterID: j.RequesterID, SessionRef: j.SessionRef, SHA256: j.InternalHash, ScannerVersion: "scanner-v1", Size: receipt.Size, MimeType: receipt.MimeType, State: "clean", Generation: 1, AssessedAt: time.Now().UTC()}
				if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&fingerprint).Error; e != nil {
					return e
				}
			}
			result := tx.Model(&fresh).Where("lease_token=? AND status='running' AND lease_until>?", j.LeaseToken, time.Now()).Updates(map[string]any{"status": "ready", "version": gorm.Expr("version+1"), "updated_at": time.Now()})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return missing()
			}
			return nil
		})
		if e != nil {
			if failure := s.failFinanceJob(ctx, j, e); failure != nil {
				return done, failure
			}
			if _, expected := e.(*apiError); !expected {
				return done, e
			}
		}
		done++
	}
	return done, nil
}
func (s *Server) failFinanceJob(ctx context.Context, j FinanceAssistanceJob, cause error) error {
	state, code := "queued", "provider_unavailable"
	if in(j.Operation, "scan_intake", "scan_receipt") {
		code = "scan_unavailable"
	}
	if j.Attempts >= 3 {
		state = "failed"
	}
	if errors.Is(cause, ErrMediaScanRejected) {
		state, code = "failed", "scan_rejected"
	}
	if a, ok := cause.(*apiError); ok && inStatus(a.Status, 401, 403, 404, 409) {
		state, code = "stale", "source_unavailable"
	}
	return s.publishFinanceFailure(ctx, j, state, code, false)
}
func inStatus(status int, values ...int) bool {
	for _, v := range values {
		if v == status {
			return true
		}
	}
	return false
}
func (s *Server) publishFinanceFailure(ctx context.Context, j FinanceAssistanceJob, state, code string, exhausted bool) error {
	delay := 5 * time.Second
	if j.Attempts >= 2 {
		delay = 30 * time.Second
	}
	e := s.withFinanceClaimAccess(ctx, j, exhausted, func(tx *gorm.DB, _ *access) error {
		q := tx.Model(&FinanceAssistanceJob{}).Where("id=? AND lease_token=? AND status='running'", j.ID, j.LeaseToken)
		if exhausted {
			q = q.Where("attempts>=3 AND lease_until<=?", time.Now())
		} else {
			q = q.Where("lease_until>?", time.Now())
		}
		result := q.Updates(map[string]any{"status": state, "error_code": code, "available_at": time.Now().Add(delay), "updated_at": time.Now().UTC(), "version": gorm.Expr("version+1")})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return missing()
		}
		return nil
	})
	if e == nil {
		return nil
	}
	// Authorization/old-claim loss can only retire the still-owned claim as stale;
	// it cannot publish a scan verdict or change the current source.
	if a, ok := e.(*apiError); !ok || !inStatus(a.Status, 401, 403, 404, 409) {
		return e
	}
	q := s.db.WithContext(ctx).Model(&FinanceAssistanceJob{}).Where("id=? AND lease_token=? AND status='running'", j.ID, j.LeaseToken)
	if exhausted {
		q = q.Where("attempts>=3 AND lease_until<=?", time.Now())
	} else {
		q = q.Where("lease_until>?", time.Now())
	}
	return q.Updates(map[string]any{"status": "stale", "error_code": "source_unavailable", "updated_at": time.Now().UTC(), "version": gorm.Expr("version+1")}).Error
}
