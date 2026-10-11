package platform

import (
	"bytes"
	"context"
	"errors"
	"gorm.io/gorm"
	"io"
	"os"
	"testing"
	"time"
)

type financeRejectScanner struct{}

func (financeRejectScanner) Scan(context.Context, io.Reader) error {
	return ErrMediaScanRejected
}
func pendingFinanceScan(t *testing.T, f financeFixture) (string, FinanceAssistanceJob) {
	t.Helper()
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceIntakeStore = store
	data := []byte("\x89PNG\r\n\x1a\nfictional")
	id := reserveFinanceIntake(t, f, data, "receipt")
	if uploadFinanceIntake(t, f, id, data) != 200 {
		t.Fatal("upload")
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", map[string]any{"retryKey": "scan-outcome", "expectedVersion": 2}, f.cookie)
	var job FinanceAssistanceJob
	if e := f.db.First(&job, "source_id=?", id).Error; e != nil {
		t.Fatal(e)
	}
	return id, job
}
func TestFinanceScanTerminalObservableAndRecovery(t *testing.T) {
	for _, kind := range []string{"rejection", "unavailable", "exhausted_lease"} {
		t.Run(kind, func(t *testing.T) {
			f := newFinanceFixture(t)
			id, job := pendingFinanceScan(t, f)
			if kind == "exhausted_lease" {
				f.db.Model(&FinanceAssistanceJob{}).Where("id=?", job.ID).Updates(map[string]any{"status": "running", "attempts": 3, "lease_token": "expired-own-claim", "lease_until": time.Now().UTC().Add(-time.Minute)})
			} else {
				if kind == "rejection" {
					f.s.opts.FinanceScanner = financeRejectScanner{}
				}
				for n := 0; n < 3; n++ {
					f.db.Model(&FinanceAssistanceJob{}).Where("id=?", job.ID).Update("available_at", time.Now().UTC().Add(-time.Minute))
					if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
						t.Fatal(e)
					}
				}
			}
			if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
				t.Fatal(e)
			}
			meta := financeOK(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie)
			assessment, ok := meta["assessment"].(map[string]any)
			expectedStatus, expectedRetry := "failed", true
			if kind == "rejection" {
				expectedStatus, expectedRetry = "rejected", false
			}
			if !ok || assessment["status"] != expectedStatus || assessment["retryable"] != expectedRetry {
				t.Fatalf("terminal scan invisible to authorized intake GET: %v", meta)
			}
			if meta["state"] == "clean" {
				t.Fatal("failure cleaned bytes")
			}
			if st, _, _ := req(t, f.s, "GET", f.base()+"/finance/intakes/"+id+"/download", nil, f.cookie); st != 404 {
				t.Fatal("failed bytes downloadable", st)
			}
			if uploadFinanceIntake(t, f, id, []byte("\x89PNG\r\n\x1a\nfictional")) != 409 {
				t.Fatal("failed source accepts upload")
			}
			f.s.opts.FinanceScanner = financeCleanScanner{}
			retry := map[string]any{"retryKey": "deliberate-same-source-assessment", "expectedVersion": 3, "retryAssessment": true}
			if kind == "rejection" {
				if st, _, _ := req(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", retry, f.cookie); st != 422 {
					t.Fatal("rejected bytes retried", st)
				}
				financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/cancel", map[string]any{"retryKey": "cancel-rejected", "expectedVersion": 3}, f.cookie)
				if st, _, _ := req(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie); st != 404 {
					t.Fatal("cancelled rejection disclosed", st)
				}
				return
			}
			financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", retry, f.cookie)
			financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", retry, f.cookie)
			if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
				t.Fatal(e)
			}
			meta = financeOK(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie)
			if meta["state"] != "clean" || meta["version"] != float64(5) {
				t.Fatal("deliberate fresh assessment did not clean once", meta)
			}
			financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", retry, f.cookie)
			var jobs int64
			if e := f.db.Model(&FinanceAssistanceJob{}).Where("source_id=?", id).Count(&jobs).Error; e != nil {
				t.Fatal(e)
			}
			if jobs != 2 {
				t.Fatal("canonical retry created another assessment", jobs)
			}
			var intake FinanceAssistanceIntake
			if e := f.db.First(&intake, "id=?", id).Error; e != nil {
				t.Fatal(e)
			}
			if intake.ContentGeneration != job.ContentGeneration || !intake.ExpiresAt.Equal(job.ExpiresAt) || intake.SessionRef != job.SessionRef {
				t.Fatal("retry renewed/replaced source")
			}
			// Old terminal publication cannot overwrite new claim/source version.
			if e := f.s.failFinanceJob(t.Context(), job, errors.New("late old scanner rejection")); e != nil {
				t.Fatal(e)
			}
			meta = financeOK(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie)
			if meta["state"] != "clean" {
				t.Fatal("old failure overwrote new clean source")
			}
		})
	}
}

type pausedFinanceRejection struct{ entered, resume chan struct{} }

func (p pausedFinanceRejection) Scan(ctx context.Context, _ io.Reader) error {
	close(p.entered)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-p.resume:
		return ErrMediaScanRejected
	}
}
func TestFinanceScanOldFailureCannotPublishAfterBarrier(t *testing.T) {
	for _, barrier := range []string{"reclaimed_lease", "new_generation", "cancelled", "origin_expired"} {
		t.Run(barrier, func(t *testing.T) {
			f := newFinanceFixture(t)
			id, job := pendingFinanceScan(t, f)
			scanner := pausedFinanceRejection{make(chan struct{}), make(chan struct{})}
			f.s.opts.FinanceScanner = scanner
			done := make(chan error, 1)
			go func() { _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); done <- e }()
			select {
			case <-scanner.entered:
			case <-time.After(3 * time.Second):
				t.Fatal("scanner not entered")
			}
			switch barrier {
			case "reclaimed_lease":
				f.db.Model(&FinanceAssistanceJob{}).Where("id=?", job.ID).Updates(map[string]any{"lease_token": "new-current-claim", "lease_until": time.Now().UTC().Add(time.Minute)})
			case "new_generation":
				f.db.Model(&FinanceAssistanceIntake{}).Where("id=?", id).Updates(map[string]any{"version": 4, "content_generation": 2})
			case "cancelled":
				financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/cancel", map[string]any{"retryKey": "cancel-during-rejected-scan", "expectedVersion": 3}, f.cookie)
			case "origin_expired":
				expireFinanceJobOrigin(t, f, job.ID)
			}
			close(scanner.resume)
			if e := <-done; e != nil {
				t.Fatal(e)
			}
			st, meta, _ := req(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie)
			if barrier == "cancelled" || barrier == "origin_expired" {
				if st != 404 && st != 401 {
					t.Fatal("denied outcome disclosed", st)
				}
				return
			}
			if st != 200 {
				t.Fatal(st)
			}
			if assessment, ok := meta["assessment"].(map[string]any); ok && assessment["status"] == "rejected" {
				t.Fatal("old rejection published to current source", meta)
			}
			if barrier == "reclaimed_lease" {
				var current FinanceAssistanceJob
				f.db.First(&current, "id=?", job.ID)
				if current.Status != "running" || current.LeaseToken != "new-current-claim" {
					t.Fatal("old worker changed new claim", current.Status)
				}
			}
		})
	}
}
func TestFinanceScanRequiredOutcomeWriteRollback(t *testing.T) {
	for _, kind := range []string{"scanner_failure", "exhaustion"} {
		t.Run(kind, func(t *testing.T) {
			f := newFinanceFixture(t)
			id, job := pendingFinanceScan(t, f)
			f.s.opts.FinanceScanner = financeRejectScanner{}
			if kind == "exhaustion" {
				f.db.Model(&FinanceAssistanceJob{}).Where("id=?", job.ID).Updates(map[string]any{"status": "running", "attempts": 3, "lease_token": "exhausted-owned", "lease_until": time.Now().UTC().Add(-time.Minute)})
			}
			injected := errors.New("owned required outcome write failure")
			f.db.Callback().Update().Before("gorm:update").Register("reject_scan_outcome", func(tx *gorm.DB) {
				if tx.Statement.Table == "finance_assistance_jobs" {
					if updates, ok := tx.Statement.Dest.(map[string]interface{}); ok && updates["status"] == "failed" {
						tx.AddError(injected)
					}
				}
			})
			if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); !errors.Is(e, injected) {
				t.Fatal("worker hid required outcome write error", e)
			}
			f.db.Callback().Update().Remove("reject_scan_outcome")
			var fresh FinanceAssistanceJob
			f.db.First(&fresh, "id=?", job.ID)
			if fresh.Status != "running" {
				t.Fatal("failed write did not rollback", fresh.Status)
			}
			meta := financeOK(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie)
			if meta["state"] == "clean" {
				t.Fatal("failed write cleaned source")
			}
		})
	}
}
func TestFinanceScanRetryOriginalSessionAndRollback(t *testing.T) {
	f := newFinanceFixture(t)
	id, job := pendingFinanceScan(t, f)
	f.db.Model(&FinanceAssistanceJob{}).Where("id=?", job.ID).Updates(map[string]any{"status": "failed", "error_code": "scan_unavailable"})
	retry := map[string]any{"retryKey": "rollback-retry-assessment", "expectedVersion": 3, "retryAssessment": true}
	f.db.Callback().Create().Before("gorm:create").Register("reject_scan_retry", func(tx *gorm.DB) {
		if tx.Statement.Table == "finance_assistance_jobs" {
			tx.AddError(errors.New("owned retry create failure"))
		}
	})
	if st, _, _ := req(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", retry, f.cookie); st != 500 {
		t.Fatal("retry hid failure", st)
	}
	f.db.Callback().Create().Remove("reject_scan_retry")
	var source FinanceAssistanceIntake
	f.db.First(&source, "id=?", id)
	if source.Version != 3 {
		t.Fatal("retry failure advanced CAS")
	}
	var claims int64
	if e := f.db.Model(&BusinessMutationRetry{}).Where("retry_key=?", "rollback-retry-assessment").Count(&claims).Error; e != nil {
		t.Fatal(e)
	}
	if claims != 0 {
		t.Fatal("failed retry persisted claim")
	}
	expireFinanceJobOrigin(t, f, job.ID)
	if st, _, _ := req(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", retry, f.cookie); st != 401 && st != 404 {
		t.Fatal("expired origin renewed by retry", st)
	}
}
func TestFinanceScanRealRejectedVerdict(t *testing.T) {
	address := os.Getenv("TEST_CLAMAV_ADDRESS")
	if address == "" {
		t.Skip("explicit owned ClamAV required")
	}
	scanner := ClamAVScanner{Address: address}
	fixture := []byte("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")
	if e := scanner.Scan(t.Context(), bytes.NewReader(fixture)); !errors.Is(e, ErrMediaScanRejected) {
		t.Fatal("positive actual scanner rejection not typed", e)
	}
}
