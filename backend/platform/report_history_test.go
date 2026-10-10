package platform

import (
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
