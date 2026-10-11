package platform

import (
	"encoding/json"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var colorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func readFields(w http.ResponseWriter, r *http.Request, allowed ...string) (map[string]json.RawMessage, error) {
	var f map[string]json.RawMessage
	if e := decode(w, r, &f); e != nil {
		return nil, e
	}
	if len(f) == 0 {
		return nil, invalid("Provide at least one field.")
	}
	for k, v := range f {
		if !in(k, allowed...) {
			return nil, invalid("Unknown or immutable field: " + k)
		}
		if string(v) == "null" {
			return nil, invalid(k + " cannot be null; use an empty string or list.")
		}
	}
	return f, nil
}
func applyFields(f map[string]json.RawMessage, v any) error {
	b, e := json.Marshal(f)
	if e != nil {
		return e
	}
	if e = json.Unmarshal(b, v); e != nil {
		return invalid("Invalid field type: " + e.Error())
	}
	return nil
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func validateCompany(c Company) error {
	if !clean(c.Name, 120) {
		return invalid("Company name is required (up to 120 characters).")
	}
	if !slugPattern.MatchString(c.Slug) || len(c.Slug) > 60 {
		return invalid("Company slug must use lowercase letters, numbers and hyphens (up to 60).")
	}
	if _, e := time.LoadLocation(c.Timezone); e != nil {
		return invalid("Select a valid IANA company timezone.")
	}
	if !colorPattern.MatchString(c.Color) {
		return invalid("Color must be a six-digit hex value such as #F97316.")
	}
	if len(c.Industry) > 160 {
		return invalid("Industry must be at most 160 characters.")
	}
	if !in(c.Currency, supportedCurrencies...) || c.FiscalYearStartMonth < 1 || c.FiscalYearStartMonth > 12 {
		return invalid("Choose a supported two-decimal currency and a financial-year start month from 1 to 12.")
	}
	return nil
}
func (s *Server) createCompany(w http.ResponseWriter, r *http.Request) error {
	u, _, e := s.authenticate(r)
	if e != nil {
		return e
	}
	if !u.IsPlatformAdmin {
		return denied()
	}
	f, e := readFields(w, r, "name", "slug", "industry", "timezone", "color", "currency", "fiscalYearStartMonth")
	if e != nil {
		return e
	}
	c := Company{ID: newID("cmp"), Timezone: "UTC", Color: "#F97316", Currency: "INR", FiscalYearStartMonth: 4, CreatedAt: nowString()}
	if e = applyFields(f, &c); e != nil {
		return e
	}
	c.Name = strings.TrimSpace(c.Name)
	if e = validateCompany(c); e != nil {
		return e
	}
	e = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var n int64
		if e := tx.Model(&Company{}).Where("slug = ?", c.Slug).Count(&n).Error; e != nil {
			return e
		}
		if n > 0 {
			return invalid("That company slug is already in use.")
		}
		if e := tx.Create(&c).Error; e != nil {
			return e
		}
		m := Membership{ID: newID("mem"), CompanyID: c.ID, UserID: u.ID, Role: "founder", CapacityHours: 40, Active: true}
		if e := tx.Create(&m).Error; e != nil {
			return e
		}
		if e := defaultExpenseCategories(tx, c.ID); e != nil {
			return e
		}
		return audit(tx, c.ID, "", u.ID, "company_created", c.Name+" created.")
	})
	if e != nil {
		return e
	}
	return ok(w, c.ID)
}
func (s *Server) patchCompany(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "name", "slug", "industry", "timezone", "color", "currency", "fiscalYearStartMonth")
	if e != nil {
		return e
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !leadership(a.Member.Role) {
			return denied()
		}
		c := a.Company
		if e := applyFields(f, &c); e != nil {
			return e
		}
		if e := validateCompany(c); e != nil {
			return e
		}
		if c.Currency != a.Company.Currency || c.FiscalYearStartMonth != a.Company.FiscalYearStartMonth {
			var budgets, expenses int64
			if e := tx.Model(&Budget{}).Where("company_id = ?", c.ID).Count(&budgets).Error; e != nil {
				return e
			}
			if e := tx.Model(&Expense{}).Where("company_id = ?", c.ID).Count(&expenses).Error; e != nil {
				return e
			}
			if budgets > 0 || expenses > 0 {
				return invalid("Currency and financial-year start cannot change after a budget or expense has been recorded.")
			}
		}
		var n int64
		if e := tx.Model(&Company{}).Where("slug = ? AND id <> ?", c.Slug, c.ID).Count(&n).Error; e != nil {
			return e
		}
		if n > 0 {
			return invalid("That company slug is already in use.")
		}
		if e := tx.Model(&Company{}).Where("id = ?", c.ID).Updates(map[string]any{"name": c.Name, "slug": c.Slug, "industry": c.Industry, "timezone": c.Timezone, "color": c.Color, "currency": c.Currency, "fiscal_year_start_month": c.FiscalYearStartMonth}).Error; e != nil {
			return e
		}
		return audit(tx, c.ID, "", a.User.ID, "company_updated", "Company identity and settings updated.")
	})
	if e != nil {
		return e
	}
	return ok(w, a.Company.ID)
}
func departmentExists(db *gorm.DB, cid, id string) bool {
	if id == "" {
		return true
	}
	var n int64
	return db.Model(&Department{}).Where("id = ? AND company_id = ?", id, cid).Count(&n).Error == nil && n == 1
}
func (s *Server) saveDepartment(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "name", "headId", "color", "description")
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if id == "" {
		id = newID("dep")
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !leadership(a.Member.Role) {
			return denied()
		}
		d := Department{ID: id, CompanyID: a.Company.ID, Color: "#F97316"}
		if r.Method == "PATCH" {
			if e := tx.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&d).Error; e != nil {
				return missing()
			}
		}
		if e := applyFields(f, &d); e != nil {
			return e
		}
		if !clean(d.Name, 120) || len(d.Description) > 4000 {
			return invalid("Department name is required (up to 120 characters); description allows 4,000.")
		}
		if !colorPattern.MatchString(d.Color) {
			return invalid("Use a six-digit hex color.")
		}
		if d.HeadID != "" && !a.activeUser(d.HeadID) {
			return invalid("Department head must be an active member of this company.")
		}
		if e := tx.Save(&d).Error; e != nil {
			return e
		}
		return audit(tx, a.Company.ID, "", a.User.ID, "department_updated", d.Name+" saved.")
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func validateMember(db *gorm.DB, a *access, m Membership) error {
	if rank(m.Role) == 0 {
		return invalid("Choose a valid company role.")
	}
	if !finite(m.CapacityHours) || m.CapacityHours < 0 || m.CapacityHours > 168 {
		return invalid("Weekly capacity must be between 0 and 168 hours.")
	}
	if len(m.Title) > 160 {
		return invalid("Title must be at most 160 characters.")
	}
	if !departmentExists(db, a.Company.ID, m.DepartmentID) {
		return invalid("Department must belong to this company.")
	}
	if m.ManagerID != "" {
		if m.ManagerID == m.UserID || !a.activeUser(m.ManagerID) {
			return invalid("Reporting manager must be another active member of this company.")
		}
		seen := map[string]bool{m.UserID: true}
		uid := m.ManagerID
		for uid != "" {
			if seen[uid] {
				return invalid("Reporting lines cannot form a cycle.")
			}
			seen[uid] = true
			parent, ok := a.Members[uid]
			if !ok {
				break
			}
			uid = parent.ManagerID
		}
	}
	return nil
}
func (s *Server) addPerson(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	if !leadership(a.Member.Role) {
		return denied()
	}
	var v struct {
		Name          string  `json:"name"`
		Email         string  `json:"email"`
		Password      string  `json:"password"`
		Role          string  `json:"role"`
		DepartmentID  string  `json:"departmentId"`
		ManagerID     string  `json:"managerId"`
		Title         string  `json:"title"`
		CapacityHours float64 `json:"capacityHours"`
	}
	if e = decode(w, r, &v); e != nil {
		return e
	}
	v.Email = strings.ToLower(strings.TrimSpace(v.Email))
	if !validEmail(v.Email) || !clean(v.Name, 120) {
		return invalid("A name (up to 120 characters) and valid email address are required.")
	}
	if rank(v.Role) > rank(a.Member.Role) || (v.Role == "founder" && a.Member.Role != "founder") {
		return denied()
	}
	var u User
	e = s.db.Where("email = ?", v.Email).First(&u).Error
	newUser := e == gorm.ErrRecordNotFound
	if e != nil && !newUser {
		return e
	}
	if newUser {
		if e = validatePassword(v.Password); e != nil {
			return e
		}
		hash, e := passwordHash(v.Password)
		if e != nil {
			return e
		}
		u = User{ID: newID("usr"), Name: strings.TrimSpace(v.Name), Email: v.Email, PasswordHash: hash}
	}
	m := Membership{ID: newID("mem"), CompanyID: a.Company.ID, UserID: u.ID, Role: v.Role, DepartmentID: v.DepartmentID, ManagerID: v.ManagerID, Title: v.Title, CapacityHours: v.CapacityHours, Active: true}
	if e = validateMember(s.db, a, m); e != nil {
		return e
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !leadership(a.Member.Role) || rank(v.Role) > rank(a.Member.Role) || (v.Role == "founder" && a.Member.Role != "founder") {
			return denied()
		}
		if e := validateMember(tx, a, m); e != nil {
			return e
		}
		if e := lockCompany(tx, a.Company.ID); e != nil {
			return e
		}
		var n int64
		if e := tx.Model(&Membership{}).Where("company_id = ? AND user_id = ?", a.Company.ID, u.ID).Count(&n).Error; e != nil {
			return e
		}
		if n > 0 {
			return invalid("This account already has a membership; edit that membership instead.")
		}
		if newUser {
			if e := tx.Create(&u).Error; e != nil {
				return e
			}
		}
		if e := tx.Create(&m).Error; e != nil {
			return e
		}
		return audit(tx, a.Company.ID, "", a.User.ID, "person_added", u.Name+" added as "+m.Role+". Existing account passwords are never reset.")
	})
	if e != nil {
		return e
	}
	return ok(w, u.ID)
}
func lockCompany(tx *gorm.DB, cid string) error {
	if tx.Dialector.Name() == "postgres" {
		var c Company
		return tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&c, "id = ?", cid).Error
	}
	return tx.Model(&Company{}).Where("id = ?", cid).UpdateColumn("next_task_number", gorm.Expr("next_task_number")).Error
}
func (s *Server) patchPerson(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "role", "departmentId", "managerId", "title", "capacityHours", "active")
	if e != nil {
		return e
	}
	uid := r.PathValue("id")
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !leadership(a.Member.Role) {
			return denied()
		}
		old, exists := a.Members[uid]
		if !exists {
			return missing()
		}
		m := old
		if e := applyFields(f, &m); e != nil {
			return e
		}
		if e := validateMember(tx, a, m); e != nil {
			return e
		}
		if rank(old.Role) > rank(a.Member.Role) || rank(m.Role) > rank(a.Member.Role) || (m.Role == "founder" && a.Member.Role != "founder") {
			return denied()
		}
		if uid == a.User.ID && rank(m.Role) > rank(old.Role) {
			return denied()
		}
		if uid == a.User.ID && !m.Active {
			return invalid("Ask another company administrator to deactivate your membership.")
		}
		if old.Role == "founder" && old.Active && (m.Role != "founder" || !m.Active) {
			count := 0
			for _, member := range a.Members {
				if member.Role == "founder" && member.Active {
					count++
				}
			}
			if count <= 1 {
				return invalid("A company must retain at least one active founder.")
			}
		}
		if old.Active && !m.Active {
			if e := revokeCompanyConversations(tx, a.Company.ID, uid); e != nil {
				return e
			}
		}
		if e := tx.Model(&Membership{}).Where("id = ?", m.ID).Updates(map[string]any{"role": m.Role, "department_id": m.DepartmentID, "manager_id": m.ManagerID, "title": m.Title, "capacity_hours": m.CapacityHours, "active": m.Active}).Error; e != nil {
			return e
		}
		return audit(tx, a.Company.ID, "", a.User.ID, "membership_updated", uid+": role "+old.Role+" → "+m.Role+"; reporting line, capacity and active status saved.")
	})
	if e != nil {
		return e
	}
	return ok(w, uid)
}
func (s *Server) saveProject(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "name", "description", "departmentId", "ownerId", "dueDate", "color", "status", "version", "taskOwnerPolicy", "defaultTaskOwnerId", "defaultReviewerId", "defaultRequiresApproval")
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if id == "" {
		id = newID("prj")
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !in(a.Member.Role, "founder", "ceo", "admin", "head", "manager") {
			return denied()
		}
		p := Project{ID: id, CompanyID: a.Company.ID, Color: "#F97316", Status: "active", Version: 1, TaskOwnerPolicy: "actor"}
		var expected int64
		if r.Method == "PATCH" {
			if json.Unmarshal(f["version"], &expected) != nil || expected < 1 {
				return invalid("A positive project version is required.")
			}
		}
		delete(f, "version")
		if r.Method == "PATCH" {
			if e := tx.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&p).Error; e != nil {
				return missing()
			}
			if !a.canCreate(p.OwnerID, p.DepartmentID) {
				return denied()
			}
			if p.Version != expected {
				return conflict()
			}
		}
		if e := applyFields(f, &p); e != nil {
			return e
		}
		if !clean(p.Name, 160) || len(p.Description) > 8000 {
			return invalid("Project name is required (up to 160 characters); description allows 8,000.")
		}
		if !a.activeUser(p.OwnerID) || !departmentExists(tx, a.Company.ID, p.DepartmentID) {
			return invalid("Project owner and department must belong to this company.")
		}
		if !validDate(p.DueDate) || !colorPattern.MatchString(p.Color) || !in(p.Status, "active", "on_hold", "completed", "archived") {
			return invalid("Project date, color or status is invalid.")
		}
		if !a.canCreate(p.OwnerID, p.DepartmentID) {
			return denied()
		}
		if !in(p.TaskOwnerPolicy, "actor", "project_owner", "fixed") {
			return invalid("Choose a project task owner policy.")
		}
		if p.TaskOwnerPolicy == "fixed" && (!a.activeUser(p.DefaultTaskOwnerID) || !a.canCreate(p.DefaultTaskOwnerID, p.DepartmentID)) {
			return invalid("Choose an active permitted default owner.")
		}
		resolvedOwner := p.OwnerID
		if p.TaskOwnerPolicy == "fixed" {
			resolvedOwner = p.DefaultTaskOwnerID
		}
		if p.DefaultReviewerID != "" && (!a.activeUser(p.DefaultReviewerID) || a.Members[p.DefaultReviewerID].Role == "viewer" || p.DefaultReviewerID == resolvedOwner) {
			return invalid("Choose an active independent default reviewer.")
		}
		if p.DefaultRequiresApproval && p.DefaultReviewerID == "" {
			return invalid("Choose a default reviewer for required review.")
		}
		if r.Method == "PATCH" {
			p.Version = expected + 1
			res := tx.Model(&Project{}).Where("id = ? AND company_id = ? AND version = ?", p.ID, p.CompanyID, expected).Select("*").Updates(&p)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected != 1 {
				return conflict()
			}
		} else {
			if e := tx.Create(&p).Error; e != nil {
				return e
			}
		}
		return audit(tx, a.Company.ID, "", a.User.ID, "project_updated", p.Name+" saved.")
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
