package platform

import (
	"testing"
)

func TestPlanningScheduleContext(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	root := createTask(t, s, c, cid, taskBody(uid))
	prereq := createTask(t, s, c, cid, taskBody(uid))
	input := scheduleBody(root, 1)
	input["context"] = map[string]any{"projects": []any{}, "milestones": []any{}, "sources": []any{map[string]any{"id": prereq, "version": 1}}}
	db.Model(&Task{}).Where("id=?", prereq).Update("version", 2)
	path := "/api/companies/" + cid
	status, _, _ := req(t, s, "POST", path+"/task-schedule/preview", input, c)
	if status != 409 {
		t.Fatalf("edited source should block preview: %d", status)
	}
	input["context"].(map[string]any)["sources"] = []any{map[string]any{"id": prereq, "version": 2}}
	status, b, _ := req(t, s, "POST", path+"/task-schedule/preview", input, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	pid := b["proposal"].(map[string]any)["id"].(string)
	apply := map[string]any{"retryKey": "apply-source", "proposalId": pid, "expectedProposalVersion": 1}
	db.Model(&Task{}).Where("id=?", prereq).Update("version", 3)
	status, _, _ = req(t, s, "POST", path+"/task-schedule/apply", apply, c)
	if status != 409 {
		t.Fatal("stale contextual apply", status)
	}
	db.Model(&Task{}).Where("id=?", prereq).Update("version", 2)
	status, b, _ = req(t, s, "POST", path+"/task-schedule/apply", apply, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	db.Model(&Task{}).Where("id=?", prereq).Update("version", 4)
	status, b, _ = req(t, s, "POST", path+"/task-schedule/apply", apply, c)
	if status != 200 {
		t.Fatal("successful immutable replay", status, b)
	}
	var task Task
	db.First(&task, "id=?", root)
	if task.Version != 2 {
		t.Fatal(task.Version)
	}
}
func TestPlanningScheduleContextBounds(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	for _, sources := range []any{[]any{map[string]any{"id": id, "version": 0}}, []any{map[string]any{"id": id, "version": 1}, map[string]any{"id": id, "version": 1}}} {
		input := scheduleBody(id, 1)
		input["context"].(map[string]any)["sources"] = sources
		status, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/task-schedule/preview", input, c)
		if status != 422 {
			t.Fatal(status, b)
		}
	}
}
func TestPlanningWarningsAndSeedReadOnly(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	base := "/api/companies/" + cid + "/planning"
	query := "?from=2026-10-12&to=2026-10-25"
	status, b, _ := req(t, s, "GET", base+"/summary"+query, nil, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	basis := b["projectionBasis"].(string)
	status, b, _ = req(t, s, "GET", base+"/warnings"+query+"&projectionBasis="+basis, nil, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	status, b, _ = req(t, s, "GET", base+"/schedule-seed"+query+"&projectionBasis="+basis+"&taskIds="+id, nil, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	var n int64
	db.Model(&TaskScheduleProposal{}).Count(&n)
	if n != 0 {
		t.Fatal("seed wrote proposal")
	}
}
