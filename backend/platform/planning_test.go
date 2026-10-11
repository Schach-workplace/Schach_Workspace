package platform

import (
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
