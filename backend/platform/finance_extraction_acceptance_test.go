package platform

import (
	"errors"
	"gorm.io/gorm"
	"testing"
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
