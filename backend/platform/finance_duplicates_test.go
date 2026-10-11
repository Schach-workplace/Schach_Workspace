package platform

import "testing"

func TestFinanceDuplicateSuggestionsDismissal(t *testing.T) {
	f := newFinanceFixture(t)
	a := f.addExpense(t, 100, f.cookie)
	b := f.addExpense(t, 100, f.cookie)
	path := f.base() + "/finance/duplicate-candidates"
	review := map[string]any{"retryKey": "review", "sourceKind": "expense", "sourceId": a, "expectedVersion": 1}
	out := financeOK(t, f.s, "POST", path+"/review", review, f.cookie)
	items := out["items"].([]any)
	if len(items) != 1 {
		t.Fatal(out)
	}
	candidate := items[0].(map[string]any)
	if candidate["reason"] != "same_vendor_amount_date" || !((candidate["comparedExpenseId"] == b && candidate["sourceId"] == a) || (candidate["comparedExpenseId"] == a && candidate["sourceId"] == b)) {
		t.Fatal(candidate)
	}
	id := candidate["id"].(string)
	body := map[string]any{"retryKey": "dismiss", "expectedVersion": 1, "reason": "These are separate legitimate purchases"}
	financeOK(t, f.s, "POST", path+"/"+id+"/dismiss", body, f.cookie)
	financeOK(t, f.s, "POST", path+"/"+id+"/dismiss", body, f.cookie)
	financeOK(t, f.s, "PATCH", f.base()+"/expenses/"+a, map[string]any{"version": 1, "amountMinor": 101}, f.cookie)
	if st, _, _ := req(t, f.s, "GET", path+"/"+id, nil, f.cookie); st != 404 {
		t.Fatal("old basis", st)
	}
}
