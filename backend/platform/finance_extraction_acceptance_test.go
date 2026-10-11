package platform

import (
	"errors"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestReceiptAcceptanceCanonicalDraft(t *testing.T) {
	f := newFinanceFixture(t)
	job := readyReceiptExtraction(t, f)
	meta := financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+job, nil, f.cookie)
	source := meta["job"].(map[string]any)["sourceId"].(string)
	body := map[string]any{"retryKey": "accept", "expectedResultRevision": 1, "sourceKind": "intake", "sourceId": source, "destinationDepartmentId": f.department, "copyEvidence": true, "fields": f.expense(130050), "confirmedUncertainties": []string{"title"}}
	path := f.base() + "/finance/receipt-extractions/" + job + "/accept"
	first := financeOK(t, f.s, "POST", path, body, f.cookie)
	second := financeOK(t, f.s, "POST", path, body, f.cookie)
	if first["id"] != second["id"] {
		t.Fatal("second expense")
	}
	body["retryKey"] = "different-key"
	third := financeOK(t, f.s, "POST", path, body, f.cookie)
	if first["id"] != third["id"] {
		t.Fatal("second key duplicate")
	}
	var n int64
	f.db.Model(&Expense{}).Count(&n)
	if n != 1 {
		t.Fatal(n)
	}
	f.db.Model(&ExpenseReceipt{}).Count(&n)
	if n != 1 {
		t.Fatal(n)
	}
	body["fields"] = f.expense(1)
	if st, _, _ := req(t, f.s, "POST", path, body, f.cookie); st != 409 {
		t.Fatal("changed accepted fields", st)
	}
}
func TestReceiptAcceptanceAtomicRollback(t *testing.T) {
	f := newFinanceFixture(t)
	job := readyReceiptExtraction(t, f)
	meta := financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+job, nil, f.cookie)
	source := meta["job"].(map[string]any)["sourceId"].(string)
	body := map[string]any{"retryKey": "rollback", "expectedResultRevision": 1, "sourceKind": "intake", "sourceId": source, "destinationDepartmentId": f.department, "copyEvidence": true, "fields": f.expense(130050), "confirmedUncertainties": []string{"title"}}
	f.db.Callback().Create().Before("gorm:create").Register("reject_receipt", func(tx *gorm.DB) {
		if tx.Statement.Table == "expense_receipts" {
			tx.AddError(errors.New("owned rollback fixture"))
		}
	})
	if st, _, _ := req(t, f.s, "POST", f.base()+"/finance/receipt-extractions/"+job+"/accept", body, f.cookie); st != 500 {
		t.Fatal(st)
	}
	f.db.Callback().Create().Remove("reject_receipt")
	for _, model := range []any{&Expense{}, &FinanceExtractionAcceptance{}} {
		var n int64
		f.db.Model(model).Count(&n)
		if n != 0 {
			t.Fatal("rollback leaked", model, n)
		}
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions/"+job+"/accept", body, f.cookie)
}

// This covers actual existing-receipt source == destination, including the
// acceptance's own economic/evidence version advances on same/new-key replay.
func TestReceiptAcceptanceSameSourceTargetReplay(t *testing.T) {
	f := newFinanceFixture(t)
	target := f.addExpense(t, 100, f.cookie)
	data := []byte("\x89PNG\r\n\x1a\nfictional")
	receipt := ExpenseReceipt{ID: newID("rcp"), CompanyID: f.cid, ExpenseID: target, FileName: "owned-source.png", MimeType: "image/png", Size: int64(len(data)), UploadedBy: f.uid, CreatedAt: nowString(), Data: data}
	if e := f.db.Create(&receipt).Error; e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceScanner = financeCleanScanner{}
	f.s.opts.ReceiptOCRProvider = immediateReceiptOCR{}
	f.s.opts.FinanceOCRFingerprint = "fixture"
	financeOK(t, f.s, "POST", f.base()+"/expense-receipts/"+receipt.ID+"/assessment", map[string]any{"retryKey": "same-parent-assess", "expectedExpenseVersion": 1}, f.cookie)
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	job := financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions", map[string]any{"retryKey": "same-parent-extract", "optIn": true, "source": map[string]any{"kind": "expense_receipt", "id": receipt.ID, "expectedVersion": 1}, "destinationDepartmentId": f.department, "targetExpenseId": target, "expectedTargetVersion": 1}, f.cookie)["id"].(string)
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	body := map[string]any{"retryKey": "same-parent-accept", "expectedResultRevision": 1, "sourceKind": "expense_receipt", "sourceId": receipt.ID, "destinationDepartmentId": f.department, "targetExpenseId": target, "expectedTargetVersion": 1, "copyEvidence": true, "fields": f.expense(130050), "confirmedUncertainties": []string{"title"}}
	path := f.base() + "/finance/receipt-extractions/" + job + "/accept"
	first := financeOK(t, f.s, "POST", path, body, f.cookie)
	second := financeOK(t, f.s, "POST", path, body, f.cookie)
	body["retryKey"] = "same-parent-newkey"
	third := financeOK(t, f.s, "POST", path, body, f.cookie)
	if first["id"] != target || second["id"] != target || third["id"] != target {
		t.Fatal("same-parent replay replaced destination")
	}
	var expense Expense
	f.db.First(&expense, "id=?", target)
	var count int64
	f.db.Model(&ExpenseReceipt{}).Where("expense_id=?", target).Count(&count)
	if expense.Version != 3 || expense.AmountMinor != 130050 || expense.Status != "draft" || count != 2 {
		t.Fatal("own bumps replayed", expense.Version, count)
	}
}
