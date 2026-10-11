package platform

import (
	"context"
	"io"
	"sync/atomic"
	"testing"
	"time"
)

type pausedFinanceScanner struct{ entered, resume chan struct{} }

func (p pausedFinanceScanner) Scan(ctx context.Context, r io.Reader) error {
	close(p.entered)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-p.resume:
		_, e := io.Copy(io.Discard, r)
		return e
	}
}

type countedReceiptProvider struct{ calls atomic.Int32 }

func (p *countedReceiptProvider) Extract(ctx context.Context, in ReceiptOCRInput) (ReceiptOCRText, error) {
	p.calls.Add(1)
	return immediateReceiptOCR{}.Extract(ctx, in)
}
func TestReceiptExtractionReauthorizeBeforeProvider(t *testing.T) {
	for _, barrier := range []string{"source_denied", "cancelled", "lease_reclaimed"} {
		t.Run(barrier, func(t *testing.T) {
			f := newFinanceFixture(t)
			id := readyReceiptExtraction(t, f)
			f.db.Where("job_id=?", id).Delete(&ReceiptExtractionResult{})
			f.db.Model(&FinanceAssistanceJob{}).Where("id=?", id).Updates(map[string]any{"status": "queued", "result_id": "", "attempts": 0, "available_at": time.Now().Add(-time.Minute)})
			scanner := pausedFinanceScanner{make(chan struct{}), make(chan struct{})}
			provider := &countedReceiptProvider{}
			f.s.opts.FinanceScanner = scanner
			f.s.opts.ReceiptOCRProvider = provider
			done := make(chan error, 1)
			go func() { _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); done <- e }()
			select {
			case <-scanner.entered:
			case <-time.After(3 * time.Second):
				t.Fatal("scanner not entered")
			}
			switch barrier {
			case "source_denied":
				if e := f.db.Model(&Membership{}).Where("company_id=? AND user_id=?", f.cid, f.uid).Update("active", false).Error; e != nil {
					t.Fatal(e)
				}
			case "cancelled":
				var j FinanceAssistanceJob
				f.db.First(&j, "id=?", id)
				financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions/"+id+"/cancel", map[string]any{"retryKey": "cancel-at-provider-boundary", "expectedVersion": j.Version}, f.cookie)
			case "lease_reclaimed":
				if e := f.db.Model(&FinanceAssistanceJob{}).Where("id=?", id).Updates(map[string]any{"lease_token": "new-owned-lease", "lease_until": time.Now().Add(time.Minute)}).Error; e != nil {
					t.Fatal(e)
				}
			}
			close(scanner.resume)
			if e := <-done; e != nil {
				t.Fatal(e)
			}
			if provider.calls.Load() != 0 {
				t.Fatal("scanner-time barrier still disclosed bytes to provider", provider.calls.Load())
			}
			var results int64
			f.db.Model(&ReceiptExtractionResult{}).Where("job_id=?", id).Count(&results)
			if results != 0 {
				t.Fatal("old worker resurrected output")
			}
		})
	}
}

type waitingFinanceBudget struct {
	LocalProviderBudget
	entered chan struct{}
}

func (b waitingFinanceBudget) Acquire(ctx context.Context) (func(), error) {
	close(b.entered)
	return b.LocalProviderBudget.Acquire(ctx)
}
func TestReceiptExtractionReauthorizeAfterBudgetWait(t *testing.T) {
	f := newFinanceFixture(t)
	id := readyReceiptExtraction(t, f)
	f.db.Where("job_id=?", id).Delete(&ReceiptExtractionResult{})
	f.db.Model(&FinanceAssistanceJob{}).Where("id=?", id).Updates(map[string]any{"status": "queued", "result_id": "", "attempts": 0, "available_at": time.Now().Add(-time.Minute)})
	budget := NewLocalProviderBudget(1)
	release, e := budget.Acquire(t.Context())
	if e != nil {
		t.Fatal(e)
	}
	entered := make(chan struct{})
	f.s.opts.LocalProviderBudget = waitingFinanceBudget{budget, entered}
	provider := &countedReceiptProvider{}
	f.s.opts.ReceiptOCRProvider = provider
	done := make(chan error, 1)
	go func() { _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); done <- e }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		release()
		t.Fatal("budget wait not entered")
	}
	var j FinanceAssistanceJob
	f.db.First(&j, "id=?", id)
	financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions/"+id+"/cancel", map[string]any{"retryKey": "cancel-budget-wait", "expectedVersion": j.Version}, f.cookie)
	release()
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	if provider.calls.Load() != 0 {
		t.Fatal("budget-time cancellation disclosed bytes to provider")
	}
}
