package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"reflect"
)

type MilestoneCriterion struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}
type MilestoneAssertion struct {
	CriterionID string `json:"criterionId"`
	Statement   string `json:"statement"`
}
type MilestoneTaskBasis struct {
	TaskID  string `json:"taskId"`
	Version int64  `json:"version"`
}
type ProjectMilestone struct {
	ID                      string               `json:"id" gorm:"primaryKey"`
	CompanyID               string               `json:"companyId" gorm:"index"`
	ProjectID               string               `json:"projectId" gorm:"index"`
	Version                 int64                `json:"version"`
	OwnerID                 string               `json:"ownerId"`
	ReviewerID              string               `json:"reviewerId"`
	Title                   string               `json:"title"`
	Description             string               `json:"description"`
	Criteria                []MilestoneCriterion `json:"criteria" gorm:"serializer:json;type:jsonb"`
	CriteriaVersion         int64                `json:"criteriaVersion"`
	TaskIDs                 []string             `json:"taskIds" gorm:"serializer:json;type:jsonb"`
	DueDate                 string               `json:"dueDate"`
	DeadlineMode            string               `json:"deadlineMode"`
	DueAt                   DeadlineInstant      `json:"dueAt"`
	DueTimezone             string               `json:"dueTimezone"`
	OriginalDueDate         string               `json:"originalDueDate"`
	OriginalDeadlineMode    string               `json:"originalDeadlineMode"`
	OriginalDueAt           DeadlineInstant      `json:"originalDueAt"`
	OriginalDueTimezone     string               `json:"originalDueTimezone"`
	DeadlineChangeReason    string               `json:"deadlineChangeReason"`
	State                   string               `json:"state"`
	SubmittedAt             string               `json:"submittedAt"`
	SubmittedBy             string               `json:"submittedBy"`
	SubmittedProjectVersion int64                `json:"submittedProjectVersion"`
	SubmittedTasks          []MilestoneTaskBasis `json:"submittedTasks" gorm:"serializer:json;type:jsonb"`
	Assertions              []MilestoneAssertion `json:"assertions" gorm:"serializer:json;type:jsonb"`
	AcceptedAt              string               `json:"acceptedAt"`
	AcceptedBy              string               `json:"acceptedBy"`
	CreatedAt               string               `json:"createdAt"`
}
type MilestoneAcceptance struct {
	ID               string               `json:"id" gorm:"primaryKey"`
	CompanyID        string               `json:"companyId"`
	MilestoneID      string               `json:"milestoneId" gorm:"index"`
	MilestoneVersion int64                `json:"milestoneVersion"`
	CriteriaVersion  int64                `json:"criteriaVersion"`
	ProjectVersion   int64                `json:"projectVersion"`
	Tasks            []MilestoneTaskBasis `json:"tasks" gorm:"serializer:json;type:jsonb"`
	Assertions       []MilestoneAssertion `json:"assertions" gorm:"serializer:json;type:jsonb"`
	ActorID          string               `json:"actorId"`
	CreatedAt        string               `json:"createdAt"`
	Note             string               `json:"note"`
}
type MilestoneEvent struct {
	ID          string `json:"id" gorm:"primaryKey"`
	CompanyID   string `json:"companyId"`
	MilestoneID string `json:"milestoneId" gorm:"index"`
	ActorID     string `json:"actorId"`
	Action      string `json:"action"`
	Reason      string `json:"reason"`
	Version     int64  `json:"version"`
	CreatedAt   string `json:"createdAt"`
}

func projectEditor(a *access, p Project) bool {
	return in(a.Member.Role, "founder", "ceo", "admin", "head", "manager") && a.canCreate(p.OwnerID, p.DepartmentID)
}
func milestoneScope(tx *gorm.DB, a *access, m ProjectMilestone) (Project, error) {
	p, e := scopedProject(tx, a, m.ProjectID)
	if e != nil {
		return p, e
	}
	for _, id := range m.TaskIDs {
		t, e := scopedTask(tx, a, id)
		if e != nil {
			return p, e
		}
		if t.ProjectID != m.ProjectID {
			return p, missing()
		}
	}
	for _, basis := range m.SubmittedTasks {
		t, e := scopedTask(tx, a, basis.TaskID)
		if e != nil {
			return p, e
		}
		if t.ProjectID != m.ProjectID {
			return p, missing()
		}
	}
	return p, nil
}
func scopedMilestone(tx *gorm.DB, a *access, id string) (ProjectMilestone, Project, error) {
	var m ProjectMilestone
	if e := tx.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&m).Error; e != nil {
		return m, Project{}, missing()
	}
	p, e := milestoneScope(tx, a, m)
	return m, p, e
}
func milestoneReviewer(tx *gorm.DB, a *access, m ProjectMilestone) error {
	target, e := currentAttentionActorLocked(tx, a.Company.ID, m.ReviewerID)
	if e != nil {
		return e
	}
	if target.Member.Role == "viewer" || m.ReviewerID == m.OwnerID {
		return invalid("A milestone needs an active independent reviewer.")
	}
	_, e = milestoneScope(tx, target, m)
	if e != nil {
		return invalid("Reviewer must independently read the project and all selected tasks.")
	}
	return nil
}
func validateMilestone(tx *gorm.DB, a *access, m *ProjectMilestone) error {
	if !clean(m.Title, 240) || len(m.Description) > 8000 || len(m.Criteria) < 1 || len(m.Criteria) > 100 || len(m.TaskIDs) < 1 || len(m.TaskIDs) > 100 {
		return invalid("Milestones require a title, 1–100 criteria and 1–100 selected project tasks.")
	}
	if !a.activeUser(m.OwnerID) {
		return invalid("Choose an active milestone owner.")
	}
	seen := map[string]bool{}
	for i := range m.Criteria {
		c := &m.Criteria[i]
		if c.ID == "" {
			c.ID = newID("criterion")
		}
		if !clean(c.ID, 100) || !clean(c.Text, 500) || seen[c.ID] {
			return invalid("Criteria need unique IDs and text of 1–500 characters.")
		}
		seen[c.ID] = true
	}
	seen = map[string]bool{}
	for _, id := range m.TaskIDs {
		if seen[id] {
			return invalid("Selected tasks must be unique.")
		}
		seen[id] = true
	}
	t := Task{DueDate: m.DueDate, DeadlineMode: m.DeadlineMode, DueAt: m.DueAt, DueTimezone: m.DueTimezone}
	if e := validateDeadline(&t); e != nil {
		return e
	}
	m.DueDate = t.DueDate
	m.DeadlineMode = t.DeadlineMode
	m.DueAt = t.DueAt
	m.DueTimezone = t.DueTimezone
	if _, e := milestoneScope(tx, a, *m); e != nil {
		return e
	}
	return milestoneReviewer(tx, a, *m)
}
func (s *Server) milestoneRoutes() {
	base := "/api/companies/{cid}"
	s.route("GET "+base+"/projects", s.projectList)
	s.route("GET "+base+"/projects/{id}", s.projectDetail)
	s.route("GET "+base+"/projects/{id}/milestones", s.milestoneList)
	s.route("POST "+base+"/projects/{id}/milestones", s.saveMilestone)
	s.route("GET "+base+"/project-milestones/{id}", s.milestoneDetail)
	s.route("PATCH "+base+"/project-milestones/{id}", s.saveMilestone)
	s.route("POST "+base+"/project-milestones/{id}/transition", s.transitionMilestone)
}
func (s *Server) projectList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	if r.URL.Query().Get("limit") == "" {
		limit = 50
	}
	var all []Project
	if e = s.db.Where("company_id = ?", a.Company.ID).Order("id").Find(&all).Error; e != nil {
		return e
	}
	basis := payloadHash([]string{accessBasis(a), "projects"})
	after := ""
	if cursor := r.URL.Query().Get("cursor"); cursor != "" {
		c, e := decodeReadCursor(cursor, basis)
		if e != nil {
			return e
		}
		after = c.ID
	}
	rows := []Project{}
	for _, p := range all {
		if p.ID <= after {
			continue
		}
		visible, e := canReadProject(s.db, a, p)
		if e != nil {
			return e
		}
		if visible {
			rows = append(rows, p)
		}
		if len(rows) > limit {
			break
		}
	}
	next := ""
	if len(rows) > limit {
		rows = rows[:limit]
		next = encodeReadCursor(readCursor{Basis: basis, ID: rows[len(rows)-1].ID})
	}
	return respond(w, 200, map[string]any{"projects": rows, "nextCursor": next})
}
func (s *Server) projectDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	p, e := scopedProject(s.db, a, r.PathValue("id"))
	if e != nil {
		return e
	}
	var total, done int64
	q := taskReadQuery(s.db, a).Where("project_id = ?", p.ID)
	if e = q.Count(&total).Error; e != nil {
		return e
	}
	if e = taskReadQuery(s.db, a).Where("project_id = ? AND status = ?", p.ID, "done").Count(&done).Error; e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"project": p, "canEdit": projectEditor(a, p), "summary": map[string]any{"label": "authorized tasks", "total": total, "accepted": done}})
}
func milestoneProjection(tx *gorm.DB, a *access, m ProjectMilestone, p Project) (map[string]any, error) {
	raw, _ := json.Marshal(m)
	view := map[string]any{}
	json.Unmarshal(raw, &view)
	current := m.SubmittedProjectVersion == 0 || m.SubmittedProjectVersion == p.Version
	for _, b := range m.SubmittedTasks {
		t, e := scopedTask(tx, a, b.TaskID)
		if e != nil {
			return nil, e
		}
		if t.Version != b.Version || t.Status != "done" {
			current = false
		}
	}
	view["basisCurrent"] = current
	if !current {
		view["basisNotice"] = "The inspected work changed; a fresh human review is needed for current achievement."
	}
	var history []MilestoneAcceptance
	if e := tx.Where("company_id = ? AND milestone_id = ?", a.Company.ID, m.ID).Order("created_at").Find(&history).Error; e != nil {
		return nil, e
	}
	for _, event := range history {
		for _, b := range event.Tasks {
			if _, e := scopedTask(tx, a, b.TaskID); e != nil {
				return nil, e
			}
		}
	}
	view["acceptances"] = history
	view["canEdit"] = m.State == "draft" && (a.User.ID == m.OwnerID || projectEditor(a, p))
	view["canSubmit"] = m.State == "draft" && a.User.ID == m.OwnerID
	view["canReview"] = m.State == "in_review" && a.User.ID != m.OwnerID && a.Member.Role != "viewer" && (a.User.ID == m.ReviewerID || leadership(a.Member.Role))
	view["canReopen"] = m.State == "accepted" && (a.User.ID == m.OwnerID || projectEditor(a, p))
	return view, nil
}
func (s *Server) milestoneList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	p, e := scopedProject(s.db, a, r.PathValue("id"))
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	if r.URL.Query().Get("limit") == "" {
		limit = 50
	}
	basis := payloadHash([]any{accessBasis(a), "milestones", p.ID, p.Version})
	after := ""
	if cursor := r.URL.Query().Get("cursor"); cursor != "" {
		c, e := decodeReadCursor(cursor, basis)
		if e != nil {
			return e
		}
		after = c.ID
	}
	var all []ProjectMilestone
	if e = s.db.Where("company_id = ? AND project_id = ? AND id > ?", a.Company.ID, p.ID, after).Order("id").Find(&all).Error; e != nil {
		return e
	}
	rows := []map[string]any{}
	for _, m := range all {
		if _, e := milestoneScope(s.db, a, m); e != nil {
			continue
		}
		view, e := milestoneProjection(s.db, a, m, p)
		if e != nil {
			if api, ok := e.(*apiError); ok && api.Status == 404 {
				continue
			}
			return e
		}
		rows = append(rows, view)
		if len(rows) > limit {
			break
		}
	}
	next := ""
	if len(rows) > limit {
		rows = rows[:limit]
		next = encodeReadCursor(readCursor{Basis: basis, ID: rows[len(rows)-1]["id"].(string)})
	}
	return respond(w, 200, map[string]any{"milestones": rows, "nextCursor": next})
}
func (s *Server) milestoneDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	m, p, e := scopedMilestone(s.db, a, r.PathValue("id"))
	if e != nil {
		return e
	}
	view, e := milestoneProjection(s.db, a, m, p)
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"milestone": view})
}
func (s *Server) saveMilestone(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "version", "expectedProjectVersion", "ownerId", "reviewerId", "title", "description", "criteria", "taskIds", "dueDate", "deadlineMode", "dueAt", "dueTimezone", "deadlineChangeReason")
	if e != nil {
		return e
	}
	key, e := optionalBusinessKey(f)
	if e != nil || key == "" {
		return invalid("A retry key is required.")
	}
	delete(f, "retryKey")
	var expectedProject int64
	json.Unmarshal(f["expectedProjectVersion"], &expectedProject)
	delete(f, "expectedProjectVersion")
	var version int64
	json.Unmarshal(f["version"], &version)
	delete(f, "version")
	id := r.PathValue("id")
	create := r.Method == "POST"
	var out BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var p Project
		var old, next ProjectMilestone
		authorize := func() error {
			var e error
			if create {
				p, e = scopedProject(tx, a, id)
				old = ProjectMilestone{CompanyID: a.Company.ID, ProjectID: id, Version: 1, CriteriaVersion: 1, State: "draft", CreatedAt: nowString()}
				if e != nil {
					return e
				}
				if !projectEditor(a, p) {
					return denied()
				}
			} else {
				old, p, e = scopedMilestone(tx, a, id)
				if e != nil {
					return e
				}
				if a.User.ID != old.OwnerID && !projectEditor(a, p) {
					return denied()
				}
				if !projectEditor(a, p) {
					for _, k := range []string{"ownerId", "reviewerId"} {
						if _, ok := f[k]; ok {
							return denied()
						}
					}
				}
			}
			next = old
			if raw, ok := f["criteria"]; ok {
				var criteria []MilestoneCriterion
				if e := strictJSON(raw, &criteria); e != nil {
					return e
				}
				next.Criteria = criteria
			}
			for k, v := range f {
				if k == "criteria" {
					continue
				}
				if e := applyFields(map[string]json.RawMessage{k: v}, &next); e != nil {
					return e
				}
			}
			if !a.activeUser(next.OwnerID) || (create || next.OwnerID != old.OwnerID) && !a.canCreate(next.OwnerID, p.DepartmentID) {
				return denied()
			}
			if _, e = milestoneScope(tx, a, next); e != nil {
				return e
			}
			return milestoneReviewer(tx, a, next)
		}
		apply := func() (BusinessResult, error) {
			if expectedProject < 1 || p.Version != expectedProject {
				return BusinessResult{}, conflict()
			}
			if !create {
				if version < 1 || version != old.Version {
					return BusinessResult{}, conflict()
				}
				if old.State != "draft" {
					return BusinessResult{}, invalid("Reopen the milestone before editing its criteria.")
				}
			}
			if e := validateMilestone(tx, a, &next); e != nil {
				return BusinessResult{}, e
			}
			if create {
				next.ID = newID("milestone")
				next.OriginalDueDate = next.DueDate
				next.OriginalDeadlineMode = next.DeadlineMode
				next.OriginalDueAt = next.DueAt
				next.OriginalDueTimezone = next.DueTimezone
			} else {
				if !reflect.DeepEqual(old.Criteria, next.Criteria) || !reflect.DeepEqual(old.TaskIDs, next.TaskIDs) {
					next.CriteriaVersion++
				}
				before := Task{DueDate: old.DueDate, DueAt: old.DueAt, DueTimezone: old.DueTimezone, DeadlineMode: old.DeadlineMode}
				after := Task{DueDate: next.DueDate, DueAt: next.DueAt, DueTimezone: next.DueTimezone, DeadlineMode: next.DeadlineMode}
				if deadlineChanged(before, after) {
					if _, ok := f["deadlineChangeReason"]; !ok || !clean(next.DeadlineChangeReason, 4000) {
						return BusinessResult{}, invalid("Explain the changed milestone deadline.")
					}
				}
				next.Version++
			}
			if e := tx.Save(&next).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "milestone", IDs: []string{next.ID}, Versions: []int64{next.Version}}, nil
		}
		operation := "milestone_create"
		if !create {
			operation = "milestone_update"
		}
		out, e = businessMutation(tx, a, operation, key, []any{id, version, expectedProject, f}, authorize, func(v BusinessResult) error { _, _, e := scopedMilestone(tx, a, v.IDs[0]); return e }, apply)
		return e
	})
	if e != nil {
		return e
	}
	return ok(w, out.IDs[0])
}

type MilestoneTransitionInput struct {
	RetryKey               string               `json:"retryKey"`
	Version                int64                `json:"version"`
	ExpectedProjectVersion int64                `json:"expectedProjectVersion"`
	Action                 string               `json:"action"`
	CriteriaVersion        int64                `json:"criteriaVersion"`
	Assertions             []MilestoneAssertion `json:"assertions"`
	Tasks                  []MilestoneTaskBasis `json:"tasks"`
	Reason                 string               `json:"reason"`
	Note                   string               `json:"note"`
}

func (s *Server) transitionMilestone(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input MilestoneTransitionInput
	if e = decodeBusiness(w, r, &input); e != nil {
		return e
	}
	key := input.RetryKey
	input.RetryKey = ""
	if !in(input.Action, "submit", "approve", "request_changes", "reopen") {
		return invalid("Choose a milestone transition.")
	}
	if input.Action == "submit" && (input.Reason != "" || input.Note != "") {
		return invalid("Submission accepts criterion assertions and task basis only.")
	}
	if input.Action != "submit" && len(input.Assertions) > 0 {
		return invalid("Assertions are accepted only on submission.")
	}
	if input.Action == "reopen" && (len(input.Tasks) > 0 || input.CriteriaVersion != 0 || input.Note != "") {
		return invalid("Reopen requires only a reason and captured versions.")
	}
	if input.Action == "approve" && input.Reason != "" {
		return invalid("Approval accepts a review note, not a change reason.")
	}
	var out BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var m ProjectMilestone
		var p Project
		authorize := func() error {
			var e error
			m, p, e = scopedMilestone(tx, a, r.PathValue("id"))
			if e != nil {
				return e
			}
			if a.Member.Role == "viewer" {
				return denied()
			}
			switch input.Action {
			case "submit":
				if a.User.ID != m.OwnerID {
					return denied()
				}
			case "approve", "request_changes":
				if a.User.ID == m.OwnerID || (a.User.ID != m.ReviewerID && !leadership(a.Member.Role)) {
					return denied()
				}
			case "reopen":
				if a.User.ID != m.OwnerID && !projectEditor(a, p) {
					return denied()
				}
			}
			return nil
		}
		apply := func() (BusinessResult, error) {
			if input.Version < 1 || m.Version != input.Version || input.ExpectedProjectVersion < 1 || p.Version != input.ExpectedProjectVersion {
				return BusinessResult{}, conflict()
			}
			if len(input.Note) > 4000 {
				return BusinessResult{}, invalid("Review note allows 4,000 characters.")
			}
			switch input.Action {
			case "submit":
				if m.State != "draft" || input.CriteriaVersion != m.CriteriaVersion {
					return BusinessResult{}, conflict()
				}
				if len(input.Assertions) != len(m.Criteria) || len(input.Tasks) != len(m.TaskIDs) {
					return BusinessResult{}, invalid("Assert every criterion and inspect every selected task.")
				}
				criteria := map[string]bool{}
				for _, c := range m.Criteria {
					criteria[c.ID] = true
				}
				for _, assertion := range input.Assertions {
					if !criteria[assertion.CriterionID] || !clean(assertion.Statement, 4000) {
						return BusinessResult{}, invalid("Assert each criterion once with a 1–4,000 character statement.")
					}
					delete(criteria, assertion.CriterionID)
				}
				for i, id := range m.TaskIDs {
					basis := input.Tasks[i]
					if basis.TaskID != id {
						return BusinessResult{}, invalid("Task basis must match the ordered selection.")
					}
					t, e := scopedTask(tx, a, id)
					if e != nil {
						return BusinessResult{}, e
					}
					if t.Version != basis.Version {
						return BusinessResult{}, conflict()
					}
					if t.Status != "done" {
						return BusinessResult{}, invalid("Every selected task must be accepted as done.")
					}
					if e = completionReady(tx, t); e != nil {
						return BusinessResult{}, e
					}
				}
				if e := milestoneReviewer(tx, a, m); e != nil {
					return BusinessResult{}, e
				}
				m.State = "in_review"
				m.SubmittedAt = nowString()
				m.SubmittedBy = a.User.ID
				m.SubmittedProjectVersion = p.Version
				m.SubmittedTasks = input.Tasks
				m.Assertions = input.Assertions
			case "approve", "request_changes":
				if m.State != "in_review" || input.CriteriaVersion != m.CriteriaVersion || !reflect.DeepEqual(input.Tasks, m.SubmittedTasks) || p.Version != m.SubmittedProjectVersion {
					return BusinessResult{}, conflict()
				}
				for _, basis := range m.SubmittedTasks {
					t, e := scopedTask(tx, a, basis.TaskID)
					if e != nil {
						return BusinessResult{}, e
					}
					if t.Version != basis.Version || t.Status != "done" {
						return BusinessResult{}, conflict()
					}
					if e = completionReady(tx, t); e != nil {
						return BusinessResult{}, e
					}
				}
				if input.Action == "approve" {
					m.State = "accepted"
					m.AcceptedAt = nowString()
					m.AcceptedBy = a.User.ID
					event := MilestoneAcceptance{ID: newID("acceptance"), CompanyID: a.Company.ID, MilestoneID: m.ID, MilestoneVersion: m.Version + 1, CriteriaVersion: m.CriteriaVersion, ProjectVersion: p.Version, Tasks: m.SubmittedTasks, Assertions: m.Assertions, ActorID: a.User.ID, CreatedAt: m.AcceptedAt, Note: input.Note}
					if e := tx.Create(&event).Error; e != nil {
						return BusinessResult{}, e
					}
				} else {
					if !clean(input.Reason, 4000) {
						return BusinessResult{}, invalid("Explain the requested changes.")
					}
					m.State = "draft"
					clearMilestoneSubmission(&m)
				}
			case "reopen":
				if m.State != "accepted" || !clean(input.Reason, 4000) {
					return BusinessResult{}, invalid("Reopen an accepted milestone with a reason.")
				}
				m.State = "draft"
				clearMilestoneSubmission(&m)
			}
			m.Version++
			if e := tx.Save(&m).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Create(&MilestoneEvent{ID: newID("mev"), CompanyID: a.Company.ID, MilestoneID: m.ID, ActorID: a.User.ID, Action: input.Action, Reason: input.Reason, Version: m.Version, CreatedAt: nowString()}).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "milestone", IDs: []string{m.ID}, Versions: []int64{m.Version}}, nil
		}
		out, e = businessMutation(tx, a, "milestone_transition", key, []any{r.PathValue("id"), input}, authorize, func(v BusinessResult) error { _, _, e := scopedMilestone(tx, a, v.IDs[0]); return e }, apply)
		return e
	})
	if e != nil {
		return e
	}
	return ok(w, out.IDs[0])
}
func clearMilestoneSubmission(m *ProjectMilestone) {
	m.SubmittedAt = ""
	m.SubmittedBy = ""
	m.SubmittedProjectVersion = 0
	m.SubmittedTasks = []MilestoneTaskBasis{}
	m.Assertions = []MilestoneAssertion{}
	m.AcceptedAt = ""
	m.AcceptedBy = ""
}
