package platform

import (
	"context"
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
