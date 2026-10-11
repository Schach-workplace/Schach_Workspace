package platform

import (
	"net/http"
	"testing"
	"time"
)

func createMeasuredGoal(t *testing.T, s *Server, c *http.Cookie, cid, owner string) string {
	t.Helper()
	status, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/goals", map[string]any{"retryKey": "create-goal", "name": "Quality", "ownerId": owner, "unit": "defects", "baseline": 8, "target": 3, "initialMeasurement": map[string]any{"value": 4.8, "effectiveAt": "2026-10-01T00:00:00.123456Z", "reason": "Independent observed result"}}, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	if b["goalVersion"] != float64(1) {
		t.Fatal(b)
	}
	return b["id"].(string)
}
func TestGoalMeasurementAtomicity(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, me(t, s, c))
	p := "/api/companies/" + cid + "/goals/" + id
	input := map[string]any{"retryKey": "measure", "expectedVersion": 1, "value": 4, "effectiveAt": "2026-10-02T00:00:00.654321Z", "reason": "Observed quality independently"}
	status, b, _ := req(t, s, "POST", p+"/measurements", input, c)
	if status != 200 || b["goalVersion"] != float64(2) || b["current"] != float64(4) {
		t.Fatal(status, b)
	}
	status, b, _ = req(t, s, "GET", p+"/measurements", nil, c)
	if status != 200 || len(b["measurements"].([]any)) != 2 {
		t.Fatal(status, b)
	}
	row := b["measurements"].([]any)[0].(map[string]any)
	if row["effectiveAt"] != "2026-10-02T00:00:00.654321Z" {
		t.Fatal(row)
	}
	status, b, _ = req(t, s, "PATCH", p, map[string]any{"retryKey": "silent-current", "version": 2, "reason": "silent", "current": 99}, c)
	if status != 422 {
		t.Fatal(status, b)
	}
	var g Goal
	db.First(&g, "id=?", id)
	if g.Current != 4 {
		t.Fatal(g)
	}
}
func TestGoalCanonicalRetry(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, me(t, s, c))
	p := "/api/companies/" + cid + "/goals/" + id
	input := map[string]any{"retryKey": "frozen", "expectedVersion": 1, "value": 4, "effectiveAt": "2026-10-02T05:30:00.123456+05:30", "reason": "Observed result"}
	status, b, _ := req(t, s, "POST", p+"/measurements", input, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	mid := b["measurementId"]
	input["effectiveAt"] = "2026-10-02T00:00:00.123456Z"
	status, b, _ = req(t, s, "POST", p+"/measurements", input, c)
	if status != 200 || b["measurementId"] != mid || b["goalVersion"] != float64(2) {
		t.Fatal(status, b)
	}
	input["value"] = 3
	status, b, _ = req(t, s, "POST", p+"/measurements", input, c)
	if status != 409 {
		t.Fatal(status, b)
	}
}
func TestGoalCorrections(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, me(t, s, c))
	p := "/api/companies/" + cid + "/goals/" + id
	_, b, _ := req(t, s, "GET", p+"/measurements", nil, c)
	initial := b["measurements"].([]any)[0].(map[string]any)["id"].(string)
	input := map[string]any{"retryKey": "next", "expectedVersion": 1, "value": 3.5, "effectiveAt": "2026-10-03T00:00:00Z", "reason": "New observation"}
	_, b, _ = req(t, s, "POST", p+"/measurements", input, c)
	current := b["measurementId"].(string)
	correction := map[string]any{"retryKey": "old-correction", "expectedVersion": 2, "value": 5, "reason": "Correct older observation", "correctsId": initial}
	status, b, _ := req(t, s, "POST", p+"/measurements", correction, c)
	if status != 200 || b["current"] != 3.5 {
		t.Fatal(status, b)
	}
	correction["retryKey"] = "branch"
	correction["expectedVersion"] = 3
	status, b, _ = req(t, s, "POST", p+"/measurements", correction, c)
	if status != 409 {
		t.Fatal(status, b)
	}
	correction["retryKey"] = "current-correction"
	correction["correctsId"] = current
	status, b, _ = req(t, s, "POST", p+"/measurements", correction, c)
	if status != 200 || b["current"] != float64(5) {
		t.Fatal(status, b)
	}
}
func TestGoalObservationPrecision(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, me(t, s, c))
	for _, at := range []string{"2026-10-02T00:00:00.1234567Z", "2026-10-02T00:00:00.123456789Z", time.Now().Add(time.Hour).Format(time.RFC3339Nano)} {
		status, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/goals/"+id+"/measurements", map[string]any{"retryKey": at, "expectedVersion": 1, "value": 4, "effectiveAt": at, "reason": "precision check"}, c)
		if status != 422 {
			t.Fatal(status, b)
		}
	}
}
func TestGoalLegacyCoverage(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	current := 4.8
	g := Goal{ID: newID("legacygoal"), CompanyID: cid, Name: "Legacy quality", OwnerID: me(t, s, c), Unit: "defects", Baseline: 8, Target: 3, Current: current, TaskIDs: []string{}}
	if e := db.Create(&g).Error; e != nil {
		t.Fatal(e)
	}
	if e := migrateGoalMeasurements(db); e != nil {
		t.Fatal(e)
	}
	db.First(&g, "id=?", g.ID)
	if g.Version != 1 || g.LegacyObservedCurrent == nil || *g.LegacyObservedCurrent != current || g.CurrentMeasurementID != "" || g.MeasurementCoverageFrom == nil {
		t.Fatal(g)
	}
	var n int64
	db.Model(&GoalMeasurement{}).Where("goal_id=?", g.ID).Count(&n)
	if n != 0 {
		t.Fatal(n)
	}
	input := map[string]any{"retryKey": "legacy-first", "expectedVersion": 1, "value": 4, "effectiveAt": "1960-01-01T00:00:00.123456Z", "reason": "First known observation"}
	status, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/goals/"+g.ID+"/measurements", input, c)
	if status != 200 {
		t.Fatal(status, b)
	}
}
func TestGoalScopeAndVersion(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := addPerson(t, s, c, cid, "goalowner@example.com", "member")
	viewer := addPerson(t, s, c, cid, "goalviewer@example.com", "viewer")
	_ = viewer
	id := createMeasuredGoal(t, s, c, cid, owner)
	p := "/api/companies/" + cid + "/goals/" + id
	member := login(t, s, "goalowner@example.com")
	vc := login(t, s, "goalviewer@example.com")
	input := map[string]any{"retryKey": "owner-measure", "expectedVersion": 1, "value": 4, "effectiveAt": "2026-10-02T00:00:00Z", "reason": "Observed"}
	status, b, _ := req(t, s, "GET", p, nil, vc)
	if status != 200 || b["canMeasure"] != false {
		t.Fatal(status, b)
	}
	status, b, _ = req(t, s, "POST", p+"/measurements", input, vc)
	if status != 403 {
		t.Fatal(status, b)
	}
	status, b, _ = req(t, s, "POST", p+"/measurements", input, member)
	if status != 200 {
		t.Fatal(status, b)
	}
	status, b, _ = req(t, s, "PATCH", p, map[string]any{"retryKey": "change-unit", "version": 2, "reason": "New unit", "unit": "percent"}, c)
	if status != 422 {
		t.Fatal(status, b)
	}
	status, b, _ = req(t, s, "PATCH", p, map[string]any{"retryKey": "bundle", "version": 2, "reason": "New metric", "unit": "percent", "current": 10, "effectiveAt": "2026-10-03T00:00:00Z", "measurementReason": "Explicit new unit observation"}, c)
	if status != 200 || b["goalVersion"] != float64(3) {
		t.Fatal(status, b)
	}
	db.Model(&Goal{}).Where("id=?", id).Update("owner_id", me(t, s, c))
	status, b, _ = req(t, s, "POST", p+"/measurements", input, member)
	if status != 404 {
		t.Fatal("revoked result replay", status, b)
	}
}
func TestGoalsIndependentFromTasks(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, me(t, s, c))
	task := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	db.Model(&Goal{}).Where("id=?", id).Update("task_ids", []byte(`["`+task+`"]`))
	status, b, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+task, map[string]any{"version": 1, "progress": 100, "status": "in_progress"}, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	var g Goal
	db.First(&g, "id=?", id)
	if g.Current != 4.8 || g.Version != 1 {
		t.Fatal(g)
	}
}
func TestGoalCanonicalRace(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, me(t, s, c))
	path := "/api/companies/" + cid + "/goals/" + id + "/measurements"
	input := map[string]any{"retryKey": "concurrent-frozen", "expectedVersion": 1, "value": 4, "effectiveAt": "2026-10-02T00:00:00.123456Z", "reason": "Concurrent observed result"}
	type result struct {
		status int
		id     any
	}
	out := make(chan result, 2)
	run := func() { status, b, _ := req(t, s, "POST", path, input, c); out <- result{status, b["measurementId"]} }
	if db.Dialector.Name() == "postgres" {
		go run()
		go run()
	} else {
		run()
		run()
	}
	a, b := <-out, <-out
	if a.status != 200 || b.status != 200 || a.id != b.id {
		t.Fatal(a, b)
	}
	var n int64
	db.Model(&GoalMeasurement{}).Where("goal_id=?", id).Count(&n)
	if n != 2 {
		t.Fatal(n)
	}
}
func TestGoalRequiresExplicitValue(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, me(t, s, c))
	for _, value := range []any{nil, "missing"} {
		body := map[string]any{"retryKey": "absent-value", "expectedVersion": 1, "effectiveAt": "2026-10-02T00:00:00Z", "reason": "Must supply observed value"}
		if value == nil {
			body["value"] = nil
		}
		st, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/goals/"+id+"/measurements", body, c)
		if st != 422 {
			t.Fatal(st, b)
		}
	}
}
func TestGoalTimestampProjectionUTC(t *testing.T) {
	at, _ := time.Parse(time.RFC3339Nano, "2026-10-02T05:30:00.654321+05:30")
	view := goalMeasurementView(nil, &access{Users: map[string]User{}, Members: map[string]Membership{}}, GoalMeasurement{EffectiveAt: at, CreatedAt: at, Evidence: []GoalEvidenceBinding{}})
	if view["effectiveAt"] != "2026-10-02T00:00:00.654321Z" || view["createdAt"] != "2026-10-02T00:00:00.654321Z" {
		t.Fatal(view)
	}
}
