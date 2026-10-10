package platform

import (
	"context"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestReportSchedulesDSTAndCatchup(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	base := "/api/companies/" + cid + "/reports/definitions"
	st, b, w := req(t, s, "POST", base, map[string]any{"retryKey": "schedule-def", "configuration": savedConfig(uid)}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	id := b["definition"].(map[string]any)["id"].(string)
	input := map[string]any{"retryKey": "schedule-one", "expectedDefinitionVersion": 1, "expectedScheduleVersion": 0, "weekdays": []int{1}, "localMinute": "09:00", "scheduleZone": "Asia/Kolkata", "state": "active"}
	st, _, w = req(t, s, "PATCH", base+"/"+id+"/schedule", input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
}

func TestReportLocalDeliveryDedup(t *testing.T) {
	s, db := testServer(t)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	s.opts.ReportArtifactStore = store
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/reports"
	st, b, w := req(t, s, "POST", base+"/history/snapshots", map[string]any{"retryKey": "delivery-snapshot", "request": historyRequest()}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	st, _, w = req(t, s, "POST", base+"/exports", map[string]any{"retryKey": "delivery-export", "snapshotId": b["snapshotId"], "csvSchemaVersion": 1}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	job, token, e := s.claimReportExport(context.Background(), time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	if e := s.generateReportExport(context.Background(), job, token); e != nil {
		t.Fatal(e)
	}
	var item AttentionItem
	item = AttentionItem{ID: newID("attention"), CompanyID: cid, RecipientID: job.RecipientID, SourceKind: "report_export", SourceID: job.ID, Kind: "report_ready", OccurrenceKey: "report:" + job.ID, State: "open", Version: 1, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	if e := db.Create(&item).Error; e != nil {
		t.Fatal(e)
	}
	var a *access
	db.Transaction(func(tx *gorm.DB) error {
		lockCompany(tx, cid)
		var e error
		a, e = currentAttentionActorLocked(tx, cid, job.RecipientID)
		return e
	})
	_, e = attentionSource(db, a, item)
	if e != nil {
		t.Fatal("report-ready source missing", e)
	}
}

func TestReportSchedulesResolvedDSTPolicy(t *testing.T) {
	for _, x := range []struct{ date, minute, zone, want string }{{"2026-11-01", "01:30", "America/New_York", "2026-11-01T05:30:00Z"}, {"2026-03-08", "02:30", "America/New_York", "2026-03-08T07:00:00Z"}, {"2026-12-01", "09:00", "Asia/Kolkata", "2026-12-01T03:30:00Z"}, {"2011-12-30", "09:00", "Pacific/Apia", "2011-12-30T10:00:00Z"}} {
		got, e := resolveReportOccurrence(x.date, x.minute, x.zone)
		if e != nil || got.Format(time.RFC3339) != x.want {
			t.Fatal(x, got, e)
		}
	}
}
func TestReportWorkerIsolationAndShutdown(t *testing.T) {
	s, _ := testServer(t)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	s.opts.ReportArtifactStore = store
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.RunReportWorker(ctx); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("report worker leaked after cancellation")
	}
}

func TestReportSchedulesRecipientIsolationAndCatchup(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := me(t, s, c)
	other := addPerson(t, s, c, cid, "report-member@example.com", "member")
	for _, uid := range []string{owner, other} {
		body := taskBody(uid)
		body["dueDate"] = "2026-09-20"
		body["startDate"] = "2026-09-01"
		createTask(t, s, c, cid, body)
	}
	db.Where("company_id=?", cid).Delete(&TaskFact{})
	db.Where("company_id=?", cid).Delete(&TaskHistoryCoverage{})
	var tasks []Task
	db.Where("company_id=?", cid).Find(&tasks)
	for _, task := range tasks {
		if e := db.Transaction(func(tx *gorm.DB) error {
			return ensureObservedTaskState(tx, task, time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC))
		}); e != nil {
			t.Fatal(e)
		}
	}
	cfg := savedConfig(owner)
	cfg["recipientIds"] = []string{owner, other}
	base := "/api/companies/" + cid + "/reports/definitions"
	st, b, w := req(t, s, "POST", base, map[string]any{"retryKey": "recipient-def", "configuration": cfg}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	id := b["definition"].(map[string]any)["id"].(string)
	st, b, w = req(t, s, "PATCH", base+"/"+id+"/schedule", map[string]any{"retryKey": "recipient-schedule", "expectedDefinitionVersion": 1, "expectedScheduleVersion": 0, "weekdays": []int{0, 1, 2, 3, 4, 5, 6}, "localMinute": "00:00", "scheduleZone": "UTC", "state": "active"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	db.Model(&ReportSchedule{}).Where("definition_id=?", id).Update("next_occurrence_utc", time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	now := time.Now().UTC()
	n, e := s.RunReportSchedules(context.Background(), now, 100)
	if e != nil || n != 2 {
		t.Fatal(n, e)
	}
	n, e = s.RunReportSchedules(context.Background(), now, 100)
	if e != nil || n != 0 {
		t.Fatal("duplicate tick", n, e)
	}
	var jobs []ReportExportJob
	db.Where("definition_id=?", id).Find(&jobs)
	if len(jobs) != 2 {
		t.Fatal(jobs)
	}
	counts := map[string]float64{}
	for _, job := range jobs {
		var snap HistoricalReportSnapshot
		db.First(&snap, "id=?", job.SnapshotID)
		counts[job.RecipientID] = snap.Summary.Metrics["state.cohort"].Value
	}
	if counts[owner] != 2 || counts[other] != 1 {
		t.Fatal("recipient inherited owner scope", counts)
	}
}

func TestReportWorkerCleanupRetainsHistory(t *testing.T) {
	s, db := testServer(t)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	s.opts.ReportArtifactStore = store
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/reports"
	st, b, w := req(t, s, "POST", base+"/history/snapshots", map[string]any{"retryKey": "cleanup-snap", "request": historyRequest()}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	sid := b["snapshotId"].(string)
	st, _, w = req(t, s, "POST", base+"/exports", map[string]any{"retryKey": "cleanup-job", "snapshotId": sid, "csvSchemaVersion": 1}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	job, token, e := s.claimReportExport(context.Background(), time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	if e := s.generateReportExport(context.Background(), job, token); e != nil {
		t.Fatal(e)
	}
	if n, e := s.RunReportDelivery(context.Background(), time.Now().UTC(), 100); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	if n, e := s.RunReportDelivery(context.Background(), time.Now().UTC(), 100); e != nil || n != 0 {
		t.Fatal("duplicate intent", n, e)
	}
	var artifact ReportArtifact
	db.First(&artifact, "job_id=?", job.ID)
	db.Model(&artifact).Update("expires_at", time.Now().UTC().Add(-time.Second))
	if n, e := s.RunReportCleanup(context.Background(), time.Now().UTC(), 100); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	if _, e := store.Open(context.Background(), artifact.StoreKey); e == nil {
		t.Fatal("expired private bytes survived")
	}
	var n int64
	db.Model(&HistoricalReportSnapshot{}).Where("id=?", sid).Count(&n)
	if n != 1 {
		t.Fatal("cleanup deleted snapshot")
	}
}
