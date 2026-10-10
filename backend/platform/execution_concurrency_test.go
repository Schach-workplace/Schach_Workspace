package platform

import (
	"os"
	"sync"
	"testing"
)

func TestExecutionConcurrentGraphAndSchedule(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("PostgreSQL race")
	}
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	a := createTask(t, s, c, cid, taskBody(uid))
	b := createTask(t, s, c, cid, taskBody(uid))
	base := "/api/companies/" + cid
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for id, dep := range map[string]string{a: b, b: a} {
		wg.Add(1)
		go func(id, dep string) {
			defer wg.Done()
			st, _, _ := req(t, s, "PATCH", base+"/tasks/"+id, map[string]any{"version": 1, "dependencies": []string{dep}}, c)
			codes <- st
		}(id, dep)
	}
	wg.Wait()
	close(codes)
	success := 0
	for st := range codes {
		if st == 200 {
			success++
		} else if st != 422 {
			t.Fatal(st)
		}
	}
	if success != 1 {
		t.Fatal("concurrent dependency cycle", success)
	}
	var row Task
	db.First(&row, "id = ?", a)
	one := scheduleBody(a, row.Version)
	one["retryKey"] = "preview-one"
	two := scheduleBody(a, row.Version)
	two["retryKey"] = "preview-two"
	pids := []string{}
	for _, input := range []map[string]any{one, two} {
		st, res, w := req(t, s, "POST", base+"/task-schedule/preview", input, c)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
		pids = append(pids, res["proposal"].(map[string]any)["id"].(string))
	}
	codes = make(chan int, 2)
	for _, id := range pids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			st, _, _ := req(t, s, "POST", base+"/task-schedule/apply", map[string]any{"retryKey": "apply-" + id, "proposalId": id, "expectedProposalVersion": 1}, c)
			codes <- st
		}(id)
	}
	wg.Wait()
	close(codes)
	success = 0
	for st := range codes {
		if st == 200 {
			success++
		} else if st != 409 {
			t.Fatal(st)
		}
	}
	if success != 1 {
		t.Fatal("concurrent schedule version winner", success)
	}
	var current Task
	db.First(&current, "id = ?", a)
	if current.Version != row.Version+1 || current.OriginalDueDate != "2026-10-20" {
		t.Fatal(current)
	}
}
func TestMilestoneConcurrentAcceptance(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("PostgreSQL race")
	}
	s, cid, project, task, reviewer := milestoneFixture(t)
	c := login(t, s, "founder@example.com")
	base := "/api/companies/" + cid
	st, res, w := req(t, s, "POST", base+"/projects/"+project+"/milestones", map[string]any{"retryKey": "create", "expectedProjectVersion": 1, "title": "Concurrent release", "ownerId": me(t, s, c), "reviewerId": reviewer, "criteria": []any{map[string]any{"id": "c", "text": "Accepted delivery"}}, "taskIds": []string{task}, "dueDate": "2026-10-20"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := res["id"].(string)
	path := base + "/project-milestones/" + id + "/transition"
	basis := []any{map[string]any{"taskId": task, "version": 1}}
	st, _, w = req(t, s, "POST", path, map[string]any{"retryKey": "submit", "version": 1, "expectedProjectVersion": 1, "action": "submit", "criteriaVersion": 1, "assertions": []any{map[string]any{"criterionId": "c", "statement": "Verified"}}, "tasks": basis}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	rc := login(t, s, "milestone-reviewer@example.com")
	input := map[string]any{"retryKey": "approve", "version": 2, "expectedProjectVersion": 1, "action": "approve", "criteriaVersion": 1, "tasks": basis}
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); st, _, _ := req(t, s, "POST", path, input, rc); codes <- st }()
	}
	wg.Wait()
	close(codes)
	for st := range codes {
		if st != 200 {
			t.Fatal(st)
		}
	}
	var count int64
	s.db.Model(&MilestoneAcceptance{}).Where("milestone_id = ?", id).Count(&count)
	if count != 1 {
		t.Fatal(count)
	}
}
