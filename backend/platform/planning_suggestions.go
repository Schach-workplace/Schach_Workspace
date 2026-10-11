package platform

import (
	"database/sql"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"strings"
	"time"
)

type PlanningWarning struct {
	Kind        string        `json:"kind"`
	Week        string        `json:"week,omitempty"`
	TaskID      string        `json:"taskId,omitempty"`
	Title       string        `json:"title,omitempty"`
	Description string        `json:"description"`
	Drill       PlanningDrill `json:"drill"`
}

func planningWarnings(v PlanningView) []PlanningWarning {
	out := []PlanningWarning{}
	add := func(kind string, r planningRow, description string) {
		out = append(out, PlanningWarning{Kind: kind, TaskID: r.task.ID, Title: r.task.Title, Description: description, Drill: PlanningDrill{Category: r.state}})
	}
	sources := map[string]Task{}
	for _, t := range v.sources {
		sources[t.ID] = t
	}
	for _, r := range v.rows {
		if r.state == "undated" {
			add("undated_work", r, "No recorded commitment interval; omitted from weekly sums.")
		}
		if r.task.EstimatedHours == 0 {
			add("recorded_zero_estimate", r, "Recorded zero estimate may mean unestimated work.")
		}
		if r.state == "invalid" || !r.validNumeric {
			add("missing_input", r, "Invalid recorded dates or effort inputs; excluded from sums.")
		}
		for _, id := range r.task.Dependencies {
			source, ok := sources[id]
			if !ok {
				add("prerequisite_unavailable", r, "A prerequisite is unavailable in your current scope.")
				break
			}
			_, end, state := planningInterval(source, v.Timezone)
			if state == "scheduled" && r.state == "scheduled" && end > r.start {
				add("dependency_order", r, "A readable prerequisite ends after this work starts; review ordering.")
			}
		}
	}
	for _, w := range v.Weeks {
		for _, p := range w.People {
			kind, description := "", ""
			if p.CapacityState == "recorded_zero" && p.remaining > 0 {
				kind = "effort_with_recorded_zero"
				description = "Visible effort with recorded zero weekly capacity; utilization unavailable."
			}
			if p.CapacityState == "recorded_positive" && p.remaining > p.RecordedCapacity {
				kind = "declared_weekly_overcapacity"
				description = "Visible estimate exceeds recorded weekly capacity; review commitments."
			}
			if kind != "" {
				out = append(out, PlanningWarning{Kind: kind, Week: w.From, Description: description, Drill: p.Drill})
			}
		}
		groups := map[string][]planningRow{}
		for _, r := range v.rows {
			if r.state == "scheduled" && r.task.OwnerID != "" && r.start <= w.SelectedTo && r.end >= w.SelectedFrom {
				groups[r.task.OwnerID] = append(groups[r.task.OwnerID], r)
			}
		}
		for _, rows := range groups {
			sort.Slice(rows, func(i, j int) bool {
				if rows[i].start == rows[j].start {
					return rows[i].task.ID < rows[j].task.ID
				}
				return rows[i].start < rows[j].start
			})
			marked := map[string]planningRow{}
			maxEnd := ""
			var maxRow planningRow
			for _, r := range rows {
				if r.start <= maxEnd {
					marked[r.task.ID] = r
					marked[maxRow.task.ID] = maxRow
				}
				if r.end > maxEnd {
					maxEnd = r.end
					maxRow = r
				}
			}
			for _, r := range marked {
				out = append(out, PlanningWarning{Kind: "overlapping_commitments", Week: w.From, TaskID: r.task.ID, Title: r.task.Title, Description: "Recorded intervals overlap. This advisory does not prove simultaneous bookings or daily availability.", Drill: PlanningDrill{Category: "scheduled", Week: w.From, PersonID: r.task.OwnerID}})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.Week != b.Week {
			return a.Week < b.Week
		}
		if a.TaskID != b.TaskID {
			return a.TaskID < b.TaskID
		}
		return a.Drill.PersonID < b.Drill.PersonID
	})
	unique := out[:0]
	seen := map[string]bool{}
	for _, w := range out {
		key := w.Kind + ":" + w.Week + ":" + w.TaskID + ":" + w.Drill.PersonID
		if !seen[key] {
			seen[key] = true
			unique = append(unique, w)
		}
	}
	return unique
}
func (s *Server) planningWarnings(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := planningLimit(r)
	if e != nil {
		return e
	}
	rows := []PlanningWarning{}
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
		basis := payloadHash([]any{a.User.ID, a.Company.ID, v.ProjectionBasis, "warnings"})
		c := readCursor{}
		if r.URL.Query().Get("cursor") != "" {
			c, e = decodeReadCursor(r.URL.Query().Get("cursor"), basis)
			if e != nil {
				return e
			}
		}
		for _, row := range planningWarnings(v) {
			id := row.Kind + ":" + row.Week + ":" + row.TaskID + ":" + row.Drill.PersonID
			if id <= c.ID {
				continue
			}
			if len(rows) == limit {
				more = true
				break
			}
			rows = append(rows, row)
			cursor = encodeReadCursor(readCursor{Basis: basis, ID: id})
		}
		if !more {
			cursor = ""
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"warnings": rows, "cursor": cursor, "hasMore": more})
}
func (s *Server) planningScheduleSeed(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	raw := r.URL.Query().Get("taskIds")
	if len(raw) > 8100 {
		return invalid("Select at most 100 tasks.")
	}
	ids := strings.Split(raw, ",")
	if len(ids) < 1 || len(ids) > 100 {
		return invalid("Select 1–100 tasks.")
	}
	tasks := []Task{}
	context := ScheduleContext{Projects: []ScheduleVersion{}, Milestones: []ScheduleVersion{}, Sources: []ScheduleVersion{}}
	basis := ""
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		v, e := loadPlanning(tx, a, planningFilters(r), time.Now())
		if e != nil {
			return e
		}
		if e = planningBasis(r, v); e != nil {
			return e
		}
		basis = v.ProjectionBasis
		selected := map[string]bool{}
		projects := map[string]bool{}
		refs := map[string]bool{}
		allowed := map[string]bool{}
		for _, row := range v.rows {
			allowed[row.task.ID] = true
		}
		for _, id := range ids {
			if id == "" || selected[id] {
				return invalid("Select unique task IDs.")
			}
			selected[id] = true
			if !allowed[id] {
				return missing()
			}
			task, e := scopedTask(tx, a, id)
			if e != nil {
				return e
			}
			if !a.canWrite(task) {
				return denied()
			}
			// The canonical M5 seed contains Task numeric fields. Keep legacy
			// nonfinite values unavailable instead of fabricating replacements.
			if !finite(task.EstimatedHours) || !finite(task.Progress) || !finite(task.ActualHours) {
				return invalid("Selected task has invalid recorded numeric inputs; inspect and repair the task before scheduling.")
			}
			tasks = append(tasks, task)
			if task.ProjectID != "" && !projects[task.ProjectID] {
				project, e := scopedProject(tx, a, task.ProjectID)
				if e != nil {
					return e
				}
				context.Projects = append(context.Projects, ScheduleVersion{ID: project.ID, Version: project.Version})
				projects[project.ID] = true
			}
			for _, id := range append(append([]string{}, task.Dependencies...), task.ParentID) {
				if id != "" {
					refs[id] = true
				}
			}
		}
		for _, source := range v.sources {
			if refs[source.ID] {
				context.Sources = append(context.Sources, ScheduleVersion{ID: source.ID, Version: source.Version})
			}
		}
		if len(context.Sources) > 1000 {
			return invalid("Narrow selection to at most 1000 inspected sources.")
		}
		sort.Slice(context.Projects, func(i, j int) bool { return context.Projects[i].ID < context.Projects[j].ID })
		sort.Slice(context.Sources, func(i, j int) bool { return context.Sources[i].ID < context.Sources[j].ID })
		for i := range tasks {
			tasks[i].Comments = []Comment{}
			tasks[i].Attachments = []Attachment{}
			tasks[i].TimeEntries = []TimeEntry{}
			deps := []string{}
			for _, id := range tasks[i].Dependencies {
				if _, e := scopedTask(tx, a, id); e == nil {
					deps = append(deps, id)
				}
			}
			tasks[i].Dependencies = deps
			if _, e := scopedTask(tx, a, tasks[i].ParentID); e != nil {
				tasks[i].ParentID = ""
			}
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"tasks": tasks, "context": context, "projectionBasis": basis, "writes": false})
}
