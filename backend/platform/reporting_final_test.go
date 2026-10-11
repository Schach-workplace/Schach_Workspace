package platform

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

// Exercises the delivery producer and public candidate query, not only projection.
func TestReportReadyPublicAttention(t *testing.T) {
	for _, mode := range []string{"ready", "expired", "source_loss", "epoch", "recipient", "company"} {
		t.Run(mode, func(t *testing.T) {
			s, db := testServer(t)
			store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
			if e != nil {
				t.Fatal(e)
			}
			s.opts.ReportArtifactStore = store
			ownerCookie := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, ownerCookie)
			owner := me(t, s, ownerCookie)
			uid := addPerson(t, s, ownerCookie, cid, "inbox-report@example.com", "member")
			c := login(t, s, "inbox-report@example.com")
			body := taskBody(uid)
			body["dueDate"] = "2026-09-20"
			body["startDate"] = "2026-09-01"
			task := createTask(t, s, ownerCookie, cid, body)
			observeFinalReportTask(t, db, task)
			root := "/api/companies/" + cid
			reports := root + "/reports"
			b := financeOK(t, s, "POST", reports+"/history/snapshots", map[string]any{"retryKey": "inbox-snapshot", "request": historyRequest()}, c)
			var sources int64
			if e := db.Model(&ReportSnapshotSource{}).Where("snapshot_id=? AND task_id=?", b["snapshotId"], task).Count(&sources).Error; e != nil || sources != 1 {
				t.Fatal("fixture source absent", sources, e)
			}
			input := map[string]any{"retryKey": "inbox-export", "snapshotId": b["snapshotId"], "csvSchemaVersion": 1}
			b = financeOK(t, s, "POST", reports+"/exports", input, c)
			id := b["job"].(map[string]any)["id"].(string)
			retry := financeOK(t, s, "POST", reports+"/exports", input, c)
			if retry["job"].(map[string]any)["id"] != id {
				t.Fatal("export retry duplicated")
			}
			job, token, e := s.claimReportExport(t.Context(), time.Now().UTC())
			if e != nil {
				t.Fatal(e)
			}
			if e = s.generateReportExport(t.Context(), job, token); e != nil {
				t.Fatal(e)
			}
			if n, e := s.RunReportDelivery(t.Context(), time.Now().UTC(), 100); e != nil || n != 1 {
				t.Fatal(n, e)
			}
			if n, e := s.RunReportDelivery(t.Context(), time.Now().UTC(), 100); e != nil || n != 0 {
				t.Fatal("delivery duplicated", n, e)
			}
			assertList := func(path string, cookieMode bool, want int) {
				t.Helper()
				cookie := c
				if cookieMode {
					cookie = ownerCookie
				}
				st, b, w := req(t, s, "GET", path, nil, cookie)
				if st != 200 {
					t.Fatalf("public Inbox status=%d", st)
				}
				count := 0
				for _, v := range b["items"].([]any) {
					x := v.(map[string]any)
					if x["sourceKind"] == "report_export" {
						count++
						if x["sourceId"] != id || x["recipientId"] != uid || x["title"] != "Report ready" || x["canRoute"] == true || x["canDecide"] == true || !strings.Contains(x["link"].(string), "job="+id) {
							t.Fatal("wrong ready report projection")
						}
					}
				}
				if count != want {
					t.Fatalf("public Inbox report count=%d want=%d; responseBytes=%d", count, want, w.Body.Len())
				}
			}
			assertList(root+"/attention", false, 1)
			assertList(root+"/attention?state=all", false, 1)
			switch mode {
			case "expired":
				if e = db.Model(&ReportArtifact{}).Where("job_id=?", id).Update("expires_at", time.Now().UTC().Add(-time.Second)).Error; e != nil {
					t.Fatal(e)
				}
			case "source_loss":
				if e = db.Model(&Task{}).Where("id=?", task).Update("owner_id", owner).Error; e != nil {
					t.Fatal(e)
				}
			case "epoch":
				if e = db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, uid).Update("access_epoch", gorm.Expr("access_epoch+1")).Error; e != nil {
					t.Fatal(e)
				}
			case "recipient":
				assertList(root+"/attention?state=all", true, 0)
				return
			case "company":
				b := financeOK(t, s, "POST", "/api/companies", map[string]any{"name": "Other Inbox company", "slug": "other-inbox", "industry": "Test", "timezone": "UTC"}, ownerCookie)
				assertList("/api/companies/"+b["id"].(string)+"/attention?state=all", true, 0)
				return
			default:
				return
			}
			assertList(root+"/attention?state=all", false, 0)
		})
	}
}

// The writer commits real authority changes synchronously after the first output
// chunk. If output held authority locks this gate could not complete; no sleeps.
func TestCurrentReportCSVChunkAuthority(t *testing.T) {
	for _, mode := range []string{"unchanged", "membership", "session", "source_later", "reference_outside_period", "frozen_values"} {
		t.Run(mode, func(t *testing.T) {
			s, db := testServer(t)
			oc := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, oc)
			owner := me(t, s, oc)
			uid := addPerson(t, s, oc, cid, "csv-report@example.com", "member")
			c := login(t, s, "csv-report@example.com")
			body := taskBody(uid)
			body["dueDate"] = "2026-09-20"
			body["startDate"] = "2026-09-01"
			templateID := createTask(t, s, oc, cid, body)
			var template Task
			if e := db.First(&template, "id=?", templateID).Error; e != nil {
				t.Fatal(e)
			}
			body["dueDate"] = "2026-12-20"
			reference := createTask(t, s, oc, cid, body)
			rows := make([]Task, 201)
			now := time.Now().UTC()
			for i := range rows {
				rows[i] = template
				rows[i].ID = newID("task")
				rows[i].Code = fmt.Sprintf("CSV%03d", i)
				rows[i].Title = fmt.Sprintf("csv-row-%03d", i)
				rows[i].Description = strings.Repeat("x", 1024)
				rows[i].CreatedAt = now.Add(-time.Duration(i) * time.Second).Format(time.RFC3339Nano)
			}
			rows[0].Title = "=FORMULA"
			rows[200].Title = "PRIVATE-LATER-ROW"
			rows[200].Description = "PRIVATE-LATER-DESCRIPTION"
			rows[200].Dependencies = []string{reference}
			if e := db.Create(&rows).Error; e != nil {
				t.Fatal(e)
			}
			if e := db.Delete(&Task{}, "id=?", templateID).Error; e != nil {
				t.Fatal(e)
			}
			root := "/api/companies/" + cid + "/reports/tasks"
			filters := "?from=2026-09-01&to=2026-09-30"
			b := financeOK(t, s, "GET", root+"/summary"+filters, nil, c)
			token := b["snapshot"].(string)
			path := root + "/export" + filters + "&snapshot=" + token
			committed := false
			w := &reportRevokingWriter{ResponseRecorder: httptest.NewRecorder(), revoke: func() {
				e := db.Transaction(func(tx *gorm.DB) error {
					if e := lockCompany(tx, cid); e != nil {
						return e
					}
					switch mode {
					case "membership":
						return tx.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, uid).Update("active", false).Error
					case "session":
						return tx.Where("user_id=?", uid).Delete(&SessionRecord{}).Error
					case "source_later":
						return tx.Model(&Task{}).Where("id=?", rows[200].ID).Update("owner_id", owner).Error
					case "reference_outside_period":
						return tx.Model(&Task{}).Where("id=?", reference).Update("owner_id", owner).Error
					case "frozen_values":
						return tx.Model(&Task{}).Where("id=?", rows[200].ID).Update("title", "UNSEEN-NEW-TITLE").Error
					}
					return nil
				})
				if e != nil {
					t.Fatal(e)
				}
				committed = true
			}}
			r := httptest.NewRequest("GET", path, nil)
			r.AddCookie(c)
			s.ServeHTTP(w, r)
			if !committed || w.Code != 200 || !strings.Contains(w.Body.String(), "'=FORMULA") {
				t.Fatal("first authorized bytes/formula protection absent", w.Code, committed)
			}
			if strings.Contains(w.Body.String(), "\"error\"") {
				t.Fatal("JSON appended after CSV")
			}
			switch mode {
			case "unchanged", "frozen_values":
				records, e := csv.NewReader(strings.NewReader(w.Body.String())).ReadAll()
				if e != nil || len(records) != 202 || !strings.Contains(w.Body.String(), "PRIVATE-LATER-ROW") || strings.Contains(w.Body.String(), "UNSEEN-NEW-TITLE") {
					t.Fatal("frozen complete export changed", len(records), e)
				}
			default:
				if strings.Contains(w.Body.String(), "PRIVATE-LATER-ROW") || strings.Contains(w.Body.String(), "PRIVATE-LATER-DESCRIPTION") {
					t.Fatal("later cached private rows emitted after committed authority loss")
				}
				if w.chunks != 1 || w.Body.Len() > 64<<10 {
					t.Fatal("revoked stream exceeded its first bounded chunk", w.chunks, w.Body.Len())
				}
				st, _, out := req(t, s, "GET", path, nil, c)
				if st < 400 || out.Header().Get("Content-Type") == "text/csv; charset=utf-8" {
					t.Fatal("revoked retry started CSV", st)
				}
			}
		})
	}
}

func TestReportRuntimeRecipientDepartureIsolation(t *testing.T) {
	for _, mode := range []string{"departure", "suspension"} {
		t.Run(mode, func(t *testing.T) {
			s, db := testServer(t)
			store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
			if e != nil {
				t.Fatal(e)
			}
			s.opts.ReportArtifactStore = store
			c := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, c)
			owner := me(t, s, c)
			a := addPerson(t, s, c, cid, "healthy-report@example.com", "member")
			b := addPerson(t, s, c, cid, "departing-report@example.com", "member")
			ac := login(t, s, "healthy-report@example.com")
			bc := login(t, s, "departing-report@example.com")
			body := taskBody(a)
			body["dueDate"] = "2026-09-20"
			body["startDate"] = "2026-09-01"
			body["collaborators"] = []string{b}
			sharedTask := createTask(t, s, c, cid, body)
			observeFinalReportTask(t, db, sharedTask)
			root := "/api/companies/" + cid + "/reports"
			cfg := savedConfig(owner)
			cfg["recipientIds"] = []string{b, a}
			out := financeOK(t, s, "POST", root+"/definitions", map[string]any{"retryKey": "isolated-definition", "configuration": cfg}, c)
			did := out["definition"].(map[string]any)["id"].(string)
			financeOK(t, s, "PATCH", root+"/definitions/"+did+"/schedule", map[string]any{"retryKey": "isolated-schedule", "expectedDefinitionVersion": 1, "expectedScheduleVersion": 0, "weekdays": []int{0, 1, 2, 3, 4, 5, 6}, "localMinute": "00:00", "scheduleZone": "UTC", "state": "active"}, c)
			now := time.Now().UTC()
			if e = db.Model(&ReportSchedule{}).Where("definition_id=?", did).Update("next_occurrence_utc", now.Add(-48*time.Hour)).Error; e != nil {
				t.Fatal(e)
			}
			if n, e := s.RunReportSchedules(t.Context(), now, 100); e != nil || n != 2 {
				t.Fatal("initial recipients not eligible", n, e)
			}
			for i := 0; i < 2; i++ {
				job, token, e := s.claimReportExport(t.Context(), time.Now().UTC())
				if e != nil {
					t.Fatal(e)
				}
				if e = s.generateReportExport(t.Context(), job, token); e != nil {
					t.Fatal(e)
				}
			}
			var aj, bj ReportExportJob
			if e = db.First(&aj, "definition_id=? AND recipient_id=?", did, a).Error; e != nil {
				t.Fatal(e)
			}
			if e = db.First(&bj, "definition_id=? AND recipient_id=?", did, b).Error; e != nil {
				t.Fatal(e)
			}
			if mode == "departure" {
				e = db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, b).Update("active", false).Error
			} else {
				e = db.Model(&User{}).Where("id=?", b).Update("suspended", true).Error
			}
			if e != nil {
				t.Fatal(e)
			}
			for _, path := range []string{root + "/exports/" + aj.ID, root + "/artifacts/" + aj.ArtifactID} {
				st, _, _ := req(t, s, "GET", path, nil, ac)
				if st != 200 {
					t.Fatalf("unrelated %s denied healthy A output: status=%d", mode, st)
				}
			}
			for _, path := range []string{root + "/exports/" + bj.ID, root + "/artifacts/" + bj.ArtifactID} {
				st, _, _ := req(t, s, "GET", path, nil, bc)
				if st != 401 && st != 403 {
					t.Fatal("ineligible B output readable", st)
				}
			}
			if n, e := s.RunReportDelivery(t.Context(), time.Now().UTC(), 100); e != nil || n != 1 {
				t.Fatal("ineligible B poisoned A delivery", n, e)
			}
			if n, e := s.RunReportDelivery(t.Context(), time.Now().UTC(), 100); e != nil || n != 0 {
				t.Fatal("delivery retry duplicated", n, e)
			}
			var d SavedReportDefinition
			if e = db.First(&d, "id=?", did).Error; e != nil {
				t.Fatal(e)
			}
			st, _, _ := req(t, s, "POST", root+"/definitions", map[string]any{"retryKey": "invalid-create", "configuration": cfg}, c)
			if st != 422 {
				t.Fatal("explicit create accepted ineligible recipient", st)
			}
			st, _, _ = req(t, s, "PATCH", root+"/definitions/"+did, map[string]any{"retryKey": "invalid-save", "expectedVersion": d.Version, "configuration": cfg, "state": "active"}, c)
			if st != 422 {
				t.Fatal("explicit save accepted ineligible recipient", st)
			}
			input := map[string]any{"retryKey": "healthy-manual-generation", "expectedVersion": d.Version}
			manual := financeOK(t, s, "POST", root+"/definitions/"+did+"/generate", input, c)
			retry := financeOK(t, s, "POST", root+"/definitions/"+did+"/generate", input, c)
			if manual["snapshotId"] != retry["snapshotId"] {
				t.Fatal("generation retry duplicated")
			}
			later := now.Add(25 * time.Hour)
			if n, e := s.RunReportSchedules(t.Context(), later, 100); e != nil || n != 1 {
				t.Fatal("ineligible B paused A later occurrence", n, e)
			}
			if n, e := s.RunReportSchedules(t.Context(), later, 100); e != nil || n != 0 {
				t.Fatal("occurrence retry duplicated", n, e)
			}
			var schedule ReportSchedule
			if e = db.First(&schedule, "definition_id=?", did).Error; e != nil || schedule.State != "active" {
				t.Fatal("healthy schedule retired", e)
			}
			var failures, healthyJobs, bJobs int64
			db.Model(&ReportScheduleFailure{}).Where("definition_id=? AND recipient_id=? AND state='failed'", did, b).Count(&failures)
			db.Model(&ReportExportJob{}).Where("definition_id=? AND recipient_id=?", did, a).Count(&healthyJobs)
			db.Model(&ReportExportJob{}).Where("definition_id=? AND recipient_id=?", did, b).Count(&bJobs)
			if failures != 1 || healthyJobs != 2 || bJobs != 1 {
				t.Fatal("recipient occurrence isolation/dedup lost", failures, healthyJobs, bJobs)
			}
			job, token, e := s.claimReportExport(t.Context(), later)
			if e != nil {
				t.Fatal(e)
			}
			if job.RecipientID != a {
				t.Fatal("ineligible recipient generated")
			}
			if e = s.generateReportExport(t.Context(), job, token); e != nil {
				t.Fatal(e)
			}
			if n, e := s.RunReportDelivery(t.Context(), later, 100); e != nil || n != 1 {
				t.Fatal("healthy later output did not deliver", n, e)
			}
		})
	}
}

// A deliberate legacy observation places the fictional task in the completed
// report period without rewriting production time or inventing acceptance.
func observeFinalReportTask(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	if e := db.Transaction(func(tx *gorm.DB) error {
		var task Task
		if e := tx.First(&task, "id=?", id).Error; e != nil {
			return e
		}
		if e := tx.Where("task_id=?", id).Delete(&TaskFact{}).Error; e != nil {
			return e
		}
		if e := tx.Where("task_id=?", id).Delete(&TaskHistoryCoverage{}).Error; e != nil {
			return e
		}
		return ensureObservedTaskState(tx, task, time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC))
	}); e != nil {
		t.Fatal(e)
	}
}

// Recipient isolation must not weaken the existing wider invalidation fences.
func TestReportRuntimeWiderInvalidation(t *testing.T) {
	for _, mode := range []string{"owner_departure", "owner_source_loss", "definition_revision", "recipient_removed", "schedule_version", "artifact_expired"} {
		t.Run(mode, func(t *testing.T) {
			s, db := testServer(t)
			store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
			if e != nil {
				t.Fatal(e)
			}
			s.opts.ReportArtifactStore = store
			c := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, c)
			recipient := me(t, s, c)
			owner := addPerson(t, s, c, cid, "report-config-owner@example.invalid", "admin")
			oc := login(t, s, "report-config-owner@example.invalid")
			body := taskBody(owner)
			body["startDate"] = "2026-09-01"
			body["dueDate"] = "2026-09-20"
			task := createTask(t, s, c, cid, body)
			observeFinalReportTask(t, db, task)
			root := "/api/companies/" + cid + "/reports"
			cfg := savedConfig(recipient)
			out := financeOK(t, s, "POST", root+"/definitions", map[string]any{"retryKey": "wide-def", "configuration": cfg}, oc)
			did := out["definition"].(map[string]any)["id"].(string)
			financeOK(t, s, "PATCH", root+"/definitions/"+did+"/schedule", map[string]any{"retryKey": "wide-schedule", "expectedDefinitionVersion": 1, "expectedScheduleVersion": 0, "weekdays": []int{0, 1, 2, 3, 4, 5, 6}, "localMinute": "00:00", "scheduleZone": "UTC", "state": "active"}, oc)
			if e = db.Model(&ReportSchedule{}).Where("definition_id=?", did).Update("next_occurrence_utc", time.Now().UTC().Add(-48*time.Hour)).Error; e != nil {
				t.Fatal(e)
			}
			if n, e := s.RunReportSchedules(t.Context(), time.Now().UTC(), 100); e != nil || n != 1 {
				t.Fatal(n, e)
			}
			job, lease, e := s.claimReportExport(t.Context(), time.Now().UTC())
			if e != nil {
				t.Fatal(e)
			}
			if e = s.generateReportExport(t.Context(), job, lease); e != nil {
				t.Fatal(e)
			}
			var ready ReportExportJob
			if e = db.First(&ready, "id=?", job.ID).Error; e != nil {
				t.Fatal(e)
			}
			financeOK(t, s, "GET", root+"/exports/"+ready.ID, nil, c)
			switch mode {
			case "owner_departure":
				e = db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, owner).Update("active", false).Error
			case "owner_source_loss":
				e = db.Transaction(func(tx *gorm.DB) error {
					if e := tx.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, owner).Update("role", "member").Error; e != nil {
						return e
					}
					return tx.Model(&Task{}).Where("id=?", task).Update("owner_id", recipient).Error
				})
			case "definition_revision":
				e = db.Model(&SavedReportDefinition{}).Where("id=?", did).Update("version", gorm.Expr("version+1")).Error
			case "recipient_removed":
				var d SavedReportDefinition
				if e = db.First(&d, "id=?", did).Error; e != nil {
					t.Fatal(e)
				}
				d.Configuration.RecipientIDs = []string{owner}
				raw, err := json.Marshal(d.Configuration)
				if err != nil {
					t.Fatal(err)
				}
				e = db.Model(&d).Update("configuration", string(raw)).Error
			case "schedule_version":
				e = db.Model(&ReportSchedule{}).Where("definition_id=?", did).Update("version", gorm.Expr("version+1")).Error
			case "artifact_expired":
				e = db.Model(&ReportArtifact{}).Where("job_id=?", job.ID).Update("expires_at", time.Now().UTC().Add(-time.Second)).Error
			}
			if e != nil {
				t.Fatal(e)
			}
			st, _, w := req(t, s, "GET", root+"/artifacts/"+ready.ArtifactID, nil, c)
			if st < 400 || strings.Contains(w.Body.String(), "schema,basis") {
				t.Fatal("wider invalidation disclosed ready bytes", st)
			}
			if n, e := s.RunReportDelivery(t.Context(), time.Now().UTC(), 100); e != nil || n != 0 {
				t.Fatal("wider invalidation delivered", n, e)
			}
		})
	}
}
