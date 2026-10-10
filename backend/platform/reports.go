package platform

import (
	"net/http"
	"time"
)

// taskReport is a lean current-state input projection. Business authorization is
// identical to workspace; conversation and finance data never enter this query.
func (s *Server) taskReport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	q := r.URL.Query()
	from, to := q.Get("from"), q.Get("to")
	if from == "" || to == "" || !validDate(from) || !validDate(to) || from > to {
		return invalid("Choose a valid report start and end date.")
	}
	loc, e := time.LoadLocation(a.Company.Timezone)
	if e != nil {
		return invalid("The company report timezone is invalid.")
	}
	var tasks []Task
	if e = s.db.WithContext(r.Context()).Omit("Comments", "TimeEntries", "Attachments", "Checklist").Where("company_id=?", a.Company.ID).Order("created_at DESC, id DESC").Find(&tasks).Error; e != nil {
		return e
	}
	visible := map[string]bool{}
	for _, t := range tasks {
		if a.canRead(t) {
			visible[t.ID] = true
		}
	}
	rows := []Task{}
	for _, t := range tasks {
		if !visible[t.ID] || t.Status == "cancelled" {
			continue
		}
		if d := q.Get("departmentId"); d != "" && t.DepartmentID != d {
			continue
		}
		if o := q.Get("ownerId"); o != "" && t.OwnerID != o {
			continue
		}
		if p := q.Get("projectId"); p != "" && t.ProjectID != p {
			continue
		}
		due := t.DueDate != "" && t.DueDate >= from && t.DueDate <= to
		accepted := false
		if t.Status == "done" {
			if at, err := time.Parse(time.RFC3339Nano, t.CompletedAt); err == nil {
				day := at.In(loc).Format("2006-01-02")
				accepted = day >= from && day <= to
			}
		}
		if !due && !accepted {
			continue
		}
		t.Comments = []Comment{}
		t.Attachments = []Attachment{}
		t.TimeEntries = []TimeEntry{}
		t.Checklist = []ChecklistItem{}
		if t.Tags == nil {
			t.Tags = []string{}
		}
		if t.Collaborators == nil {
			t.Collaborators = []string{}
		}
		deps := []string{}
		for _, id := range t.Dependencies {
			if visible[id] {
				deps = append(deps, id)
			}
		}
		t.Dependencies = deps
		if !visible[t.ParentID] {
			t.ParentID = ""
		}
		rows = append(rows, t)
	}
	return respond(w, 200, map[string]any{"tasks": rows, "timezone": a.Company.Timezone, "generatedAt": nowString(), "basis": "current_state"})
}
