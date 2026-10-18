package platform

import "testing"

func TestExpenseExportStrictAndAtomic(t *testing.T) {
	f := newFinanceFixture(t)
	id := f.addExpense(t, 12345, f.cookie)
	path := f.base() + "/finance/expense-export"
	selected := func(id string, v int) map[string]any { return map[string]any{"id": id, "expectedVersion": v} }
	for _, tc := range []struct {
		body   any
		status int
	}{
		{map[string]any{"expenses": []any{selected(id, 1)}}, 200},
		{map[string]any{"expenses": []any{selected(id, 2)}}, 409},
		{map[string]any{"expenses": []any{selected(id, 0)}}, 422},
		{map[string]any{"expenses": []any{selected(id, 1), selected(id, 1)}}, 422},
		{map[string]any{"expenses": []any{selected(id, 1), selected("foreign", 1)}}, 404},
		{map[string]any{"expenses": []any{}}, 422},
		{map[string]any{"expenses": []any{map[string]any{"id": id, "expectedVersion": 1, "amountMinor": 1}}}, 422},
		{map[string]any{"expenses": []any{selected(id, 1)}, "extra": true}, 422},
	} {
		status, data, w := req(t, f.s, "POST", path, tc.body, f.cookie)
		if status != tc.status {
			t.Fatalf("%d want %d: %s", status, tc.status, w.Body.String())
		}
		if status == 200 {
			row := data["rows"].([]any)[0].(map[string]any)
			if row["amountMinor"] != "12345" || len(row) != 8 {
				t.Fatalf("unsafe %v", row)
			}
		} else if data["rows"] != nil {
			t.Fatal("partial rows")
		}
	}
}
func TestExpenseExportCurrentScopeAndNoMutations(t *testing.T) {
	f := newFinanceFixture(t)
	own, uid := f.person(t, "export-member@example.com", "member", f.department)
	viewer, _ := f.person(t, "export-viewer@example.com", "viewer", f.department)
	id := f.addExpense(t, 54321, own)
	foreign := f.addExpense(t, 22, f.cookie)
	body := map[string]any{"expenses": []any{map[string]any{"id": id, "expectedVersion": 1}}}
	var before, after int64
	f.db.Model(&FinanceEvent{}).Count(&before)
	financeOK(t, f.s, "POST", f.base()+"/finance/expense-export", body, own)
	if status, _, _ := req(t, f.s, "POST", f.base()+"/finance/expense-export", body, viewer); status != 403 {
		t.Fatalf("viewer %d", status)
	}
	body["expenses"] = []any{map[string]any{"id": id, "expectedVersion": 1}, map[string]any{"id": foreign, "expectedVersion": 1}}
	if status, _, _ := req(t, f.s, "POST", f.base()+"/finance/expense-export", body, own); status != 404 {
		t.Fatalf("partial scope %d", status)
	}
	financeOK(t, f.s, "PATCH", f.base()+"/people/"+uid, map[string]any{"role": "viewer"}, f.cookie)
	if status, _, _ := req(t, f.s, "POST", f.base()+"/finance/expense-export", body, own); status != 403 && status != 401 {
		t.Fatalf("role change %d", status)
	}
	f.db.Model(&FinanceEvent{}).Count(&after)
	if before != after {
		t.Fatal("finance event mutation")
	}
	if f.state(t, id, f.cookie)["version"] != float64(1) {
		t.Fatal("expense mutation")
	}
}

func TestExpenseExportBoundsAndCompanyIsolation(t *testing.T) {
	f := newFinanceFixture(t)
	id := f.addExpense(t, 12, f.cookie)
	other := financeOK(t, f.s, "POST", "/api/companies", map[string]any{"name": "Other export company", "slug": "export-other", "timezone": "UTC", "color": "#6366F1"}, f.cookie)["id"].(string)
	otherBase := "/api/companies/" + other
	department := financeOK(t, f.s, "POST", otherBase+"/departments", map[string]any{"name": "Export department", "headId": "", "color": "#6366F1", "description": ""}, f.cookie)["id"].(string)
	category := financeOK(t, f.s, "POST", otherBase+"/expense-categories", map[string]any{"name": "Export category", "color": "#6366F1", "receiptRequired": false}, f.cookie)["id"].(string)
	foreignBody := f.expense(99)
	foreignBody["departmentId"], foreignBody["categoryId"] = department, category
	foreignID := financeOK(t, f.s, "POST", otherBase+"/expenses", foreignBody, f.cookie)["id"].(string)
	financeOK(t, f.s, "POST", otherBase+"/finance/expense-export", map[string]any{"expenses": []any{map[string]any{"id": foreignID, "expectedVersion": 1}}}, f.cookie)
	body := map[string]any{"expenses": []any{map[string]any{"id": id, "expectedVersion": 1}, map[string]any{"id": foreignID, "expectedVersion": 1}}}
	if st, data, _ := req(t, f.s, "POST", f.base()+"/finance/expense-export", body, f.cookie); st != 404 || data["rows"] != nil {
		t.Fatalf("company leak %d %v", st, data)
	}
	selected := make([]any, 101)
	for i := range selected {
		selected[i] = map[string]any{"id": string(rune('a' + i)), "expectedVersion": 1}
	}
	if st, _, _ := req(t, f.s, "POST", f.base()+"/finance/expense-export", map[string]any{"expenses": selected}, f.cookie); st != 422 {
		t.Fatalf("bound %d", st)
	}
	member, uid := f.person(t, "export-revoked@example.com", "member", f.department)
	if err := f.db.Model(&Membership{}).Where("company_id=? AND user_id=?", f.cid, uid).Update("active", false).Error; err != nil {
		t.Fatal(err)
	}
	if st, data, _ := req(t, f.s, "POST", f.base()+"/finance/expense-export", body, member); (st != 401 && st != 403) || data["rows"] != nil {
		t.Fatalf("revoked company %d %v", st, data)
	}
}
