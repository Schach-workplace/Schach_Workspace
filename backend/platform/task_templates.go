package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"strings"
	"time"
)

type TemplateDefaults struct {
	Title            string   `json:"title,omitempty"`
	Description      string   `json:"description,omitempty"`
	Priority         string   `json:"priority,omitempty"`
	EstimatedHours   float64  `json:"estimatedHours,omitempty"`
	Tags             []string `json:"tags,omitempty"`
	Checklist        []string `json:"checklist"`
	Status           string   `json:"status,omitempty"`
	OwnerPolicy      string   `json:"ownerPolicy,omitempty"`
	FixedOwnerID     string   `json:"fixedOwnerId,omitempty"`
	ReviewerID       string   `json:"reviewerId,omitempty"`
	RequiresApproval bool     `json:"requiresApproval,omitempty"`
	RelativeDueDays  *int     `json:"relativeDueDays,omitempty"`
}
type TaskTemplate struct {
	ID                string           `json:"id" gorm:"primaryKey"`
	CompanyID         string           `json:"companyId" gorm:"index"`
	Version           int64            `json:"version"`
	Kind              string           `json:"kind"`
	Name              string           `json:"name"`
	Description       string           `json:"description"`
	ScopeOwnerID      string           `json:"scopeOwnerId"`
	ScopeDepartmentID string           `json:"scopeDepartmentId"`
	Archived          bool             `json:"archived"`
	Defaults          TemplateDefaults `json:"defaults" gorm:"serializer:json;type:jsonb"`
	CreatedAt         string           `json:"createdAt"`
}
type TaskTemplateApplication struct {
	ID              string `gorm:"primaryKey"`
	CompanyID       string
	TemplateID      string
	TemplateVersion int64
	TaskID          string
	ActorID         string
	RetryKey        string
	CreatedAt       string
}

func templateReadable(a *access, t TaskTemplate) bool {
	return leadership(a.Member.Role) || a.Member.Role == "viewer" || a.ownsScope(t.ScopeOwnerID) || (a.Member.Role == "head" && t.ScopeDepartmentID != "" && t.ScopeDepartmentID == a.Member.DepartmentID)
}
func scopedTemplate(tx *gorm.DB, a *access, id string, application bool) (TaskTemplate, error) {
	var t TaskTemplate
	if e := tx.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&t).Error; e != nil {
		return t, missing()
	}
	if !templateReadable(a, t) || (application && t.Archived) {
		return t, missing()
	}
	return t, nil
}
func templateManage(a *access, t TaskTemplate) bool {
	return a.Member.Role != "viewer" && a.canCreate(t.ScopeOwnerID, t.ScopeDepartmentID)
}
func validateTemplate(tx *gorm.DB, a *access, t *TaskTemplate) error {
	if !in(t.Kind, "task", "checklist") || !clean(t.Name, 160) || len(t.Description) > 8000 {
		return invalid("Choose a task/checklist kind and name up to 160 characters; description allows 8,000.")
	}
	if !a.activeUser(t.ScopeOwnerID) || !departmentExists(tx, a.Company.ID, t.ScopeDepartmentID) {
		return invalid("Choose an active explicit template scope.")
	}
	d := &t.Defaults
	if len(d.Checklist) > 100 {
		return invalid("Limit checklists to 100 entries.")
	}
	for i, text := range d.Checklist {
		d.Checklist[i] = strings.TrimSpace(text)
		if !clean(d.Checklist[i], 500) {
			return invalid("Checklist text requires 1–500 characters.")
		}
	}
	if t.Kind == "checklist" {
		if d.Title != "" || d.Description != "" || d.Priority != "" || d.EstimatedHours != 0 || len(d.Tags) > 0 || d.Status != "" || d.OwnerPolicy != "" || d.FixedOwnerID != "" || d.ReviewerID != "" || d.RequiresApproval || d.RelativeDueDays != nil {
			return invalid("Checklist templates contain checklist text only.")
		}
		return nil
	}
	if !clean(d.Title, 240) || len(d.Description) > 20000 || (!in(d.Status, "", "todo", "backlog")) || (!in(d.Priority, "", "critical", "high", "medium", "low")) || !finite(d.EstimatedHours) || d.EstimatedHours < 0 || d.EstimatedHours > 100000 || !in(d.OwnerPolicy, "actor", "fixed", "project_owner", "project_default") {
		return invalid("Invalid task template defaults.")
	}
	if d.OwnerPolicy == "fixed" && (!a.activeUser(d.FixedOwnerID) || !a.canCreate(d.FixedOwnerID, t.ScopeDepartmentID)) {
		return invalid("Choose an active permitted fixed owner.")
	}
	if d.ReviewerID != "" && (!a.activeUser(d.ReviewerID) || a.Members[d.ReviewerID].Role == "viewer" || d.ReviewerID == d.FixedOwnerID) {
		return invalid("Choose an active independent reviewer.")
	}
	if d.RequiresApproval && d.ReviewerID == "" {
		return invalid("Required review needs a reviewer.")
	}
	if d.RelativeDueDays != nil && (*d.RelativeDueDays < -366 || *d.RelativeDueDays > 366) {
		return invalid("Relative due days must be between -366 and 366.")
	}
	if len(d.Tags) > 30 {
		return invalid("Limit tags to 30.")
	}
	seen := map[string]bool{}
	for _, tag := range d.Tags {
		if !clean(tag, 60) || seen[tag] {
			return invalid("Tags must be unique, 1–60 characters.")
		}
		seen[tag] = true
	}
	return nil
}
func (s *Server) templateRoutes() {
	base := "/api/companies/{cid}"
	s.route("GET "+base+"/task-templates", s.templateList)
	s.route("POST "+base+"/task-templates", s.saveTemplate)
	s.route("GET "+base+"/task-templates/{id}", s.templateDetail)
	s.route("PATCH "+base+"/task-templates/{id}", s.saveTemplate)
	s.route("POST "+base+"/task-templates/{id}/preview", s.templatePreview)
	s.route("POST "+base+"/task-templates/{id}/apply", s.templateApply)
	s.route("POST "+base+"/tasks/{id}/checklists/apply", s.checklistApply)
}
func templateReadQuery(tx *gorm.DB, a *access) *gorm.DB {
	q := tx.Where("company_id = ?", a.Company.ID)
	if leadership(a.Member.Role) || a.Member.Role == "viewer" {
		return q
	}
	owners := []string{}
	for id := range a.Members {
		if a.ownsScope(id) {
			owners = append(owners, id)
		}
	}
	if a.Member.Role == "head" && a.Member.DepartmentID != "" {
		return q.Where("scope_owner_id IN ? OR scope_department_id = ?", owners, a.Member.DepartmentID)
	}
	return q.Where("scope_owner_id IN ?", owners)
}
func (s *Server) templateList(w http.ResponseWriter, r *http.Request) error {
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
	basis := payloadHash([]string{accessBasis(a), "templates", r.URL.Query().Get("kind")})
	q := templateReadQuery(s.db.WithContext(r.Context()).Model(&TaskTemplate{}), a)
	if kind := r.URL.Query().Get("kind"); kind != "" {
		if !in(kind, "task", "checklist") {
			return invalid("Unknown template kind.")
		}
		q = q.Where("kind = ?", kind)
	}
	if cursor := r.URL.Query().Get("cursor"); cursor != "" {
		c, e := decodeReadCursor(cursor, basis)
		if e != nil {
			return e
		}
		q = q.Where("id > ?", c.ID)
	}
	var rows []TaskTemplate
	if e = q.Order("id").Limit(limit + 1).Find(&rows).Error; e != nil {
		return e
	}
	next := ""
	if len(rows) > limit {
		rows = rows[:limit]
		next = encodeReadCursor(readCursor{Basis: basis, ID: rows[len(rows)-1].ID})
	}
	return respond(w, 200, map[string]any{"templates": rows, "nextCursor": next})
}
func (s *Server) templateDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	t, e := scopedTemplate(s.db, a, r.PathValue("id"), false)
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"template": t})
}
func (s *Server) saveTemplate(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "version", "kind", "name", "description", "scopeOwnerId", "scopeDepartmentId", "archived", "defaults")
	if e != nil {
		return e
	}
	key, e := optionalBusinessKey(f)
	if e != nil || key == "" {
		return invalid("A retry key is required.")
	}
	delete(f, "retryKey")
	id := r.PathValue("id")
	operation := "template_create"
	if id != "" {
		operation = "template_update"
	}
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var old TaskTemplate
		var next TaskTemplate
		authorize := func() error {
			next = TaskTemplate{CompanyID: a.Company.ID, Version: 1}
			if id != "" {
				var e error
				old, e = scopedTemplate(tx, a, id, false)
				if e != nil {
					return e
				}
				if !templateManage(a, old) {
					return denied()
				}
				next = old
			}
			if raw, ok := f["defaults"]; ok {
				var d TemplateDefaults
				if e := strictJSON(raw, &d); e != nil {
					return e
				}
				next.Defaults = d
			}
			for k, v := range f {
				if k == "version" || k == "defaults" {
					continue
				}
				if e := applyFields(map[string]json.RawMessage{k: v}, &next); e != nil {
					return e
				}
			}
			if !templateManage(a, next) {
				return denied()
			}
			return validateTemplate(tx, a, &next)
		}
		apply := func() (BusinessResult, error) {
			if id != "" {
				var version int64
				if json.Unmarshal(f["version"], &version) != nil || version < 1 {
					return BusinessResult{}, invalid("A positive template version is required.")
				}
				if version != old.Version {
					return BusinessResult{}, conflict()
				}
				if next.Kind != old.Kind {
					return BusinessResult{}, invalid("Template kind cannot change.")
				}
				next.Version = old.Version + 1
			} else {
				if _, ok := f["version"]; ok {
					return BusinessResult{}, invalid("Creation does not accept version.")
				}
				next.ID = newID("tpl")
				next.CreatedAt = nowString()
			}
			if e := tx.Save(&next).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "template", IDs: []string{next.ID}, Versions: []int64{next.Version}}, nil
		}
		intent := []any{id, f}
		result, e = businessMutation(tx, a, operation, key, intent, authorize, func(out BusinessResult) error {
			t, e := scopedTemplate(tx, a, out.IDs[0], false)
			if e != nil {
				return e
			}
			if !templateManage(a, t) {
				return denied()
			}
			return nil
		}, apply)
		return e
	})
	if e != nil {
		return e
	}
	return ok(w, result.IDs[0])
}
func strictJSON(raw json.RawMessage, dst any) error {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return invalid("Invalid nested fields.")
	}
	var hasNull func(any) bool
	hasNull = func(v any) bool {
		if v == nil {
			return true
		}
		switch x := v.(type) {
		case map[string]any:
			for _, child := range x {
				if hasNull(child) {
					return true
				}
			}
		case []any:
			for _, child := range x {
				if hasNull(child) {
					return true
				}
			}
		}
		return false
	}
	if hasNull(value) {
		return invalid("Null nested fields are not supported.")
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if e := decoder.Decode(dst); e != nil {
		return invalid("Unknown or invalid nested fields.")
	}
	return nil
}

type TemplateUseInput struct {
	RetryKey                string                     `json:"retryKey"`
	ExpectedTemplateVersion int64                      `json:"expectedTemplateVersion"`
	ProjectID               string                     `json:"projectId"`
	ExpectedProjectVersion  int64                      `json:"expectedProjectVersion"`
	AnchorDate              string                     `json:"anchorDate"`
	Fields                  map[string]json.RawMessage `json:"fields"`
}

func templateFields(tx *gorm.DB, a *access, t TaskTemplate, input TemplateUseInput, versions bool) (map[string]json.RawMessage, []string, error) {
	if t.Kind != "task" {
		return nil, nil, invalid("Choose a task template.")
	}
	if !validDate(input.AnchorDate) || input.AnchorDate == "" {
		return nil, nil, invalid("Choose an explicit company calendar anchor date.")
	}
	if versions && (input.ExpectedTemplateVersion < 1 || t.Version != input.ExpectedTemplateVersion) {
		return nil, nil, conflict()
	}
	d := t.Defaults
	fields := map[string]json.RawMessage{}
	put := func(k string, v any) { fields[k], _ = json.Marshal(v) }
	put("title", d.Title)
	put("description", d.Description)
	put("priority", "medium")
	if d.Priority != "" {
		put("priority", d.Priority)
	}
	put("estimatedHours", d.EstimatedHours)
	put("tags", d.Tags)
	put("status", "todo")
	if d.Status != "" {
		put("status", d.Status)
	}
	put("departmentId", t.ScopeDepartmentID)
	put("recurrence", "none")
	put("ownerId", a.User.ID)
	put("reviewerId", d.ReviewerID)
	var project Project
	required := d.RequiresApproval
	ownerPolicy := d.OwnerPolicy
	if input.ProjectID != "" {
		var e error
		project, e = scopedProject(tx, a, input.ProjectID)
		if e != nil {
			return nil, nil, e
		}
		if versions && (input.ExpectedProjectVersion < 1 || project.Version != input.ExpectedProjectVersion) {
			return nil, nil, conflict()
		}
		put("projectId", project.ID)
		required = required || project.DefaultRequiresApproval
	}
	switch ownerPolicy {
	case "fixed":
		put("ownerId", d.FixedOwnerID)
	case "project_owner":
		put("ownerId", project.OwnerID)
	case "project_default":
		if project.ID == "" {
			put("ownerId", "")
		} else {
			switch project.TaskOwnerPolicy {
			case "fixed":
				put("ownerId", project.DefaultTaskOwnerID)
			case "project_owner":
				put("ownerId", project.OwnerID)
			}
			put("reviewerId", project.DefaultReviewerID)
		}
	}
	if d.RelativeDueDays != nil {
		date, _ := time.Parse("2006-01-02", input.AnchorDate)
		put("dueDate", date.AddDate(0, 0, *d.RelativeDueDays).Format("2006-01-02"))
		put("deadlineMode", "all_day")
		put("dueAt", "")
		put("dueTimezone", "")
	}
	for k, v := range input.Fields {
		if !in(k, createTaskFields...) || in(k, "parentId", "dependencies", "collaborators", "checklist", "recurrence") || string(v) == "null" {
			return nil, nil, invalid("Unsupported template task field: " + k)
		}
		fields[k] = v
	}
	if v, ok := input.Fields["projectId"]; ok {
		var p string
		if json.Unmarshal(v, &p) != nil || p != input.ProjectID {
			return nil, nil, invalid("The selected project must match the reviewed task project.")
		}
	}
	var candidate Task
	applyFields(fields, &candidate)
	if !in(candidate.Status, "todo", "backlog") {
		return nil, nil, invalid("Template tasks start todo or backlog.")
	}
	required = required || candidate.RequiresApproval
	put("requiresApproval", required)
	unresolved := []string{}
	if !a.activeUser(candidate.OwnerID) || !a.canCreate(candidate.OwnerID, candidate.DepartmentID) {
		unresolved = append(unresolved, "ownerId")
		put("ownerId", "")
	}
	if candidate.ReviewerID != "" && (!a.activeUser(candidate.ReviewerID) || a.Members[candidate.ReviewerID].Role == "viewer" || candidate.ReviewerID == candidate.OwnerID) {
		put("reviewerId", "")
		unresolved = append(unresolved, "reviewerId")
	} else if required && candidate.ReviewerID == "" {
		unresolved = append(unresolved, "reviewerId")
	}
	return fields, unresolved, nil
}
func scopedProject(tx *gorm.DB, a *access, id string) (Project, error) {
	var p Project
	if e := tx.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&p).Error; e != nil {
		return p, missing()
	}
	visible, e := canReadProject(tx, a, p)
	if e != nil {
		return p, e
	}
	if !visible {
		return p, missing()
	}
	return p, nil
}
func (s *Server) templatePreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input TemplateUseInput
	if e = decode(w, r, &input); e != nil {
		return e
	}
	if input.RetryKey != "" {
		return invalid("Preview is read-only; no retry key.")
	}
	var output map[string]any
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		t, e := scopedTemplate(tx, a, r.PathValue("id"), true)
		if e != nil {
			return e
		}
		fields, unresolved, e := templateFields(tx, a, t, input, true)
		if e != nil {
			return e
		}
		output = map[string]any{"fields": fields, "unresolved": unresolved, "templateVersion": t.Version, "projectVersion": input.ExpectedProjectVersion}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, output)
}
func (s *Server) templateApply(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input TemplateUseInput
	if e = decode(w, r, &input); e != nil {
		return e
	}
	key := input.RetryKey
	input.RetryKey = ""
	var out BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var template TaskTemplate
		authorize := func() error {
			var e error
			template, e = scopedTemplate(tx, a, r.PathValue("id"), true)
			if e != nil {
				return e
			}
			return authorizeTaskCreation(tx, a, input.Fields)
		}
		apply := func() (BusinessResult, error) {
			fields, unresolved, e := templateFields(tx, a, template, input, true)
			if e != nil {
				return BusinessResult{}, e
			}
			if len(unresolved) > 0 {
				return BusinessResult{}, invalid("Resolve active owner and independent reviewer before applying.")
			}
			checklist := []ChecklistItem{}
			for _, text := range template.Defaults.Checklist {
				checklist = append(checklist, ChecklistItem{ID: newID("chk"), Text: text})
			}
			fields["checklist"], _ = json.Marshal(checklist)
			t, e := makeTask(a, fields)
			if e != nil {
				return BusinessResult{}, e
			}
			if e = authorizeTaskCreation(tx, a, fields); e != nil {
				return BusinessResult{}, e
			}
			if e = validateTask(tx, a, &t); e != nil {
				return BusinessResult{}, e
			}
			if e = setWorkflow(tx, &t, "", false); e != nil {
				return BusinessResult{}, e
			}
			if e = insertTask(tx, a, &t); e != nil {
				return BusinessResult{}, e
			}
			if e = tx.Create(&TaskTemplateApplication{ID: newID("tpa"), CompanyID: a.Company.ID, TemplateID: template.ID, TemplateVersion: template.Version, TaskID: t.ID, ActorID: a.User.ID, RetryKey: key, CreatedAt: nowString()}).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "task", IDs: []string{t.ID}, Versions: []int64{t.Version}}, nil
		}
		out, e = businessMutation(tx, a, "template_apply", key, []any{r.PathValue("id"), input}, authorize, func(v BusinessResult) error { return authorizeTaskResults(tx, a, v) }, apply)
		return e
	})
	if e != nil {
		return e
	}
	return ok(w, out.IDs[0])
}
func (s *Server) checklistApply(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey                string `json:"retryKey"`
		Version                 int64  `json:"version"`
		TemplateID              string `json:"templateId"`
		ExpectedTemplateVersion int64  `json:"expectedTemplateVersion"`
	}
	if e = decode(w, r, &input); e != nil {
		return e
	}
	key := input.RetryKey
	input.RetryKey = ""
	var out BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var old Task
		var template TaskTemplate
		authorize := func() error {
			var e error
			old, e = scopedTask(tx, a, r.PathValue("id"))
			if e != nil {
				return e
			}
			if !a.canWrite(old) {
				return denied()
			}
			template, e = scopedTemplate(tx, a, input.TemplateID, true)
			if e != nil {
				return e
			}
			if template.Kind != "checklist" {
				return invalid("Choose a checklist template.")
			}
			return nil
		}
		apply := func() (BusinessResult, error) {
			if input.ExpectedTemplateVersion < 1 || template.Version != input.ExpectedTemplateVersion {
				return BusinessResult{}, conflict()
			}
			items := append([]ChecklistItem{}, old.Checklist...)
			for _, text := range template.Defaults.Checklist {
				items = append(items, ChecklistItem{ID: newID("chk"), Text: text})
			}
			raw, _ := json.Marshal(items)
			fields := map[string]json.RawMessage{"checklist": raw}
			next, e := prepareTaskPatch(tx, a, old, input.Version, fields, nil)
			if e != nil {
				return BusinessResult{}, e
			}
			if e = commitTaskPatch(tx, a, old, next, fields); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "task", IDs: []string{old.ID}, Versions: []int64{old.Version + 1}}, nil
		}
		out, e = businessMutation(tx, a, "checklist_apply", key, []any{r.PathValue("id"), input}, authorize, func(v BusinessResult) error { return authorizeTaskResults(tx, a, v) }, apply)
		return e
	})
	if e != nil {
		return e
	}
	return ok(w, out.IDs[0])
}
