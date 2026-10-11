package platform

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"strings"
	"testing"
	"time"
)

func historyRequest() map[string]any {
	return map[string]any{"basis": "task_history_v1", "from": "2026-09-01", "to": "2026-09-30", "reportZone": "Asia/Kolkata", "filters": map[string]any{}}
}
func TestHistoricalSnapshotImmutability(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	path := "/api/companies/" + cid + "/reports/history/snapshots"
	input := map[string]any{"retryKey": "history-one", "request": historyRequest()}
	st, b, w := req(t, s, "POST", path, input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	sid := b["snapshotId"].(string)
	st, original, w := req(t, s, "GET", path+"/"+sid, nil, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "title": "Readable changed"}, c)
	st, later, w := req(t, s, "GET", path+"/"+sid, nil, c)
	if st != 200 || payloadHash(original) != payloadHash(later) {
		t.Fatal("mutable snapshot", st, w.Body.String())
	}
	st, b, w = req(t, s, "POST", path, input, c)
	if st != 200 || b["snapshotId"] != sid {
		t.Fatal("replay regenerated", w.Body.String())
	}
}
func TestHistoricalAllSourceAuthorization(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := me(t, s, c)
	var hidden string
	for i := 0; i < 103; i++ {
		hidden = createTask(t, s, c, cid, taskBody(owner))
	}
	db.Where("company_id=?", cid).Delete(&TaskFact{})
	db.Where("company_id=?", cid).Delete(&TaskHistoryCoverage{})
	path := "/api/companies/" + cid + "/reports/history/snapshots"
	st, b, w := req(t, s, "POST", path, map[string]any{"retryKey": "all-source", "request": historyRequest()}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	sid := b["snapshotId"].(string)
	st, rows, w := req(t, s, "GET", path+"/"+sid+"/rows?metric=coverage.unknown_before&limit=100", nil, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	if rows["cursor"] == "" {
		t.Fatal("no complete drilldown")
	}
	db.Delete(&Task{}, "id=?", hidden)
	for _, suffix := range []string{"", "/rows?metric=coverage.unknown_before"} {
		st, b, _ = req(t, s, "GET", path+"/"+sid+suffix, nil, c)
		if st != 409 || b["snapshot"] != nil {
			t.Fatal("partial source leak", st, b)
		}
	}
}
func TestHistoricalCalendarPolicy(t *testing.T) {
	// An actual route must reject unknown filters and cannot accept arbitrary SQL.
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	input := historyRequest()
	input["reportZone"] = "Mars/Timezone"
	st, _, w := req(t, s, "POST", "/api/companies/"+cid+"/reports/history/snapshots", map[string]any{"retryKey": "invalid-zone", "request": input}, c)
	if st != 422 {
		t.Fatal(st, w.Body.String())
	}
	_ = time.Now()
}

func TestHistoricalStateAndEpisodes(t *testing.T) {
	p, e := resolveReportPeriod("2026-09-01", "2026-09-30", "Asia/Kolkata")
	if e != nil {
		t.Fatal(e)
	}
	state := ReportTaskState{Status: "done", ActualHours: 9, Current: ReportDeadline{Mode: "all_day", Date: "2026-09-20"}, Original: ReportDeadline{Mode: "all_day", Date: "2026-09-20"}, CompanyPolicyZone: "Asia/Kolkata"}
	rows := []HistoricalReportRow{{RowID: "s", Kind: "state", TaskID: "task", State: state}, {RowID: "a1", Kind: "acceptance", TaskID: "task", AcceptanceID: "event1", AcceptedAtRaw: "2026-09-20T17:00:00Z", State: state}, {RowID: "a2", Kind: "acceptance", TaskID: "task", AcceptanceID: "event2", AcceptedAtRaw: "2026-09-21T17:00:00Z", State: state}, {RowID: "t", Kind: "time", TaskID: "task", Hours: 2, Provenance: "native_time_entry", State: state}, {RowID: "o", Kind: "time", TaskID: "task", Hours: 4, Provenance: "observed_time_entry", State: state}}
	summary := reduceHistoricalReport(rows, p)
	for code, want := range map[string]float64{"state.cohort": 1, "state.done": 1, "state.actual_hours": 9, "acceptance.episodes": 2, "acceptance.unique_tasks": 1, "effort.logged_hours": 2, "effort.observed_hours": 4} {
		if summary.Metrics[code].Value != want {
			t.Fatal(code, summary.Metrics[code])
		}
	}
	m := summary.Metrics["acceptance.original_on_time"]
	if m.Rate == nil || *m.Rate != 50 || *m.Denominator != 2 {
		t.Fatal(m)
	}
	m = summary.Metrics["state.done"]
	if m.Denominator == nil || *m.Denominator != 1 || m.Rate == nil || *m.Rate != 100 {
		t.Fatal("state denominator unavailable", m)
	}
	empty := reduceHistoricalReport(nil, p)
	if empty.Metrics["acceptance.current_on_time"].Rate != nil {
		t.Fatal("fabricated 100 percent")
	}
}
func TestHistoricalCalendarExactAndDST(t *testing.T) {
	d := ReportDeadline{Mode: "timed", At: "2026-09-01T00:00:00.000000001Z"}
	if met, valid := reportDeadlineMet("2026-09-01T00:00:00.000000001Z", d, "UTC"); !met || !valid {
		t.Fatal("equality is late")
	}
	if met, valid := reportDeadlineMet("2026-09-01T00:00:00.000000002Z", d, "UTC"); met || !valid {
		t.Fatal("+1ns is ontime")
	}
	for day, hours := range map[string]float64{"2026-03-08": 23, "2026-11-01": 25} {
		p, e := resolveReportPeriod(day, day, "America/New_York")
		if e != nil || p.EndExclusive.Sub(p.StartInclusive).Hours() != hours {
			t.Fatal(p, e)
		}
	}
	if met, valid := reportDeadlineMet("2026-09-20T23:00:00Z", ReportDeadline{Mode: "all_day", Date: "2026-09-20"}, "America/New_York"); !met || !valid {
		t.Fatal("event-zone all day changed")
	}
}

func TestHistoricalCompareBothManifests(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	db.Where("company_id=?", cid).Delete(&TaskFact{})
	db.Where("company_id=?", cid).Delete(&TaskHistoryCoverage{})
	base := "/api/companies/" + cid + "/reports/history"
	snapshots := []string{}
	for _, key := range []string{"left", "right"} {
		st, b, w := req(t, s, "POST", base+"/snapshots", map[string]any{"retryKey": key, "request": historyRequest()}, c)
		if st != 200 {
			t.Fatal(w.Body.String())
		}
		snapshots = append(snapshots, b["snapshotId"].(string))
	}
	input := map[string]any{"leftSnapshotId": snapshots[0], "rightSnapshotId": snapshots[1]}
	st, _, w := req(t, s, "POST", base+"/compare", input, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	db.Delete(&Task{}, "id=?", id)
	st, b, _ := req(t, s, "POST", base+"/compare", input, c)
	if st != 409 || b["comparisons"] != nil {
		t.Fatal("comparison disclosed inaccessible side", st, b)
	}
}

func TestHistoricalUniqueEpisodesAndInvalidCoverage(t *testing.T) {
	p, _ := resolveReportPeriod("2026-09-01", "2026-09-30", "UTC")
	rows := []HistoricalReportRow{{RowID: "one", Kind: "acceptance", TaskID: "task", AcceptanceID: "episode-one"}, {RowID: "two", Kind: "acceptance", TaskID: "task", AcceptanceID: "episode-two"}}
	summary := reduceHistoricalReport(rows, p)
	raw, _ := json.Marshal(summary.Metrics["acceptance.unique_tasks"])
	if !strings.Contains(string(raw), "episode-one") || !strings.Contains(string(raw), "episode-two") {
		t.Fatal("unique task row lacks all matching episode ids", string(raw))
	}
	if summary.Metrics["coverage.invalid_deadline"].Value != 2 {
		t.Fatal("same row counted twice for original/current missing deadline", summary.Metrics["coverage.invalid_deadline"])
	}
}

func TestHistoricalObservedMidPeriodDisclosesUnknownStart(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["startDate"] = "2026-09-01"
	body["dueDate"] = "2026-09-20"
	id := createTask(t, s, c, cid, body)
	db.Where("task_id=?", id).Delete(&TaskFact{})
	db.Where("task_id=?", id).Delete(&TaskHistoryCoverage{})
	var task Task
	db.First(&task, "id=?", id)
	if e := db.Transaction(func(tx *gorm.DB) error {
		return ensureObservedTaskState(tx, task, time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC))
	}); e != nil {
		t.Fatal(e)
	}
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/reports/history/snapshots", map[string]any{"retryKey": "mid-period", "request": historyRequest()}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var snap HistoricalReportSnapshot
	db.First(&snap, "id=?", b["snapshotId"])
	if snap.Summary.Metrics["state.cohort"].Value != 1 || snap.Summary.Metrics["coverage.unknown_before"].Value != 1 {
		t.Fatal("known cutoff erased unknown period start", snap.Summary)
	}
}
func TestHistoricalCaptureRejectsRowAndCanonicalByteLimits(t *testing.T) {
	for _, kind := range []string{"rows", "bytes"} {
		t.Run(kind, func(t *testing.T) {
			s, db := testServer(t)
			c := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, c)
			owner := me(t, s, c)
			if kind == "rows" {
				rows := make([]Task, 10001)
				for i := range rows {
					rows[i] = Task{ID: newID("task"), CompanyID: cid, OwnerID: owner, CreatedBy: owner, Code: fmt.Sprintf("LIMIT-%d", i), Title: "Bounded fixture", Version: 1, Status: "todo", Priority: "high", Recurrence: "none", DueDate: "2026-09-20", DeadlineMode: "all_day", Tags: []string{}, Checklist: []ChecklistItem{}, Dependencies: []string{}, Collaborators: []string{}}
				}
				if e := db.CreateInBatches(&rows, 100).Error; e != nil {
					t.Fatal(e)
				}
			} else {
				for i := 0; i < 2; i++ {
					id := createTask(t, s, c, cid, taskBody(owner))
					db.Where("task_id=?", id).Delete(&TaskFact{})
					db.Where("task_id=?", id).Delete(&TaskHistoryCoverage{})
					db.Model(&Task{}).Where("id=?", id).Updates(map[string]any{"title": strings.Repeat("x", 5<<20), "due_date": "2026-09-20"})
					var task Task
					db.First(&task, "id=?", id)
					if e := db.Transaction(func(tx *gorm.DB) error {
						return ensureObservedTaskState(tx, task, time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC))
					}); e != nil {
						t.Fatal(e)
					}
				}
			}
			st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/reports/history/snapshots", map[string]any{"retryKey": "limit", "request": historyRequest()}, c)
			if st != 422 || !strings.Contains(w.Body.String(), "range_too_large") {
				t.Fatal("limit not explicit", st, b)
			}
			var n int64
			db.Model(&HistoricalReportSnapshot{}).Count(&n)
			if n != 0 {
				t.Fatal("oversized snapshot persisted", n)
			}
		})
	}
}

func TestHistoricalHTTPActorRefreshRejectsLateSuspension(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	r := requestForAccess("/api/companies/"+cid+"/reports/history/snapshots", c, cid)
	a, e := s.access(r)
	if e != nil {
		t.Fatal(e)
	}
	if e = db.Model(&User{}).Where("id=?", a.User.ID).Update("suspended", true).Error; e != nil {
		t.Fatal(e)
	}
	invoked := false
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error { invoked = true; return nil })
	if e == nil || invoked {
		t.Fatal("stale HTTP actor disclosed report data", e, invoked)
	}
}

func TestHistoricalInteriorGapsRemainVisibleWithKnownCutoffState(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["dueDate"] = "2026-09-20"
	body["startDate"] = "2026-09-01"
	id := createTask(t, s, c, cid, body)
	var fact TaskFact
	db.First(&fact, "task_id=?", id)
	known := time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)
	db.Model(&fact).Updates(map[string]any{"effective_at": known, "effective_at_raw": known.Format(time.RFC3339Nano)})
	db.Model(&TaskHistoryCoverage{}).Where("task_id=?", id).Update("first_known_at", time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC))
	from := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)
	gaps := []TaskHistoryGap{{ID: newID("gap"), CompanyID: cid, TaskID: id, FromExclusive: from, ToExclusive: &to, Reason: "skipped_versions"}, {ID: newID("gap"), CompanyID: cid, TaskID: id, FromExclusive: from.Add(-48 * time.Hour), ToExclusive: &from, Reason: "skipped_versions"}}
	if e := db.Create(&gaps).Error; e != nil {
		t.Fatal(e)
	}
	var snapshots []string
	for _, test := range []struct {
		from, to     string
		states, gaps float64
	}{
		{"2026-09-01", "2026-09-30", 1, 2},
		{"2026-09-01", "2026-09-15", 0, 2},
		{"2026-09-21", "2026-09-30", 1, 0},
	} {
		input := historyRequest()
		input["from"] = test.from
		input["to"] = test.to
		input["reportZone"] = "UTC"
		st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/reports/history/snapshots", map[string]any{"retryKey": test.from + test.to, "request": input}, c)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
		sid := b["snapshotId"].(string)
		snapshots = append(snapshots, sid)
		var snap HistoricalReportSnapshot
		db.First(&snap, "id=?", sid)
		var stateRows int64
		db.Model(&HistoricalReportRow{}).Where("snapshot_id=? AND kind=?", sid, "state").Count(&stateRows)
		if float64(stateRows) != test.states || snap.Summary.Metrics["coverage.gaps"].Value != test.gaps {
			t.Fatalf("%s..%s state=%v gaps=%v", test.from, test.to, stateRows, snap.Summary.Metrics["coverage.gaps"].Value)
		}
	}
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/reports/history/compare", map[string]any{"leftSnapshotId": snapshots[0], "rightSnapshotId": snapshots[2]}, c)
	if st != 200 || !strings.Contains(fmt.Sprint(b), "gap") {
		t.Fatal("comparison lost interior gap warning", st, w.Body.String())
	}
}

func TestHistoricalFilteredEventsBeyondCandidatePage(t *testing.T) {
	for _, kind := range []string{"acceptance", "time", "overflow"} {
		t.Run(kind, func(t *testing.T) {
			s, db := testServer(t)
			c := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, c)
			owner := me(t, s, c)
			other := addPerson(t, s, c, cid, "history-filter@example.com", "member")
			id := createTask(t, s, c, cid, taskBody(owner))
			var original TaskFact
			db.First(&original, "task_id=?", id)
			at := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
			nonmatch := original.State
			nonmatch.OwnerID = other
			linked := original
			linked.ID = newID("tf")
			linked.TaskVersion = 2
			linked.State = nonmatch
			if e := db.Create(&linked).Error; e != nil {
				t.Fatal(e)
			}
			count := reportRowLimit + 2
			if kind == "time" {
				facts := make([]TaskTimeFact, count)
				for i := range facts {
					fid := linked.ID
					if i == count-1 {
						fid = original.ID
					}
					facts[i] = TaskTimeFact{ID: fmt.Sprintf("ttf_page_%05d", i), CompanyID: cid, TimeEntryID: newID("te"), TaskID: id, TaskVersion: 1, TaskFactID: fid, RecordedAt: at, RecordedAtRaw: at.Format(time.RFC3339Nano), EntryDate: "2026-09-10", Hours: 2, ActorID: owner, Provenance: "native_time_entry"}
				}
				if e := db.CreateInBatches(&facts, 100).Error; e != nil {
					t.Fatal(e)
				}
			} else {
				facts := make([]TaskAcceptanceFact, count)
				for i := range facts {
					state := nonmatch
					if i == count-1 || kind == "overflow" {
						state = original.State
					}
					facts[i] = TaskAcceptanceFact{ID: fmt.Sprintf("af_page_%05d", i), CompanyID: cid, TaskID: id, TaskVersion: int64(i + 1), TaskFactID: newID("tf"), AcceptedAt: at, AcceptedAtRaw: at.Format(time.RFC3339Nano), ActorID: owner, AcceptanceKind: "direct_completion", State: state}
				}
				if e := db.CreateInBatches(&facts, 100).Error; e != nil {
					t.Fatal(e)
				}
			}
			input := historyRequest()
			input["filters"] = map[string]any{"ownerId": owner}
			st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/reports/history/snapshots", map[string]any{"retryKey": "filtered-page", "request": input}, c)
			if kind == "overflow" {
				if st != 422 || !strings.Contains(w.Body.String(), "range_too_large") {
					t.Fatal("incomplete report did not fail closed", st, w.Body.String())
				}
				return
			}
			if st != 200 {
				t.Fatal(st, w.Body.String())
			}
			var snap HistoricalReportSnapshot
			db.First(&snap, "id=?", b["snapshotId"])
			code, want := "acceptance.episodes", float64(1)
			if kind == "time" {
				code = "effort.logged_hours"
				want = 2
			}
			if snap.Summary.Metrics[code].Value != want {
				t.Fatal("later matching event silently omitted", code, snap.Summary.Metrics[code].Value)
			}
		})
	}
}

func TestHistoricalNarrowFilterBeyondVisibleTaskLimit(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := me(t, s, c)
	other := addPerson(t, s, c, cid, "history-narrow@example.com", "member")
	at := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	tasks := make([]Task, reportRowLimit+2)
	facts := make([]TaskFact, len(tasks))
	covs := make([]TaskHistoryCoverage, len(tasks))
	for i := range tasks {
		uid := other
		if i == len(tasks)-1 {
			uid = owner
		}
		tasks[i] = Task{ID: fmt.Sprintf("tsk_narrow_%05d", i), CompanyID: cid, Code: fmt.Sprintf("NARROW-%d", i), Title: "Narrow fixture", OwnerID: uid, CreatedBy: owner, Status: "todo", Priority: "high", Recurrence: "none", Version: 1, DueDate: "2026-09-20", OriginalDueDate: "2026-09-20", DeadlineMode: "all_day", OriginalDeadlineMode: "all_day", Tags: []string{}, Checklist: []ChecklistItem{}, Dependencies: []string{}, Collaborators: []string{}}
		state := ReportTaskState{Code: tasks[i].Code, Title: tasks[i].Title, OwnerID: uid, CreatorID: owner, Status: "todo", Priority: "high", Current: ReportDeadline{Mode: "all_day", Date: "2026-09-20"}, Original: ReportDeadline{Mode: "all_day", Date: "2026-09-20"}, CompanyPolicyZone: "UTC", Dependencies: []string{}}
		hash := reportStateHash(state)
		facts[i] = TaskFact{ID: newID("tf"), CompanyID: cid, TaskID: tasks[i].ID, TaskVersion: 1, RecordedAt: at, EffectiveAt: at, EffectiveAtRaw: at.Format(time.RFC3339Nano), Operation: "create", ActorKind: "user", ActorID: owner, Provenance: "native_event", KnownFrom: at, StateHash: hash, State: state}
		covs[i] = TaskHistoryCoverage{CompanyID: cid, TaskID: tasks[i].ID, FirstKnownAt: at, LastRecordedVersion: 1, StateHash: hash, LastFactID: facts[i].ID}
	}
	for _, rows := range []any{&tasks, &facts, &covs} {
		if e := db.CreateInBatches(rows, 100).Error; e != nil {
			t.Fatal(e)
		}
	}
	input := historyRequest()
	input["filters"] = map[string]any{"ownerId": owner}
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/reports/history/snapshots", map[string]any{"retryKey": "narrow-tasks", "request": input}, c)
	if st != 200 {
		t.Fatal("narrow report cannot recover from visible candidate limit", st, w.Body.String())
	}
	var snap HistoricalReportSnapshot
	db.First(&snap, "id=?", b["snapshotId"])
	if snap.RowCount != 1 || snap.Summary.Metrics["state.cohort"].Value != 1 {
		t.Fatal("narrow report was not complete", snap.RowCount, snap.Summary)
	}
}
