package platform

import (
	"net/url"
	"strings"
	"testing"
)

// Catches pagination before authorization and global evidence reads.
func TestLeanTaskReadsScopeBeforePagination(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := addPerson(t, s, c, cid, "lean@example.com", "member")
	member := login(t, s, "lean@example.com")
	own := createTask(t, s, c, cid, taskBody(uid))
	for i := 0; i < 3; i++ {
		createTask(t, s, c, cid, taskBody(me(t, s, c)))
	}
	db.Create(&Comment{ID: newID("comment"), CompanyID: cid, TaskID: own, UserID: uid, Body: "detail only"})
	path := "/api/companies/" + cid
	status, b, _ := req(t, s, "GET", path+"/tasks?limit=1", nil, member)
	if status != 200 {
		t.Fatalf("list %d %#v", status, b)
	}
	rows := b["tasks"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["id"] != own || b["hasMore"] != false {
		t.Fatal(b)
	}
	if len(rows[0].(map[string]any)["comments"].([]any)) != 0 {
		t.Fatal("list evidence")
	}
	status, b, _ = req(t, s, "GET", path+"/tasks/"+own, nil, member)
	if status != 200 || len(b["task"].(map[string]any)["comments"].([]any)) != 1 {
		t.Fatal("detail", status, b)
	}
	status, b, _ = req(t, s, "GET", path+"/bootstrap", nil, member)
	if status != 200 || len(b["tasks"].([]any)) != 0 || len(b["expenses"].([]any)) != 0 {
		t.Fatal("bootstrap", status, b)
	}
	if status, _, _ = req(t, s, "GET", path+"/tasks?limit=101", nil, member); status != 422 {
		t.Fatal(status)
	}
}
func TestLeanFinanceReadsAndEvidence(t *testing.T) {
	f := newFinanceFixture(t)
	id := f.addExpense(t, 100, f.cookie)
	path := "/api/companies/" + f.cid
	status, b, _ := req(t, f.s, "GET", path+"/expenses?limit=1", nil, f.cookie)
	if status != 200 || len(b["expenses"].([]any)) != 1 {
		t.Fatal(status, b)
	}
	status, b, _ = req(t, f.s, "GET", path+"/expenses/"+id, nil, f.cookie)
	if status != 200 || b["expense"].(map[string]any)["amountMinor"] != float64(100) {
		t.Fatal(status, b)
	}
}

// Catches rows/export drifting from previously reported totals after edits.
func TestReportSnapshotConsistentAndBoundToAccessFilters(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	body := taskBody(uid)
	body["title"] = "=SUM(1,2)"
	id := createTask(t, s, c, cid, body)
	createTask(t, s, c, cid, taskBody(uid))
	base := "/api/companies/" + cid + "/reports/tasks"
	filters := "from=2026-10-01&to=2026-10-31"
	status, b, _ := req(t, s, "GET", base+"/summary?"+filters, nil, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	if b["summary"].(map[string]any)["cohort"] != float64(2) {
		t.Fatal(b)
	}
	token := b["snapshot"].(string)
	q := filters + "&snapshot=" + url.QueryEscape(token)
	db.Model(&Task{}).Where("id=?", id).Update("status", "cancelled")
	status, page, _ := req(t, s, "GET", base+"/rows?"+q+"&limit=1", nil, c)
	if status != 200 || len(page["tasks"].([]any)) != 1 || page["hasMore"] != true {
		t.Fatal(status, page)
	}
	cursor := page["cursor"].(string)
	status, next, _ := req(t, s, "GET", base+"/rows?"+q+"&limit=1&cursor="+url.QueryEscape(cursor), nil, c)
	if status != 200 || len(next["tasks"].([]any)) != 1 || next["hasMore"] != false {
		t.Fatal(status, next)
	}
	_, _, csv := req(t, s, "GET", base+"/export?"+q, nil, c)
	if !strings.Contains(csv.Body.String(), "Original due at") || !strings.Contains(csv.Body.String(), "Due timezone") || !strings.Contains(csv.Body.String(), "'=SUM(1,2)") || strings.Count(csv.Body.String(), "\n") != 3 {
		t.Fatal(csv.Body.String())
	}
	if status, _, _ = req(t, s, "GET", base+"/rows?"+q+"&ownerId=other", nil, c); status != 422 {
		t.Fatal("filter binding", status)
	}
	db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, uid).Update("role", "viewer")
	if status, _, _ = req(t, s, "GET", base+"/rows?"+q, nil, c); status != 409 {
		t.Fatal("role binding", status)
	}
}

// Catches cross-user cursor reuse and references to tasks outside the read scope.
func TestLeanCursorBindingAndHiddenReferences(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := addPerson(t, s, c, cid, "cursor@example.com", "member")
	m := login(t, s, "cursor@example.com")
	hidden := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	own := createTask(t, s, c, cid, taskBody(uid))
	createTask(t, s, c, cid, taskBody(uid))
	db.Model(&Task{}).Where("id = ?", own).Updates(map[string]any{"parent_id": hidden, "dependencies": "[\"" + hidden + "\"]"})
	base := "/api/companies/" + cid + "/tasks"
	status, b, _ := req(t, s, "GET", base+"?limit=1", nil, m)
	if status != 200 || b["hasMore"] != true {
		t.Fatal(status, b)
	}
	cursor := url.QueryEscape(b["cursor"].(string))
	if status, _, _ = req(t, s, "GET", base+"?limit=1&cursor="+cursor, nil, c); status != 422 {
		t.Fatal("cross user", status)
	}
	status, b, _ = req(t, s, "GET", base+"/"+own, nil, m)
	task := b["task"].(map[string]any)
	if status != 200 || task["parentId"] != "" || len(task["dependencies"].([]any)) != 0 {
		t.Fatal(status, b)
	}
	if status, _, _ = req(t, s, "GET", base+"/"+hidden, nil, m); status != 404 {
		t.Fatal(status)
	}
}

func TestReportSnapshotRejectsTaskVisibilityRevocation(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := addPerson(t, s, c, cid, "snapshot-member@example.com", "member")
	m := login(t, s, "snapshot-member@example.com")
	id := createTask(t, s, c, cid, taskBody(uid))
	db.Model(&Task{}).Where("id=?", id).Update("created_by", me(t, s, c))
	base := "/api/companies/" + cid + "/reports/tasks"
	filters := "from=2026-10-01&to=2026-10-31"
	status, b, _ := req(t, s, "GET", base+"/summary?"+filters, nil, m)
	if status != 200 {
		t.Fatal(status, b)
	}
	db.Model(&Task{}).Where("id=?", id).Update("owner_id", me(t, s, c))
	q := filters + "&snapshot=" + url.QueryEscape(b["snapshot"].(string))
	for _, route := range []string{"rows", "export"} {
		if status, _, _ = req(t, s, "GET", base+"/"+route+"?"+q, nil, m); status != 409 {
			t.Fatal(route, status)
		}
	}
}
func TestScopedFinanceEvents(t *testing.T) {
	f := newFinanceFixture(t)
	f.addExpense(t, 100, f.cookie)
	status, b, _ := req(t, f.s, "GET", f.base()+"/finance/events", nil, f.cookie)
	if status != 200 || len(b["financeEvents"].([]any)) == 0 {
		t.Fatal(status, b)
	}
}
func TestReportSummaryCoversUnloadedRowsAndTabs(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	rows := []Task{}
	for i := 0; i < 201; i++ {
		rows = append(rows, Task{ID: newID("t"), Code: newID("c"), CompanyID: cid, OwnerID: uid, Title: "task", Status: "blocked", Priority: "medium", Recurrence: "none", Version: 1, Tags: []string{}, Checklist: []ChecklistItem{}, Dependencies: []string{}, Collaborators: []string{}, DueDate: "2026-10-10", CreatedAt: "2026-10-01T00:00:00Z"})
	}
	if e := db.CreateInBatches(rows, 100).Error; e != nil {
		t.Fatal(e)
	}
	base := "/api/companies/" + cid + "/reports/tasks"
	filters := "from=2026-10-01&to=2026-10-31"
	status, b, _ := req(t, s, "GET", base+"/summary?"+filters, nil, c)
	if status != 200 || b["summary"].(map[string]any)["needsAttention"] != float64(201) {
		t.Fatal(status, b)
	}
	q := filters + "&snapshot=" + b["snapshot"].(string)
	status, b, _ = req(t, s, "GET", base+"/rows?"+q+"&tab=accepted", nil, c)
	if status != 200 || len(b["tasks"].([]any)) != 0 {
		t.Fatal("accepted tab", status, b)
	}
	status, b, _ = req(t, s, "GET", base+"/rows?"+q+"&tab=exceptions", nil, c)
	if status != 200 || len(b["tasks"].([]any)) != 100 || b["hasMore"] != true {
		t.Fatal("bounded tab", status, b)
	}
}
func TestBootstrapReadBasisTracksMembershipGraph(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	manager := addPerson(t, s, c, cid, "basis-manager@example.com", "manager")
	uid := addPerson(t, s, c, cid, "basis-subordinate@example.com", "member")
	db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, uid).Update("manager_id", manager)
	m := login(t, s, "basis-manager@example.com")
	path := "/api/companies/" + cid + "/bootstrap"
	_, before, _ := req(t, s, "GET", path, nil, m)
	db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, uid).Update("manager_id", "")
	_, after, _ := req(t, s, "GET", path, nil, m)
	if before["readBasis"] == nil || before["readBasis"] == after["readBasis"] {
		t.Fatal(before["readBasis"], after["readBasis"])
	}
}
func TestTaskDetailEvidenceBoundedAndCursorScoped(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	id := createTask(t, s, c, cid, taskBody(uid))
	other := createTask(t, s, c, cid, taskBody(uid))
	rows := []Comment{}
	for i := 0; i < 101; i++ {
		rows = append(rows, Comment{ID: newID("comment"), CompanyID: cid, TaskID: id, UserID: uid, Body: "history", CreatedAt: "2026-10-01T00:00:00Z"})
	}
	if e := db.CreateInBatches(rows, 100).Error; e != nil {
		t.Fatal(e)
	}
	base := "/api/companies/" + cid + "/tasks/"
	status, b, _ := req(t, s, "GET", base+id, nil, c)
	if status != 200 || len(b["task"].(map[string]any)["comments"].([]any)) != 100 {
		t.Fatal("bounded detail", status)
	}
	evidence := b["evidence"].(map[string]any)["comments"].(map[string]any)
	cursor := url.QueryEscape(evidence["cursor"].(string))
	status, b, _ = req(t, s, "GET", base+id+"/comments?cursor="+cursor, nil, c)
	if status != 200 || len(b["comments"].([]any)) != 1 || b["hasMore"] != false {
		t.Fatal(status, b)
	}
	if status, _, _ = req(t, s, "GET", base+other+"/comments?cursor="+cursor, nil, c); status != 422 {
		t.Fatal("other record cursor", status)
	}
}

func TestListBusinessFieldsPreserveSearchExportAndBlocker(t *testing.T) {
	t.Run("tasks", func(t *testing.T) {
		s, db := testServer(t)
		c := login(t, s, "founder@example.com")
		cid := firstCompany(t, s, c)
		id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
		fields := map[string]any{"description": "Unique searchable delivery context", "blocker_reason": "Waiting for signed design", "deadline_change_reason": "Supplier confirmation moved the deadline"}
		if e := db.Model(&Task{}).Where("id=?", id).Updates(fields).Error; e != nil {
			t.Fatal(e)
		}
		status, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/tasks", nil, c)
		if status != 200 {
			t.Fatal(status, b)
		}
		row := b["tasks"].([]any)[0].(map[string]any)
		for key, want := range map[string]string{"description": fields["description"].(string), "blockerReason": fields["blocker_reason"].(string), "deadlineChangeReason": fields["deadline_change_reason"].(string)} {
			if row[key] != want {
				t.Fatalf("%s: got %v want %s", key, row[key], want)
			}
		}
		for _, key := range []string{"comments", "timeEntries", "attachments", "checklist"} {
			if len(row[key].([]any)) != 0 {
				t.Fatal("list evidence", key)
			}
		}
	})
	t.Run("expenses", func(t *testing.T) {
		f := newFinanceFixture(t)
		id := f.addExpense(t, 100, f.cookie)
		fields := map[string]any{"description": "Unique searchable finance context", "review_note": "Reviewed independently with evidence", "receipt_exception_reason": "Original invoice pending from supplier", "budget_override_reason": "Authorised exceptional site expense"}
		if e := f.db.Model(&Expense{}).Where("id=?", id).Updates(fields).Error; e != nil {
			t.Fatal(e)
		}
		status, b, _ := req(t, f.s, "GET", f.base()+"/expenses", nil, f.cookie)
		if status != 200 {
			t.Fatal(status, b)
		}
		row := b["expenses"].([]any)[0].(map[string]any)
		for key, want := range map[string]string{"description": fields["description"].(string), "reviewNote": fields["review_note"].(string), "receiptExceptionReason": fields["receipt_exception_reason"].(string), "budgetOverrideReason": fields["budget_override_reason"].(string)} {
			if row[key] != want {
				t.Fatalf("%s: got %v want %s", key, row[key], want)
			}
		}
		if len(row["receipts"].([]any)) != 0 {
			t.Fatal("list receipt history")
		}
	})
}
