package platform

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
)

func authorizeExpenseCreation(tx *gorm.DB, a *access, f map[string]json.RawMessage) error {
	if a.financeScope() == "none" {
		return denied()
	}
	var e Expense
	if err := applyFields(f, &e); err != nil {
		return err
	}
	if !departmentExists(tx, a.Company.ID, e.DepartmentID) {
		return invalid("Choose an expense department in this company.")
	}
	if !a.canCreateExpense(e.DepartmentID) {
		return denied()
	}
	if e.TaskID != "" {
		t, err := scopedTask(tx, a, e.TaskID)
		if err != nil {
			return invalid("Linked task must be accessible in your work scope.")
		}
		if t.DepartmentID != e.DepartmentID {
			return denied()
		}
	}
	if e.ProjectID != "" {
		var p Project
		if err := tx.First(&p, "company_id=? AND id=?", a.Company.ID, e.ProjectID).Error; err != nil {
			return invalid("Linked project must be accessible in this company.")
		}
		yes, err := canReadProject(tx, a, p)
		if err != nil {
			return err
		}
		if !yes || p.DepartmentID != e.DepartmentID {
			return invalid("Linked project must be accessible in your work scope.")
		}
	}
	return nil
}
func authorizeExpenseResults(tx *gorm.DB, a *access, result BusinessResult) error {
	for _, id := range result.IDs {
		e, err := scopedExpense(tx, a, id)
		if err != nil {
			return err
		}
		if e.CreatedBy != a.User.ID || !a.canCreateExpense(e.DepartmentID) {
			return missing()
		}
		f := map[string]json.RawMessage{}
		for k, v := range map[string]string{"departmentId": e.DepartmentID, "taskId": e.TaskID, "projectId": e.ProjectID} {
			f[k], _ = json.Marshal(v)
		}
		if err = authorizeExpenseCreation(tx, a, f); err != nil {
			return err
		}
	}
	return nil
}
func prepareExpenseCreate(tx *gorm.DB, a *access, f map[string]json.RawMessage) (Expense, error) {
	e := Expense{CompanyID: a.Company.ID, CreatedBy: a.User.ID, Status: "draft", Version: 1, Receipts: []ExpenseReceipt{}}
	if err := authorizeExpenseCreation(tx, a, f); err != nil {
		return e, err
	}
	if err := applyFields(f, &e); err != nil {
		return e, err
	}
	if err := validateExpense(tx, a, &e); err != nil {
		return e, err
	}
	e.Currency = a.Company.Currency
	return e, nil
}
func insertExpenseDraft(tx *gorm.DB, a *access, e *Expense) error {
	e.ID = newID("exp")
	e.CreatedAt = nowString()
	e.UpdatedAt = e.CreatedAt
	var err error
	e.Code, err = nextExpenseCode(tx, a.Company.ID)
	if err != nil {
		return err
	}
	if err = tx.Omit("Receipts").Create(e).Error; err != nil {
		return err
	}
	return financeEvent(tx, e.CompanyID, e.DepartmentID, "expense", e.ID, a.User.ID, "expense_created", fmt.Sprintf("%s · %s · %s. Vendor: %s. Invoice: %s. Expense date: %s.", e.Code, e.Title, moneyLabel(e.Currency, e.AmountMinor), e.Vendor, e.InvoiceNumber, e.ExpenseDate))
}
func prepareExpenseDraftPatch(tx *gorm.DB, a *access, old Expense, version int64, f map[string]json.RawMessage, allowRejected bool) (Expense, error) {
	e := old
	if a.financeScope() == "none" || old.CreatedBy != a.User.ID {
		return e, denied()
	}
	if old.Version != version {
		return e, financeConflict()
	}
	if old.Status != "draft" && !(allowRejected && old.Status == "rejected") {
		return e, invalid("Only the creator can correct an eligible draft.")
	}
	if err := applyFields(f, &e); err != nil {
		return e, err
	}
	if err := validateExpense(tx, a, &e); err != nil {
		return e, err
	}
	if !a.canCreateExpense(e.DepartmentID) {
		return e, denied()
	}
	return e, nil
}
func commitExpenseDraftPatch(tx *gorm.DB, a *access, old, next Expense, f map[string]json.RawMessage) error {
	if err := saveExpenseVersion(tx, &next, old.Version); err != nil {
		return err
	}
	if err := financeEvent(tx, next.CompanyID, next.DepartmentID, "expense", next.ID, a.User.ID, "expense_updated", financialChanges(f, old, next)); err != nil {
		return err
	}
	return syncExpenseAttention(tx, a, old, next)
}
