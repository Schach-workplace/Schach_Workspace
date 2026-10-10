package platform

import (
	"testing"
	"time"
)

func scheduleBody(task string, version int64) map[string]any {
	return map[string]any{"retryKey": "preview", "method": "manual", "changes": []any{map[string]any{"taskId": task, "version": version, "startDate": "2026-10-12", "dueDate": "2026-10-22", "deadlineMode": "all_day", "dueAt": "", "dueTimezone": "", "reason": "Reviewed delivery adjustment"}}, "context": map[string]any{"projects": []any{}, "milestones": []any{}}}
}
func TestTaskSchedulePreview(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	path := "/api/companies/" + cid + "/task-schedule/preview"
	input := scheduleBody(id, 1)
	st, b, w := req(t, s, "POST", path, input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	proposal := b["proposal"].(map[string]any)
	st, b, w = req(t, s, "POST", path, input, c)
	if st != 200 || b["proposal"].(map[string]any)["id"] != proposal["id"] || b["proposal"].(map[string]any)["expiresAt"] != proposal["expiresAt"] {
		t.Fatal(st, b, w.Body.String())
	}
	var row Task
	db.First(&row, "id = ?", id)
	if row.Version != 1 || row.DueDate != "2026-10-20" {
		t.Fatal("preview wrote task", row)
	}
	input["method"] = "calendar_day_shift"
	input["dayOffset"] = 2
	st, _, _ = req(t, s, "POST", path, input, c)
	if st != 409 {
		t.Fatal("changed intent", st)
	}
}
func TestTaskScheduleApply(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	base := "/api/companies/" + cid
	st, b, w := req(t, s, "POST", base+"/task-schedule/preview", scheduleBody(id, 1), c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	proposal := b["proposal"].(map[string]any)["id"].(string)
	input := map[string]any{"retryKey": "apply", "proposalId": proposal, "expectedProposalVersion": 1}
	for i := 0; i < 2; i++ {
		st, _, w = req(t, s, "POST", base+"/task-schedule/apply", input, c)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	var row Task
	db.First(&row, "id = ?", id)
	if row.Version != 2 || row.DueDate != "2026-10-22" || row.OriginalDueDate != "2026-10-20" {
		t.Fatal(row)
	}
	st, b, w = req(t, s, "POST", base+"/task-schedule/preview", scheduleBody(id, 2), c)
	if st != 409 {
		t.Fatal("same preview key must conflict changed selected version", st, b, w.Body.String())
	}
}

func TestTaskScheduleStaleBatchAndExpiryReplay(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := me(t, s, c)
	first := createTask(t, s, c, cid, taskBody(owner))
	second := createTask(t, s, c, cid, taskBody(owner))
	base := "/api/companies/" + cid
	body := scheduleBody(first, 1)
	rows := body["changes"].([]any)
	other := scheduleBody(second, 1)["changes"].([]any)[0]
	body["changes"] = append(rows, other)
	st, b, w := req(t, s, "POST", base+"/task-schedule/preview", body, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	proposal := b["proposal"].(map[string]any)["id"].(string)
	db.Model(&Task{}).Where("id = ?", second).Update("version", 2)
	st, _, _ = req(t, s, "POST", base+"/task-schedule/apply", map[string]any{"retryKey": "stale", "proposalId": proposal, "expectedProposalVersion": 1}, c)
	if st != 409 {
		t.Fatal(st)
	}
	var row Task
	db.First(&row, "id = ?", first)
	if row.Version != 1 || row.DueDate != "2026-10-20" {
		t.Fatal("partial stale batch", row)
	}
	single := scheduleBody(first, 1)
	single["retryKey"] = "fresh-preview"
	st, b, w = req(t, s, "POST", base+"/task-schedule/preview", single, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	proposal = b["proposal"].(map[string]any)["id"].(string)
	apply := map[string]any{"retryKey": "successful", "proposalId": proposal, "expectedProposalVersion": 1}
	st, _, w = req(t, s, "POST", base+"/task-schedule/apply", apply, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	db.Model(&TaskScheduleProposal{}).Where("id = ?", proposal).Update("expires_at", time.Now().Add(-time.Hour))
	st, _, w = req(t, s, "POST", base+"/task-schedule/apply", apply, c)
	if st != 200 {
		t.Fatal("expired successful replay", w.Body.String())
	}
}
func TestTaskScheduleCalendarShift(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	body := scheduleBody(id, 1)
	body["method"] = "calendar_day_shift"
	body["dayOffset"] = 2
	st, _, w := req(t, s, "POST", "/api/companies/"+cid+"/task-schedule/preview", body, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	body["retryKey"] = "override"
	body["changes"].([]any)[0].(map[string]any)["dueDate"] = "2026-10-23"
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/task-schedule/preview", body, c)
	if st != 422 {
		t.Fatal(st)
	}
}
