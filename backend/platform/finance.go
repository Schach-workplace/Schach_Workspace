package platform

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

const maxMoneyMinor int64 = 1000000000000

var supportedCurrencies = []string{"INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"}

func financeAuthority(role string) bool { return leadership(role) || role == "finance" }
func (a *access) financeScope() string {
	if financeAuthority(a.Member.Role) {
		return "company"
	}
	if a.Member.Role == "head" {
		return "department"
	}
	if in(a.Member.Role, "manager", "member") {
		return "personal"
	}
	return "none"
}
func (a *access) canReadExpense(e Expense) bool {
	if a.financeScope() == "none" {
		return false
	}
	return financeAuthority(a.Member.Role) || e.CreatedBy == a.User.ID || (a.Member.Role == "head" && a.Member.DepartmentID != "" && e.DepartmentID == a.Member.DepartmentID)
}
func (a *access) canCreateExpense(department string) bool {
	return financeAuthority(a.Member.Role) || (in(a.Member.Role, "head", "manager", "member") && department != "" && department == a.Member.DepartmentID)
}
func (a *access) canApproveExpense(e Expense) bool {
	return a.User.ID != e.CreatedBy && (financeAuthority(a.Member.Role) || (a.Member.Role == "head" && a.Member.DepartmentID != "" && e.DepartmentID == a.Member.DepartmentID))
}
func scopedExpense(db *gorm.DB, a *access, id string) (Expense, error) {
	var e Expense
	err := db.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&e).Error
	if err == gorm.ErrRecordNotFound {
		return e, missing()
	}
	if err != nil {
		return e, err
	}
	if !a.canReadExpense(e) {
		return e, missing()
	}
	return e, nil
}
func financeConflict() error {
	return &apiError{Status: 409, Code: "version_conflict", Message: "This financial record changed since you opened it. Refresh and retry your decision intentionally."}
}
func financialVersion(f map[string]json.RawMessage) (int64, error) {
	var version int64
	if err := json.Unmarshal(f["version"], &version); err != nil || version < 1 {
		return 0, invalid("A positive financial record version is required; refresh before editing.")
	}
	delete(f, "version")
	return version, nil
}
func meaningfulReason(s string) bool {
	s = strings.TrimSpace(s)
	return utf8.RuneCountInString(s) >= 12 && financeTextFits(s, 4000)
}
func financeTextFits(s string, max int) bool { return utf8.RuneCountInString(s) <= max }
func financeClean(s string, max int) bool {
	return strings.TrimSpace(s) != "" && financeTextFits(s, max)
}
func normalizeWords(s string) string { return strings.Join(strings.Fields(s), " ") }
func invoiceKey(s string) string     { return strings.ToLower(normalizeWords(s)) }
func moneyLabel(currency string, amount int64) string {
	return fmt.Sprintf("%s %d.%02d", currency, amount/100, amount%100)
}
func financeEvent(tx *gorm.DB, cid, department, entityType, entityID, uid, action, detail string) error {
	return tx.Create(&FinanceEvent{ID: newID("fev"), CompanyID: cid, DepartmentID: department, EntityType: entityType, EntityID: entityID, UserID: uid, Action: action, Detail: detail, CreatedAt: nowString()}).Error
}
func financialChanges(fields map[string]json.RawMessage, before, after any) string {
	oldBytes, _ := json.Marshal(before)
	newBytes, _ := json.Marshal(after)
	var old, next map[string]json.RawMessage
	_ = json.Unmarshal(oldBytes, &old)
	_ = json.Unmarshal(newBytes, &next)
	keys := make([]string, 0, len(fields))
	for key := range fields {
		if key != "reason" && string(old[key]) != string(next[key]) {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	changes := make([]string, 0, len(keys))
	for _, key := range keys {
		if key == "taskId" || key == "projectId" {
			// Finance visibility never grants work visibility. Keep this event safe
			// even when a linked task or project is hidden from a later reader.
			label := map[string]string{"taskId": "Linked task", "projectId": "Linked project"}[key]
			changes = append(changes, label+" changed")
			continue
		}
		changes = append(changes, key+": "+string(old[key])+" → "+string(next[key]))
	}
	return strings.Join(changes, "; ")
}

func defaultExpenseCategories(tx *gorm.DB, cid string) error {
	for _, item := range []struct{ name, color string }{
		{"Materials", "#F97316"}, {"Equipment", "#6366F1"}, {"Travel", "#3B82F6"}, {"Software", "#14B8A6"},
		{"Professional services", "#A855F7"}, {"People & administration", "#16A34A"}, {"Other", "#64748B"},
	} {
		category := ExpenseCategory{ID: newID("cat"), CompanyID: cid, Name: item.name, Color: item.color, Active: true, ReceiptRequired: true, Version: 1}
		if err := tx.Create(&category).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) saveExpenseCategory(w http.ResponseWriter, r *http.Request) error {
	a, err := s.access(r)
	if err != nil {
		return err
	}
	allowed := []string{"name", "color", "active", "receiptRequired"}
	if r.Method == "PATCH" {
		allowed = append(allowed, "version")
	}
	f, err := readFields(w, r, allowed...)
	if err != nil {
		return err
	}
	var version int64
	if r.Method == "PATCH" {
		version, err = financialVersion(f)
		if err != nil {
			return err
		}
		if len(f) == 0 {
			return invalid("Provide a category field to update.")
		}
	}
	id := r.PathValue("id")
	if id == "" {
		id = newID("cat")
	}
	err = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !financeAuthority(a.Member.Role) {
			return denied()
		}
		category := ExpenseCategory{ID: id, CompanyID: a.Company.ID, Color: "#64748B", Active: true, ReceiptRequired: true, Version: 1}
		if r.Method == "PATCH" {
			if e := tx.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&category).Error; e != nil {
				if e == gorm.ErrRecordNotFound {
					return missing()
				}
				return e
			}
			if category.Version != version {
				return financeConflict()
			}
		}
		old := category
		if e := applyFields(f, &category); e != nil {
			return e
		}
		category.Name = normalizeWords(category.Name)
		if !financeClean(category.Name, 120) || !colorPattern.MatchString(category.Color) {
			return invalid("A category requires a name up to 120 characters and a six-digit hex color.")
		}
		var count int64
		if e := tx.Model(&ExpenseCategory{}).Where("company_id = ? AND lower(name) = ? AND id <> ?", a.Company.ID, strings.ToLower(category.Name), category.ID).Count(&count).Error; e != nil {
			return e
		}
		if count > 0 {
			return invalid("That expense category already exists, including archived categories.")
		}
		action, detail := "category_created", "Created "+category.Name+"."
		if r.Method == "PATCH" {
			category.Version++
			result := tx.Model(&ExpenseCategory{}).Where("id = ? AND company_id = ? AND version = ?", id, a.Company.ID, version).Select("name", "color", "active", "receipt_required", "version").Updates(&category)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return financeConflict()
			}
			action, detail = "category_updated", financialChanges(f, old, category)
		} else if e := tx.Create(&category).Error; e != nil {
			return e
		}
		return financeEvent(tx, a.Company.ID, "", "category", category.ID, a.User.ID, action, detail)
	})
	if err != nil {
		return err
	}
	return ok(w, id)
}

func fiscalYear(date string, startMonth int) int {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return 0
	}
	year := t.Year()
	if int(t.Month()) < startMonth {
		year--
	}
	return year
}
func validateBudget(tx *gorm.DB, a *access, b *Budget) error {
	b.Name = strings.TrimSpace(b.Name)
	b.Notes = strings.TrimSpace(b.Notes)
	if !financeClean(b.Name, 160) || !financeTextFits(b.Notes, 4000) {
		return invalid("Budget name is required (up to 160 characters); notes allow 4,000 characters.")
	}
	if b.DepartmentID == "" || !departmentExists(tx, a.Company.ID, b.DepartmentID) {
		return invalid("Choose a budget department in this company.")
	}
	if b.AmountMinor < 0 || b.AmountMinor > maxMoneyMinor {
		return invalid("Budget amount must be an integer from 0 to 1,000,000,000,000 minor units.")
	}
	if b.StartDate == "" || b.EndDate == "" || !validDate(b.StartDate) || !validDate(b.EndDate) || b.StartDate > b.EndDate {
		return invalid("Choose a valid inclusive budget start and end date in YYYY-MM-DD format.")
	}
	if fiscalYear(b.StartDate, a.Company.FiscalYearStartMonth) != fiscalYear(b.EndDate, a.Company.FiscalYearStartMonth) {
		return invalid("A department budget period must fit entirely within one company financial year.")
	}
	if !in(b.Status, "draft", "active", "closed") {
		return invalid("Choose draft, active or closed budget status.")
	}
	var count int64
	if err := tx.Model(&Budget{}).Where("company_id = ? AND department_id = ? AND id <> ? AND start_date <= ? AND end_date >= ?", a.Company.ID, b.DepartmentID, b.ID, b.EndDate, b.StartDate).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return invalid("This department already has an overlapping budget period. Draft and closed budgets also preserve their periods.")
	}
	return nil
}

var budgetColumns = []string{"department_id", "name", "start_date", "end_date", "amount_minor", "status", "notes", "updated_at", "version"}

func (s *Server) saveBudget(w http.ResponseWriter, r *http.Request) error {
	a, err := s.access(r)
	if err != nil {
		return err
	}
	allowed := []string{"departmentId", "name", "startDate", "endDate", "amountMinor", "status", "notes"}
	if r.Method == "PATCH" {
		allowed = append(allowed, "version", "reason")
	}
	f, err := readFields(w, r, allowed...)
	if err != nil {
		return err
	}
	var version int64
	var reason string
	if r.Method == "PATCH" {
		version, err = financialVersion(f)
		if err != nil {
			return err
		}
		if raw, ok := f["reason"]; ok {
			if err = json.Unmarshal(raw, &reason); err != nil {
				return invalid("Budget revision reason must be text.")
			}
			delete(f, "reason")
		}
		if len(f) == 0 {
			return invalid("Provide a budget field to update.")
		}
	}
	reason = strings.TrimSpace(reason)
	if reason != "" && !meaningfulReason(reason) {
		return invalid("Budget reasons require at least 12 and at most 4,000 Unicode characters.")
	}
	id := r.PathValue("id")
	if id == "" {
		id = newID("bud")
	}
	err = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !financeAuthority(a.Member.Role) {
			return denied()
		}
		b := Budget{ID: id, CompanyID: a.Company.ID, Currency: a.Company.Currency, Status: "draft", CreatedBy: a.User.ID, CreatedAt: nowString(), UpdatedAt: nowString(), Version: 1}
		if r.Method == "PATCH" {
			if e := tx.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&b).Error; e != nil {
				if e == gorm.ErrRecordNotFound {
					return missing()
				}
				return e
			}
			if b.Version != version {
				return financeConflict()
			}
		}
		old := b
		if e := applyFields(f, &b); e != nil {
			return e
		}
		if r.Method == "POST" && !in(b.Status, "draft", "active") {
			return invalid("New budgets start as draft or active.")
		}
		if r.Method == "PATCH" {
			if old.Status != "draft" && (old.DepartmentID != b.DepartmentID || old.StartDate != b.StartDate || old.EndDate != b.EndDate) {
				return invalid("An activated budget keeps its department and dates permanently. Create a separate non-overlapping period for a new envelope.")
			}
			if old.Status != b.Status && !((old.Status == "draft" && b.Status == "active") || (old.Status == "active" && b.Status == "closed") || (old.Status == "closed" && b.Status == "active")) {
				return invalid("Budgets move draft → active → closed. A closed budget may reopen to active with a reason.")
			}
			controlled := (old.Status != "draft" && old.AmountMinor != b.AmountMinor) || (old.Status != b.Status && (b.Status == "closed" || old.Status == "closed"))
			if controlled && !meaningfulReason(reason) {
				return invalid("Explain this controlled budget change with a reason of at least 12 characters.")
			}
		}
		if e := validateBudget(tx, a, &b); e != nil {
			return e
		}
		action, detail := "budget_created", fmt.Sprintf("Created %s: %s for %s to %s; status %s.", b.Name, moneyLabel(b.Currency, b.AmountMinor), b.StartDate, b.EndDate, b.Status)
		if r.Method == "PATCH" {
			b.Version++
			b.UpdatedAt = nowString()
			result := tx.Model(&Budget{}).Where("id = ? AND company_id = ? AND version = ?", id, a.Company.ID, version).Select(budgetColumns).Updates(&b)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return financeConflict()
			}
			action, detail = "budget_updated", financialChanges(f, old, b)
			if old.Status != b.Status {
				action = map[string]string{"active": "budget_activated", "closed": "budget_closed"}[b.Status]
				if old.Status == "closed" {
					action = "budget_reopened"
				}
			}
			if reason != "" {
				detail += ". Reason: " + reason
			}
		} else if e := tx.Create(&b).Error; e != nil {
			return e
		}
		return financeEvent(tx, a.Company.ID, b.DepartmentID, "budget", b.ID, a.User.ID, action, detail)
	})
	if err != nil {
		return err
	}
	return ok(w, id)
}
