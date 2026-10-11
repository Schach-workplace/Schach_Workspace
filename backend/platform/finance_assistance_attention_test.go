package platform

import (
	"fmt"
	"testing"
)

func TestFinanceAssistanceAttentionScopes(t *testing.T) {
	f := newFinanceFixture(t)
	id := readyReceiptExtraction(t, f)
	var items []AttentionItem
	f.db.Where("company_id=? AND source_kind='finance_extraction'", f.cid).Find(&items)
	if len(items) != 1 {
		t.Fatalf("ready extraction has %d episodes", len(items))
	}
	a := items[0]
	view := financeOK(t, f.s, "GET", f.base()+"/attention/"+a.ID, nil, f.cookie)
	if view["item"].(map[string]any)["kind"] != "receipt_review" {
		t.Fatal(view)
	}
	peer, _ := f.person(t, "finance-extraction-peer@example.com", "finance", "")
	if st, _, _ := req(t, f.s, "GET", f.base()+"/attention/"+a.ID, nil, peer); st != 404 {
		t.Fatal(st)
	}
	financeOK(t, f.s, "POST", f.base()+"/attention/"+a.ID+"/transition", map[string]any{"retryKey": "resolve-only", "expectedVersion": 1, "action": "resolve", "reason": "I will review the receipt separately"}, f.cookie)
	var j FinanceAssistanceJob
	f.db.First(&j, "id=?", id)
	if j.Status != "ready" {
		t.Fatal("attention mutated finance", j.Status)
	}
	f.db.Model(&FinanceAssistanceIntake{}).Where("id=?", j.SourceID).Update("state", "cancelled")
	if st, _, _ := req(t, f.s, "GET", f.base()+"/attention/"+a.ID, nil, f.cookie); st != 404 {
		t.Fatal(fmt.Sprint("revoked source ", st))
	}
}
