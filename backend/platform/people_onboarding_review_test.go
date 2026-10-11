package platform

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// M9_ONBOARDING_REVIEW_FIXTURE optionally records the real, credential-free
// HTTP preview and current label responses consumed by both client UI tests.
func TestOnboardingReviewedTemplateTasks(t *testing.T) {
	s, db := testServer(t)
	enableFictionalCredentialKey(t, s)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	owner := me(t, s, c)
	reviewer := addPerson(t, s, c, cid, "checklist-reviewer@example.invalid", "admin")
	project := financeOK(t, s, "POST", base+"/projects", map[string]any{"name": "Reviewed starting project", "ownerId": owner, "defaultRequiresApproval": true, "defaultReviewerId": reviewer}, c)
	texts := []string{"Read the complete starting handbook", "Confirm the independent review requirements"}
	defaults := map[string]any{"title": "Reviewed starting task", "description": "Complete the reviewed starting work", "ownerPolicy": "actor", "reviewerId": reviewer, "requiresApproval": true, "status": "todo", "priority": "high", "estimatedHours": 2.5, "relativeDueDays": 3, "tags": []string{"starting", "reviewed"}, "checklist": texts}
	template := financeOK(t, s, "POST", base+"/task-templates", map[string]any{"retryKey": "checklist-template", "kind": "task", "name": "Reviewed starting template", "scopeOwnerId": owner, "defaults": defaults}, c)
	input := map[string]any{"retryKey": "checklist-preview", "name": "Fictional Reviewed Starter", "email": "reviewed-starter@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 32}, "tasks": []any{map[string]any{"templateId": template["id"], "expectedTemplateVersion": 1, "projectId": project["id"], "expectedProjectVersion": 1, "anchorDate": "2026-10-11", "fields": map[string]any{"startDate": "2026-10-11"}}}}
	counts := func() []int64 {
		result := []int64{}
		for _, model := range []any{&User{}, &Membership{}, &Task{}, &TaskTemplateApplication{}} {
			var n int64
			if e := db.Model(model).Count(&n).Error; e != nil {
				t.Fatal(e)
			}
			result = append(result, n)
		}
		return result
	}
	before := counts()
	preview := financeOK(t, s, "POST", base+"/people/onboarding/preview", input, c)
	if !reflect.DeepEqual(before, counts()) {
		t.Fatal("preview created user, membership, task or template application")
	}
	if path := os.Getenv("M9_ONBOARDING_REVIEW_FIXTURE"); path != "" {
		fixture := map[string]any{"preview": preview, "context": financeOK(t, s, "GET", base+"/people/context", nil, c), "projects": financeOK(t, s, "GET", base+"/projects", nil, c)}
		data, e := json.MarshalIndent(fixture, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, append(data, '\n'), 0600); e != nil {
			t.Fatal(e)
		}
	}
	tasks := preview["taskPreviews"].([]any)
	if len(tasks) != 1 {
		t.Fatal("missing task preview")
	}
	task := tasks[0].(map[string]any)
	got, _ := json.Marshal(task["checklist"])
	want, _ := json.Marshal(texts)
	if string(got) != string(want) {
		t.Fatalf("preview omitted full ordered checklist text: got %s want %s", got, want)
	}
	fields := task["fields"].(map[string]any)
	for field, value := range map[string]any{"ownerId": owner, "reviewerId": reviewer, "projectId": project["id"], "requiresApproval": true, "dueDate": "2026-10-14", "startDate": "2026-10-11", "estimatedHours": 2.5, "status": "todo", "priority": "high"} {
		if fields[field] != value {
			t.Errorf("review field %s: got %v want %v", field, fields[field], value)
		}
	}
	if _, ok := fields["checklist"]; ok {
		t.Fatal("preview generated task checklist state instead of text requirements")
	}
	if len(preview["grants"].([]any)) != 4 {
		t.Fatal("missing access grants")
	}
	again := financeOK(t, s, "POST", base+"/people/onboarding/preview", input, c)
	if preview["id"] != again["id"] || !reflect.DeepEqual(preview["taskPreviews"], again["taskPreviews"]) || !reflect.DeepEqual(preview["grants"], again["grants"]) {
		t.Fatal("preview canonical replay changed captured requirements or grants")
	}
	body := map[string]any{"retryKey": "checklist-apply", "previewId": preview["id"], "expectedPreviewVersion": 1, "password": "FictionalOnly!2026"}
	applied := financeOK(t, s, "POST", base+"/people/onboarding/apply", body, c)
	id := applied["taskIds"].([]any)[0].(string)
	var created Task
	if e := db.First(&created, "id=?", id).Error; e != nil {
		t.Fatal(e)
	}
	if len(created.Checklist) != 2 {
		t.Fatal("created checklist incomplete")
	}
	ids := map[string]bool{}
	for i, item := range created.Checklist {
		if item.Text != texts[i] || item.ID == "" || ids[item.ID] || item.Done {
			t.Fatal("created checklist must have ordered texts and fresh unique unchecked IDs")
		}
		ids[item.ID] = true
	}
	if created.DueDate != "2026-10-14" || created.OriginalDueDate != "2026-10-14" || created.StartDate != "2026-10-11" || created.ReviewerID != reviewer || !created.RequiresApproval {
		t.Fatal("creation changed reviewed dates or independent acceptance")
	}
	after := counts()
	// A completed application replays canonically under current ACL even after a
	// template edit; a never-applied captured preview must instead reject it.
	defaults["checklist"] = []string{"Edited requirement"}
	financeOK(t, s, "PATCH", base+"/task-templates/"+template["id"].(string), map[string]any{"retryKey": "checklist-edit", "version": 1, "defaults": defaults}, c)
	replay := financeOK(t, s, "POST", base+"/people/onboarding/apply", body, c)
	if !reflect.DeepEqual(applied, replay) || !reflect.DeepEqual(after, counts()) {
		t.Fatal("canonical replay duplicated or changed applied result")
	}
	var replayTask Task
	db.First(&replayTask, "id=?", id)
	if !reflect.DeepEqual(created.Checklist, replayTask.Checklist) {
		t.Fatal("canonical replay rewrote checklist IDs or state")
	}
	assertNativeTaskFacts(t, s)
}

func TestOnboardingChecklistPreviewRejectsChangedSource(t *testing.T) {
	for _, change := range []string{"edit", "archive"} {
		t.Run(change, func(t *testing.T) {
			s, db := testServer(t)
			enableFictionalCredentialKey(t, s)
			c := login(t, s, "founder@example.com")
			base := "/api/companies/" + firstCompany(t, s, c)
			template := financeOK(t, s, "POST", base+"/task-templates", templateBody(me(t, s, c), "task"), c)
			input := map[string]any{"retryKey": "source-preview", "name": "Fictional Starter", "email": "changed-source@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{map[string]any{"templateId": template["id"], "expectedTemplateVersion": 1, "anchorDate": "2026-10-11", "fields": map[string]any{}}}}
			preview := financeOK(t, s, "POST", base+"/people/onboarding/preview", input, c)
			patch := map[string]any{"retryKey": "source-archive", "version": 1, "archived": true}
			if change == "edit" {
				patch = map[string]any{"retryKey": "source-edit", "version": 1, "defaults": map[string]any{"title": "Changed", "ownerPolicy": "actor", "status": "todo", "checklist": []string{"Changed requirement"}}}
			}
			financeOK(t, s, "PATCH", base+"/task-templates/"+template["id"].(string), patch, c)
			st, _, _ := req(t, s, "POST", base+"/people/onboarding/apply", map[string]any{"retryKey": "source-apply", "previewId": preview["id"], "expectedPreviewVersion": 1, "password": "FictionalOnly!2026"}, c)
			if st != 409 && st != 404 && st != 403 {
				t.Fatalf("changed source accepted: %d", st)
			}
			var n int64
			db.Model(&User{}).Where("email=?", "changed-source@example.invalid").Count(&n)
			if n != 0 {
				t.Fatal("changed source created account")
			}
			db.Model(&Task{}).Count(&n)
			if n != 0 {
				t.Fatal("changed source created task")
			}
		})
	}
}

func TestOnboardingLegacyChecklistPreviewRequiresFreshReview(t *testing.T) {
	for _, applied := range []bool{false, true} {
		t.Run(map[bool]string{false: "first_apply", true: "committed_replay"}[applied], func(t *testing.T) {
			s, db := testServer(t)
			enableFictionalCredentialKey(t, s)
			c := login(t, s, "founder@example.com")
			base := "/api/companies/" + firstCompany(t, s, c)
			template := financeOK(t, s, "POST", base+"/task-templates", templateBody(me(t, s, c), "task"), c)
			input := map[string]any{"retryKey": "legacy-preview", "name": "Fictional Legacy Starter", "email": "legacy-starter@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{map[string]any{"templateId": template["id"], "expectedTemplateVersion": 1, "anchorDate": "2026-10-11", "fields": map[string]any{}}}}
			preview := financeOK(t, s, "POST", base+"/people/onboarding/preview", input, c)
			body := map[string]any{"retryKey": "legacy-apply", "previewId": preview["id"], "expectedPreviewVersion": 1, "password": "FictionalOnly!2026"}
			var original map[string]any
			if applied {
				original = financeOK(t, s, "POST", base+"/people/onboarding/apply", body, c)
			}
			var row PeoplePreview
			if e := db.First(&row, "id=?", preview["id"]).Error; e != nil {
				t.Fatal(e)
			}
			var stored map[string]any
			if e := json.Unmarshal(row.Manifest, &stored); e != nil {
				t.Fatal(e)
			}
			for _, task := range stored["TaskPreviews"].([]any) {
				delete(task.(map[string]any), "checklist")
			}
			legacy, e := json.Marshal(stored)
			if e != nil {
				t.Fatal(e)
			}
			if e = db.Model(&row).Update("manifest", json.RawMessage(legacy)).Error; e != nil {
				t.Fatal(e)
			}
			replayPreview := financeOK(t, s, "POST", base+"/people/onboarding/preview", input, c)
			if len(replayPreview["unresolved"].([]any)) != 1 {
				t.Error("legacy captured preview must visibly require a fresh review")
			}
			status, out, _ := req(t, s, "POST", base+"/people/onboarding/apply", body, c)
			if applied {
				if status != 200 || !reflect.DeepEqual(out, original) {
					t.Fatal("legacy completed application lost canonical replay")
				}
			} else {
				if status != 409 {
					t.Fatalf("undisclosed legacy first apply accepted: %d", status)
				}
				var n int64
				db.Model(&User{}).Where("email=?", "legacy-starter@example.invalid").Count(&n)
				if n != 0 {
					t.Fatal("legacy first apply created account")
				}
				db.Model(&Task{}).Count(&n)
				if n != 0 {
					t.Fatal("legacy first apply created task")
				}
			}
		})
	}
}
