package platform

import "testing"

func milestoneFixture(t *testing.T) (*Server, string, string, string, string) {
	t.Helper()
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	reviewer := addPerson(t, s, c, cid, "milestone-reviewer@example.com", "member")
	st, p, w := req(t, s, "POST", "/api/companies/"+cid+"/projects", map[string]any{"name": "Release", "ownerId": uid}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	project := p["id"].(string)
	body := taskBody(uid)
	body["projectId"] = project
	body["status"] = "done"
	body["reviewerId"] = reviewer
	body["requiresApproval"] = false
	id := createTask(t, s, c, cid, body)
	return s, cid, project, id, reviewer
}
func TestMilestoneIndependentAcceptance(t *testing.T) {
	s, cid, project, task, reviewer := milestoneFixture(t)
	c := login(t, s, "founder@example.com")
	base := "/api/companies/" + cid
	st, b, w := req(t, s, "POST", base+"/projects/"+project+"/milestones", map[string]any{"retryKey": "milestone-create", "expectedProjectVersion": 1, "title": "Release ready", "ownerId": me(t, s, c), "reviewerId": reviewer, "criteria": []any{map[string]any{"id": "criterion", "text": "Delivery accepted"}}, "taskIds": []string{task}, "dueDate": "2026-10-20"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := b["id"].(string)
	path := base + "/project-milestones/" + id + "/transition"
	input := map[string]any{"retryKey": "submit", "version": 1, "expectedProjectVersion": 1, "action": "submit", "criteriaVersion": 1, "assertions": []any{map[string]any{"criterionId": "criterion", "statement": "Checked accepted delivery"}}, "tasks": []any{map[string]any{"taskId": task, "version": 1}}}
	st, _, w = req(t, s, "POST", path, input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	approve := map[string]any{"retryKey": "approve", "version": 2, "expectedProjectVersion": 1, "action": "approve", "criteriaVersion": 1, "tasks": input["tasks"], "note": "Independently checked"}
	st, _, _ = req(t, s, "POST", path, approve, c)
	if st != 403 {
		t.Fatal("owner accepted milestone", st)
	}
	rc := login(t, s, "milestone-reviewer@example.com")
	for i := 0; i < 2; i++ {
		st, _, w = req(t, s, "POST", path, approve, rc)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	var row Task
	s.db.First(&row, "id = ?", task)
	if row.Version != 1 || row.Status != "done" {
		t.Fatal("milestone changed task", row)
	}
	st, b, w = req(t, s, "GET", base+"/project-milestones/"+id, nil, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	m := b["milestone"].(map[string]any)
	if m["state"] != "accepted" || m["basisCurrent"] != true {
		t.Fatal(m)
	}
	var n int64
	s.db.Table("milestone_acceptances").Count(&n)
	if n != 1 {
		t.Fatal("duplicate acceptance", n)
	}
}
func TestMilestoneBasisConflicts(t *testing.T) {
	s, cid, project, task, reviewer := milestoneFixture(t)
	c := login(t, s, "founder@example.com")
	base := "/api/companies/" + cid
	st, b, w := req(t, s, "POST", base+"/projects/"+project+"/milestones", map[string]any{"retryKey": "create", "expectedProjectVersion": 1, "title": "Basis", "ownerId": me(t, s, c), "reviewerId": reviewer, "criteria": []any{map[string]any{"id": "c", "text": "Current work"}}, "taskIds": []string{task}}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	id := b["id"].(string)
	s.db.Model(&Task{}).Where("id = ?", task).Update("version", 2)
	st, _, _ = req(t, s, "POST", base+"/project-milestones/"+id+"/transition", map[string]any{"retryKey": "stale", "version": 1, "expectedProjectVersion": 1, "action": "submit", "criteriaVersion": 1, "assertions": []any{map[string]any{"criterionId": "c", "statement": "Checked"}}, "tasks": []any{map[string]any{"taskId": task, "version": 1}}}, c)
	if st != 409 {
		t.Fatal(st)
	}
}

func TestMilestoneRetryAndHistory(t *testing.T) {
	s, cid, project, task, reviewer := milestoneFixture(t)
	c := login(t, s, "founder@example.com")
	base := "/api/companies/" + cid
	_, b, _ := req(t, s, "POST", base+"/projects/"+project+"/milestones", map[string]any{"retryKey": "history-create", "expectedProjectVersion": 1, "title": "History", "ownerId": me(t, s, c), "reviewerId": reviewer, "criteria": []any{map[string]any{"id": "c", "text": "Checked"}}, "taskIds": []string{task}}, c)
	id := b["id"].(string)
	path := base + "/project-milestones/" + id
	basis := []any{map[string]any{"taskId": task, "version": 1}}
	submit := map[string]any{"retryKey": "submit", "version": 1, "expectedProjectVersion": 1, "action": "submit", "criteriaVersion": 1, "assertions": []any{map[string]any{"criterionId": "c", "statement": "Accepted work inspected"}}, "tasks": basis}
	st, _, w := req(t, s, "POST", path+"/transition", submit, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	rc := login(t, s, "milestone-reviewer@example.com")
	approve := map[string]any{"retryKey": "approve", "version": 2, "expectedProjectVersion": 1, "action": "approve", "criteriaVersion": 1, "tasks": basis}
	st, _, w = req(t, s, "POST", path+"/transition", approve, rc)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	s.db.Model(&Task{}).Where("id = ?", task).Update("version", 2)
	st, b, w = req(t, s, "GET", path, nil, c)
	if st != 200 || b["milestone"].(map[string]any)["basisCurrent"] != false {
		t.Fatal(st, b, w.Body.String())
	}
	st, _, w = req(t, s, "POST", path+"/transition", approve, rc)
	if st != 200 {
		t.Fatal("successful canonical decision replay after basis changed", w.Body.String())
	}
	st, _, w = req(t, s, "POST", path+"/transition", map[string]any{"retryKey": "reopen", "version": 3, "expectedProjectVersion": 1, "action": "reopen", "reason": "Re-review current work"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	var n int64
	s.db.Model(&MilestoneAcceptance{}).Where("milestone_id = ?", id).Count(&n)
	if n != 1 {
		t.Fatal("history erased", n)
	}
}
