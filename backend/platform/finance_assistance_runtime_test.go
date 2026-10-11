package platform

import (
	"context"
	"errors"
	"testing"
	"time"
)

type failingFinanceDelete struct {
	MediaStore
	fail bool
}

func (s *failingFinanceDelete) Delete(ctx context.Context, key string) error {
	if s.fail {
		return errors.New("owned deletion failure")
	}
	return s.MediaStore.Delete(ctx, key)
}
func TestFinanceAssistanceRetentionIndependent(t *testing.T) {
	f := newFinanceFixture(t)
	job := readyReceiptExtraction(t, f)
	meta := financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+job, nil, f.cookie)
	source := meta["job"].(map[string]any)["sourceId"].(string)
	body := map[string]any{"retryKey": "retained-acceptance", "expectedResultRevision": 1, "sourceKind": "intake", "sourceId": source, "destinationDepartmentId": f.department, "copyEvidence": true, "fields": f.expense(130050), "confirmedUncertainties": []string{"title"}}
	out := financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions/"+job+"/accept", body, f.cookie)
	expense := out["id"].(string)
	now := time.Now().UTC()
	f.db.Model(&FinanceAssistanceIntake{}).Where("id=?", source).Update("expires_at", now.Add(-time.Minute))
	f.db.Model(&ReceiptExtractionResult{}).Where("job_id=?", job).Update("expires_at", now.Add(-time.Minute))
	if _, e := f.s.RunFinanceAssistanceCleanup(t.Context(), now, 100); e != nil {
		t.Fatal(e)
	}
	var result ReceiptExtractionResult
	f.db.First(&result, "job_id=?", job)
	if len(result.Candidates.Fields) != 0 {
		t.Fatal("expired candidates retained", result.Candidates)
	}
	var receipt ExpenseReceipt
	if e := f.db.First(&receipt, "expense_id=?", expense).Error; e != nil || len(receipt.Data) == 0 {
		t.Fatal("destination evidence expired", e)
	}
	if st, _, _ := req(t, f.s, "GET", f.base()+"/finance/intakes/"+source, nil, f.cookie); st != 404 {
		t.Fatal(st)
	}
	var claim FinanceExtractionAcceptance
	f.db.First(&claim, "expense_id=?", expense)
	if claim.ID == "" {
		t.Fatal("successful tombstone deleted")
	}
}
func TestFinanceAssistanceCleanupRetry(t *testing.T) {
	f := newFinanceFixture(t)
	store, _ := NewFileMediaStore(t.TempDir())
	wrapped := &failingFinanceDelete{MediaStore: store, fail: true}
	f.s.opts.FinanceIntakeStore = wrapped
	data := []byte("\x89PNG\r\n\x1a\nfictional")
	id := reserveFinanceIntake(t, f, data, "receipt")
	if uploadFinanceIntake(t, f, id, data) != 200 {
		t.Fatal("stage")
	}
	f.db.Model(&FinanceAssistanceIntake{}).Where("id=?", id).Update("expires_at", time.Now().Add(-time.Minute))
	if _, e := f.s.RunFinanceAssistanceCleanup(t.Context(), time.Now(), 100); e == nil {
		t.Fatal("delete failed silently")
	}
	if st, _, _ := req(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie); st != 404 {
		t.Fatal(st)
	}
	var first FinanceAssistanceIntake
	f.db.First(&first, "id=?", id)
	f.s.RunFinanceAssistanceCleanup(t.Context(), time.Now(), 100)
	var second FinanceAssistanceIntake
	f.db.First(&second, "id=?", id)
	if first.ContentGeneration != second.ContentGeneration {
		t.Fatal("retry advanced logical expiry twice")
	}
	wrapped.fail = false
	if _, e := f.s.RunFinanceAssistanceCleanup(t.Context(), time.Now(), 100); e != nil {
		t.Fatal(e)
	}
}
func TestFinanceAssistanceConfigDisabled(t *testing.T) {
	t.Setenv("FINANCE_OCR_ENABLED", "false")
	var o Options
	if e := ConfigureFinanceAssistance(&o); e != nil || o.ReceiptOCRProvider != nil {
		t.Fatal(e)
	}
	t.Setenv("FINANCE_OCR_ENABLED", "invalid")
	if e := ConfigureFinanceAssistance(&o); e == nil {
		t.Fatal("invalid enabled config")
	}
}

func TestFinanceAssistanceCleanupBounded(t *testing.T) {
	f := newFinanceFixture(t)
	now := time.Now().UTC()
	for n := 0; n < 3; n++ {
		p := FinanceStatementPreview{ID: newID("fsp"), CompanyID: f.cid, ActorID: f.uid, ParserVersion: 1, Revision: 1, ExpiresAt: now.Add(-time.Minute), Rows: []FinanceStatementRow{{RecordOrdinal: 1}}, Errors: []RowError{}}
		if e := f.db.Create(&p).Error; e != nil {
			t.Fatal(e)
		}
	}
	count, e := f.s.RunFinanceAssistanceCleanup(t.Context(), now, 1)
	if e != nil || count != 1 {
		t.Fatalf("bounded count=%d error=%v", count, e)
	}
	var remaining int64
	f.db.Model(&FinanceStatementPreview{}).Where("rows<>?", "[]").Count(&remaining)
	if remaining != 2 {
		t.Fatal("cleanup exceeded pass budget", remaining)
	}
}

func TestFinanceAssistancePrivateHistory(t *testing.T) {
	f := newFinanceFixture(t)
	f.s.opts.FinanceIntakeStore, _ = NewFileMediaStore(t.TempDir())
	input := map[string]any{"retryKey": "private-history-reserve", "purpose": "receipt", "capture": true, "destinationDepartmentId": f.department}
	first := financeOK(t, f.s, "POST", f.base()+"/finance/intakes", input, f.cookie)
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes", input, f.cookie)
	var count int64
	if e := f.db.Table("finance_assistance_histories").Where("company_id=? AND actor_id=? AND operation=?", f.cid, f.uid, "finance_intake_reserve").Count(&count).Error; e != nil || count != 1 {
		t.Fatalf("canonical private history count=%d error=%v id=%v", count, e, first["id"])
	}
}

func TestFinanceAssistanceRecoveryListsCurrentTargetBeforePaging(t *testing.T) {
	f := newFinanceFixture(t)
	target := f.addExpense(t, 100, f.cookie)
	job := readyReceiptExtraction(t, f)
	if e := f.db.Model(&FinanceAssistanceJob{}).Where("id=?", job).Updates(map[string]any{"target_expense_id": target, "target_version": 1}).Error; e != nil {
		t.Fatal(e)
	}
	initial := financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions", nil, f.cookie)
	if len(initial["items"].([]any)) != 1 {
		t.Fatal(initial)
	}
	other := Department{ID: newID("dep"), CompanyID: f.cid, Name: "Other current department", Color: "#6366F1"}
	if e := f.db.Create(&other).Error; e != nil {
		t.Fatal(e)
	}
	f.db.Model(&Expense{}).Where("id=?", target).Update("department_id", other.ID)
	if st, _, _ := req(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+job, nil, f.cookie); st != 404 {
		t.Fatal(st)
	}
	current := financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions?limit=1", nil, f.cookie)
	if len(current["items"].([]any)) != 0 {
		t.Fatal("moved current target leaked recovery metadata", current)
	}
}

func TestFinanceAssistanceDeleteFailureDoesNotRetainExpiredText(t *testing.T) {
	f := newFinanceFixture(t)
	job := readyReceiptExtraction(t, f)
	var j FinanceAssistanceJob
	f.db.First(&j, "id=?", job)
	f.s.opts.FinanceIntakeStore = &failingFinanceDelete{MediaStore: f.s.opts.FinanceIntakeStore, fail: true}
	now := time.Now().UTC()
	f.db.Model(&FinanceAssistanceIntake{}).Where("id=?", j.SourceID).Update("expires_at", now.Add(-time.Minute))
	f.db.Model(&ReceiptExtractionResult{}).Where("job_id=?", job).Update("expires_at", now.Add(-time.Minute))
	if _, e := f.s.RunFinanceAssistanceCleanup(t.Context(), now, 100); e == nil {
		t.Fatal("lost delete failure")
	}
	var result ReceiptExtractionResult
	f.db.First(&result, "job_id=?", job)
	if len(result.Candidates.Fields) != 0 {
		t.Fatal("failed file deletion delayed expired private text removal")
	}
}
func TestFinanceAssistanceInjectedQuotaBounds(t *testing.T) {
	f := newFinanceFixture(t)
	for _, o := range []Options{{FinanceActorQuotaBytes: (500 << 20) + 1, FinanceCompanyQuotaBytes: (500 << 20) + 1}, {FinanceCompanyQuotaBytes: (500 << 20) + 1}} {
		if _, e := New(f.db, o); e == nil {
			t.Fatal("injected finance quota bypassed hard bound")
		}
	}
}
