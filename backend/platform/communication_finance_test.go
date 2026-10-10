package platform

import (
	"strings"
	"testing"
)

func TestExpenseConversionCreatesOnlyReviewedDraft(t *testing.T) {
	f := newFinanceFixture(t)
	mc, uid := f.person(t, "member@example.com", "member", f.department)
	id := newConversation(t, f.s, f.cookie, f.cid, []string{f.uid, uid}, "group")
	allowPublication(t, f.s, f.cookie, f.cid, id)
	m := sendMessage(t, f.s, mc, f.cid, id, "incurred", "Paid for material")
	input := conversionInput(m, nil, "expense-once")
	delete(input, "task")
	input["expense"] = f.expense(1200)
	root := f.base() + "/conversations/" + id + "/expense-conversions"
	preview := financeOK(t, f.s, "POST", root+"/preview", input, mc)
	if preview["notice"] == nil || len(preview["audienceUserIds"].([]any)) < 2 {
		t.Fatal("missing publication preview", preview)
	}
	first := financeOK(t, f.s, "POST", root, input, mc)["id"].(string)
	again := financeOK(t, f.s, "POST", root, input, mc)["id"]
	if first != again {
		t.Fatal("duplicate expense draft")
	}
	var expense Expense
	if e := f.db.First(&expense, "id=?", first).Error; e != nil {
		t.Fatal(e)
	}
	if expense.Status != "draft" || expense.AmountMinor != 1200 || expense.CreatedBy != uid || expense.ReviewedBy != "" || expense.PaidBy != "" {
		t.Fatalf("chat bypassed finance %+v", expense)
	}
	input["expense"].(map[string]any)["amountMinor"] = 1300
	if st, _, _ := req(t, f.s, "POST", root, input, mc); st != 409 {
		t.Fatal("changed retry", st)
	}
	outsider, other := f.person(t, "other@example.com", "member", f.department)
	_ = other
	// A conversation reader without destination finance scope gets no linked ID.
	financeOK(t, f.s, "POST", f.base()+"/conversations/"+id+"/members", map[string]any{"expectedVersion": 2, "userId": other, "role": "member", "active": true}, f.cookie)
	sendMessage(t, f.s, f.cookie, f.cid, id, "fresh", "Accessible after join")
	st, b, w := req(t, f.s, "GET", f.base()+"/conversations/"+id+"/expense-links", nil, outsider)
	if st != 200 || len(b["expenses"].([]any)) != 0 || strings.Contains(w.Body.String(), first) {
		t.Fatal("hidden expense leaked", st, w.Body.String())
	}
}
func TestIntakePublishesSelectedWorkAndUsesTaskEngine(t *testing.T) {
	f := newFinanceFixture(t)
	mc, uid := f.person(t, "requester@example.com", "member", f.department)
	id := newConversation(t, f.s, f.cookie, f.cid, []string{f.uid, uid}, "group")
	allowPublication(t, f.s, f.cookie, f.cid, id)
	m := sendMessage(t, f.s, mc, f.cid, id, "intake", "Private context not automatically published")
	input := map[string]any{"retryKey": "intake-once", "anchorMessageId": m["id"], "sourceRevision": 1, "expectedPolicyVersion": 2, "departmentId": f.department, "title": "Explicit service request", "summary": "Selected work summary"}
	root := f.base() + "/conversations/" + id + "/requests"
	rid := financeOK(t, f.s, "POST", root, input, mc)["id"].(string)
	preview := financeOK(t,f.s,"POST",root+"/preview",input,mc)
 if preview["notice"] == nil || len(preview["audienceUserIds"].([]any)) < 2 { t.Fatal("intake audience missing",preview) }
 financeOK(t,f.s,"PATCH",f.base()+"/conversations/"+id+"/messages/"+m["id"].(string),map[string]any{"expectedRevision":1,"body":"Edited private context"},mc)
 if financeOK(t, f.s, "POST", root, input, mc)["id"] != rid {
		t.Fatal("duplicate intake")
	}
	list := financeOK(t, f.s, "GET", f.base()+"/communication/requests", nil, f.cookie)
	row := list["requests"].([]any)[0].(map[string]any)
	if row["conversationId"] != nil || row["anchorMessageId"] != nil || row["summary"] != "Selected work summary" {
		t.Fatal("private provenance leaked", row)
	}
	body := taskBody(uid)
	body["departmentId"] = f.department
	path := f.base() + "/communication/requests/" + rid + "/assign"
	if st, _, _ := req(t, f.s, "POST", path, map[string]any{"expectedVersion": 1, "task": body}, mc); st != 403 {
		t.Fatal("requester assigned", st)
	}
	tid := financeOK(t, f.s, "POST", path, map[string]any{"expectedVersion": 1, "task": body}, f.cookie)["id"].(string)
	if st, _, _ := req(t, f.s, "POST", path, map[string]any{"expectedVersion": 1, "task": body}, f.cookie); st != 409 {
		t.Fatal("duplicate assignment", st)
	}
	var task Task
	f.db.First(&task, "id=?", tid)
	if task.OwnerID != uid || task.DepartmentID != f.department {
		t.Fatal("task engine bypassed")
	}
	if st, _, _ := req(t, f.s, "PATCH", f.base()+"/communication/requests/"+rid, map[string]any{"expectedVersion": 2, "state": "resolved", "reason": "Work not yet accepted"}, f.cookie); st != 422 {
		t.Fatal("unaccepted resolved", st)
	}
}
