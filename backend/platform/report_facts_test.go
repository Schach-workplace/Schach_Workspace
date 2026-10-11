package platform

import (
	"context"
	"fmt"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestTaskFactsWriterInventory(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["retryKey"] = "facts-create"
	id := createTask(t, s, c, cid, body)
	var n int64
	if e := db.Table("task_facts").Where("task_id=?", id).Count(&n).Error; e != nil {
		t.Fatal(e)
	}
	if n != 1 {
		t.Fatal("native creation fact", n)
	}
	createTask(t, s, c, cid, body)
	st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "title": "Changed"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	db.Table("task_facts").Where("task_id=?", id).Count(&n)
	if n != 2 {
		t.Fatal("patch/replay facts", n)
	}
	st, _, _ = req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "title": "Stale"}, c)
	if st != 409 {
		t.Fatal(st)
	}
	db.Table("task_facts").Where("task_id=?", id).Count(&n)
	if n != 2 {
		t.Fatal("failed CAS added fact", n)
	}
}
func TestAcceptanceFactsIndependent(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	base := "/api/companies/" + cid + "/tasks/" + id
	for i, status := range []string{"done", "in_progress", "done"} {
		st, _, w := req(t, s, "PATCH", base, map[string]any{"version": i + 1, "status": status}, c)
		if st != 200 {
			t.Fatal(w.Body.String())
		}
	}
	var n int64
	if e := db.Table("task_acceptance_facts").Where("task_id=? AND acceptance_kind='direct_completion'", id).Count(&n).Error; e != nil {
		t.Fatal(e)
	}
	if n != 2 {
		t.Fatal("independent episodes", n)
	}
	st, _, w := req(t, s, "POST", base+"/time", map[string]any{"hours": 2, "date": "2026-01-01", "note": "SECRET_TIME_NOTE"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	db.Table("task_acceptance_facts").Where("task_id=?", id).Count(&n)
	if n != 2 {
		t.Fatal("time added acceptance", n)
	}
}
func TestTaskTimeFactsIndependent(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	st, _, w := req(t, s, "POST", "/api/companies/"+cid+"/tasks/"+id+"/time", map[string]any{"hours": 2, "date": "2026-01-01", "note": "SECRET_TIME_NOTE"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	var rows []map[string]any
	if e := db.Table("task_time_facts").Where("task_id=?", id).Find(&rows).Error; e != nil {
		t.Fatal(e)
	}
	if len(rows) != 1 {
		t.Fatal(rows)
	}
}
func TestReportObservedCoverage(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	legacy := Task{ID: newID("tsk"), Code: "LEG-7", CompanyID: cid, OwnerID: me(t, s, c), Title: "Legacy", Priority: "medium", Recurrence: "none", Tags: []string{}, Checklist: []ChecklistItem{}, Dependencies: []string{}, Collaborators: []string{}, Version: 7, Status: "done", CompletedAt: "2020-01-01T00:00:00Z", CreatedAt: "2019-01-01T00:00:00Z"}
	if e := db.Create(&legacy).Error; e != nil {
		t.Fatal(e)
	}
	if _, _, e := s.InitializeReportHistory(context.Background(), time.Now().UTC(), 100); e != nil {
		t.Fatal(e)
	}
	var n int64
	if e := db.Table("task_history_coverages").Where("task_id=?", legacy.ID).Count(&n).Error; e != nil {
		t.Fatal(e)
	}
	if n != 1 {
		t.Fatal("observation missing", n)
	}
}

func TestReportObservedCoverageGapsAndNoAcceptance(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	legacy := Task{ID: newID("tsk"), Code: "OBS-1", CompanyID: cid, OwnerID: me(t, s, c), Title: "Unknown", Priority: "medium", Recurrence: "none", Tags: []string{}, Checklist: []ChecklistItem{}, Dependencies: []string{}, Collaborators: []string{}, Version: 7, Status: "done", CompletedAt: "2020-01-01T00:00:00Z", CreatedAt: "2019-01-01T00:00:00Z"}
	if e := db.Create(&legacy).Error; e != nil {
		t.Fatal(e)
	}
	first := time.Now().UTC()
	for i := 0; i < 2; i++ {
		if _, _, e := s.InitializeReportHistory(context.Background(), first, 100); e != nil {
			t.Fatal(e)
		}
	}
	var facts []TaskFact
	db.Where("task_id=?", legacy.ID).Find(&facts)
	if len(facts) != 1 || !facts[0].UnknownBefore || facts[0].EffectiveAtRaw != first.Format(time.RFC3339Nano) {
		t.Fatal(facts)
	}
	var n int64
	db.Model(&TaskAcceptanceFact{}).Where("task_id=?", legacy.ID).Count(&n)
	if n != 0 {
		t.Fatal("invented legacy acceptance", n)
	}
	legacy.Title = "Unsupported direct edit"
	db.Model(&Task{}).Where("id=?", legacy.ID).Update("title", legacy.Title)
	if e := db.Transaction(func(tx *gorm.DB) error { return ensureObservedTaskState(tx, legacy, first.Add(time.Hour)) }); e != nil {
		t.Fatal(e)
	}
	var cov TaskHistoryCoverage
	db.First(&cov, "task_id=?", legacy.ID)
	if !cov.Inconsistent {
		t.Fatal("same-version divergence went unnoticed")
	}
	legacy.Version = 10
	db.Model(&Task{}).Where("id=?", legacy.ID).Update("version", 10)
	if e := db.Transaction(func(tx *gorm.DB) error { return ensureObservedTaskState(tx, legacy, first.Add(2*time.Hour)) }); e != nil {
		t.Fatal(e)
	}
	db.Where("task_id=?", legacy.ID).Find(&facts)
	if len(facts) != 2 {
		t.Fatal("facts overwritten", facts)
	}
	var gaps []TaskHistoryGap
	db.Where("task_id=?", legacy.ID).Find(&gaps)
	if len(gaps) != 2 {
		t.Fatal(gaps)
	}
}
func TestTaskFactsRollback(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	db.Callback().Create().Before("gorm:create").Register("fail-report-fact", func(tx *gorm.DB) {
		if tx.Statement.Table == "task_facts" {
			tx.AddError(fmt.Errorf("injected fact failure"))
		}
	})
	defer db.Callback().Create().Remove("fail-report-fact")
	body := taskBody(me(t, s, c))
	body["retryKey"] = "rollback-fact"
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks", body, c)
	if st != 500 {
		t.Fatal(st)
	}
	for _, table := range []string{"tasks", "task_facts", "business_mutation_retries", "attention_items"} {
		var n int64
		db.Table(table).Count(&n)
		if n != 0 {
			t.Fatal(table, n)
		}
	}
}

func TestTaskFactsPolicyZoneChangeDoesNotInventTaskGap(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	db.Model(&Company{}).Where("id=?", cid).Update("timezone", "America/New_York")
	st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "title": "New zone event"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	var gaps int64
	db.Model(&TaskHistoryGap{}).Where("task_id=?", id).Count(&gaps)
	if gaps != 0 {
		t.Fatal("company policy change fabricated task inconsistency", gaps)
	}
	var facts []TaskFact
	db.Where("task_id=?", id).Order("task_version").Find(&facts)
	if facts[0].State.CompanyPolicyZone == facts[1].State.CompanyPolicyZone {
		t.Fatal("event policy not captured")
	}
}

func TestTaskFactsExactDeadlineSurvivesPostgresReload(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["deadlineMode"] = "timed"
	body["dueAt"] = "2026-10-20T10:00:00.000000001Z"
	body["dueTimezone"] = "UTC"
	id := createTask(t, s, c, cid, body)
	st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "title": "Same exact commitment"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	var gaps int64
	db.Model(&TaskHistoryGap{}).Where("task_id=?", id).Count(&gaps)
	if gaps != 0 {
		t.Fatal("SQL rounding fabricated task gap", gaps)
	}
	var facts []TaskFact
	db.Where("task_id=?", id).Order("task_version").Find(&facts)
	for _, f := range facts {
		if f.State.Original.At != "2026-10-20T10:00:00.000000001Z" || f.State.Current.At != f.State.Original.At {
			t.Fatal("exact source lost", f)
		}
	}
}

func TestTaskTimeFactsLegacyFirstWriteStaysNative(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	db.Where("task_id=?", id).Delete(&TaskFact{})
	db.Where("task_id=?", id).Delete(&TaskHistoryCoverage{})
	st, _, w := req(t, s, "POST", "/api/companies/"+cid+"/tasks/"+id+"/time", map[string]any{"hours": 2, "date": "2026-09-10", "note": "private"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	var facts []TaskTimeFact
	db.Where("task_id=?", id).Find(&facts)
	if len(facts) != 1 || facts[0].Provenance != "native_time_entry" {
		t.Fatal("new real time entry misclassified as observation", facts)
	}
}

// Called after real producer flows: every persisted successful revision must
// have one lean native fact, including retries, evidence and recurring creation.
func assertNativeTaskFacts(t *testing.T, s *Server) {
	t.Helper()
	var tasks []Task
	if e := s.db.Find(&tasks).Error; e != nil {
		t.Fatal(e)
	}
	if len(tasks) == 0 {
		t.Fatal("producer created no task")
	}
	for _, task := range tasks {
		var facts []TaskFact
		if e := s.db.Where("task_id=?", task.ID).Order("task_version").Find(&facts).Error; e != nil {
			t.Fatal(e)
		}
		if len(facts) != int(task.Version) {
			t.Fatalf("%s persisted version %d has %d facts", task.ID, task.Version, len(facts))
		}
		for i, f := range facts {
			if f.TaskVersion != int64(i+1) || f.Provenance != "native_event" || f.UnknownBefore {
				t.Fatalf("missing native revision: %+v", f)
			}
		}
		latest := facts[len(facts)-1]
		if latest.State.Status != task.Status || latest.State.ActualHours != task.ActualHours || latest.State.Title != task.Title || latest.State.Current.Date != task.DueDate {
			t.Fatal("fact disagrees with persisted producer result", latest.State, task)
		}
	}
}

func TestTaskFactsExactAuthoredDeadlineEditParity(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["deadlineMode"] = "timed"
	body["dueAt"] = "2026-10-20T10:00:00.000000001Z"
	body["dueTimezone"] = "UTC"
	id := createTask(t, s, c, cid, body)
	for i, fields := range []map[string]any{
		{"dueAt": "2026-10-20T10:00:00Z", "deadlineChangeReason": "Deliberate exact-second edit"},
		{"title": "Keep deliberately edited commitment"},
	} {
		fields["version"] = i + 1
		st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, fields, c)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	var facts []TaskFact
	if e := db.Where("task_id=?", id).Order("task_version").Find(&facts).Error; e != nil {
		t.Fatal(e)
	}
	for _, f := range facts[1:] {
		if f.State.Original.At != "2026-10-20T10:00:00.000000001Z" || f.State.Current.At != "2026-10-20T10:00:00Z" {
			t.Fatalf("authored deadline replaced by previous precision: %+v", f.State)
		}
		met, valid := reportDeadlineMet("2026-10-20T10:00:00.000000001Z", f.State.Current, "UTC")
		if !valid || met {
			t.Fatal("one nanosecond after edited commitment was reported on time")
		}
	}
	var gaps int64
	db.Model(&TaskHistoryGap{}).Where("task_id=?", id).Count(&gaps)
	if gaps != 0 {
		t.Fatal("authored edit fabricated a gap", gaps)
	}
}
