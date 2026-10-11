package platform

import (
	"fmt"
	"net/url"
	"testing"
	"time"
)

func TestFinanceDuplicateComparisonCursor(t *testing.T) {
	f := newFinanceFixture(t)
	source := f.addExpense(t, 100, f.cookie)
	var template Expense
	if err := f.db.First(&template, "id=?", source).Error; err != nil {
		t.Fatal(err)
	}
	peers := []Expense{}
	for n := 0; n < 101; n++ {
		p := template
		p.ID = fmt.Sprintf("exp_000page_%03d", n)
		p.Code = fmt.Sprintf("EXP-PAGE-%03d", n)
		p.AmountMinor = 99
		peers = append(peers, p)
	}
	peer := template
	peer.ID = "exp_zzzpage"
	peer.Code = "EXP-PAGE-LAST"
	peers = append(peers, peer)
	if err := f.db.Create(&peers).Error; err != nil {
		t.Fatal(err)
	}
	path := f.base() + "/finance/duplicate-candidates/review"
	body := map[string]any{"retryKey": "compare-page1", "sourceKind": "expense", "sourceId": source, "expectedVersion": 1}
	first := financeOK(t, f.s, "POST", path, body, f.cookie)
	cursor, _ := first["nextComparisonCursor"].(string)
	if cursor == "" || len(first["items"].([]any)) != 0 {
		t.Fatal("comparison must continue beyond first authorized100", first)
	}
	body["retryKey"] = "compare-page2"
	body["comparisonCursor"] = cursor
	second := financeOK(t, f.s, "POST", path, body, f.cookie)
	if len(second["items"].([]any)) != 1 {
		t.Fatal("late authorized peer unreachable", second)
	}
	replay := financeOK(t, f.s, "POST", path, body, f.cookie)
	if replay["items"].([]any)[0].(map[string]any)["id"] != second["items"].([]any)[0].(map[string]any)["id"] {
		t.Fatal("batch replay changed candidate")
	}
	body["expectedVersion"] = 2
	body["retryKey"] = "wrong-comparison-basis"
	if st, _, _ := req(t, f.s, "POST", path, body, f.cookie); st == 200 {
		t.Fatal("wrong comparison basis accepted")
	}
}
func TestFinanceStatementPreviewBoundCursor(t *testing.T) {
	f := newFinanceFixture(t)
	id := readyStatementPreview(t, f)
	first := financeOK(t, f.s, "GET", f.base()+"/finance/statement-previews/"+id+"?limit=1", nil, f.cookie)
	cursor, _ := first["nextPageCursor"].(string)
	if cursor == "" {
		t.Fatal("preview requires current scope/revision cursor", first)
	}
	path := f.base() + "/finance/statement-previews/" + id + "?limit=1&cursor=" + url.QueryEscape(cursor)
	second := financeOK(t, f.s, "GET", path, nil, f.cookie)
	if second["rows"].([]any)[0].(map[string]any)["recordOrdinal"] == first["rows"].([]any)[0].(map[string]any)["recordOrdinal"] {
		t.Fatal("equal occurrences collapsed")
	}
	if err := f.db.Model(&FinanceStatementPreview{}).Where("id=?", id).Update("mapping_hash", payloadHash([]string{"changed mapping basis"})).Error; err != nil {
		t.Fatal(err)
	}
	if st, _, _ := req(t, f.s, "GET", path, nil, f.cookie); st != 422 {
		t.Fatal("stale preview cursor accepted", st)
	}
}
func TestFinanceReconciliationPaidCursor(t *testing.T) {
	f := newFinanceFixture(t)
	source := f.addExpense(t, 100, f.cookie)
	var template Expense
	f.db.First(&template, "id=?", source)
	_, payer := f.person(t, "page-payer@example.com", "finance", "")
	peers := []Expense{}
	for n := 0; n < 101; n++ {
		p := template
		p.ID = fmt.Sprintf("exp_paidpage_%03d", n)
		p.Code = fmt.Sprintf("EXP-PAIDPAGE-%03d", n)
		p.Status = "paid"
		p.PaidDate = p.ExpenseDate
		p.SubmittedAt = nowString()
		p.ReviewedBy = payer
		p.ReviewedAt = nowString()
		p.PaidBy = payer
		p.PaidAt = nowString()
		p.PaymentMethod = "bank_transfer"
		p.PaymentReference = "PAGE-FICTIONAL"
		peers = append(peers, p)
	}
	if err := f.db.Create(&peers).Error; err != nil {
		t.Fatal(err)
	}
	path := f.base() + "/finance/reconciliation?limit=10&state=all"
	seen := map[string]bool{}
	cursor := ""
	for n := 0; n < 20; n++ {
		pagePath := path
		if cursor != "" {
			pagePath += "&cursor=" + url.QueryEscape(cursor)
		}
		page := financeOK(t, f.s, "GET", pagePath, nil, f.cookie)
		for _, v := range page["unallocatedExpenses"].([]any) {
			id := v.(map[string]any)["id"].(string)
			if seen[id] {
				t.Fatal("duplicate paid page", id)
			}
			seen[id] = true
		}
		cursor, _ = page["cursor"].(string)
		if cursor == "" {
			break
		}
	}
	if len(seen) != 101 {
		t.Fatal("unallocated paid expenses truncated", len(seen))
	}
}

func TestFinanceReconciliationHistoryCursor(t *testing.T) {
	f := newFinanceFixture(t)
	preview := readyStatementPreview(t, f)
	id := financeOK(t, f.s, "POST", f.base()+"/finance/statement-previews/"+preview+"/import", map[string]any{"retryKey": "history-import", "expectedPreviewRevision": 1}, f.cookie)["id"].(string)
	rows := financeOK(t, f.s, "GET", f.base()+"/finance/statement-imports/"+id+"/rows", nil, f.cookie)["items"].([]any)
	rowID := rows[0].(map[string]any)["id"].(string)
	decisions := []FinanceReconciliationDecision{}
	for n := 0; n < 101; n++ {
		decisions = append(decisions, FinanceReconciliationDecision{ID: fmt.Sprintf("frd_page_%03d", n), CompanyID: f.cid, RowID: rowID, ActorID: f.uid, Action: "dismiss", Reason: "Separate fictional accounting review", SuggestionBasis: "fictional-current-review", RetryKey: fmt.Sprintf("history-%d", n), ReviewedVersion: 1, CreatedAt: time.Now().UTC()})
	}
	if err := f.db.Create(&decisions).Error; err != nil {
		t.Fatal(err)
	}
	current := financeOK(t, f.s, "GET", f.base()+"/finance/reconciliation?state=all", nil, f.cookie)
	for _, v := range current["items"].([]any) {
		item := v.(map[string]any)
		if item["row"].(map[string]any)["id"] == rowID && (len(item["history"].([]any)) > 20 || item["hasMoreHistory"] != true) {
			t.Fatal("history must be bounded and recoverable", len(item["history"].([]any)))
		}
	}
	path := f.base() + "/finance/reconciliation/rows/" + rowID + "/history?limit=10"
	seen := map[string]bool{}
	cursor := ""
	for n := 0; n < 20; n++ {
		p := path
		if cursor != "" {
			p += "&cursor=" + url.QueryEscape(cursor)
		}
		page := financeOK(t, f.s, "GET", p, nil, f.cookie)
		for _, v := range page["items"].([]any) {
			key := v.(map[string]any)["id"].(string)
			if seen[key] {
				t.Fatal("duplicate history page")
			}
			seen[key] = true
		}
		cursor, _ = page["cursor"].(string)
		if cursor == "" {
			break
		}
	}
	if len(seen) != 101 {
		t.Fatal("old decisions unreachable", len(seen))
	}
	member, _ := f.person(t, "history-member@example.com", "member", f.department)
	if st, _, _ := req(t, f.s, "GET", path, nil, member); st != 404 {
		t.Fatal("private finance history", st)
	}
}
