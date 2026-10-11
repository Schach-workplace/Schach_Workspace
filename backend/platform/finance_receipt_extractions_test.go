package platform

import (
	"context"
	"testing"
	"time"
)

func TestReceiptExtractionCandidateBounds(t *testing.T) {
	c, e := parseReceiptCandidates("Vendor: Demo Stationery\nInvoice: TEST-2026-001\nDate: 2026-10-10\nTotal INR 1300.50\nSubtotal INR 1200.00", "INR")
	if e != nil {
		t.Fatal(e)
	}
	if len(c.Fields["amountText"]) != 1 || c.Fields["amountText"][0] != "1300.50" {
		t.Fatal(c)
	}
	if len(c.Fields["categoryId"]) != 0 {
		t.Fatal("inferred category")
	}
	if _, e = parseReceiptCandidates(string(make([]byte, 65537)), "INR"); e == nil {
		t.Fatal("oversize")
	}
}
func TestReceiptOCRLocalBudgetCancellation(t *testing.T) {
	b := NewLocalProviderBudget(1)
	release, e := b.Acquire(t.Context())
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, e = b.Acquire(ctx); e == nil {
		t.Fatal("cancelled acquired")
	}
	release()
	release2, e := b.Acquire(t.Context())
	if e != nil {
		t.Fatal("leak", e)
	}
	release2()
}

type pausedReceiptOCR struct {
	entered chan struct{}
	resume  chan struct{}
}

func (p pausedReceiptOCR) Extract(ctx context.Context, in ReceiptOCRInput) (ReceiptOCRText, error) {
	close(p.entered)
	select {
	case <-ctx.Done():
		return ReceiptOCRText{}, ctx.Err()
	case <-p.resume:
		return ReceiptOCRText{Text: "Vendor: Demo Stationery\nTotal INR 1300.50", Engine: "fixture", Version: "1", Language: "eng"}, nil
	}
}
func TestReceiptExtractionPrePostAccessAndRuntimeIsolation(t *testing.T) {
	f := newFinanceFixture(t)
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceIntakeStore = store
	f.s.opts.FinanceScanner = financeCleanScanner{}
	data := []byte("\x89PNG\r\n\x1a\nfictional")
	id := reserveFinanceIntake(t, f, data, "receipt")
	if uploadFinanceIntake(t, f, id, data) != 200 {
		t.Fatal("upload")
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", map[string]any{"retryKey": "scan", "expectedVersion": 2}, f.cookie)
	f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1)
	p := pausedReceiptOCR{make(chan struct{}), make(chan struct{})}
	f.s.opts.ReceiptOCRProvider = p
	f.s.opts.FinanceOCRFingerprint = "fixture"
	body := map[string]any{"retryKey": "extract", "optIn": true, "source": map[string]any{"kind": "intake", "id": id, "expectedVersion": 4}, "destinationDepartmentId": f.department}
	job := financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions", body, f.cookie)["id"].(string)
	done := make(chan error, 1)
	go func() { _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); done <- e }()
	select {
	case <-p.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("provider not entered")
	}
	if e := f.db.Model(&Membership{}).Where("company_id=? AND user_id=?", f.cid, f.uid).Update("active", false).Error; e != nil {
		t.Fatal(e)
	}
	close(p.resume)
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	var count int64
	f.db.Model(&ReceiptExtractionResult{}).Count(&count)
	if count != 0 {
		t.Fatal("revoked result persisted")
	}
	if st, out, _ := req(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+job, nil, f.cookie); st == 200 || out["result"] != nil {
		t.Fatal("revoked output", st, out)
	}
}

type immediateReceiptOCR struct{}

func (immediateReceiptOCR) Extract(context.Context, ReceiptOCRInput) (ReceiptOCRText, error) {
	return ReceiptOCRText{Text: "Vendor: Demo Stationery\nInvoice: TEST-2026-001\nDate: 2026-10-10\nTotal INR 1300.50", Engine: "fixture", Version: "1", Language: "eng"}, nil
}
func readyReceiptExtraction(t *testing.T, f financeFixture) string {
	t.Helper()
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceIntakeStore = store
	f.s.opts.FinanceScanner = financeCleanScanner{}
	f.s.opts.ReceiptOCRProvider = immediateReceiptOCR{}
	f.s.opts.FinanceOCRFingerprint = "fixture"
	data := []byte("\x89PNG\r\n\x1a\nfictional")
	id := reserveFinanceIntake(t, f, data, "receipt")
	if uploadFinanceIntake(t, f, id, data) != 200 {
		t.Fatal("upload")
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", map[string]any{"retryKey": "scan", "expectedVersion": 2}, f.cookie)
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	job := financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions", map[string]any{"retryKey": "extract", "optIn": true, "source": map[string]any{"kind": "intake", "id": id, "expectedVersion": 4}, "destinationDepartmentId": f.department}, f.cookie)["id"].(string)
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	meta := financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+job, nil, f.cookie)
	if meta["result"] == nil {
		t.Fatal(meta)
	}
	return job
}
