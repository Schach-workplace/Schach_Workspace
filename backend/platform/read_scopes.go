package platform

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"

	"gorm.io/gorm"
)

// taskReadQuery expresses exactly canRead before LIMIT. JSON membership uses the
// database JSON operator rather than a text substring that could match another ID.
func taskReadQuery(db *gorm.DB, a *access) *gorm.DB {
	q := db.Model(&Task{}).Where("company_id = ?", a.Company.ID)
	if leadership(a.Member.Role) || a.Member.Role == "viewer" {
		return q
	}
	condition := "owner_id = ? OR created_by = ? OR reviewer_id = ?"
	args := []any{a.User.ID, a.User.ID, a.User.ID}
	if db.Dialector.Name() == "postgres" {
		condition += " OR collaborators @> ?::jsonb"
		b, _ := json.Marshal([]string{a.User.ID})
		args = append(args, string(b))
	} else {
		condition += " OR EXISTS (SELECT 1 FROM json_each(tasks.collaborators) WHERE value = ?)"
		args = append(args, a.User.ID)
	}
	if a.Member.Role == "head" && a.Member.DepartmentID != "" {
		condition += " OR department_id = ?"
		args = append(args, a.Member.DepartmentID)
	}
	if a.Member.Role == "manager" {
		owners := []string{}
		for uid := range a.Members {
			if a.ownsScope(uid) {
				owners = append(owners, uid)
			}
		}
		condition += " OR owner_id IN ?"
		args = append(args, owners)
	}
	return q.Where("("+condition+")", args...)
}
func expenseReadQuery(db *gorm.DB, a *access) *gorm.DB {
	q := db.Model(&Expense{}).Where("company_id = ?", a.Company.ID)
	switch a.financeScope() {
	case "none":
		return q.Where("1 = 0")
	case "personal":
		return q.Where("created_by = ?", a.User.ID)
	case "department":
		return q.Where("created_by = ? OR (department_id = ? AND department_id <> '')", a.User.ID, a.Member.DepartmentID)
	}
	return q
}
func accessBasis(a *access) string {
	ms := make([]Membership, 0, len(a.Members))
	for _, m := range a.Members {
		ms = append(ms, m)
	}
	sort.Slice(ms, func(i, j int) bool { return ms[i].UserID < ms[j].UserID })
	return payloadHash([]any{a.Company.ID, a.User.ID, a.Company.Timezone, ms})
}
func pageLimit(r *http.Request) (int, error) {
	v := r.URL.Query().Get("limit")
	if v == "" {
		return 100, nil
	}
	n, e := strconv.Atoi(v)
	if e != nil || n < 1 || n > 100 {
		return 0, invalid("Page size must be between 1 and 100.")
	}
	return n, nil
}

type readCursor struct {
	Basis   string `json:"b"`
	Created string `json:"c"`
	ID      string `json:"i"`
}

func encodeReadCursor(c readCursor) string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}
func decodeReadCursor(v, basis string) (readCursor, error) {
	var c readCursor
	if len(v) > 2048 {
		return c, invalid("Invalid read cursor.")
	}
	b, e := base64.RawURLEncoding.DecodeString(v)
	if e != nil || json.Unmarshal(b, &c) != nil || c.Basis != basis || c.ID == "" {
		return c, invalid("This cursor does not match the current read scope.")
	}
	return c, nil
}
func normalizeTask(t *Task) {
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
	if t.Comments == nil {
		t.Comments = []Comment{}
	}
	if t.TimeEntries == nil {
		t.TimeEntries = []TimeEntry{}
	}
	if t.Attachments == nil {
		t.Attachments = []Attachment{}
	}
}
func pruneTaskLinks(db *gorm.DB, a *access, rows []Task) error {
	ids := []string{}
	for _, t := range rows {
		ids = append(ids, t.Dependencies...)
		if t.ParentID != "" {
			ids = append(ids, t.ParentID)
		}
	}
	visible := map[string]bool{}
	if len(ids) > 0 {
		var refs []Task
		if e := taskReadQuery(db, a).Select("id").Where("id IN ?", ids).Find(&refs).Error; e != nil {
			return e
		}
		for _, t := range refs {
			visible[t.ID] = true
		}
	}
	for i := range rows {
		t := &rows[i]
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
		normalizeTask(t)
	}
	return nil
}
func (s *Server) taskList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	q := r.URL.Query()
	basis := payloadHash([]string{accessBasis(a), "tasks", q.Get("departmentId"), q.Get("ownerId"), q.Get("projectId"), q.Get("status")})
	db := s.db.WithContext(r.Context())
	query := taskReadQuery(db, a).Omit("Description", "Checklist", "BlockerReason", "DeadlineChangeReason")
	for _, f := range []struct{ key, col string }{{"departmentId", "department_id"}, {"ownerId", "owner_id"}, {"projectId", "project_id"}, {"status", "status"}} {
		if v := q.Get(f.key); v != "" {
			query = query.Where(f.col+" = ?", v)
		}
	}
	if v := q.Get("cursor"); v != "" {
		c, e := decodeReadCursor(v, basis)
		if e != nil {
			return e
		}
		query = query.Where("created_at < ? OR (created_at = ? AND id < ?)", c.Created, c.Created, c.ID)
	}
	rows := []Task{}
	if e = query.Order("created_at DESC, id DESC").Limit(limit + 1).Find(&rows).Error; e != nil {
		return e
	}
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	if e = pruneTaskLinks(db, a, rows); e != nil {
		return e
	}
	cursor := ""
	if more {
		t := rows[len(rows)-1]
		cursor = encodeReadCursor(readCursor{basis, t.CreatedAt, t.ID})
	}
	return respond(w, 200, map[string]any{"tasks": rows, "cursor": cursor, "hasMore": more})
}
func (s *Server) taskDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	db := s.db.WithContext(r.Context())
	t, e := scopedTask(db, a, r.PathValue("id"))
	if e != nil {
		return e
	}
	evidence := map[string]any{}
	t.Comments, evidence["comments"], e = readEvidence[Comment](db.Where("company_id = ? AND task_id = ?", a.Company.ID, t.ID), "", accessBasis(a)+":task:"+t.ID+":comments", 100)
	if e != nil {
		return e
	}
	t.TimeEntries, evidence["timeEntries"], e = readEvidence[TimeEntry](db.Where("company_id = ? AND task_id = ?", a.Company.ID, t.ID), "", accessBasis(a)+":task:"+t.ID+":timeEntries", 100)
	if e != nil {
		return e
	}
	t.Attachments, evidence["attachments"], e = readEvidence[Attachment](db.Omit("Data").Where("company_id = ? AND task_id = ?", a.Company.ID, t.ID), "", accessBasis(a)+":task:"+t.ID+":attachments", 100)
	if e != nil {
		return e
	}

	rows := []Task{t}
	if e = pruneTaskLinks(db, a, rows); e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"task": rows[0], "evidence": evidence, "people": taskEvidencePeople(a, rows[0])})
}
func pruneExpenseLinks(db *gorm.DB, a *access, rows []Expense) error {
	taskIDs, projectIDs := []string{}, []string{}
	for _, e := range rows {
		if e.TaskID != "" {
			taskIDs = append(taskIDs, e.TaskID)
		}
		if e.ProjectID != "" {
			projectIDs = append(projectIDs, e.ProjectID)
		}
	}
	tasks, projects := map[string]bool{}, map[string]bool{}
	if len(taskIDs) > 0 {
		var refs []Task
		if e := taskReadQuery(db, a).Select("id").Where("id IN ?", taskIDs).Find(&refs).Error; e != nil {
			return e
		}
		for _, t := range refs {
			tasks[t.ID] = true
		}
	}
	if len(projectIDs) > 0 {
		var refs []Project
		if e := db.Where("company_id = ? AND id IN ?", a.Company.ID, projectIDs).Find(&refs).Error; e != nil {
			return e
		}
		for _, p := range refs {
			if leadership(a.Member.Role) || a.Member.Role == "viewer" || a.ownsScope(p.OwnerID) || (a.Member.Role == "head" && a.Member.DepartmentID != "" && p.DepartmentID == a.Member.DepartmentID) {
				projects[p.ID] = true
			}
		}
	}
	for i := range rows {
		e := &rows[i]
		if e.Receipts == nil {
			e.Receipts = []ExpenseReceipt{}
		}
		if !tasks[e.TaskID] {
			e.TaskID = ""
		}
		if !projects[e.ProjectID] {
			e.ProjectID = ""
		}
	}
	return nil
}
func (s *Server) expenseList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	q := r.URL.Query()
	basis := payloadHash([]string{accessBasis(a), "expenses", q.Get("departmentId"), q.Get("status")})
	db := s.db.WithContext(r.Context())
	query := expenseReadQuery(db, a).Omit("Description", "ReviewNote", "ReceiptExceptionReason", "BudgetOverrideReason")
	if v := q.Get("departmentId"); v != "" {
		query = query.Where("department_id = ?", v)
	}
	if v := q.Get("status"); v != "" {
		query = query.Where("status = ?", v)
	}
	if v := q.Get("cursor"); v != "" {
		c, e := decodeReadCursor(v, basis)
		if e != nil {
			return e
		}
		query = query.Where("created_at < ? OR (created_at = ? AND id < ?)", c.Created, c.Created, c.ID)
	}
	rows := []Expense{}
	if e = query.Order("created_at DESC, id DESC").Limit(limit + 1).Find(&rows).Error; e != nil {
		return e
	}
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	if e = pruneExpenseLinks(db, a, rows); e != nil {
		return e
	}
	cursor := ""
	if more {
		v := rows[len(rows)-1]
		cursor = encodeReadCursor(readCursor{basis, v.CreatedAt, v.ID})
	}
	return respond(w, 200, map[string]any{"expenses": rows, "cursor": cursor, "hasMore": more})
}
func (s *Server) expenseDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	db := s.db.WithContext(r.Context())
	v, e := scopedExpense(db, a, r.PathValue("id"))
	if e != nil {
		return e
	}
	receipts, receiptPage, e := readEvidence[ExpenseReceipt](db.Omit("Data").Where("company_id = ? AND expense_id = ?", a.Company.ID, v.ID), "", accessBasis(a)+":expense:"+v.ID+":receipts", 100)
	if e != nil {
		return e
	}
	v.Receipts = receipts

	rows := []Expense{v}
	if e = pruneExpenseLinks(db, a, rows); e != nil {
		return e
	}
	events := []FinanceEvent{}
	if e = db.Where("company_id = ? AND entity_type = 'expense' AND entity_id = ?", a.Company.ID, v.ID).Order("created_at DESC, id DESC").Limit(1000).Find(&events).Error; e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"expense": rows[0], "financeEvents": events, "evidence": map[string]any{"receipts": receiptPage}, "people": financeEventPeople(a, events)})
}

func (s *Server) financeEvents(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	db := s.db.WithContext(r.Context())
	q := db.Where("company_id = ?", a.Company.ID)
	switch a.financeScope() {
	case "none":
		q = q.Where("1 = 0")
	case "personal":
		q = q.Where("entity_type = 'expense' AND entity_id IN (?)", expenseReadQuery(db, a).Select("id"))
	case "department":
		q = q.Where("(entity_type = 'expense' AND entity_id IN (?)) OR (entity_type = 'budget' AND department_id = ? AND department_id <> '')", expenseReadQuery(db, a).Select("id"), a.Member.DepartmentID)
	}
	rows := []FinanceEvent{}
	if e = q.Order("created_at DESC, id DESC").Limit(1000).Find(&rows).Error; e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"financeEvents": rows, "people": financeEventPeople(a, rows)})
}

func readEvidence[T any](query *gorm.DB, raw, basis string, limit int) ([]T, map[string]any, error) {
	if raw != "" {
		c, e := decodeReadCursor(raw, basis)
		if e != nil {
			return nil, nil, e
		}
		query = query.Where("created_at > ? OR (created_at = ? AND id > ?)", c.Created, c.Created, c.ID)
	}
	rows := []T{}
	if e := query.Order("created_at ASC, id ASC").Limit(limit + 1).Find(&rows).Error; e != nil {
		return nil, nil, e
	}
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	cursor := ""
	if more {
		c := readCursor{Basis: basis}
		switch v := any(rows[len(rows)-1]).(type) {
		case Comment:
			c.ID, c.Created = v.ID, v.CreatedAt
		case TimeEntry:
			c.ID, c.Created = v.ID, v.CreatedAt
		case Attachment:
			c.ID, c.Created = v.ID, v.CreatedAt
		case ExpenseReceipt:
			c.ID, c.Created = v.ID, v.CreatedAt
		}
		cursor = encodeReadCursor(c)
	}
	return rows, map[string]any{"cursor": cursor, "hasMore": more}, nil
}
func taskEvidencePeople(a *access, t Task) []Person {
	ids := map[string]bool{}
	for _, v := range t.Comments {
		ids[v.UserID] = true
	}
	for _, v := range t.TimeEntries {
		ids[v.UserID] = true
	}
	for _, v := range t.Attachments {
		ids[v.UploadedBy] = true
	}
	rows := []Person{}
	for id := range ids {
		if m, ok := a.Members[id]; ok {
			rows = append(rows, person(a.Users[id], m))
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	return rows
}
func (s *Server) taskEvidence(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	db := s.db.WithContext(r.Context())
	t, e := scopedTask(db, a, r.PathValue("id"))
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	kind := r.PathValue("kind")
	if kind == "time" {
		kind = "timeEntries"
	}
	basis := accessBasis(a) + ":task:" + t.ID + ":" + kind
	query := db.Where("company_id = ? AND task_id = ?", a.Company.ID, t.ID)
	var rows any
	var meta map[string]any
	switch kind {
	case "comments":
		t.Comments, meta, e = readEvidence[Comment](query, r.URL.Query().Get("cursor"), basis, limit)
		rows = t.Comments
	case "timeEntries":
		t.TimeEntries, meta, e = readEvidence[TimeEntry](query, r.URL.Query().Get("cursor"), basis, limit)
		rows = t.TimeEntries
	case "attachments":
		t.Attachments, meta, e = readEvidence[Attachment](query.Omit("Data"), r.URL.Query().Get("cursor"), basis, limit)
		rows = t.Attachments
	default:
		return missing()
	}
	if e != nil {
		return e
	}
	meta[kind] = rows
	meta["people"] = taskEvidencePeople(a, t)
	return respond(w, 200, meta)
}
func (s *Server) expenseEvidence(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	db := s.db.WithContext(r.Context())
	v, e := scopedExpense(db, a, r.PathValue("id"))
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	rows, meta, e := readEvidence[ExpenseReceipt](db.Omit("Data").Where("company_id = ? AND expense_id = ?", a.Company.ID, v.ID), r.URL.Query().Get("cursor"), accessBasis(a)+":expense:"+v.ID+":receipts", limit)
	if e != nil {
		return e
	}
	meta["receipts"] = rows
	return respond(w, 200, meta)
}

func financeEventPeople(a *access, rows []FinanceEvent) []Person {
	ids := map[string]bool{}
	for _, v := range rows {
		ids[v.UserID] = true
	}
	people := []Person{}
	for id := range ids {
		if m, ok := a.Members[id]; ok {
			people = append(people, person(a.Users[id], m))
		}
	}
	sort.Slice(people, func(i, j int) bool { return people[i].ID < people[j].ID })
	return people
}
