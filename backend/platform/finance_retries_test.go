package platform

import (
	"os"
	"sync"
	"testing"
)

func TestExpenseCreateCanonicalRetry(t *testing.T) {
	f := newFinanceFixture(t)
	b := f.expense(130050)
	b["retryKey"] = "lost-ack"
	id := financeOK(t, f.s, "POST", f.base()+"/expenses", b, f.cookie)["id"]
	if got := financeOK(t, f.s, "POST", f.base()+"/expenses", b, f.cookie)["id"]; got != id {
		t.Fatal("replay created second draft", got, id)
	}
	financeOK(t, f.s, "POST", f.base()+"/expenses/"+id.(string)+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	if got := financeOK(t, f.s, "POST", f.base()+"/expenses", b, f.cookie)["id"]; got != id {
		t.Fatal("lifecycle replay changed result")
	}
	b["amountMinor"] = 1
	if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", b, f.cookie); st != 409 {
		t.Fatal("changed intent", st)
	}
	var n int64
	f.db.Model(&Expense{}).Where("company_id=?", f.cid).Count(&n)
	if n != 1 {
		t.Fatal("draft count", n)
	}
	f.db.Model(&FinanceEvent{}).Where("company_id=? AND action=?", f.cid, "expense_created").Count(&n)
	if n != 1 {
		t.Fatal("audit count", n)
	}
}

func TestExpenseRetryConcurrent(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("owned PG fixture")
	}
	f := newFinanceFixture(t)
	b := f.expense(1)
	b["retryKey"] = "race"
	var wg sync.WaitGroup
	out := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", b, f.cookie); out <- st }()
	}
	wg.Wait()
	close(out)
	for st := range out {
		if st != 200 {
			t.Fatal(st)
		}
	}
	var n int64
	f.db.Model(&Expense{}).Count(&n)
	if n != 1 {
		t.Fatal(n)
	}
}
func TestExpenseRetryCurrentScope(t *testing.T) {
	f := newFinanceFixture(t)
	b := f.expense(1)
	b["retryKey"] = "scope"
	financeOK(t, f.s, "POST", f.base()+"/expenses", b, f.cookie)
	f.db.Model(&Membership{}).Where("company_id=? AND user_id=?", f.cid, f.uid).Update("role", "viewer")
	if st, out, _ := req(t, f.s, "POST", f.base()+"/expenses", b, f.cookie); st != 403 || out["id"] != nil {
		t.Fatal(st, out)
	}
}
