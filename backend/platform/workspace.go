package platform

import (
	"net/http"
	"sort"
)

func (s *Server) companies(w http.ResponseWriter, r *http.Request) error {
	u, _, err := s.authenticate(r)
	if err != nil {
		return err
	}
	v, err := s.sessionFor(s.db, u)
	if err != nil {
		return err
	}
	return respond(w, 200, map[string]any{"companies": v.Companies})
}
func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) error {
	return s.readWorkspace(w, r, true)
}
func (s *Server) workspace(w http.ResponseWriter, r *http.Request) error {
	return s.readWorkspace(w, r, false)
}
func (s *Server) readWorkspace(w http.ResponseWriter, r *http.Request, lean bool) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	d := WorkspaceData{ReadBasis: accessBasis(a), Company: a.Company, Me: person(a.User, a.Member), Departments: []Department{}, People: []Person{}, Projects: []Project{}, Tasks: []Task{}, Goals: []Goal{}, Activities: []Activity{}, Notifications: []Notification{}}
	db := s.db.WithContext(r.Context())
	var tasks []Task
	taskQuery := db.Where("company_id = ?", a.Company.ID)
	if lean {
		taskQuery = taskReadQuery(db, a).Select("id", "owner_id", "created_by", "reviewer_id", "department_id", "project_id", "collaborators")
	}
	if e = taskQuery.Order("created_at DESC").Find(&tasks).Error; e != nil {
		return e
	}
	visible := map[string]bool{}
	userIDs := map[string]bool{a.User.ID: true}
	departmentIDs := map[string]bool{}
	projectIDs := map[string]bool{}
	for _, t := range tasks {
		if a.canRead(t) {
			visible[t.ID] = true
			userIDs[t.OwnerID] = true
			userIDs[t.CreatedBy] = true
			userIDs[t.ReviewerID] = true
			departmentIDs[t.DepartmentID] = true
			projectIDs[t.ProjectID] = true
			for _, u := range t.Collaborators {
				userIDs[u] = true
			}
			d.Tasks = append(d.Tasks, t)
		}
	}
	ids := []string{}
	for id := range visible {
		ids = append(ids, id)
	}
	comments := map[string][]Comment{}
	times := map[string][]TimeEntry{}
	files := map[string][]Attachment{}
	if len(ids) > 0 && !lean {
		var cs []Comment
		if e = db.Where("company_id = ? AND task_id IN ?", a.Company.ID, ids).Order("created_at ASC").Find(&cs).Error; e != nil {
			return e
		}
		for _, v := range cs {
			comments[v.TaskID] = append(comments[v.TaskID], v)
			userIDs[v.UserID] = true
		}
		var ts []TimeEntry
		if e = db.Where("company_id = ? AND task_id IN ?", a.Company.ID, ids).Order("created_at ASC").Find(&ts).Error; e != nil {
			return e
		}
		for _, v := range ts {
			times[v.TaskID] = append(times[v.TaskID], v)
			userIDs[v.UserID] = true
		}
		var fs []Attachment
		if e = db.Omit("Data").Where("company_id = ? AND task_id IN ?", a.Company.ID, ids).Order("created_at ASC").Find(&fs).Error; e != nil {
			return e
		}
		for _, v := range fs {
			files[v.TaskID] = append(files[v.TaskID], v)
			userIDs[v.UploadedBy] = true
		}
	}
	for i := range d.Tasks {
		t := &d.Tasks[i]
		t.Comments = comments[t.ID]
		t.TimeEntries = times[t.ID]
		t.Attachments = files[t.ID]
		if t.Comments == nil {
			t.Comments = []Comment{}
		}
		if t.TimeEntries == nil {
			t.TimeEntries = []TimeEntry{}
		}
		if t.Attachments == nil {
			t.Attachments = []Attachment{}
		}
		if t.Tags == nil {
			t.Tags = []string{}
		}
		if t.Checklist == nil {
			t.Checklist = []ChecklistItem{}
		}
		if t.Dependencies == nil {
			t.Dependencies = []string{}
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
	}
	full := leadership(a.Member.Role) || a.Member.Role == "viewer"
	for id, m := range a.Members {
		if full || a.ownsScope(id) || userIDs[id] {
			d.People = append(d.People, person(a.Users[id], m))
			departmentIDs[m.DepartmentID] = true
		}
	}
	sort.Slice(d.People, func(i, j int) bool { return d.People[i].Name < d.People[j].Name })
	var ds []Department
	if e = db.Where("company_id = ?", a.Company.ID).Order("name").Find(&ds).Error; e != nil {
		return e
	}
	for _, v := range ds {
		if full || departmentIDs[v.ID] || v.ID == a.Member.DepartmentID {
			d.Departments = append(d.Departments, v)
		}
	}
	var ps []Project
	if e = db.Where("company_id = ?", a.Company.ID).Order("name").Find(&ps).Error; e != nil {
		return e
	}
	for _, v := range ps {
		if full || projectIDs[v.ID] || a.ownsScope(v.OwnerID) || (a.Member.Role == "head" && v.DepartmentID == a.Member.DepartmentID && v.DepartmentID != "") {
			d.Projects = append(d.Projects, v)
		}
	}
	var gs []Goal
	if e = db.Where("company_id = ?", a.Company.ID).Order("name").Find(&gs).Error; e != nil {
		return e
	}
	for _, v := range gs {
		if full || a.ownsScope(v.OwnerID) || (a.Member.Role == "head" && v.DepartmentID == a.Member.DepartmentID && v.DepartmentID != "") {
			filtered := []string{}
			for _, id := range v.TaskIDs {
				if visible[id] {
					filtered = append(filtered, id)
				}
			}
			v.TaskIDs = filtered
			d.Goals = append(d.Goals, v)
		}
	}
	visibleExpenses, e := loadFinanceProjection(db, a, &d, visible, lean)
	if e != nil {
		return e
	}
	var acts []Activity
	activityQuery := db.Where("company_id = ?", a.Company.ID)
	if full {
		if len(ids) > 0 {
			activityQuery = activityQuery.Where("task_id = '' OR task_id IN ?", ids)
		} else {
			activityQuery = activityQuery.Where("task_id = ''")
		}
	} else if len(ids) > 0 {
		activityQuery = activityQuery.Where("task_id IN ?", ids)
	} else {
		activityQuery = activityQuery.Where("1 = 0")
	}
	if e = activityQuery.Order("created_at DESC, id DESC").Limit(1000).Find(&acts).Error; e != nil {
		return e
	}
	for _, v := range acts {
		if visible[v.TaskID] || (full && v.TaskID == "") {
			d.Activities = append(d.Activities, v)
		}
	}
	var ns []Notification
	if e = db.Where("company_id = ? AND user_id = ?", a.Company.ID, a.User.ID).Order("created_at DESC").Limit(500).Find(&ns).Error; e != nil {
		return e
	}
	for _, v := range ns {
		if (v.ExpenseID != "" && visibleExpenses[v.ExpenseID]) || (v.ExpenseID == "" && (v.TaskID == "" || visible[v.TaskID])) {
			d.Notifications = append(d.Notifications, v)
		}
	}
	if lean {
		d.Tasks = []Task{}
		d.Expenses = []Expense{}
		d.FinanceEvents = []FinanceEvent{}
	}
	return respond(w, 200, d)
}
