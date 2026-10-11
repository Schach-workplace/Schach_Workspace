package platform

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"time"

	"gorm.io/gorm"
)

var createTaskFields = []string{"title", "description", "ownerId", "reviewerId", "departmentId", "projectId", "parentId", "priority", "status", "dueDate", "deadlineMode", "dueAt", "dueTimezone", "startDate", "estimatedHours", "tags", "checklist", "dependencies", "collaborators", "recurrence", "requiresApproval"}
var taskColumns = []string{"project_id", "department_id", "parent_id", "title", "description", "owner_id", "reviewer_id", "status", "priority", "start_date", "due_date", "deadline_mode", "due_at", "due_timezone", "progress", "estimated_hours", "tags", "checklist", "dependencies", "collaborators", "recurrence", "requires_approval", "blocker_reason", "deadline_change_reason", "completed_at", "updated_at", "version"}

func makeTask(a *access, f map[string]json.RawMessage) (Task, error) {
	t := Task{ID: newID("tsk"), CompanyID: a.Company.ID, CreatedBy: a.User.ID, Priority: "medium", Status: "todo", Recurrence: "none", Tags: []string{}, Checklist: []ChecklistItem{}, Dependencies: []string{}, Collaborators: []string{}, Comments: []Comment{}, TimeEntries: []TimeEntry{}, Attachments: []Attachment{}, Version: 1, CreatedAt: nowString(), UpdatedAt: nowString()}
	if e := applyFields(f, &t); e != nil {
		return t, e
	}
	if _, exists := f["requiresApproval"]; !exists && t.ReviewerID != "" {
		t.RequiresApproval = true
	}
	if e := validateDeadline(&t); e != nil {
		return t, e
	}
	t.OriginalDeadlineMode = t.DeadlineMode
	t.OriginalDueAt = t.DueAt
	t.OriginalDueTimezone = t.DueTimezone
	t.OriginalDueDate = t.DueDate
	return t, nil
}
func validateTask(tx *gorm.DB, a *access, t *Task) error { return validateTaskWithGraph(tx, a, t, nil) }
func validateTaskWithGraph(tx *gorm.DB, a *access, t *Task, override map[string]Task) error {
	if e := validateDeadline(t); e != nil {
		return e
	}
	t.Title = strings.TrimSpace(t.Title)
	if !clean(t.Title, 240) {
		return invalid("Task title is required (up to 240 characters).")
	}
	if len(t.Description) > 20000 {
		return invalid("Description can contain at most 20,000 characters.")
	}
	if !a.activeUser(t.OwnerID) {
		return invalid("Choose an active owner in this company.")
	}
	if t.ReviewerID != "" && (!a.activeUser(t.ReviewerID) || a.Members[t.ReviewerID].Role == "viewer" || t.ReviewerID == t.OwnerID) {
		return invalid("Reviewer must be another active company member with permission to review; owners and read-only viewers cannot review.")
	}
	if t.RequiresApproval && t.ReviewerID == "" {
		return invalid("Tasks requiring approval need an assigned reviewer.")
	}
	if !in(t.Status, "backlog", "todo", "in_progress", "blocked", "in_review", "done", "cancelled") {
		return invalid("Choose a valid task status.")
	}
	if !in(t.Priority, "critical", "high", "medium", "low") {
		return invalid("Choose critical, high, medium or low priority.")
	}
	if !in(t.Recurrence, "none", "daily", "weekly", "monthly") {
		return invalid("Choose a valid recurrence interval.")
	}
	if !finite(t.EstimatedHours) || t.EstimatedHours < 0 || t.EstimatedHours > 100000 {
		return invalid("Estimated hours must be between 0 and 100,000.")
	}
	if !finite(t.Progress) || t.Progress < 0 || t.Progress > 100 {
		return invalid("Progress must be between 0 and 100.")
	}
	if !validDate(t.DueDate) || !validDate(t.StartDate) {
		return invalid("Dates must use YYYY-MM-DD (years 1900–2200).")
	}
	if t.StartDate != "" && t.DueDate != "" && t.StartDate > t.DueDate {
		return invalid("The start date cannot be later than the deadline.")
	}
	if t.Recurrence != "none" && t.DueDate == "" {
		return invalid("Recurring tasks require a deadline.")
	}
	if t.Status == "blocked" && !clean(t.BlockerReason, 4000) {
		return invalid("Describe the blocker before setting a task to blocked.")
	}
	if len(t.BlockerReason) > 4000 || len(t.DeadlineChangeReason) > 4000 {
		return invalid("Blocker and deadline-change reasons allow up to 4,000 characters.")
	}
	if !departmentExists(tx, a.Company.ID, t.DepartmentID) {
		return invalid("Task department must belong to this company.")
	}
	if t.ProjectID != "" {
		var project Project
		if e := tx.Where("id = ? AND company_id = ?", t.ProjectID, a.Company.ID).First(&project).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return invalid("Task project must be accessible in this company.")
			}
			return e
		}
		visible := leadership(a.Member.Role) || a.Member.Role == "viewer" || a.ownsScope(project.OwnerID) || (a.Member.Role == "head" && project.DepartmentID != "" && project.DepartmentID == a.Member.DepartmentID)
		if !visible {
			var linked []Task
			if e := tx.Where("company_id = ? AND project_id = ?", a.Company.ID, project.ID).Find(&linked).Error; e != nil {
				return e
			}
			for _, existing := range linked {
				if a.canRead(existing) {
					visible = true
					break
				}
			}
		}
		if !visible {
			return invalid("Task project must be accessible in your role's workspace.")
		}
	}

	if len(t.Tags) > 30 || len(t.Collaborators) > 100 || len(t.Dependencies) > 100 || len(t.Checklist) > 100 {
		return invalid("Limit a task to 30 tags, 100 collaborators, 100 dependencies and 100 checklist items.")
	}
	seen := map[string]bool{}
	for _, tag := range t.Tags {
		if !clean(tag, 60) || seen[tag] {
			return invalid("Tags must be unique non-empty values of at most 60 characters.")
		}
		seen[tag] = true
	}
	seen = map[string]bool{}
	for _, uid := range t.Collaborators {
		if !a.activeUser(uid) || seen[uid] {
			return invalid("Collaborators must be unique active company members.")
		}
		seen[uid] = true
	}
	seen = map[string]bool{}
	for i := range t.Checklist {
		c := &t.Checklist[i]
		c.Text = strings.TrimSpace(c.Text)
		if c.ID == "" {
			c.ID = newID("chk")
		}
		if len(c.ID) > 100 || seen[c.ID] || !clean(c.Text, 500) {
			return invalid("Checklist items require unique IDs and text of at most 500 characters.")
		}
		seen[c.ID] = true
	}
	if t.Tags == nil {
		t.Tags = []string{}
	}
	if t.Collaborators == nil {
		t.Collaborators = []string{}
	}
	if t.Dependencies == nil {
		t.Dependencies = []string{}
	}
	if t.Checklist == nil {
		t.Checklist = []ChecklistItem{}
	}
	if override != nil {
		return validateTaskGraph(a, *t, override)
	}
	var all []Task
	if e := tx.Where("company_id = ?", a.Company.ID).Select("id", "company_id", "owner_id", "created_by", "reviewer_id", "department_id", "collaborators", "dependencies", "parent_id", "status").Find(&all).Error; e != nil {
		return e
	}
	graph := map[string]Task{}
	for _, v := range all {
		graph[v.ID] = v
	}
	return validateTaskGraph(a, *t, graph)
}
func validateTaskGraph(a *access, t Task, graph map[string]Task) error {
	graph[t.ID] = t
	seen := map[string]bool{}
	for _, id := range t.Dependencies {
		dep, ok := graph[id]
		if id == t.ID || !ok || !a.canRead(dep) || seen[id] {
			return invalid("Dependencies must be unique accessible tasks in this company and cannot include the task itself.")
		}
		seen[id] = true
	}
	visiting := map[string]bool{}
	visited := map[string]bool{}
	var visit func(string) bool
	visit = func(id string) bool {
		if visiting[id] {
			return false
		}
		if visited[id] {
			return true
		}
		visiting[id] = true
		for _, next := range graph[id].Dependencies {
			if !visit(next) {
				return false
			}
		}
		visiting[id] = false
		visited[id] = true
		return true
	}
	if !visit(t.ID) {
		return invalid("This dependency would create a cycle.")
	}
	if t.ParentID != "" {
		p, ok := graph[t.ParentID]
		if !ok || !a.canRead(p) {
			return invalid("Parent task must be accessible in this company.")
		}
		seen = map[string]bool{t.ID: true}
		id := t.ParentID
		for id != "" {
			if seen[id] {
				return invalid("Parent tasks cannot be their own descendants.")
			}
			seen[id] = true
			id = graph[id].ParentID
		}
	}
	return nil
}
func completionReady(tx *gorm.DB, t Task) error {
	for _, c := range t.Checklist {
		if !c.Done {
			return invalid("Complete every checklist item before submitting or accepting this task.")
		}
	}
	for _, id := range t.Dependencies {
		var dep Task
		if e := tx.Select("status").Where("id = ? AND company_id = ?", id, t.CompanyID).First(&dep).Error; e != nil {
			return invalid("A required dependency could not be resolved.")
		}
		if dep.Status != "done" {
			return invalid("All required dependencies must be accepted as done first.")
		}
	}
	return nil
}
func setWorkflow(tx *gorm.DB, t *Task, oldStatus string, review bool) error {
	if t.Status == "in_review" {
		if t.ReviewerID == "" {
			return invalid("Assign a reviewer before submitting for review.")
		}
		if e := completionReady(tx, *t); e != nil {
			return e
		}
		t.Progress = 100
	}
	if t.Status == "done" {
		if t.RequiresApproval && !review && oldStatus != "done" {
			return invalid("Submit for review; an assigned reviewer or company leader must approve this task.")
		}
		if e := completionReady(tx, *t); e != nil {
			return e
		}
		t.Progress = 100
		if t.CompletedAt == "" {
			t.CompletedAt = nowString()
		}
	} else {
		t.CompletedAt = ""
	}
	return nil
}
func nextCode(tx *gorm.DB, c Company) (string, error) {
	if e := tx.Model(&Company{}).Where("id = ?", c.ID).UpdateColumn("next_task_number", gorm.Expr("next_task_number + 1")).Error; e != nil {
		return "", e
	}
	var fresh Company
	if e := tx.Select("next_task_number").First(&fresh, "id = ?", c.ID).Error; e != nil {
		return "", e
	}
	prefix := strings.ToUpper(strings.ReplaceAll(c.Slug, "-", ""))
	if len(prefix) > 3 {
		prefix = prefix[:3]
	}
	return fmt.Sprintf("%s-%04d", prefix, fresh.NextTaskNumber), nil
}
func insertTask(tx *gorm.DB, a *access, t *Task) error {
	code, e := nextCode(tx, a.Company)
	if e != nil {
		return e
	}
	t.Code = code
	if e = tx.Omit("Comments", "TimeEntries", "Attachments").Create(t).Error; e != nil {
		return e
	}
	if e = appendTaskFact(tx, nil, *t, ReportFactActor{ID: a.User.ID}, "create", time.Now().UTC()); e != nil {
		return e
	}
	if e = audit(tx, t.CompanyID, t.ID, a.User.ID, "task_created", t.Code+": "+t.Title+"; original deadline "+t.OriginalDueDate+"."); e != nil {
		return e
	}
	if e = notification(tx, t.CompanyID, t.ID, t.OwnerID, "Task assigned", t.Code+" · "+t.Title, "assignment"); e != nil {
		return e
	}
	if e := syncTaskAttention(tx, a, nil, *t); e != nil {
		return e
	}
	if t.Status == "in_review" {
		return notification(tx, t.CompanyID, t.ID, t.ReviewerID, "Review requested", t.Code+" · "+t.Title, "review")
	}
	return nil
}
func (s *Server) createTask(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	allowed := append(append([]string{}, createTaskFields...), "retryKey", "intelligenceBasis")
	f, e := readFields(w, r, allowed...)
	if e != nil {
		return e
	}
	key, e := optionalBusinessKey(f)
	if e != nil {
		return e
	}
	delete(f, "retryKey")
	var basis *IntelligenceBasis
	if raw, ok := f["intelligenceBasis"]; ok {
		basis = &IntelligenceBasis{}
		if e := strictIntelligenceJSON(raw, basis); e != nil {
			return e
		}
		if key == "" {
			return invalid("A reviewed draft requires a stable retry key.")
		}
	}
	intent := map[string]json.RawMessage{}
	for k, v := range f {
		intent[k] = v
	}
	delete(f, "intelligenceBasis")
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		authorize := func() error {
			if e := s.intelligencePublicationAccess(tx, a, basis, "", nil); e != nil {
				return e
			}
			return authorizeTaskCreation(tx, a, f)
		}
		apply := func() (BusinessResult, error) {
			t, e := makeTask(a, f)
			if e != nil {
				return BusinessResult{}, e
			}
			if e = validateTask(tx, a, &t); e != nil {
				return BusinessResult{}, e
			}
			if e = s.intelligencePublicationFirstWrite(tx, a, basis, "", nil, intent, taskAudience(a, t)); e != nil {
				return BusinessResult{}, e
			}
			if e = setWorkflow(tx, &t, "", false); e != nil {
				return BusinessResult{}, e
			}
			if e = insertTask(tx, a, &t); e != nil {
				return BusinessResult{}, e
			}
			if e = s.recordIntelligencePublication(tx, a, basis, "task", t.ID, "task_create", key, intent); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "task", IDs: []string{t.ID}, Versions: []int64{t.Version}}, nil
		}
		if key == "" {
			if e = authorize(); e != nil {
				return e
			}
			result, e = apply()
		} else {
			result, e = businessMutation(tx, a, "task_create", key, intent, authorize, func(v BusinessResult) error { return authorizeTaskResults(tx, a, v) }, apply)
		}
		return e
	})
	if e != nil {
		return e
	}
	return ok(w, result.IDs[0])
}
func structuralChanged(a, b Task) bool {
	return a.OwnerID != b.OwnerID || a.ReviewerID != b.ReviewerID || a.RequiresApproval != b.RequiresApproval || a.DepartmentID != b.DepartmentID || a.ProjectID != b.ProjectID || a.ParentID != b.ParentID || a.Recurrence != b.Recurrence || !reflect.DeepEqual(a.Dependencies, b.Dependencies)
}
func (s *Server) patchTask(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	allowed := append(append([]string{}, createTaskFields...), "version", "progress", "blockerReason", "deadlineChangeReason")
	f, e := readFields(w, r, allowed...)
	if e != nil {
		return e
	}
	var version int64
	if e = json.Unmarshal(f["version"], &version); e != nil || version < 1 {
		return invalid("A positive task version is required; refresh before editing.")
	}
	delete(f, "version")
	if len(f) == 0 {
		return invalid("Provide at least one task field to update.")
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if a.Member.Role == "viewer" {
			return denied()
		}
		old, e := scopedTask(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		next, e := prepareTaskPatch(tx, a, old, version, f, nil)
		if e != nil {
			return e
		}
		return commitTaskPatch(tx, a, old, next, f)
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("id"))
}
func (s *Server) importTasks(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	envelope, e := readFields(w, r, "rows", "retryKey")
	if e != nil {
		return e
	}
	key, e := optionalBusinessKey(envelope)
	if e != nil {
		return e
	}
	delete(envelope, "retryKey")
	var rows []map[string]json.RawMessage
	if e = json.Unmarshal(envelope["rows"], &rows); e != nil || len(rows) < 1 || len(rows) > 200 {
		return invalid("Import between 1 and 200 rows at a time.")
	}
	validateRows := func(tx *gorm.DB, workflow bool) ([]Task, error) {
		tasks := []Task{}
		errs := []RowError{}
		for i, f := range rows {
			var validation error
			for k, v := range f {
				if !in(k, createTaskFields...) || string(v) == "null" {
					validation = invalid("Unknown, immutable or null field: " + k)
					break
				}
			}
			var t Task
			if validation == nil {
				validation = authorizeTaskCreation(tx, a, f)
			}
			if validation == nil && workflow {
				t, validation = makeTask(a, f)
				if validation == nil {
					validation = validateTask(tx, a, &t)
				}
				if validation == nil {
					validation = setWorkflow(tx, &t, "", false)
				}
			}
			if validation != nil {
				errs = append(errs, RowError{Row: i + 1, Message: validation.Error()})
			} else {
				tasks = append(tasks, t)
			}
		}
		if len(errs) > 0 {
			return nil, &apiError{Status: 422, Code: "invalid_import", Message: "No rows were imported. Fix the listed row errors and retry.", Rows: errs}
		}
		return tasks, nil
	}
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		authorize := func() error {
			if a.Member.Role == "viewer" {
				return denied()
			}
			_, e := validateRows(tx, false)
			return e
		}
		apply := func() (BusinessResult, error) {
			tasks, e := validateRows(tx, true)
			if e != nil {
				return BusinessResult{}, e
			}
			out := BusinessResult{Kind: "tasks", IDs: []string{}, Versions: []int64{}}
			for i := range tasks {
				if e = insertTask(tx, a, &tasks[i]); e != nil {
					return out, e
				}
				out.IDs = append(out.IDs, tasks[i].ID)
				out.Versions = append(out.Versions, tasks[i].Version)
			}
			return out, audit(tx, a.Company.ID, "", a.User.ID, "tasks_imported", fmt.Sprintf("Imported %d tasks atomically.", len(tasks)))
		}
		if key == "" {
			if e = authorize(); e != nil {
				return e
			}
			result, e = apply()
		} else {
			result, e = businessMutation(tx, a, "task_import", key, envelope, authorize, func(v BusinessResult) error { return authorizeTaskResults(tx, a, v) }, apply)
		}
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "created": len(result.IDs), "ids": result.IDs})
}
func (s *Server) reviewTask(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var v struct {
		Decision string `json:"decision"`
		Comment  string `json:"comment"`
		Version  int64  `json:"version"`
	}
	if e = decode(w, r, &v); e != nil {
		return e
	}
	if !in(v.Decision, "approve", "request_changes") || len(v.Comment) > 10000 {
		return invalid("Choose approve or request_changes; review comment allows 10,000 characters.")
	}
	if v.Decision == "request_changes" && !clean(v.Comment, 10000) {
		return invalid("Explain the changes needed so the owner can act.")
	}
	if v.Version < 1 {
		return invalid("A positive task version is required.")
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if a.Member.Role == "viewer" {
			return denied()
		}
		t, e := scopedTask(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if a.User.ID == t.OwnerID || a.Member.Role == "viewer" || (a.User.ID != t.ReviewerID && !leadership(a.Member.Role)) {
			return denied()
		}
		if t.Version != v.Version {
			return conflict()
		}
		if t.Status != "in_review" {
			return invalid("This task must be submitted for review before recording a decision.")
		}
		before := t
		old := t.Version
		if v.Decision == "approve" {
			t.Status = "done"
			if e = setWorkflow(tx, &t, "in_review", true); e != nil {
				return e
			}
		} else {
			t.Status = "in_progress"
			t.CompletedAt = ""
			if t.Progress == 100 {
				t.Progress = 90
			}
		}
		t.Version++
		t.UpdatedAt = nowString()
		res := tx.Model(&Task{}).Where("id = ? AND company_id = ? AND version = ?", t.ID, t.CompanyID, old).Select(taskColumns).Updates(&t)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return conflict()
		}
		operation := "request_changes"
		if v.Decision == "approve" {
			operation = "approve"
		}
		if e = appendTaskFact(tx, &before, t, ReportFactActor{ID: a.User.ID}, operation, time.Now().UTC()); e != nil {
			return e
		}
		if e = audit(tx, t.CompanyID, t.ID, a.User.ID, "review_"+v.Decision, strings.TrimSpace(v.Comment)); e != nil {
			return e
		}
		if strings.TrimSpace(v.Comment) != "" {
			if e = tx.Create(&Comment{ID: newID("cmt"), CompanyID: t.CompanyID, TaskID: t.ID, UserID: a.User.ID, Body: "[" + strings.ReplaceAll(v.Decision, "_", " ") + "] " + strings.TrimSpace(v.Comment), CreatedAt: nowString()}).Error; e != nil {
				return e
			}
		}
		if e := syncTaskAttention(tx, a, nil, t); e != nil {
			return e
		}
		return notification(tx, t.CompanyID, t.ID, t.OwnerID, map[bool]string{true: "Task approved", false: "Changes requested"}[v.Decision == "approve"], t.Code+" · "+v.Comment, "review")
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("id"))
}
