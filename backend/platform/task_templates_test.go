package platform

import "testing"

func templateBody(owner string, kind string) map[string]any {
	d := map[string]any{"checklist": []string{"Check delivery"}}
	if kind == "task" {
		d["title"] = "Reusable delivery"
		d["ownerPolicy"] = "actor"
		d["status"] = "todo"
	}
	return map[string]any{"retryKey": "template-one", "kind": kind, "name": "Delivery", "scopeOwnerId": owner, "scopeDepartmentId": "", "defaults": d}
}
func TestTemplateApplication(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	base := "/api/companies/" + cid
	st, b, w := req(t, s, "POST", base+"/task-templates", templateBody(uid, "task"), c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := b["id"].(string)
	fields := taskBody(uid)
	for _, k := range []string{"parentId", "dependencies", "collaborators", "checklist", "recurrence"} {
		delete(fields, k)
	}
	input := map[string]any{"retryKey": "apply-one", "expectedTemplateVersion": 1, "anchorDate": "2026-10-11", "fields": fields}
	st, b, w = req(t, s, "POST", base+"/task-templates/"+id+"/apply", input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	task := b["id"].(string)
	st, b, w = req(t, s, "POST", base+"/task-templates/"+id+"/apply", input, c)
	if st != 200 || b["id"] != task {
		t.Fatal(st, b, w.Body.String())
	}
	var n int64
	db.Model(&Task{}).Count(&n)
	if n != 1 {
		t.Fatal(n)
	}
	var row Task
	db.First(&row, "id = ?", task)
	if len(row.Checklist) != 1 || row.Checklist[0].Done || row.Checklist[0].ID == "" {
		t.Fatal(row.Checklist)
	}
}
func TestChecklistApplication(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	base := "/api/companies/" + cid
	st, b, w := req(t, s, "POST", base+"/task-templates", templateBody(uid, "checklist"), c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	template := b["id"].(string)
	body := taskBody(uid)
	body["checklist"] = []any{map[string]any{"id": "original", "text": "Same check", "done": true}}
	id := createTask(t, s, c, cid, body)
	input := map[string]any{"retryKey": "check-one", "version": 1, "templateId": template, "expectedTemplateVersion": 1}
	for i := 0; i < 2; i++ {
		st, _, w = req(t, s, "POST", base+"/tasks/"+id+"/checklists/apply", input, c)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	var row Task
	db.First(&row, "id = ?", id)
	if row.Version != 2 || len(row.Checklist) != 2 || !row.Checklist[0].Done || row.Checklist[0].ID != "original" || row.Checklist[1].Done {
		t.Fatal(row)
	}
}
func TestProjectOptimisticDefaults(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	st, b, w := req(t, s, "POST", base+"/projects", map[string]any{"name": "Versioned project", "ownerId": me(t, s, c)}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	path := base + "/projects/" + b["id"].(string)
	st, _, w = req(t, s, "PATCH", path, map[string]any{"version": 1, "taskOwnerPolicy": "actor"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"version": 1, "name": "Stale"}, c)
	if st != 409 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"name": "Unversioned"}, c)
	if st != 422 {
		t.Fatal(st)
	}
}

func TestTemplateScopeAndDefaults(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	reviewer := addPerson(t, s, c, cid, "template-reviewer@example.com", "member")
	base := "/api/companies/" + cid
	body := templateBody(uid, "task")
	defaults := body["defaults"].(map[string]any)
	defaults["requiresApproval"] = true
	defaults["reviewerId"] = reviewer
	st, b, w := req(t, s, "POST", base+"/task-templates", body, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	tpl := b["id"].(string)
	fields := map[string]any{"title": "Reviewed delivery", "ownerId": uid, "reviewerId": reviewer, "requiresApproval": false, "status": "todo"}
	input := map[string]any{"retryKey": "review-required", "expectedTemplateVersion": 1, "anchorDate": "2026-10-11", "fields": fields}
	st, b, w = req(t, s, "POST", base+"/task-templates/"+tpl+"/apply", input, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	id := b["id"].(string)
	var task Task
	db.First(&task, "id = ?", id)
	if !task.RequiresApproval {
		t.Fatal("required review suppressed")
	}
	st, _, w = req(t, s, "PATCH", base+"/task-templates/"+tpl, map[string]any{"retryKey": "rename", "version": 1, "name": "Later name"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	st, b, _ = req(t, s, "POST", base+"/task-templates/"+tpl+"/apply", input, c)
	if st != 200 || b["id"] != id {
		t.Fatal("source edit blocked canonical replay", st, b)
	}
	db.Model(&TaskTemplate{}).Where("id = ?", tpl).Update("archived", true)
	st, b, _ = req(t, s, "POST", base+"/task-templates/"+tpl+"/apply", input, c)
	if st != 404 || b["id"] != nil {
		t.Fatal("archive replay disclosure", st, b)
	}
}
