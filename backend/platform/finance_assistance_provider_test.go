package platform

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestFinanceAssistanceRealProvider(t *testing.T) {
	path := os.Getenv("FINANCE_REAL_FIXTURE")
	if path == "" {
		t.Skip("explicit owned fictional PNG fixture required")
	}
	data, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	if financeDigest(data) != "b03b6de24de6a5fd63ddf84b7a41c998776057ddbe7c368bae6edc1f24254589" {
		t.Fatal("fixture changed")
	}
	f := newFinanceFixture(t)
	t.Setenv("FINANCE_INTAKE_ROOT", t.TempDir())
	t.Setenv("FINANCE_OCR_ENABLED", "true")
	t.Setenv("FINANCE_OCR_EXECUTABLE", "/usr/bin/tesseract")
	t.Setenv("FINANCE_OCR_LANGUAGE", "eng")
	t.Setenv("FINANCE_PDF_ENABLED", "false")
	t.Setenv("FINANCE_SCANNER_ADDRESS", "127.0.0.1:13310")
	if e = ConfigureFinanceAssistance(&f.s.opts); e != nil {
		t.Fatal(e)
	}
	id := reserveFinanceIntake(t, f, data, "receipt")
	if uploadFinanceIntake(t, f, id, data) != 200 {
		t.Fatal("exact upload")
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", map[string]any{"retryKey": "real-scan", "expectedVersion": 2}, f.cookie)
	start := time.Now()
	if _, e = f.s.RunFinanceAssistanceJobs(t.Context(), start, 1); e != nil {
		t.Fatal(e)
	}
	scanDuration := time.Since(start)
	var intake FinanceAssistanceIntake
	f.db.First(&intake, "id=?", id)
	if intake.State != "clean" || intake.CleanGeneration != 1 {
		t.Fatal("actual scanner not clean", intake.State)
	}
	job := financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions", map[string]any{"retryKey": "real-extraction", "optIn": true, "source": map[string]any{"kind": "intake", "id": id, "expectedVersion": intake.Version}, "destinationDepartmentId": f.department}, f.cookie)["id"].(string)
	start = time.Now()
	if _, e = f.s.RunFinanceAssistanceJobs(t.Context(), start, 1); e != nil {
		t.Fatal(e)
	}
	providerDuration := time.Since(start)
	var result ReceiptExtractionResult
	f.db.First(&result, "job_id=?", job)
	for key, want := range map[string]string{"vendor": "Demo Stationery", "invoiceNumber": "TEST-2026-001", "amountText": "1300.50", "expenseDate": "2026-10-10"} {
		if !in(want, result.Candidates.Fields[key]...) {
			t.Fatalf("actual provider %s candidates %#v", key, result.Candidates.Fields[key])
		}
	}
	fields := f.expense(130050)
	fields["vendor"] = "Demo Stationery"
	fields["invoiceNumber"] = "TEST-2026-001"
	fields["expenseDate"] = "2026-10-10"
	fields["title"] = "Human reviewed fictional stationery"
	body := map[string]any{"retryKey": "real-human-accept", "expectedResultRevision": 1, "sourceKind": "intake", "sourceId": id, "destinationDepartmentId": f.department, "copyEvidence": true, "fields": fields, "confirmedUncertainties": result.Candidates.Unresolved}
	first := financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions/"+job+"/accept", body, f.cookie)
	replay := financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions/"+job+"/accept", body, f.cookie)
	if first["id"] != replay["id"] {
		t.Fatal("duplicate canonical acceptance")
	}
	var expense Expense
	f.db.First(&expense, "id=?", first["id"])
	if expense.AmountMinor != 130050 || expense.Status != "draft" {
		t.Fatal("not human reviewed draft", expense)
	}
	t.Logf("fictional bytes=%d inputSHA256=%s cleanGeneration=%d scanner=%s OCR=%s language=%s configFingerprint=%s scanDuration=%s providerJobDuration=%s acceptance=draft130050 sameKeySameID=true", len(data), financeDigest(data), intake.CleanGeneration, "ClamAV13310", result.EngineVersion, result.Language, f.s.opts.FinanceOCRFingerprint, scanDuration, providerDuration)
}
func TestFinanceAssistanceWorkerShutdown(t *testing.T) {
	f := newFinanceFixture(t)
	id := readyReceiptExtraction(t, f)
	f.db.Model(&FinanceAssistanceJob{}).Where("id=?", id).Updates(map[string]any{"status": "queued", "result_id": "", "attempts": 0})
	p := pausedReceiptOCR{entered: make(chan struct{}), resume: make(chan struct{})}
	f.s.opts.ReceiptOCRProvider = p
	ctx, cancel := context.WithCancel(t.Context())
	lifecycle := f.s.StartBackgroundWorkers(ctx)
	select {
	case <-p.entered:
	case <-time.After(4 * time.Second):
		cancel()
		t.Fatal("worker did not enter")
	}
	cancel()
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer stopCancel()
	if e := lifecycle.Stop(stopCtx); e != nil {
		t.Fatal("blocked provider did not join", e)
	}
}
