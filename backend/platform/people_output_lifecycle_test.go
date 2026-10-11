package platform

import (
	"context"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPeopleRejoinRetiresRawFinanceReportAndGoalOutputs(t *testing.T) {
	f := newFinanceFixture(t)
	admin := f.cookie
	f.cookie, f.uid = f.person(t, "output-owner@example.invalid", "admin", f.department)
	expense := f.addExpense(t, 12345, f.cookie)
	extraction := readyReceiptExtraction(t, f)
	var raw FinanceAssistanceJob
	if e := f.db.First(&raw, "id=?", extraction).Error; e != nil {
		t.Fatal(e)
	}
	current := login(t, f.s, "output-owner@example.invalid")
	financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+extraction, nil, current)
	goal := createMeasuredGoal(t, f.s, admin, f.cid, f.uid)
	preference := f.base() + "/goals/" + goal + "/reminder-preference"
	financeOK(t, f.s, "PATCH", preference, map[string]any{"retryKey": "reviewed-opt-in", "expectedVersion": 0, "reason": "Personal reminder", "enabled": true, "cadence": "weekly", "weekday": 1, "monthDay": 1, "localTime": "09:00"}, f.cookie)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.ReportArtifactStore = store
	reports := f.base() + "/reports"
	snapshot := financeOK(t, f.s, "POST", reports+"/history/snapshots", map[string]any{"retryKey": "retained-snapshot", "request": historyRequest()}, f.cookie)
	out := financeOK(t, f.s, "POST", reports+"/exports", map[string]any{"retryKey": "personal-export", "snapshotId": snapshot["snapshotId"], "csvSchemaVersion": 1}, f.cookie)
	id := out["job"].(map[string]any)["id"].(string)
	job, lease, e := f.s.claimReportExport(context.Background(), time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	if e = f.s.generateReportExport(context.Background(), job, lease); e != nil {
		t.Fatal(e)
	}
	var before ReportExportJob
	f.db.First(&before, "id=?", id)
	if before.State != "ready" || before.ArtifactID == "" {
		t.Fatal("report fixture not ready")
	}
	for _, active := range []bool{false, true} {
		financeOK(t, f.s, "PATCH", f.base()+"/people/"+f.uid, map[string]any{"active": active}, admin)
	}
	fresh := login(t, f.s, "output-owner@example.invalid")
	for _, path := range []string{f.base() + "/finance/receipt-extractions/" + extraction, f.base() + "/finance/intakes/" + raw.SourceID, reports + "/artifacts/" + before.ArtifactID} {
		if st, _, _ := req(t, f.s, "GET", path, nil, fresh); st != 404 {
			t.Fatalf("old personal source %s returned%d", path, st)
		}
	}
	for _, path := range []string{"/finance/receipt-extractions", "/finance/intakes"} {
		v := financeOK(t, f.s, "GET", f.base()+path+"?limit=1", nil, fresh)
		if len(v["items"].([]any)) != 0 {
			t.Fatal("retired raw source occupied current queue")
		}
	}
	var after ReportExportJob
	var artifact ReportArtifact
	var pref GoalReminderPreference
	f.db.First(&after, "id=?", id)
	f.db.First(&artifact, "id=?", before.ArtifactID)
	f.db.First(&pref, "company_id=? AND goal_id=? AND user_id=?", f.cid, goal, f.uid)
	if after.State != "cancelled" || artifact.State != "revoked" || pref.Enabled {
		t.Fatal("personal outputs revived after rejoin")
	}
	retained := financeOK(t, f.s, "GET", f.base()+"/expenses/"+expense, nil, fresh)
	if retained["expense"].(map[string]any)["amountMinor"] != float64(12345) {
		t.Fatal("retained financial amount changed")
	}
}

func TestPeopleReportOwnerDistinctFromRecipient(t *testing.T) {
	for _, mode := range []string{"scope", "rejoin", "final", "stream"} {
		for _, scheduled := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s/scheduled=%t", mode, scheduled), func(t *testing.T) {
				s, db := testServer(t)
				actor := login(t, s, "founder@example.com")
				cid := firstCompany(t, s, actor)
				recipient := me(t, s, actor)
				uid := addPerson(t, s, actor, cid, "report-owner@example.invalid", "admin")
				owner := login(t, s, "report-owner@example.invalid")
				root := "/api/companies/" + cid
				reports := root + "/reports"
				store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
				if e != nil {
					t.Fatal(e)
				}
				s.opts.ReportArtifactStore = store
				def := financeOK(t, s, "POST", reports+"/definitions", map[string]any{"retryKey": "owner-def", "configuration": savedConfig(recipient)}, owner)["definition"].(map[string]any)["id"].(string)
				financeOK(t, s, "PATCH", reports+"/definitions/"+def+"/schedule", map[string]any{"retryKey": "owner-schedule", "expectedDefinitionVersion": 1, "expectedScheduleVersion": 0, "weekdays": []int{0, 1, 2, 3, 4, 5, 6}, "localMinute": "00:00", "scheduleZone": "UTC", "state": "active"}, owner)
				db.Model(&ReportSchedule{}).Where("definition_id=?", def).Update("next_occurrence_utc", time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
				if _, e = s.RunReportSchedules(t.Context(), time.Now().UTC(), 100); e != nil {
					t.Fatal(e)
				}
				var original ReportExportJob
				if e = db.First(&original, "definition_id=? AND recipient_id=?", def, recipient).Error; e != nil {
					t.Fatal(e)
				}
				input := map[string]any{"retryKey": "manual-owner-export", "snapshotId": original.SnapshotID, "csvSchemaVersion": 1}
				if !scheduled {
					financeOK(t, s, "POST", reports+"/exports/"+original.ID+"/cancel", map[string]any{"retryKey": "cancel-scheduled"}, actor)
					financeOK(t, s, "POST", reports+"/exports", input, actor)
				}
				job, lease, e := s.claimReportExport(t.Context(), time.Now().UTC())
				if e != nil {
					t.Fatal(e)
				}
				if mode == "final" {
					s.opts.ReportArtifactStore = peoplePublishingStore{ReportArtifactStore: store, cross: func() { financeOK(t, s, "PATCH", root+"/people/"+uid, map[string]any{"role": "ceo"}, actor) }}
					if e = s.generateReportExport(t.Context(), job, lease); e == nil {
						t.Fatal("owner epoch crossed final publication")
					}
					var count int64
					db.Model(&ReportArtifact{}).Where("job_id=?", job.ID).Count(&count)
					if count != 0 {
						t.Fatal("crossed final artifact published")
					}
					financeOK(t, s, "GET", reports+"/history/snapshots/"+job.SnapshotID, nil, actor)
					return
				}
				if e = s.generateReportExport(t.Context(), job, lease); e != nil {
					t.Fatal(e)
				}
				var ready ReportExportJob
				db.First(&ready, "id=?", job.ID)
				financeOK(t, s, "GET", reports+"/exports/"+job.ID, nil, actor)
				if mode == "stream" {
					var artifact ReportArtifact
					db.First(&artifact, "id=?", ready.ArtifactID)
					if e = store.Delete(t.Context(), artifact.StoreKey); e != nil {
						t.Fatal(e)
					}
					data := strings.Repeat("fictional bounded report row\n", 12000)
					if e = store.Put(t.Context(), artifact.StoreKey, strings.NewReader(data)); e != nil {
						t.Fatal(e)
					}
					db.Model(&artifact).Update("length", len(data))
					out := &reportRevokingWriter{ResponseRecorder: httptest.NewRecorder(), revoke: func() { financeOK(t, s, "PATCH", root+"/people/"+uid, map[string]any{"role": "ceo"}, actor) }}
					request := httptest.NewRequest("GET", reports+"/artifacts/"+artifact.ID, nil)
					request.AddCookie(actor)
					s.ServeHTTP(out, request)
					if out.Code != 200 || out.chunks != 1 || out.Body.Len() != 64<<10 {
						t.Fatal("owner change did not stop later chunk", out.Code, out.chunks, out.Body.Len())
					}
				} else if mode == "scope" {
					financeOK(t, s, "PATCH", root+"/people/"+uid, map[string]any{"role": "ceo"}, actor)
				} else {
					for _, active := range []bool{false, true} {
						financeOK(t, s, "PATCH", root+"/people/"+uid, map[string]any{"active": active}, actor)
					}
				}
				var retired ReportExportJob
				var artifact ReportArtifact
				db.First(&retired, "id=?", job.ID)
				db.First(&artifact, "id=?", ready.ArtifactID)
				if retired.State != "cancelled" || artifact.State != "revoked" {
					t.Fatal("owner-bound consumable survived", retired.State, artifact.State)
				}
				for _, path := range []string{reports + "/exports/" + job.ID, reports + "/artifacts/" + ready.ArtifactID} {
					if status, _, _ := req(t, s, "GET", path, nil, actor); status == 200 {
						t.Fatal("old owner output readable")
					}
				}
				if !scheduled {
					if status, _, _ := req(t, s, "POST", reports+"/exports", input, actor); status == 200 {
						t.Fatal("canonical replay revived old owner output")
					}
				}
				financeOK(t, s, "GET", reports+"/history/snapshots/"+job.SnapshotID, nil, actor)
			})
		}
	}
}

type peoplePublishingStore struct {
	ReportArtifactStore
	cross func()
}

func (s peoplePublishingStore) Put(ctx context.Context, key string, r io.Reader) error {
	if e := s.ReportArtifactStore.Put(ctx, key, r); e != nil {
		return e
	}
	s.cross()
	return nil
}
