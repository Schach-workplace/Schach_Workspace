package platform

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"reflect"
	"testing"
)

func TestTaskPatchHelperParity(t *testing.T) {
	cases := []struct {
		name   string
		status int
	}{
		{"edit", 200}, {"viewer", 403}, {"hidden", 404}, {"reviewer_cannot_write", 403}, {"owner_structure", 403}, {"reviewer_protection", 403}, {"accepted_edit", 422}, {"explicit_reopen", 200}, {"deadline_reason", 422}, {"deadline_change", 200}, {"timed_deadline", 200}, {"dst_gap", 422}, {"dag_cycle", 422}, {"incomplete_checklist", 422}, {"stale_time", 409}, {"stale_evidence", 409}, {"stale_cas", 409},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, db := testServer(t)
			founder := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, founder)
			uid := me(t, s, founder)
			member := addPerson(t, s, founder, cid, "parity-owner@example.com", "member")
			viewer := addPerson(t, s, founder, cid, "parity-viewer@example.com", "viewer")
			_ = viewer
			actor := founder
			body := taskBody(uid)
			fields := map[string]any{"title": "Edited identically"}
			version := int64(1)
			switch tc.name {
			case "viewer":
				actor = login(t, s, "parity-viewer@example.com")
			case "hidden":
				actor = login(t, s, "parity-owner@example.com")
			case "reviewer_cannot_write":
				body["reviewerId"] = member
				actor = login(t, s, "parity-owner@example.com")
			case "owner_structure":
				body["ownerId"] = member
				actor = login(t, s, "parity-owner@example.com")
				fields = map[string]any{"ownerId": uid}
			case "reviewer_protection":
				body["ownerId"] = member
				body["reviewerId"] = uid
				body["requiresApproval"] = true
				actor = login(t, s, "parity-owner@example.com")
				fields = map[string]any{"requiresApproval": false}
			case "accepted_edit":
				body["status"] = "done"
			case "explicit_reopen":
				body["status"] = "done"
				fields = map[string]any{"status": "todo"}
			case "deadline_reason":
				fields = map[string]any{"dueDate": "2026-10-22"}
			case "deadline_change":
				fields = map[string]any{"dueDate": "2026-10-22", "deadlineChangeReason": "Human reviewed date"}
			case "timed_deadline":
				fields = map[string]any{"dueDate": "2026-10-22", "deadlineMode": "timed", "dueAt": "2026-10-22T10:30:00Z", "dueTimezone": "Asia/Kolkata", "deadlineChangeReason": "Human reviewed time"}
			case "dst_gap":
				fields = map[string]any{"startDate": "", "dueDate": "2026-03-08", "deadlineMode": "timed", "dueAt": "2026-03-08T02:30:00", "dueTimezone": "America/New_York", "deadlineChangeReason": "Review invalid wall date"}
			case "incomplete_checklist":
				body["ownerId"] = member
				body["reviewerId"] = uid
				body["checklist"] = []any{map[string]any{"id": "check", "text": "Required", "done": false}}
				fields = map[string]any{"status": "in_review"}
			}
			direct := createTask(t, s, founder, cid, body)
			helper := createTask(t, s, founder, cid, body)
			base := "/api/companies/" + cid
			if tc.name == "dag_cycle" {
				common := createTask(t, s, founder, cid, taskBody(uid))
				raw, _ := json.Marshal([]string{direct, helper})
				db.Model(&Task{}).Where("id = ?", common).Update("dependencies", string(raw))
				fields = map[string]any{"dependencies": []string{common}}
			}
			for _, id := range []string{direct, helper} {
				switch tc.name {
				case "stale_time":
					if st, _, w := req(t, s, "POST", base+"/tasks/"+id+"/time", map[string]any{"hours": 1, "date": "2026-10-10", "note": "Actual time"}, founder); st != 200 {
						t.Fatal(st, w.Body.String())
					}
				case "stale_evidence":
					r := requestForAccess(base+"/tasks/"+id, founder, cid)
					a, e := s.access(r)
					if e != nil {
						t.Fatal(e)
					}
					if e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
						return appendTaskEvidence(tx, a, id, Attachment{FileName: "proof.txt", Data: []byte("proof")})
					}); e != nil {
						t.Fatal(e)
					}
				case "stale_cas":
					if st, _, w := req(t, s, "PATCH", base+"/tasks/"+id, map[string]any{"version": 1, "description": "Newer update"}, founder); st != 200 {
						t.Fatal(st, w.Body.String())
					}
				}
			}
			var old Task
			db.First(&old, "id = ?", helper)
			original, _ := json.Marshal(originalCommitment(old))
			var auditsBefore int64
			db.Model(&Activity{}).Where("task_id = ? AND action = ?", helper, "task_updated").Count(&auditsBefore)
			r := requestForAccess(base+"/tasks/"+helper, actor, cid)
			a, e := s.access(r)
			if e != nil {
				t.Fatal(e)
			}
			helperStatus := 200
			e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
				prior, e := scopedTask(tx, a, helper)
				if e != nil {
					return e
				}
				f := map[string]json.RawMessage{}
				for k, v := range fields {
					f[k], _ = json.Marshal(v)
				}
				var all []Task
				if e = tx.Where("company_id = ?", cid).Find(&all).Error; e != nil {
					return e
				}
				graph := map[string]Task{}
				for _, row := range all {
					graph[row.ID] = row
				}
				next, e := prepareTaskPatch(tx, a, prior, version, f, graph)
				if e != nil {
					return e
				}
				return commitTaskPatch(tx, a, prior, next, f)
			})
			if e != nil {
				var api *apiError
				if errors.As(e, &api) {
					helperStatus = api.Status
				} else if errors.Is(e, gorm.ErrRecordNotFound) {
					helperStatus = 404
				} else {
					t.Fatal(e)
				}
			}
			payload := map[string]any{"version": version}
			for k, v := range fields {
				payload[k] = v
			}
			directStatus, _, w := req(t, s, "PATCH", base+"/tasks/"+direct, payload, actor)
			if directStatus != helperStatus || helperStatus != tc.status {
				t.Fatal("direct/helper status drift", directStatus, helperStatus, tc.status, w.Body.String())
			}
			var got, other Task
			db.First(&got, "id = ?", helper)
			db.First(&other, "id = ?", direct)
			after, _ := json.Marshal(originalCommitment(got))
			if string(after) != string(original) {
				t.Fatal("original commitment changed", string(after), string(original))
			}
			if got.Version != other.Version || got.Status != other.Status || got.Title != other.Title || got.Progress != other.Progress || got.DueDate != other.DueDate || got.DueAt != other.DueAt || got.DueTimezone != other.DueTimezone || !reflect.DeepEqual(got.Checklist, other.Checklist) {
				t.Fatal("direct/helper resulting state drift", got, other)
			}
			var auditsAfter int64
			db.Model(&Activity{}).Where("task_id = ? AND action = ?", helper, "task_updated").Count(&auditsAfter)
			expected := auditsBefore
			if tc.status == 200 {
				expected++
			}
			if auditsAfter != expected {
				t.Fatal("helper repeated/omitted audit", auditsBefore, auditsAfter)
			}
		})
	}
}

func TestTaskPatchHelperBatchConsumersParity(t *testing.T) {
	for _, consumer := range []string{"checklist", "schedule"} {
		t.Run(consumer, func(t *testing.T) {
			s, db := testServer(t)
			c := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, c)
			uid := me(t, s, c)
			reviewer := addPerson(t, s, c, cid, "batch-reviewer@example.com", "member")
			body := taskBody(uid)
			body["reviewerId"] = reviewer
			body["requiresApproval"] = true
			body["checklist"] = []any{map[string]any{"id": "original", "text": "Kept", "done": true}}
			direct := createTask(t, s, c, cid, body)
			consumerID := createTask(t, s, c, cid, body)
			base := "/api/companies/" + cid
			for _, id := range []string{direct, consumerID} {
				if st, _, w := req(t, s, "POST", base+"/tasks/"+id+"/time", map[string]any{"hours": 1, "date": "2026-10-10", "note": "Preserve accepted evidence"}, c); st != 200 {
					t.Fatal(st, w.Body.String())
				}
			}
			switch consumer {
			case "checklist":
				_, created, _ := req(t, s, "POST", base+"/task-templates", templateBody(uid, "checklist"), c)
				tpl := created["id"].(string)
				if st, _, w := req(t, s, "PATCH", base+"/tasks/"+direct, map[string]any{"version": 2, "checklist": []any{map[string]any{"id": "original", "text": "Kept", "done": true}, map[string]any{"id": "fresh", "text": "Check delivery", "done": false}}}, c); st != 200 {
					t.Fatal(st, w.Body.String())
				}
				input := map[string]any{"retryKey": "parity-check", "version": 2, "templateId": tpl, "expectedTemplateVersion": 1}
				for i := 0; i < 2; i++ {
					if st, _, w := req(t, s, "POST", base+"/tasks/"+consumerID+"/checklists/apply", input, c); st != 200 {
						t.Fatal(st, w.Body.String())
					}
				}
			case "schedule":
				fields := map[string]any{"version": 2, "startDate": "2026-10-12", "dueDate": "2026-10-22", "deadlineMode": "all_day", "dueAt": "", "dueTimezone": "", "deadlineChangeReason": "Reviewed delivery adjustment"}
				if st, _, w := req(t, s, "PATCH", base+"/tasks/"+direct, fields, c); st != 200 {
					t.Fatal(st, w.Body.String())
				}
				st, result, w := req(t, s, "POST", base+"/task-schedule/preview", scheduleBody(consumerID, 2), c)
				if st != 200 {
					t.Fatal(st, w.Body.String())
				}
				proposal := result["proposal"].(map[string]any)["id"].(string)
				input := map[string]any{"retryKey": "parity-apply", "proposalId": proposal, "expectedProposalVersion": 1}
				for i := 0; i < 2; i++ {
					if st, _, w := req(t, s, "POST", base+"/task-schedule/apply", input, c); st != 200 {
						t.Fatal(st, w.Body.String())
					}
				}
			}
			var directRow, consumerRow Task
			db.First(&directRow, "id = ?", direct)
			db.First(&consumerRow, "id = ?", consumerID)
			if directRow.Version != 3 || consumerRow.Version != 3 || directRow.ActualHours != consumerRow.ActualHours || directRow.ReviewerID != consumerRow.ReviewerID || directRow.RequiresApproval != consumerRow.RequiresApproval || directRow.Status != consumerRow.Status || !reflect.DeepEqual(currentCommitment(directRow), currentCommitment(consumerRow)) || !reflect.DeepEqual(originalCommitment(directRow), originalCommitment(consumerRow)) {
				t.Fatal("consumer helper drift", directRow, consumerRow)
			}
			if len(directRow.Checklist) != len(consumerRow.Checklist) {
				t.Fatal("checklist count drift")
			}
			for i, v := range directRow.Checklist {
				if v.Text != consumerRow.Checklist[i].Text || v.Done != consumerRow.Checklist[i].Done {
					t.Fatal("checklist content drift")
				}
			}
			for _, id := range []string{direct, consumerID} {
				var n int64
				db.Model(&Activity{}).Where("task_id = ? AND action = ?", id, "task_updated").Count(&n)
				if n != 1 {
					t.Fatal("duplicate/missing task update", consumer, id, n)
				}
			}
		})
	}
}
