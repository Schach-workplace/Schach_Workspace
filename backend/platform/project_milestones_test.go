package platform

import (
	"gorm.io/gorm"
	"testing"
)

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

func TestMilestoneStaleSubmissionRecovery(t *testing.T) {
	for _, change := range []string{"time", "evidence", "project"} {
		t.Run(change, func(t *testing.T) {
			s, cid, project, task, reviewer := milestoneFixture(t)
			c := login(t, s, "founder@example.com")
			rc := login(t, s, "milestone-reviewer@example.com")
			base := "/api/companies/" + cid
			_, created, _ := req(t, s, "POST", base+"/projects/"+project+"/milestones", map[string]any{"retryKey": "recover-create", "expectedProjectVersion": 1, "title": "Recover stale basis", "ownerId": me(t, s, c), "reviewerId": reviewer, "criteria": []any{map[string]any{"id": "criterion", "text": "Inspect work"}}, "taskIds": []string{task}}, c)
			id := created["id"].(string)
			path := base + "/project-milestones/" + id
			basis := []any{map[string]any{"taskId": task, "version": 1}}
			submit := map[string]any{"retryKey": "recover-submit", "version": 1, "expectedProjectVersion": 1, "action": "submit", "criteriaVersion": 1, "tasks": basis, "assertions": []any{map[string]any{"criterionId": "criterion", "statement": "Originally inspected"}}}
			if st, _, w := req(t, s, "POST", path+"/transition", submit, c); st != 200 {
				t.Fatal(st, w.Body.String())
			}
			switch change {
			case "time":
				if st, _, w := req(t, s, "POST", base+"/tasks/"+task+"/time", map[string]any{"hours": 1, "date": "2026-10-10", "note": "Accepted work followup"}, c); st != 200 {
					t.Fatal(st, w.Body.String())
				}
			case "project":
				if st, _, w := req(t, s, "PATCH", base+"/projects/"+project, map[string]any{"version": 1, "name": "Changed release"}, c); st != 200 {
					t.Fatal(st, w.Body.String())
				}
			case "evidence":
				if st, _, w := req(t, s, "PATCH", base+"/tasks/"+task, map[string]any{"version": 1, "status": "todo"}, c); st != 200 {
					t.Fatal(st, w.Body.String())
				}
				r := requestForAccess(base+"/tasks/"+task, c, cid)
				a, e := s.access(r)
				if e != nil {
					t.Fatal(e)
				}
				if e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
					return appendTaskEvidence(tx, a, task, Attachment{FileName: "proof.txt", Data: []byte("proof")})
				}); e != nil {
					t.Fatal(e)
				}
				if st, _, w := req(t, s, "PATCH", base+"/tasks/"+task, map[string]any{"version": 3, "status": "done"}, c); st != 200 {
					t.Fatal(st, w.Body.String())
				}
			}
			var p Project
			var row Task
			s.db.First(&p, "id = ?", project)
			s.db.First(&row, "id = ?", task)
			decision := map[string]any{"retryKey": "recover-approve", "version": 2, "expectedProjectVersion": p.Version, "action": "approve", "criteriaVersion": 1, "tasks": basis}
			if st, _, _ := req(t, s, "POST", path+"/transition", decision, rc); st != 409 {
				t.Fatal("stale approval", st)
			}
			reset := map[string]any{"retryKey": "recover-reset", "version": 2, "expectedProjectVersion": p.Version, "action": "request_changes", "criteriaVersion": 1, "tasks": basis, "reason": "Inspect changed source before resubmitting"}
			if st, _, _ := req(t, s, "POST", path+"/transition", reset, c); st != 403 {
				t.Fatal("owner reset", st)
			}
			for _, bad := range []string{"milestone_version", "project_version", "reason"} {
				v := map[string]any{}
				for k, value := range reset {
					v[k] = value
				}
				expected := 409
				switch bad {
				case "milestone_version":
					v["version"] = 1
				case "project_version":
					v["expectedProjectVersion"] = p.Version + 1
				case "reason":
					v["reason"] = ""
					expected = 422
				}
				if st, _, _ := req(t, s, "POST", path+"/transition", v, rc); st != expected {
					t.Fatal("reset guard", bad, st)
				}
			}
			addPerson(t, s, c, cid, "recover-viewer@example.com", "viewer")
			vc := login(t, s, "recover-viewer@example.com")
			if st, _, _ := req(t, s, "POST", path+"/transition", reset, vc); st != 403 && st != 404 {
				t.Fatal("viewer reset", st)
			}
			s.db.Model(&Task{}).Where("id = ?", task).Update("reviewer_id", "")
			if st, _, _ := req(t, s, "POST", path+"/transition", reset, rc); st != 404 {
				t.Fatal("hidden current task reset", st)
			}
			s.db.Model(&Task{}).Where("id = ?", task).Update("reviewer_id", reviewer)
			for i := 0; i < 2; i++ {
				if st, _, w := req(t, s, "POST", path+"/transition", reset, rc); st != 200 {
					t.Fatal("independent stale reset", st, w.Body.String())
				}
			}
			_, detail, _ := req(t, s, "GET", path, nil, c)
			m := detail["milestone"].(map[string]any)
			if m["state"] != "draft" || m["version"] != float64(3) {
				t.Fatal(m)
			}
			events := m["events"].([]any)
			var snapshot map[string]any
			for _, event := range events {
				v := event.(map[string]any)
				if v["action"] == "submit" {
					snapshot = v
				}
			}
			if snapshot == nil || snapshot["projectVersion"] != float64(1) || len(snapshot["tasks"].([]any)) != 1 || len(snapshot["assertions"].([]any)) != 1 {
				t.Fatal("immutable submission basis missing", events)
			}
			submit["retryKey"] = "recover-fresh-submit"
			submit["version"] = 3
			submit["expectedProjectVersion"] = p.Version
			submit["tasks"] = []any{map[string]any{"taskId": task, "version": row.Version}}
			if st, _, w := req(t, s, "POST", path+"/transition", submit, c); st != 200 {
				t.Fatal(st, w.Body.String())
			}
			if st, _, w := req(t, s, "POST", path+"/transition", reset, rc); st != 200 {
				t.Fatal("canonical replay", st, w.Body.String())
			}
			var current ProjectMilestone
			s.db.First(&current, "id = ?", id)
			if current.State != "in_review" || current.Version != 4 {
				t.Fatal("replay reset fresh submission", current)
			}
			decision["retryKey"] = "recover-fresh-approve"
			decision["version"] = 4
			decision["tasks"] = submit["tasks"]
			if st, _, w := req(t, s, "POST", path+"/transition", decision, rc); st != 200 {
				t.Fatal(st, w.Body.String())
			}
			var n int64
			s.db.Model(&MilestoneAcceptance{}).Where("milestone_id = ?", id).Count(&n)
			if n != 1 {
				t.Fatal("unexpected acceptance", n)
			}
		})
	}
}
