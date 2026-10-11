package platform

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http/httptest"
	"testing"
	"time"
)

func planningFixture(t *testing.T) (*Server, *access) {
	t.Helper()
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(c)
	r.SetPathValue("cid", cid)
	a, e := s.access(r)
	if e != nil {
		t.Fatal(e)
	}
	return s, a
}
func TestPlanningOverlapMethod(t *testing.T) {
	s, a := planningFixture(t)
	m := a.Members[a.User.ID]
	m.CapacityHours = 40
	a.Members[a.User.ID] = m
	x := Task{ID: newID("task"), Code: newID("code"), CompanyID: a.Company.ID, OwnerID: a.User.ID, CreatedBy: a.User.ID, Title: "Three week work", Status: "todo", Priority: "medium", Recurrence: "none", EstimatedHours: 10, Progress: 20, StartDate: "2026-10-05", DueDate: "2026-10-25", Version: 1}
	normalizeTask(&x)
	if e := s.db.Create(&x).Error; e != nil {
		t.Fatal(e)
	}
	v, e := loadPlanning(s.db, a, PlanningFilters{From: "2026-10-05", To: "2026-10-25"}, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	if v.Coverage.UniqueSelectedRemainingHours != 8 || v.Coverage.WeeklyExposureHours != 24 || len(v.Weeks) != 3 {
		t.Fatalf("%#v", v)
	}
	for _, w := range v.Weeks {
		if w.RemainingHours != 8 {
			t.Fatal(w)
		}
	}
}
func TestPlanningCompanyDates(t *testing.T) {
	x := Task{DeadlineMode: "timed", DueAt: "2026-10-10T18:45:00Z", DueDate: "2026-10-10"}
	_, end, state := planningInterval(x, "Asia/Kolkata")
	if end != "2026-10-11" || state != "scheduled" {
		t.Fatal(end, state)
	}
	x.DueAt = ""
	_, _, state = planningInterval(x, "Asia/Kolkata")
	if state != "invalid" {
		t.Fatal(state)
	}
}
func TestPlanningReadBounds(t *testing.T) {
	s, a := planningFixture(t)
	for _, tc := range []struct {
		to string
		ok bool
	}{{"2026-03-25", true}, {"2026-03-26", false}} {
		_, e := loadPlanning(s.db, a, PlanningFilters{From: "2026-01-01", To: tc.to}, time.Now())
		if (e == nil) != tc.ok {
			t.Fatal(tc, e)
		}
	}
}
func TestPlanningZeroAndCoverage(t *testing.T) {
	s, a := planningFixture(t)
	m := a.Members[a.User.ID]
	m.CapacityHours = 0
	a.Members[a.User.ID] = m
	x := Task{ID: newID("task"), Code: newID("code"), CompanyID: a.Company.ID, OwnerID: a.User.ID, CreatedBy: a.User.ID, Title: "zero", Status: "todo", Priority: "medium", Recurrence: "none", DueDate: "2026-10-11", Version: 1}
	normalizeTask(&x)
	if e := s.db.Create(&x).Error; e != nil {
		t.Fatal(e)
	}
	v, e := loadPlanning(s.db, a, PlanningFilters{From: "2026-10-05", To: "2026-10-11"}, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	if v.Coverage.RecordedZeroEstimate != 1 || len(v.Weeks[0].People) != 1 || v.Weeks[0].People[0].Utilization != nil || v.Weeks[0].People[0].CapacityState != "recorded_zero" {
		t.Fatalf("%#v", v)
	}
}
func TestPlanningScope(t *testing.T) {
	s, a := planningFixture(t)
	c := login(t, s, "founder@example.com")
	other := addPerson(t, s, c, a.Company.ID, "otherplanning@example.com", "member")
	a.Member.Role = "member"
	for _, owner := range []string{a.User.ID, other} {
		x := Task{ID: newID("task"), Code: newID("code"), CompanyID: a.Company.ID, OwnerID: owner, CreatedBy: owner, Title: owner, Status: "todo", Priority: "medium", Recurrence: "none", EstimatedHours: 10, DueDate: "2026-10-11", Version: 1}
		normalizeTask(&x)
		if e := s.db.Create(&x).Error; e != nil {
			t.Fatal(e)
		}
	}
	v, e := loadPlanning(s.db, a, PlanningFilters{From: "2026-10-05", To: "2026-10-11"}, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	if v.Coverage.UniqueSelectedRemainingHours != 10 {
		t.Fatal(v)
	}
}
func TestPlanningDrillCurrentBasis(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := addPerson(t, s, c, cid, "planner@example.com", "member")
	member := login(t, s, "planner@example.com")
	id := createTask(t, s, c, cid, taskBody(uid))
	db.Model(&Task{}).Where("id=?", id).Update("due_date", "2026-10-11")
	path := "/api/companies/" + cid + "/planning"
	status, v, _ := req(t, s, "GET", path+"/summary?from=2026-10-05&to=2026-10-11", nil, member)
	if status != 200 {
		t.Fatal(status, v)
	}
	basis := v["projectionBasis"].(string)
	status, rows, _ := req(t, s, "GET", path+"/tasks?from=2026-10-05&to=2026-10-11&category=scheduled&projectionBasis="+basis, nil, member)
	if status != 200 || len(rows["tasks"].([]any)) != 1 {
		t.Fatal(status, rows)
	}
	db.Model(&Task{}).Where("id=?", id).Updates(map[string]any{"owner_id": me(t, s, c), "created_by": me(t, s, c)})
	status, rows, _ = req(t, s, "GET", path+"/tasks?from=2026-10-05&to=2026-10-11&category=scheduled&projectionBasis="+basis, nil, member)
	if status != 409 || rows["tasks"] != nil {
		t.Fatal(status, rows)
	}
}
func TestPlanningLegacyNonfiniteBasis(t *testing.T) {
	s, a := planningFixture(t)
	ids := []string{}
	m := a.Members[a.User.ID]
	m.CapacityHours = math.Inf(1)
	a.Members[a.User.ID] = m
	for j := 0; j < 2; j++ {
		x := Task{ID: newID("inf"), Code: newID("code"), CompanyID: a.Company.ID, OwnerID: a.User.ID, CreatedBy: a.User.ID, Title: "Legacy numeric", Status: "todo", Priority: "medium", Recurrence: "none", EstimatedHours: 8, DueDate: "2026-10-11", Version: 1}
		normalizeTask(&x)
		if e := s.db.Create(&x).Error; e != nil {
			t.Fatal(e)
		}
		ids = append(ids, x.ID)
		field := "estimated_hours"
		if j == 1 {
			field = "actual_hours"
		}
		if e := s.db.Model(&Task{}).Where("id=?", x.ID).Update(field, math.Inf(1)).Error; e != nil {
			t.Fatal(e)
		}
	}
	v, e := loadPlanning(s.db, a, PlanningFilters{From: "2026-10-05", To: "2026-10-11"}, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	if v.Coverage.InvalidNumeric != 1 || v.Coverage.UniqueSelectedRemainingHours != 8 || v.Weeks[0].Utilization != nil {
		t.Fatal(v)
	}
	if _, e := json.Marshal(v); e != nil {
		t.Fatal(e)
	}
	if _, e := json.Marshal(planningWarnings(v)); e != nil {
		t.Fatal(e)
	}
	// Actual persisted legacy Infinity values must also survive the application HTTP boundary.
	cookie := login(t, s, "founder@example.com")
	path := "/api/companies/" + a.Company.ID + "/planning"
	status, summary, _ := req(t, s, "GET", path+"/summary?from=2026-10-05&to=2026-10-11", nil, cookie)
	if status != 200 || summary["coverage"].(map[string]any)["invalidNumeric"] != float64(1) {
		t.Fatal(status, summary)
	}
	basis := summary["projectionBasis"].(string)
	for _, endpoint := range []string{"warnings", "tasks"} {
		status, body, _ := req(t, s, "GET", path+"/"+endpoint+"?from=2026-10-05&to=2026-10-11&category=scheduled&projectionBasis="+basis, nil, cookie)
		if status != 200 {
			t.Fatal(endpoint, status, body)
		}
		if _, e := json.Marshal(body); e != nil {
			t.Fatal(endpoint, e)
		}
	}
	for _, id := range ids {
		status, body, _ := req(t, s, "GET", path+"/schedule-seed?from=2026-10-05&to=2026-10-11&projectionBasis="+basis+"&taskIds="+id, nil, cookie)
		if status != 422 || body["tasks"] != nil {
			t.Fatal("nonfinite seed must be controlled unavailable", status, body)
		}
	}
}
func TestPlanningWarningUnroundedThresholds(t *testing.T) {
	for j, tc := range []struct {
		effort, capacity float64
		kind             string
	}{{40.04, 40, "declared_weekly_overcapacity"}, {.04, 0, "effort_with_recorded_zero"}, {40.06, 40.07, ""}} {
		t.Run(fmt.Sprint(j), func(t *testing.T) {
			s, a := planningFixture(t)
			m := a.Members[a.User.ID]
			m.CapacityHours = tc.capacity
			a.Members[a.User.ID] = m
			x := Task{ID: newID("threshold"), Code: newID("code"), CompanyID: a.Company.ID, OwnerID: a.User.ID, CreatedBy: a.User.ID, Title: "Threshold", Status: "todo", Priority: "medium", Recurrence: "none", EstimatedHours: tc.effort, DueDate: "2026-10-11", Version: 1}
			normalizeTask(&x)
			if e := s.db.Create(&x).Error; e != nil {
				t.Fatal(e)
			}
			v, e := loadPlanning(s.db, a, PlanningFilters{From: "2026-10-05", To: "2026-10-11"}, time.Now())
			if e != nil {
				t.Fatal(e)
			}
			found := ""
			for _, w := range planningWarnings(v) {
				if w.Kind == "declared_weekly_overcapacity" || w.Kind == "effort_with_recorded_zero" {
					found = w.Kind
				}
			}
			if found != tc.kind {
				t.Fatal(tc, found)
			}
		})
	}
}
