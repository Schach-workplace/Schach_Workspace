package platform

import "testing"

func TestFinanceReconciliationIndependentPayment(t *testing.T) {
	f := newFinanceFixture(t)
	preview := readyStatementPreview(t, f)
	importID := financeOK(t, f.s, "POST", f.base()+"/finance/statement-previews/"+preview+"/import", map[string]any{"retryKey": "import", "expectedPreviewRevision": 1}, f.cookie)["id"].(string)
	rows := financeOK(t, f.s, "GET", f.base()+"/finance/statement-imports/"+importID+"/rows", nil, f.cookie)["items"].([]any)
	row := rows[0].(map[string]any)
	fields := f.expense(130050)
	fields["expenseDate"] = "2026-10-10"
	expense := financeOK(t, f.s, "POST", f.base()+"/expenses", fields, f.cookie)["id"].(string)
	finance, _ := f.person(t, "payer@example.com", "finance", "")
	f.addBudget(t, 1000000, "active")
	path := f.base() + "/expenses/" + expense
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "approve"}, finance)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 3, "action": "pay", "paidDate": "2026-10-10", "paymentMethod": "bank_transfer", "paymentReference": "UTR-FICTIONAL"}, finance)
	match := map[string]any{"retryKey": "match", "rowId": row["id"], "expectedRowVersion": 1, "expenseId": expense, "expectedExpenseVersion": 4, "reason": "Matched full recorded bank payment"}
	route := f.base() + "/finance/reconciliation/matches"
	out := financeOK(t, f.s, "POST", route, match, f.cookie)
	financeOK(t, f.s, "POST", route, match, f.cookie)
	id := out["id"].(string)
	financeOK(t, f.s, "POST", route+"/"+id+"/unmatch", map[string]any{"retryKey": "unmatch", "expectedVersion": 1, "reason": "Reversal after accounting review"}, f.cookie)
	financeOK(t, f.s, "POST", route, match, f.cookie)
	var e Expense
	f.db.First(&e, "id=?", expense)
	if e.Version != 4 || e.Status != "paid" || e.AmountMinor != 130050 {
		t.Fatal("economics modified", e)
	}
	var allocation FinanceReconciliationAllocation
	f.db.First(&allocation, "id=?", id)
	if allocation.Active {
		t.Fatal("replay reactivated")
	}
}
