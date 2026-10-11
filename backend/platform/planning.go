package platform

import (
	"database/sql"
	"encoding/json"
	"gorm.io/gorm"
	"math"
	"net/http"
	"sort"
	"time"
)

type PlanningFilters struct {
	From         string `json:"from"`
	To           string `json:"to"`
	DepartmentID string `json:"departmentId"`
	OwnerID      string `json:"ownerId"`
	ProjectID    string `json:"projectId"`
}
type PlanningCoverage struct {
	UniqueSelectedRemainingHours float64 `json:"uniqueSelectedRemainingHours"`
	WeeklyExposureHours          float64 `json:"weeklyExposureHours"`
	Undated                      int     `json:"undated"`
	InvalidInterval              int     `json:"invalidInterval"`
	RecordedZeroEstimate         int     `json:"recordedZeroEstimate"`
	MissingOwner                 int     `json:"missingOwner"`
	InvalidNumeric               int     `json:"invalidNumeric"`
	VisibleTasks                 int     `json:"visibleTasks"`
}
type PlanningPerson struct {
	ID               string        `json:"id"`
	Name             string        `json:"name"`
	RecordedCapacity float64       `json:"recordedCapacity"`
	CapacityState    string        `json:"capacityState"`
	RemainingHours   float64       `json:"remainingHours"`
	Utilization      *float64      `json:"utilization"`
	Drill            PlanningDrill `json:"drill"`
}
type PlanningDrill struct {
	Category string `json:"category"`
	Week     string `json:"week,omitempty"`
	PersonID string `json:"personId,omitempty"`
}
type PlanningWeek struct {
	From                   string           `json:"from"`
	To                     string           `json:"to"`
	SelectedFrom           string           `json:"selectedFrom"`
	SelectedTo             string           `json:"selectedTo"`
	Partial                bool             `json:"partial"`
	RemainingHours         float64          `json:"remainingHours"`
	PositiveCapacityHours  float64          `json:"positiveCapacityHours"`
	PositiveCapacityEffort float64          `json:"positiveCapacityEffort"`
	Utilization            *float64         `json:"utilization"`
	ExcludedCapacityRows   int              `json:"excludedCapacityRows"`
	People                 []PlanningPerson `json:"people"`
	Drill                  PlanningDrill    `json:"drill"`
}
type PlanningView struct {
	Method            string           `json:"method"`
	MethodDescription string           `json:"methodDescription"`
	Timezone          string           `json:"timezone"`
	GeneratedAt       string           `json:"generatedAt"`
	ReadBasis         string           `json:"readBasis"`
	ProjectionBasis   string           `json:"projectionBasis"`
	Filters           PlanningFilters  `json:"filters"`
	Weeks             []PlanningWeek   `json:"weeks"`
	Coverage          PlanningCoverage `json:"coverage"`
	rows              []planningRow
	sources           []Task
}
type planningRow struct {
	task              Task
	start, end, state string
	remaining         float64
	validNumeric      bool
}
type PlanningTask struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	Version        int64           `json:"version"`
	StartDate      string          `json:"startDate"`
	DueDate        string          `json:"dueDate"`
	DeadlineMode   string          `json:"deadlineMode"`
	DueAt          DeadlineInstant `json:"dueAt"`
	DueTimezone    string          `json:"dueTimezone"`
	RemainingHours float64         `json:"remainingHours"`
	State          string          `json:"state"`
}

func planningDate(v string) bool {
	t, e := time.Parse("2006-01-02", v)
	return e == nil && t.Year() >= 1900 && t.Year() <= 2200 && t.Format("2006-01-02") == v
}
func planningInterval(t Task, zone string) (string, string, string) {
	start, end := t.StartDate, t.DueDate
	if t.DeadlineMode == "timed" {
		loc, e := time.LoadLocation(zone)
		instant, ie := time.Parse(time.RFC3339Nano, string(t.DueAt))
		if e != nil || ie != nil || instant.Year() < 1900 || instant.Year() > 2200 {
			return "", "", "invalid"
		}
		end = instant.In(loc).Format("2006-01-02")
	}
	if start == "" && end == "" {
		return "", "", "undated"
	}
	if start != "" && !planningDate(start) || end != "" && !planningDate(end) {
		return "", "", "invalid"
	}
	if start == "" {
		start = end
	}
	if end == "" {
		end = start
	}
	if start > end {
		return "", "", "invalid"
	}
	return start, end, "scheduled"
}
func roundPlanning(v float64) float64 { return math.Round(v*10) / 10 }
func loadPlanning(tx *gorm.DB, a *access, f PlanningFilters, now time.Time) (PlanningView, error) {
	v := PlanningView{Method: "visible_remaining_overlap_v1", MethodDescription: "Authorized work in this view. Full remaining estimate is counted once per overlapping week against the whole recorded weekly capacity, including partial weeks. Unique effort differs from weekly exposure; recorded zero is possibly unestimated. Capacity is not attendance or free time.", Timezone: a.Company.Timezone, GeneratedAt: now.UTC().Format(time.RFC3339Nano), ReadBasis: accessBasis(a), Filters: f, Weeks: []PlanningWeek{}}
	if !planningDate(f.From) || !planningDate(f.To) || f.From > f.To {
		return v, invalid("Choose valid company dates from 1900–2200.")
	}
	from, _ := time.Parse("2006-01-02", f.From)
	to, _ := time.Parse("2006-01-02", f.To)
	if to.Sub(from) > 83*24*time.Hour {
		return v, invalid("Choose at most 84 calendar days.")
	}
	for _, id := range []string{f.OwnerID, f.DepartmentID, f.ProjectID} {
		if len(id) > 80 {
			return v, invalid("Planning filter is too long.")
		}
	}
	q := taskReadQuery(tx, a).Where("status NOT IN ?", []string{"done", "cancelled"})
	if f.OwnerID != "" {
		q = q.Where("owner_id=?", f.OwnerID)
	}
	if f.DepartmentID != "" {
		q = q.Where("department_id=?", f.DepartmentID)
	}
	if f.ProjectID != "" {
		q = q.Where("project_id=?", f.ProjectID)
	}
	var tasks []Task
	if e := q.Order("id").Limit(10001).Find(&tasks).Error; e != nil {
		return v, e
	}
	if len(tasks) > 10000 {
		return v, rangeTooLarge()
	}
	// Referenced readable prerequisites/parents participate in the identical basis,
	// even outside filters. Hidden references become a generic warning only.
	refs := map[string]bool{}
	for _, t := range tasks {
		for _, id := range append(append([]string{}, t.Dependencies...), t.ParentID) {
			if id != "" {
				refs[id] = true
			}
		}
	}
	ids := []string{}
	for id := range refs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	sources := []Task{}
	for i := 0; i < len(ids); i += 100 {
		end := i + 100
		if end > len(ids) {
			end = len(ids)
		}
		var rows []Task
		if e := taskReadQuery(tx, a).Where("id IN ?", ids[i:end]).Order("id").Find(&rows).Error; e != nil {
			return v, e
		}
		sources = append(sources, rows...)
	}
	v.sources = sources
	normalized := []any{a.Company.Timezone, f, tasks, sources}
	members := []Membership{}
	seen := map[string]bool{}
	for _, t := range tasks {
		if m, ok := a.Members[t.OwnerID]; ok && m.Active && !seen[t.OwnerID] {
			members = append(members, m)
			seen[t.OwnerID] = true
		}
	}
	sort.Slice(members, func(i, j int) bool { return members[i].UserID < members[j].UserID })
	normalized = append(normalized, members)
	b, e := json.Marshal(normalized)
	if e != nil {
		return v, e
	}
	if len(b) > 8<<20 {
		return v, rangeTooLarge()
	}
	v.ProjectionBasis = payloadHash(normalized)
	for _, t := range tasks {
		start, end, state := planningInterval(t, v.Timezone)
		if state == "scheduled" && (end < f.From || start > f.To) {
			continue
		}
		r := planningRow{task: t, start: start, end: end, state: state, validNumeric: finite(t.EstimatedHours) && t.EstimatedHours >= 0 && t.EstimatedHours <= 100000 && finite(t.Progress) && t.Progress >= 0 && t.Progress <= 100}
		if r.validNumeric {
			r.remaining = t.EstimatedHours * (1 - t.Progress/100)
		} else {
			v.Coverage.InvalidNumeric++
		}
		v.rows = append(v.rows, r)
		v.Coverage.VisibleTasks++
		if state == "undated" {
			v.Coverage.Undated++
		}
		if state == "invalid" {
			v.Coverage.InvalidInterval++
		}
		if t.EstimatedHours == 0 {
			v.Coverage.RecordedZeroEstimate++
		}
		m, ok := a.Members[t.OwnerID]
		if !ok || !m.Active || a.Users[t.OwnerID].ID == "" {
			v.Coverage.MissingOwner++
		}
		if state == "scheduled" && r.validNumeric {
			v.Coverage.UniqueSelectedRemainingHours += r.remaining
		}
	}
	monday := from.AddDate(0, 0, -(int(from.Weekday())+6)%7)
	for d := monday; !d.After(to); d = d.AddDate(0, 0, 7) {
		w := PlanningWeek{From: d.Format("2006-01-02"), To: d.AddDate(0, 0, 6).Format("2006-01-02"), People: []PlanningPerson{}, Drill: PlanningDrill{Category: "scheduled", Week: d.Format("2006-01-02")}}
		w.SelectedFrom = w.From
		if f.From > w.SelectedFrom {
			w.SelectedFrom = f.From
		}
		w.SelectedTo = w.To
		if f.To < w.SelectedTo {
			w.SelectedTo = f.To
		}
		w.Partial = w.From != w.SelectedFrom || w.To != w.SelectedTo
		effort := map[string]float64{}
		for _, r := range v.rows {
			if r.state != "scheduled" || !r.validNumeric || r.end < w.SelectedFrom || r.start > w.SelectedTo {
				continue
			}
			w.RemainingHours += r.remaining
			m, ok := a.Members[r.task.OwnerID]
			if ok && m.Active && a.Users[r.task.OwnerID].ID != "" {
				effort[r.task.OwnerID] += r.remaining
			}
		}
		for id, h := range effort {
			m := a.Members[id]
			p := PlanningPerson{ID: id, Name: a.Users[id].Name, RecordedCapacity: m.CapacityHours, RemainingHours: roundPlanning(h), CapacityState: "recorded_positive", Drill: PlanningDrill{Category: "scheduled", Week: w.From, PersonID: id}}
			if !finite(m.CapacityHours) || m.CapacityHours < 0 || m.CapacityHours > 168 {
				p.RecordedCapacity = 0
				p.CapacityState = "invalid"
				w.ExcludedCapacityRows++
			} else if m.CapacityHours == 0 {
				p.CapacityState = "recorded_zero"
				w.ExcludedCapacityRows++
			} else {
				u := roundPlanning(h / m.CapacityHours * 100)
				p.Utilization = &u
				w.PositiveCapacityHours += m.CapacityHours
				w.PositiveCapacityEffort += h
			}
			w.People = append(w.People, p)
		}
		sort.Slice(w.People, func(i, j int) bool {
			if w.People[i].Name == w.People[j].Name {
				return w.People[i].ID < w.People[j].ID
			}
			return w.People[i].Name < w.People[j].Name
		})
		if w.PositiveCapacityHours > 0 {
			u := roundPlanning(w.PositiveCapacityEffort / w.PositiveCapacityHours * 100)
			w.Utilization = &u
		}
		v.Coverage.WeeklyExposureHours += w.RemainingHours
		w.RemainingHours = roundPlanning(w.RemainingHours)
		w.PositiveCapacityEffort = roundPlanning(w.PositiveCapacityEffort)
		v.Weeks = append(v.Weeks, w)
	}
	v.Coverage.UniqueSelectedRemainingHours = roundPlanning(v.Coverage.UniqueSelectedRemainingHours)
	v.Coverage.WeeklyExposureHours = roundPlanning(v.Coverage.WeeklyExposureHours)
	return v, nil
}
func planningFilters(r *http.Request) PlanningFilters {
	q := r.URL.Query()
	return PlanningFilters{From: q.Get("from"), To: q.Get("to"), OwnerID: q.Get("ownerId"), DepartmentID: q.Get("departmentId"), ProjectID: q.Get("projectId")}
}
func planningBasis(r *http.Request, v PlanningView) error {
	if r.URL.Query().Get("projectionBasis") != v.ProjectionBasis {
		return &apiError{Status: 409, Code: "projection_changed", Message: "Planning sources changed. Refresh and review this view."}
	}
	return nil
}
func (s *Server) planningSummary(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var v PlanningView
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error { v, e = loadPlanning(tx, a, planningFilters(r), time.Now()); return e }, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, v)
}
func planningTask(r planningRow) PlanningTask {
	return PlanningTask{ID: r.task.ID, Title: r.task.Title, Version: r.task.Version, StartDate: r.task.StartDate, DueDate: r.end, DeadlineMode: r.task.DeadlineMode, DueAt: r.task.DueAt, DueTimezone: r.task.DueTimezone, RemainingHours: roundPlanning(r.remaining), State: r.state}
}
func planningLimit(r *http.Request) (int, error) {
	if r.URL.Query().Get("limit") == "" {
		return 50, nil
	}
	return pageLimit(r)
}
func (s *Server) planningTasks(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := planningLimit(r)
	if e != nil {
		return e
	}
	rows := []PlanningTask{}
	cursor := ""
	more := false
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		v, e := loadPlanning(tx, a, planningFilters(r), time.Now())
		if e != nil {
			return e
		}
		if e = planningBasis(r, v); e != nil {
			return e
		}
		basis := payloadHash([]any{a.User.ID, a.Company.ID, v.ProjectionBasis, r.URL.Query().Get("category"), r.URL.Query().Get("week"), r.URL.Query().Get("personId")})
		c := readCursor{}
		if r.URL.Query().Get("cursor") != "" {
			c, e = decodeReadCursor(r.URL.Query().Get("cursor"), basis)
		}
		if e != nil {
			return e
		}
		category := r.URL.Query().Get("category")
		if !in(category, "scheduled", "undated", "invalid", "zero_estimate") {
			return invalid("Choose a planning drill category.")
		}
		week := r.URL.Query().Get("week")
		if week != "" && !planningDate(week) {
			return invalid("Invalid week.")
		}
		end := ""
		if week != "" {
			d, _ := time.Parse("2006-01-02", week)
			end = d.AddDate(0, 0, 6).Format("2006-01-02")
		}
		for _, row := range v.rows {
			if row.task.ID <= c.ID || r.URL.Query().Get("personId") != "" && row.task.OwnerID != r.URL.Query().Get("personId") {
				continue
			}
			if category == "zero_estimate" && row.task.EstimatedHours != 0 || category != "zero_estimate" && row.state != category {
				continue
			}
			if week != "" && (row.state != "scheduled" || row.end < week || row.start > end) {
				continue
			}
			if len(rows) == limit {
				more = true
				break
			}
			rows = append(rows, planningTask(row))
		}
		if more {
			cursor = encodeReadCursor(readCursor{Basis: basis, ID: rows[len(rows)-1].ID})
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"tasks": rows, "cursor": cursor, "hasMore": more})
}
