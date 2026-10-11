package platform

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDepartureInventoryAndCanonicalRecovery(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	uid := addPerson(t, s, c, cid, "depart-target@example.invalid", "member")
	replacement := addPerson(t, s, c, cid, "depart-next@example.invalid", "member")
	task := financeOK(t, s, "POST", base+"/tasks", map[string]any{"title": "Live commitment", "ownerId": uid, "status": "todo", "priority": "medium", "dueDate": "2026-10-20"}, c)
	var before Task
	db.First(&before, "id=?", task["id"])
	previewBody := map[string]any{"retryKey": "departure-inspect", "reason": "Reviewed departure", "replacements": []any{}}
	path := base + "/people/" + uid + "/departure"
	p := financeOK(t, s, "POST", path+"/preview", previewBody, c)
	if p["readyToApply"] != false || len(p["liveItems"].([]any)) != 1 {
		t.Fatal("incomplete departure is ready or inventory missing")
	}
	previewBody["retryKey"] = "departure-review"
	previewBody["replacements"] = []any{map[string]any{"kind": "task_owner", "sourceId": task["id"], "expectedVersion": 1, "action": "transfer", "newUserId": replacement}}
	p = financeOK(t, s, "POST", path+"/preview", previewBody, c)
	if p["readyToApply"] != true {
		t.Fatal("complete reviewed handover not ready")
	}
	body := map[string]any{"retryKey": "departure-apply", "previewId": p["id"], "expectedPreviewVersion": p["version"], "confirmCompanyDeparture": true}
	result := financeOK(t, s, "POST", path+"/apply", body, c)
	var after Task
	db.First(&after, "id=?", task["id"])
	if after.OwnerID != replacement || after.Version != 2 || after.Status != before.Status || after.OriginalDueDate != before.OriginalDueDate || after.DueDate != before.DueDate {
		t.Fatal("handover changed commitment or failed transfer")
	}
	var member Membership
	db.First(&member, "company_id=? AND user_id=?", cid, uid)
	if member.Active {
		t.Fatal("membership still active")
	}
	db.Model(&PeoplePreview{}).Where("id=?", p["id"]).Update("expires_at", time.Now().UTC().Add(-time.Hour))
	financeOK(t, s, "PATCH", base+"/tasks/"+task["id"].(string), map[string]any{"version": 2, "title": "Later legitimate edit"}, c)
	financeOK(t, s, "PATCH", base+"/people/"+uid, map[string]any{"active": true}, c)
	replay := financeOK(t, s, "POST", path+"/apply", body, c)
	if replay["id"] != result["id"] {
		t.Fatal("canonical departure changed")
	}
	db.First(&member, "company_id=? AND user_id=?", cid, uid)
	if !member.Active {
		t.Fatal("old departure removed rejoined member")
	}
	db.First(&after, "id=?", task["id"])
	if after.Version != 3 || after.Title != "Later legitimate edit" {
		t.Fatal("replay reapplied transfer")
	}
	assertNativeTaskFacts(t, s)
}
func TestDepartureNewObligationConflicts(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	uid := addPerson(t, s, c, cid, "new-obligation@example.invalid", "member")
	path := base + "/people/" + uid + "/departure"
	p := financeOK(t, s, "POST", path+"/preview", map[string]any{"retryKey": "empty-preview", "reason": "Reviewed empty inventory", "replacements": []any{}}, c)
	financeOK(t, s, "POST", base+"/tasks", map[string]any{"title": "New responsibility", "ownerId": uid, "status": "todo", "priority": "medium"}, c)
	st, _, _ := req(t, s, "POST", path+"/apply", map[string]any{"retryKey": "empty-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true}, c)
	if st != 409 {
		t.Fatalf("new obligation bypassed manifest: %d", st)
	}
}

func TestDepartureGoalSingleCAS(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	uid := addPerson(t, s, c, cid, "goal-depart@example.invalid", "member")
	next := addPerson(t, s, c, cid, "goal-next@example.invalid", "member")
	gid := createMeasuredGoal(t, s, c, cid, uid)
	var old Goal
	db.First(&old, "id=?", gid)
	p := financeOK(t, s, "POST", base+"/people/"+uid+"/departure/preview", map[string]any{"retryKey": "goal-depart-preview", "reason": "Transfer live goal ownership", "replacements": []any{map[string]any{"kind": "goal_owner", "sourceId": gid, "expectedVersion": 1, "action": "transfer", "newUserId": next}}}, c)
	financeOK(t, s, "POST", base+"/people/"+uid+"/departure/apply", map[string]any{"retryKey": "goal-depart-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true}, c)
	var after Goal
	db.First(&after, "id=?", gid)
	if after.OwnerID != next || after.Version != 2 || after.Current != old.Current || after.CurrentMeasurementID != old.CurrentMeasurementID || after.Unit != old.Unit || after.Baseline != old.Baseline || after.Target != old.Target {
		t.Fatal("goal handover changed observed facts")
	}
	var n int64
	db.Model(&GoalMeasurement{}).Where("goal_id=?", gid).Count(&n)
	if n != 1 {
		t.Fatal("handover manufactured observation")
	}
	db.Model(&GoalRevision{}).Where("goal_id=? AND version=2", gid).Count(&n)
	if n != 1 {
		t.Fatal("handover did not write exactly one goal revision")
	}
	db.Model(&GoalReminderPreference{}).Where("goal_id=? AND user_id=?", gid, next).Count(&n)
	if n != 0 {
		t.Fatal("new goal owner was automatically opted in")
	}
}

func TestDepartureOpaqueArchivedPrivateReviewAndDirectRevocation(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	outsider := addPerson(t, s, c, cid, "private-other@example.invalid", "member")
	conv := newConversation(t, s, mc, cid, []string{uid, outsider}, "group")
	// Company founder is not a member and must receive no private identifiers.
	root := "/api/companies/" + cid
	p := financeOK(t, s, "POST", root+"/people/"+uid+"/departure/preview", map[string]any{"retryKey": "opaque-owner", "reason": "Review responsibility", "replacements": []any{}}, c)
	raw, _ := json.Marshal(p)
	if p["readyToApply"] != false || strings.Contains(string(raw), conv) {
		t.Fatal("private ownership leaked or failed to block")
	}
	// A distinct open review remains live even after archive and a past due time.
	reviewConv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	message := sendMessage(t, s, c, cid, reviewConv, "review-anchor", "Fictional confidential anchor")
	record := financeOK(t, s, "POST", root+"/conversations/"+reviewConv+"/records", map[string]any{"retryKey": "private-review", "kind": "decision", "anchorMessageId": message["id"], "sourceRevision": 1, "title": "Private decision title", "body": "Private decision body", "reviewerId": uid, "recipientIds": []string{uid}}, c)
	s.db.Model(&Conversation{}).Where("id IN ?", []string{conv, reviewConv}).Update("archived", true)
	s.db.Model(&CommunicationRecord{}).Where("id=?", record["id"]).Update("due_at", time.Now().UTC().Add(-time.Hour))
	p = financeOK(t, s, "POST", root+"/people/"+uid+"/departure/preview", map[string]any{"retryKey": "opaque-review", "reason": "Review responsibility", "replacements": []any{}}, c)
	raw, _ = json.Marshal(p)
	if p["readyToApply"] != false || strings.Contains(string(raw), record["id"].(string)) || strings.Contains(string(raw), "Private decision") {
		t.Fatal("private open review leaked or archived obligation ignored")
	}
	financeOK(t, s, "PATCH", root+"/people/"+uid, map[string]any{"active": false}, c)
	var current CommunicationRecord
	s.db.First(&current, "id=?", record["id"])
	if current.State != "open" || current.ReviewerID != uid {
		t.Fatal("direct revocation rewrote private history")
	}
	var count int64
	s.db.Model(&CompanyDeparture{}).Where("target_user_id=?", uid).Count(&count)
	if count != 0 {
		t.Fatal("direct revocation certified handover")
	}
}
func TestDepartureAllSourceWritesRollback(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	target := addPerson(t, s, c, cid, "rollback-depart@example.invalid", "member")
	next := me(t, s, c)
	task := financeOK(t, s, "POST", base+"/tasks", map[string]any{"title": "Atomic responsibility", "ownerId": target, "status": "todo", "priority": "medium"}, c)
	p := financeOK(t, s, "POST", base+"/people/"+target+"/departure/preview", map[string]any{"retryKey": "atomic-preview", "reason": "Reviewed rollback fixture", "replacements": []any{map[string]any{"kind": "task_owner", "sourceId": task["id"], "expectedVersion": 1, "action": "transfer", "newUserId": next}}}, c)
	const hook = "m9_departure_atomic_failure"
	db.Callback().Create().Before("gorm:create").Register(hook, func(tx *gorm.DB) {
		if tx.Statement.Table == "company_departures" {
			tx.AddError(errors.New("injected departure history write failure"))
		}
	})
	defer db.Callback().Create().Remove(hook)
	st, _, _ := req(t, s, "POST", base+"/people/"+target+"/departure/apply", map[string]any{"retryKey": "atomic-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true}, c)
	if st != 500 {
		t.Fatalf("injection: %d", st)
	}
	var current Task
	db.First(&current, "id=?", task["id"])
	if current.OwnerID != target || current.Version != 1 {
		t.Fatal("partial source commit survived")
	}
	var member Membership
	db.First(&member, "company_id=? AND user_id=?", cid, target)
	if !member.Active || member.AccessEpoch != 1 {
		t.Fatal("partial membership revocation survived")
	}
	db.Callback().Create().Remove(hook)
	financeOK(t, s, "POST", base+"/people/"+target+"/departure/apply", map[string]any{"retryKey": "atomic-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true}, c)
}

func TestDepartureProjectDepartmentReportingAndMilestone(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	target := addPerson(t, s, c, cid, "mixed-depart@example.invalid", "manager")
	next := me(t, s, c)
	report := addPerson(t, s, c, cid, "mixed-report@example.invalid", "admin")
	financeOK(t, s, "PATCH", base+"/people/"+report, map[string]any{"managerId": target}, c)
	project := financeOK(t, s, "POST", base+"/projects", map[string]any{"name": "Retained project purpose", "ownerId": target, "dueDate": "2026-12-01"}, c)
	department := financeOK(t, s, "POST", base+"/departments", map[string]any{"name": "Retained department", "headId": target, "color": "#123456"}, c)
	taskInput := taskBody(next)
	taskInput["projectId"] = project["id"]
	taskInput["status"] = "done"
	taskInput["requiresApproval"] = false
	taskInput["reviewerId"] = report
	acceptedTask := createTask(t, s, c, cid, taskInput)
	milestone := financeOK(t, s, "POST", base+"/projects/"+project["id"].(string)+"/milestones", map[string]any{"retryKey": "mixed-milestone", "expectedProjectVersion": 1, "title": "Draft acceptance criteria", "ownerId": target, "reviewerId": report, "criteria": []any{map[string]any{"id": "criterion", "text": "Independently verified"}}, "taskIds": []string{acceptedTask}}, c)
	replacements := []any{}
	for _, r := range []DepartureReplacement{{Kind: "project_owner", SourceID: project["id"].(string), ExpectedVersion: 1, Action: "transfer", NewUserID: next}, {Kind: "department_head", SourceID: department["id"].(string), ExpectedVersion: 1, Action: "transfer", NewUserID: next}, {Kind: "milestone_owner", SourceID: milestone["id"].(string), ExpectedVersion: 1, Action: "transfer", NewUserID: next}, {Kind: "reporting_manager", SourceID: report, ExpectedVersion: 2, Action: "clear_reporting_manager"}} {
		replacements = append(replacements, r)
	}
	p := financeOK(t, s, "POST", base+"/people/"+target+"/departure/preview", map[string]any{"retryKey": "mixed-preview", "reason": "Explicit reviewed mixed-source transfer", "replacements": replacements}, c)
	financeOK(t, s, "POST", base+"/people/"+target+"/departure/apply", map[string]any{"retryKey": "mixed-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true}, c)
	var pr Project
	db.First(&pr, "id=?", project["id"])
	if pr.Version != 2 || pr.OwnerID != next || pr.DueDate != "2026-12-01" {
		t.Fatal("project commitment changed")
	}
	var dep Department
	db.First(&dep, "id=?", department["id"])
	if dep.Version != 2 || dep.HeadID != next {
		t.Fatal("department transfer missing")
	}
	var m ProjectMilestone
	db.First(&m, "id=?", milestone["id"])
	if m.Version != 2 || m.OwnerID != next || m.ReviewerID != report || m.State != "draft" || m.CriteriaVersion != 1 {
		t.Fatal("handover manufactured milestone acceptance")
	}
	var rm Membership
	db.First(&rm, "company_id=? AND user_id=?", cid, report)
	if rm.Version != 3 || rm.ManagerID != "" || rm.AccessEpoch != 3 {
		t.Fatal("explicit no-manager did not commit once")
	}
}

func TestDepartureExpenseReviewPreservesFinanceFacts(t *testing.T) {
	for _, action := range []string{"transfer", "retain_current_reviewer"} {
		t.Run(action, func(t *testing.T) {
			f := newFinanceFixture(t)
			_, target := f.person(t, "expense-depart@example.invalid", "finance", "")
			_, next := f.person(t, "expense-next@example.invalid", "finance", "")
			financeOK(t, f.s, "PATCH", f.base()+"/people/"+next, map[string]any{"role": "admin"}, f.cookie)
			creator, _ := f.person(t, "expense-author@example.invalid", "member", f.department)
			expense := f.addExpense(t, 12500, creator)
			financeOK(t, f.s, "POST", f.base()+"/expenses/"+expense+"/transition", map[string]any{"version": 1, "action": "submit"}, creator)
			if _, e := f.s.RunAttention(t.Context(), time.Now().UTC(), 100); e != nil {
				t.Fatal(e)
			}
			var item AttentionItem
			if e := f.db.Where("company_id=? AND recipient_id=? AND source_kind='expense' AND source_id=? AND kind='expense_review' AND state='open'", f.cid, target, expense).First(&item).Error; e != nil {
				t.Fatal(e)
			}
			var before Expense
			f.db.First(&before, "id=?", expense)
			p := financeOK(t, f.s, "POST", f.base()+"/people/"+target+"/departure/preview", map[string]any{"retryKey": "expense-preview", "reason": "Reviewed independent routing only", "replacements": []any{DepartureReplacement{Kind: "expense_review_route", SourceID: item.ID, ExpectedVersion: item.Version, Action: action, NewUserID: next}}}, f.cookie)
			result := financeOK(t, f.s, "POST", f.base()+"/people/"+target+"/departure/apply", map[string]any{"retryKey": "expense-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true}, f.cookie)
			var after Expense
			f.db.First(&after, "id=?", expense)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("routing wrote a finance business fact")
			}
			var current AttentionItem
			f.db.First(&current, "id=?", item.ID)
			if current.State == "open" {
				t.Fatal("departed personal review remained open")
			}
			var transfer DepartureTransfer
			f.db.First(&transfer, "departure_id=? AND source_id=?", result["id"], item.ID)
			if transfer.AfterVersion != current.Version {
				t.Fatal("transfer history does not match final old-recipient episode version")
			}
			var count int64
			f.db.Model(&AttentionItem{}).Where("company_id=? AND recipient_id=? AND source_kind='expense' AND source_id=? AND state='open'", f.cid, next, expense).Count(&count)
			if count != 1 {
				t.Fatal("replacement reviewer obligation missing or duplicated")
			}
		})
	}
}

func TestDepartureInReviewMilestoneRequiresSeparateHumanAction(t *testing.T) {
	s, cid, project, task, target := milestoneFixture(t)
	founder := login(t, s, "founder@example.com")
	admin := addPerson(t, s, founder, cid, "milestone-depart-admin@example.invalid", "admin")
	actor := login(t, s, "milestone-depart-admin@example.invalid")
	base := "/api/companies/" + cid
	m := financeOK(t, s, "POST", base+"/projects/"+project+"/milestones", map[string]any{"retryKey": "departure-milestone", "expectedProjectVersion": 1, "title": "Submitted delivery", "ownerId": me(t, s, founder), "reviewerId": target, "criteria": []any{map[string]any{"id": "criterion", "text": "Independent delivery check"}}, "taskIds": []string{task}}, founder)
	mid := m["id"].(string)
	tasks := []any{map[string]any{"taskId": task, "version": 1}}
	financeOK(t, s, "POST", base+"/project-milestones/"+mid+"/transition", map[string]any{"retryKey": "departure-submit", "version": 1, "expectedProjectVersion": 1, "action": "submit", "criteriaVersion": 1, "assertions": []any{map[string]any{"criterionId": "criterion", "statement": "Human submitted delivery"}}, "tasks": tasks}, founder)
	inspect := map[string]any{"retryKey": "in-review-inspect", "reason": "Review independent handover", "replacements": []any{}}
	p := financeOK(t, s, "POST", base+"/people/"+target+"/departure/preview", inspect, actor)
	if p["readyToApply"] != false {
		t.Fatal("submitted milestone silently became editable")
	}
	linked := false
	for _, raw := range p["unresolved"].([]any) {
		u := raw.(map[string]any)
		if u["code"] == "milestone_request_changes_required" && u["projectId"] == project {
			linked = true
		}
	}
	if !linked {
		t.Fatal("eligible human source action unavailable")
	}
	status, _, _ := req(t, s, "POST", base+"/people/"+target+"/departure/apply", map[string]any{"retryKey": "blocked-milestone-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true}, actor)
	if status != 422 {
		t.Fatalf("blocked departure: %d", status)
	}
	financeOK(t, s, "POST", base+"/project-milestones/"+mid+"/transition", map[string]any{"retryKey": "human-request-changes", "version": 2, "expectedProjectVersion": 1, "action": "request_changes", "criteriaVersion": 1, "tasks": tasks, "reason": "Human requests fresh independent review before departure"}, actor)
	inspect["retryKey"] = "draft-handover-preview"
	inspect["replacements"] = []any{DepartureReplacement{Kind: "milestone_reviewer", SourceID: mid, ExpectedVersion: 3, Action: "transfer", NewUserID: admin}}
	p = financeOK(t, s, "POST", base+"/people/"+target+"/departure/preview", inspect, actor)
	financeOK(t, s, "POST", base+"/people/"+target+"/departure/apply", map[string]any{"retryKey": "draft-handover-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true}, actor)
	var after ProjectMilestone
	s.db.First(&after, "id=?", mid)
	if after.Version != 4 || after.State != "draft" || after.ReviewerID != admin {
		t.Fatal("separate review lifecycle not preserved")
	}
	var selected Task
	s.db.First(&selected, "id=?", task)
	if selected.ReviewerID != target || selected.Version != 1 || selected.Status != "done" {
		t.Fatal("accepted task history was rewritten")
	}
}
