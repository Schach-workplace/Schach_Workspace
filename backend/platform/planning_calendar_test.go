package platform

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func calendarFixtureTask(a *access, owner, id, date, status string) Task {
	t := Task{ID: id, Code: id, CompanyID: a.Company.ID, OwnerID: owner, CreatedBy: owner, Title: id, Status: status, Priority: "medium", Recurrence: "none", DueDate: date, Version: 1, CreatedAt: "2027-01-01T00:00:00Z"}
	normalizeTask(&t)
	return t
}
func TestPlanningCalendarCompleteCurrentRange(t *testing.T) {
	s, a := planningFixture(t)
	founder := login(t, s, "founder@example.com")
	uid := addPerson(t, s, founder, a.Company.ID, "calendar-reader@example.invalid", "member")
	cookie := login(t, s, "calendar-reader@example.invalid")
	if e := s.db.Model(&Company{}).Where("id=?", a.Company.ID).Update("timezone", "Asia/Kolkata").Error; e != nil {
		t.Fatal(e)
	}
	tasks := []Task{}
	for i := 0; i < 105; i++ {
		tasks = append(tasks, calendarFixtureTask(a, uid, fmt.Sprintf("calendar-new-%03d", i), "2026-10-11", "todo"))
	}
	old := calendarFixtureTask(a, uid, "calendar-older", "2026-10-11", "todo")
	old.CreatedAt = "2020-01-01T00:00:00Z"
	old.ParentID = "calendar-hidden"
	old.Dependencies = []string{"calendar-hidden"}
	tasks = append(tasks, old)
	tasks = append(tasks, calendarFixtureTask(a, uid, "calendar-accepted", "2026-10-11", "done"), calendarFixtureTask(a, uid, "calendar-closed", "2026-10-11", "cancelled"))
	timed := calendarFixtureTask(a, uid, "calendar-local-midnight", "2026-10-10", "todo")
	timed.DeadlineMode = "timed"
	timed.DueAt = "2026-10-10T18:45:00.123456Z"
	timed.DueTimezone = "Asia/Kolkata"
	tasks = append(tasks, timed)
	tasks = append(tasks, calendarFixtureTask(a, uid, "calendar-outside", "2026-10-12", "todo"), calendarFixtureTask(a, a.User.ID, "calendar-hidden", "2026-10-11", "todo"))
	if e := s.db.CreateInBatches(&tasks, 100).Error; e != nil {
		t.Fatal(e)
	}
	path := "/api/companies/" + a.Company.ID
	status, first, _ := req(t, s, "GET", path+"/tasks", nil, cookie)
	if status != 200 || len(first["tasks"].([]any)) != 100 || first["hasMore"] != true {
		t.Fatal(status, first)
	}
	for _, row := range first["tasks"].([]any) {
		if row.(map[string]any)["id"] == old.ID {
			t.Fatal("scale fixture did not reproduce first100 omission")
		}
	}
	for _, open := range []string{"true", "false"} {
		status, body, _ := req(t, s, "GET", path+"/planning/calendar?from=2026-10-11&to=2026-10-11&ownerId="+uid+"&openOnly="+open, nil, cookie)
		if status != 200 {
			t.Fatal(status, body)
		}
		want := 107
		if open == "false" {
			want = 109
		}
		rows := body["tasks"].([]any)
		if len(rows) != want || body["complete"] != true {
			t.Fatal(len(rows), want, body)
		}
		seen := map[string]bool{}
		for _, row := range rows {
			m := row.(map[string]any)
			id := m["id"].(string)
			seen[id] = true
			if id == old.ID && (m["parentId"] != "" || len(m["dependencies"].([]any)) != 0) {
				t.Fatal("hidden source reference leaked", m)
			}
			if id == timed.ID && (m["dueDate"] != "2026-10-11" || m["dueAt"] != string(timed.DueAt)) {
				t.Fatal(m)
			}
			if m["description"] != nil || m["actualHours"] != nil || m["comments"] != nil {
				t.Fatal("calendar DTO is not lean", m)
			}
		}
		if !seen[old.ID] || !seen[timed.ID] || seen["calendar-outside"] || seen["calendar-hidden"] {
			t.Fatal(seen)
		}
		if open == "true" && (seen["calendar-accepted"] || seen["calendar-closed"]) {
			t.Fatal(seen)
		}
	}
	var unchanged Task
	if e := s.db.First(&unchanged, "id=?", timed.ID).Error; e != nil {
		t.Fatal(e)
	}
	if unchanged.DueDate != timed.DueDate || unchanged.DueAt != timed.DueAt || unchanged.Version != 1 {
		t.Fatal("readonly calendar mutated commitment", unchanged)
	}
	for _, query := range []string{"from=2026-01-01&to=2026-03-26", "from=bad&to=2026-10-11", "from=2026-10-11&to=2026-10-10", "from=2026-10-11&to=2026-10-11&openOnly=maybe"} {
		status, body, _ := req(t, s, "GET", path+"/planning/calendar?"+query, nil, cookie)
		if status != 422 || body["tasks"] != nil {
			t.Fatal(status, body)
		}
	}
}
func TestPlanningCalendarBoundsAfterSourceFilters(t *testing.T) {
	s, a := planningFixture(t)
	cookie := login(t, s, "founder@example.com")
	rows := []Task{}
	for i := 0; i < 10001; i++ {
		rows = append(rows, calendarFixtureTask(a, a.User.ID, fmt.Sprintf("calendar-cap-%05d", i), "2026-10-12", "todo"))
	}
	if e := s.db.CreateInBatches(&rows, 100).Error; e != nil {
		t.Fatal(e)
	}
	path := "/api/companies/" + a.Company.ID + "/planning/calendar?from=2026-10-11&to=2026-10-11&ownerId=" + a.User.ID
	status, body, _ := req(t, s, "GET", path, nil, cookie)
	if status != 200 || len(body["tasks"].([]any)) != 0 || body["complete"] != true {
		t.Fatal(status, body)
	}
	status, body, _ = req(t, s, "GET", strings.Replace(path, "2026-10-11", "2026-10-12", -1), nil, cookie)
	if status != 422 || body["tasks"] != nil {
		t.Fatal(status, body)
	}
	// One oversized legacy title exercises the work budget without fabricated truncation.
	big := calendarFixtureTask(a, a.User.ID, "calendar-byte-cap", "2026-10-11", "todo")
	big.Title = strings.Repeat("x", 8<<20)
	if e := s.db.Create(&big).Error; e != nil {
		t.Fatal(e)
	}
	status, body, _ = req(t, s, "GET", path, nil, cookie)
	if status != 422 || body["tasks"] != nil {
		t.Fatal(status, body)
	}
}

func TestPlanningCalendarExactBoundaryAndDST(t *testing.T) {
	s, a := planningFixture(t)
	cookie := login(t, s, "founder@example.com")
	if e := s.db.Model(&Company{}).Where("id=?", a.Company.ID).Update("timezone", "America/New_York").Error; e != nil {
		t.Fatal(e)
	}
	// Spring DST day is23h. Include the final microsecond; exclude both adjacent days.
	cases := []struct {
		id, instant string
		want        bool
	}{{"calendar-dst-before", "2026-03-08T04:59:59.999999Z", false}, {"calendar-dst-first", "2026-03-08T05:00:00Z", true}, {"calendar-dst-last", "2026-03-09T03:59:59.999999Z", true}, {"calendar-dst-after", "2026-03-09T04:00:00Z", false}}
	for _, tc := range cases {
		row := calendarFixtureTask(a, a.User.ID, tc.id, "2026-03-07", "todo")
		row.DeadlineMode = "timed"
		row.DueAt = DeadlineInstant(tc.instant)
		row.DueTimezone = "America/New_York"
		if e := s.db.Create(&row).Error; e != nil {
			t.Fatal(e)
		}
	}
	status, body, _ := req(t, s, "GET", "/api/companies/"+a.Company.ID+"/planning/calendar?from=2026-03-08&to=2026-03-08&ownerId="+a.User.ID, nil, cookie)
	if status != 200 {
		t.Fatal(status, body)
	}
	seen := map[string]bool{}
	for _, value := range body["tasks"].([]any) {
		row := value.(map[string]any)
		seen[row["id"].(string)] = true
		if row["dueDate"] != "2026-03-08" {
			t.Fatal(row)
		}
	}
	for _, tc := range cases {
		if seen[tc.id] != tc.want {
			t.Fatal(tc, seen)
		}
	}
}

func TestPlanningCalendarAfterCompanyLockWait(t *testing.T) {
	s, db := testServer(t)
	if db.Dialector.Name() != "postgres" {
		t.Skip("native independent connections")
	}
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	owner := addPerson(t, s, founder, cid, "calendar-wait-owner@example.invalid", "member")
	other := addPerson(t, s, founder, cid, "calendar-wait-other@example.invalid", "member")
	cookie := login(t, s, "calendar-wait-owner@example.invalid")
	body := taskBody(owner)
	body["dueDate"] = "2026-10-11"
	body["title"] = "Current calendar private source"
	id := createTask(t, s, founder, cid, body)
	tx := db.Begin()
	defer tx.Rollback()
	if e := lockCompany(tx, cid); e != nil {
		t.Fatal(e)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		_, _, w := req(t, s, "GET", "/api/companies/"+cid+"/planning/calendar?from=2026-10-11&to=2026-10-11", nil, cookie)
		done <- w
	}()
	waitM8Lock(t, db, "companies")
	if e := tx.Model(&Task{}).Where("id=?", id).Updates(map[string]any{"owner_id": other, "created_by": other, "version": 2}).Error; e != nil {
		t.Fatal(e)
	}
	if e := tx.Commit().Error; e != nil {
		t.Fatal(e)
	}
	select {
	case w := <-done:
		t.Logf("Actual current calendar after company wait: %d %s", w.Code, w.Body)
		if w.Code != 200 || strings.Contains(w.Body.String(), "Current calendar private source") || strings.Contains(w.Body.String(), id) {
			t.Fatal(w.Code, w.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("calendar reader did not finish")
	}
}

func TestPlanningCalendarCivilMidnightTransitions(t *testing.T) {
	for _, c := range []struct {
		name, zone, from, to string
		instants             []string
		want                 []string
	}{
		{"HavanaBeforeGap", "America/Havana", "2026-03-07", "2026-03-07", []string{"2026-03-08T04:30:00.123456Z", "2026-03-08T05:30:00.123456Z"}, []string{"2026-03-08T04:30:00.123456Z"}},
		{"HavanaGapDay", "America/Havana", "2026-03-08", "2026-03-08", []string{"2026-03-08T04:59:59.999999Z", "2026-03-08T05:00:00Z", "2026-03-09T03:59:59.999999Z", "2026-03-09T04:00:00Z"}, []string{"2026-03-08T05:00:00Z", "2026-03-09T03:59:59.999999Z"}},
		{"HavanaWeekEndingGap", "America/Havana", "2026-03-02", "2026-03-08", []string{"2026-03-09T03:30:00.654321Z", "2026-03-09T04:00:00Z"}, []string{"2026-03-09T03:30:00.654321Z"}},
		{"HavanaMidnightOverlap", "America/Havana", "2026-11-01", "2026-11-01", []string{"2026-11-01T03:59:59.999999Z", "2026-11-01T04:30:00.123456Z", "2026-11-01T05:30:00.654321Z", "2026-11-02T04:59:59.999999Z", "2026-11-02T05:00:00Z"}, []string{"2026-11-01T04:30:00.123456Z", "2026-11-01T05:30:00.654321Z", "2026-11-02T04:59:59.999999Z"}},
		{"ApiaBeforeSkippedDate", "Pacific/Apia", "2011-12-29", "2011-12-29", []string{"2011-12-30T09:59:59.999999Z", "2011-12-30T10:00:00Z"}, []string{"2011-12-30T09:59:59.999999Z"}},
		{"ApiaSkippedDate", "Pacific/Apia", "2011-12-30", "2011-12-30", []string{"2011-12-30T09:59:59.999999Z", "2011-12-30T10:00:00Z"}, nil},
		{"ApiaRangeAcrossSkippedDate", "Pacific/Apia", "2011-12-29", "2011-12-31", []string{"2011-12-30T09:59:59.999999Z", "2011-12-30T10:00:00Z"}, []string{"2011-12-30T09:59:59.999999Z", "2011-12-30T10:00:00Z"}},
		{"StJohnsRepeatedDateWithHole", "America/St_Johns", "1988-10-29", "1988-10-29", []string{"1988-10-30T01:29:59.999999Z", "1988-10-30T01:30:30.123456Z", "1988-10-30T01:31:30.654321Z", "1988-10-30T03:29:59.999999Z", "1988-10-30T03:30:00Z"}, []string{"1988-10-30T01:29:59.999999Z", "1988-10-30T01:31:30.654321Z", "1988-10-30T03:29:59.999999Z"}},
		{"FutureLeapYearSeam", "America/Havana", "2040-12-31", "2040-12-31", []string{"2040-12-31T04:59:59.999999Z", "2040-12-31T05:00:00Z", "2041-01-01T04:59:59.999999Z", "2041-01-01T05:00:00Z"}, []string{"2040-12-31T05:00:00Z", "2041-01-01T04:59:59.999999Z"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			s, a := planningFixture(t)
			cookie := login(t, s, "founder@example.com")
			if e := s.db.Model(&Company{}).Where("id=?", a.Company.ID).Update("timezone", c.zone).Error; e != nil {
				t.Fatal(e)
			}
			loc, e := time.LoadLocation(c.zone)
			if e != nil {
				t.Fatal(e)
			}
			for i, instant := range c.instants {
				row := calendarFixtureTask(a, a.User.ID, fmt.Sprintf("civil-%d", i), "2026-01-01", "todo")
				row.DeadlineMode = "timed"
				row.DueAt = DeadlineInstant(instant)
				row.DueTimezone = "UTC"
				if e := s.db.Create(&row).Error; e != nil {
					t.Fatal(e)
				}
			}
			st, body, _ := req(t, s, "GET", "/api/companies/"+a.Company.ID+"/planning/calendar?from="+c.from+"&to="+c.to, nil, cookie)
			if st != 200 || body["complete"] != true {
				t.Fatal(st, body)
			}
			seen := map[string]bool{}
			for _, item := range body["tasks"].([]any) {
				row := item.(map[string]any)
				instant := row["dueAt"].(string)
				seen[instant] = true
				parsed, e := time.Parse(time.RFC3339Nano, instant)
				if e != nil {
					t.Fatal(e)
				}
				date := parsed.In(loc).Format("2006-01-02")
				if date < c.from || date > c.to || row["dueDate"] != date {
					t.Fatal("unselected civil date in complete response", row)
				}
			}
			if len(seen) != len(c.want) {
				t.Fatalf("range %s..%s: want %v, actual %v", c.from, c.to, c.want, seen)
			}
			for _, instant := range c.want {
				if !seen[instant] {
					t.Fatalf("omitted actual company-date commitment %s: %v", instant, body)
				}
			}
			var stored Task
			if e := s.db.First(&stored, "id=?", "civil-0").Error; e != nil {
				t.Fatal(e)
			}
			if stored.DueDate != "2026-01-01" || string(stored.DueAt) != c.instants[0] || stored.Version != 1 {
				t.Fatal("calendar changed original source", stored)
			}
		})
	}
}

func TestPlanningCalendarCivilDateBeforeCap(t *testing.T) {
	s, a := planningFixture(t)
	cookie := login(t, s, "founder@example.com")
	if e := s.db.Model(&Company{}).Where("id=?", a.Company.ID).Update("timezone", "America/Havana").Error; e != nil {
		t.Fatal(e)
	}
	outside := []Task{}
	for i := 0; i < 10001; i++ {
		row := calendarFixtureTask(a, a.User.ID, fmt.Sprintf("civil-outside-%05d", i), "2026-03-08", "todo")
		row.DeadlineMode = "timed"
		row.DueAt = "2026-03-08T04:30:00.123456Z"
		row.DueTimezone = "UTC"
		outside = append(outside, row)
	}
	if e := s.db.CreateInBatches(&outside, 100).Error; e != nil {
		t.Fatal(e)
	}
	inside := calendarFixtureTask(a, a.User.ID, "civil-selected", "2026-03-08", "todo")
	if e := s.db.Create(&inside).Error; e != nil {
		t.Fatal(e)
	}
	st, body, _ := req(t, s, "GET", "/api/companies/"+a.Company.ID+"/planning/calendar?from=2026-03-08&to=2026-03-08", nil, cookie)
	if st != 200 || body["complete"] != true || len(body["tasks"].([]any)) != 1 {
		t.Fatal("previous civil day exhausted selected-date cap", st, body)
	}
	if body["tasks"].([]any)[0].(map[string]any)["id"] != inside.ID {
		t.Fatal(body)
	}
}

func TestPlanningCalendarSkippedCivilAllDayLabel(t *testing.T) {
	s, a := planningFixture(t)
	cookie := login(t, s, "founder@example.com")
	if e := s.db.Model(&Company{}).Where("id=?", a.Company.ID).Update("timezone", "Pacific/Apia").Error; e != nil {
		t.Fatal(e)
	}
	row := calendarFixtureTask(a, a.User.ID, "skipped-all-day-label", "2011-12-30", "todo")
	if e := s.db.Create(&row).Error; e != nil {
		t.Fatal(e)
	}
	st, body, _ := req(t, s, "GET", "/api/companies/"+a.Company.ID+"/planning/calendar?from=2011-12-30&to=2011-12-30", nil, cookie)
	if st != 200 || body["complete"] != true || len(body["tasks"].([]any)) != 1 {
		t.Fatal(st, body)
	}
	task := body["tasks"].([]any)[0].(map[string]any)
	if task["id"] != row.ID || task["dueDate"] != "2011-12-30" || task["dueAt"] != "" {
		t.Fatal("civil label was changed into invented instant", task)
	}
}
