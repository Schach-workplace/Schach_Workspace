package platform

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
)

var expenseFields = []string{"departmentId", "categoryId", "title", "description", "vendor", "invoiceNumber", "expenseDate", "amountMinor", "projectId", "taskId", "receiptExceptionReason"}
var expenseColumns = []string{"department_id", "category_id", "title", "description", "vendor", "invoice_number", "vendor_key", "invoice_key", "expense_date", "amount_minor", "project_id", "task_id", "status", "receipt_exception_reason", "submitted_at", "reviewed_by", "reviewed_at", "review_note", "budget_override_reason", "paid_by", "paid_at", "paid_date", "payment_method", "payment_reference", "updated_at", "version"}

func canReadProject(tx *gorm.DB, a *access, p Project) (bool, error) {
	if leadership(a.Member.Role) || a.Member.Role == "viewer" || a.ownsScope(p.OwnerID) || (a.Member.Role == "head" && p.DepartmentID != "" && p.DepartmentID == a.Member.DepartmentID) {
		return true, nil
	}
	var tasks []Task
	if err := tx.Where("company_id = ? AND project_id = ?", a.Company.ID, p.ID).Find(&tasks).Error; err != nil {
		return false, err
	}
	for _, t := range tasks {
		if a.canRead(t) {
			return true, nil
		}
	}
	return false, nil
}
func expenseCategory(tx *gorm.DB, cid, id string) (ExpenseCategory, error) {
	var c ExpenseCategory
	err := tx.Where("company_id = ? AND id = ?", cid, id).First(&c).Error
	if err == gorm.ErrRecordNotFound {
		return c, invalid("Choose an expense category in this company.")
	}
	return c, err
}
func validateExpenseDate(c Company, date string) error {
	if date == "" || !validDate(date) {
		return invalid("Choose an expense date in YYYY-MM-DD format.")
	}
	loc, err := time.LoadLocation(c.Timezone)
	if err != nil {
		return err
	}
	if date > time.Now().In(loc).Format("2006-01-02") {
		return invalid("Expense date cannot be later than today in the company timezone. Record incurred expenses, not future commitments.")
	}
	return nil
}
func validateExpense(tx *gorm.DB, a *access, e *Expense) error {
	return validateExpenseReview(tx, a, e, true)
}

// The read-only pair preview validates the same reviewed fields and authority.
// Only ordinary/create/accept mutation validation enforces the company-wide
// invoice collision rule; peer disclosure remains scoped by its read query.
func validateExpenseReview(tx *gorm.DB, a *access, e *Expense, enforceInvoice bool) error {
	e.Title = strings.TrimSpace(e.Title)
	e.Description = strings.TrimSpace(e.Description)
	e.Vendor = normalizeWords(e.Vendor)
	e.InvoiceNumber = normalizeWords(e.InvoiceNumber)
	e.ReceiptExceptionReason = strings.TrimSpace(e.ReceiptExceptionReason)
	if !financeClean(e.Title, 240) || !financeTextFits(e.Description, 8000) {
		return invalid("Expense title is required (up to 240 characters); description allows 8,000 characters.")
	}
	if !financeClean(e.Vendor, 240) || !financeTextFits(e.InvoiceNumber, 160) {
		return invalid("Vendor is required (up to 240 characters); invoice number allows 160 characters or may be blank.")
	}
	if e.AmountMinor < 1 || e.AmountMinor > maxMoneyMinor {
		return invalid("Expense amount must be an integer from 1 to 1,000,000,000,000 minor units.")
	}
	if err := validateExpenseDate(a.Company, e.ExpenseDate); err != nil {
		return err
	}
	if e.DepartmentID == "" || !departmentExists(tx, a.Company.ID, e.DepartmentID) {
		return invalid("Choose an expense department in this company.")
	}
	c, err := expenseCategory(tx, a.Company.ID, e.CategoryID)
	if err != nil {
		return err
	}
	if !c.Active {
		return invalid("This expense category is archived. Choose an active category before editing or submitting.")
	}
	if e.ReceiptExceptionReason != "" && !meaningfulReason(e.ReceiptExceptionReason) {
		return invalid("A receipt exception needs a specific explanation of 12 to 4,000 Unicode characters.")
	}
	if e.TaskID != "" {
		var t Task
		if err := tx.Where("company_id = ? AND id = ?", a.Company.ID, e.TaskID).First(&t).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return invalid("Linked task must be accessible in this company.")
			}
			return err
		}
		if !a.canRead(t) {
			return invalid("Linked task must be accessible in your work scope.")
		}
		if t.DepartmentID != e.DepartmentID {
			return invalid("Linked task must belong to the expense department.")
		}
		if e.ProjectID != "" && t.ProjectID != e.ProjectID {
			return invalid("Linked task and project must agree.")
		}
	}
	if e.ProjectID != "" {
		var p Project
		if err := tx.Where("company_id = ? AND id = ?", a.Company.ID, e.ProjectID).First(&p).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return invalid("Linked project must be accessible in this company.")
			}
			return err
		}
		visible, err := canReadProject(tx, a, p)
		if err != nil {
			return err
		}
		if !visible {
			return invalid("Linked project must be accessible in your work scope.")
		}
		if p.DepartmentID != e.DepartmentID {
			return invalid("Linked project must belong to the expense department.")
		}
	}
	e.VendorKey, e.InvoiceKey = invoiceKey(e.Vendor), invoiceKey(e.InvoiceNumber)
	if enforceInvoice && e.InvoiceKey != "" {
		var n int64
		if err := tx.Model(&Expense{}).Where("company_id = ? AND id <> ? AND vendor_key = ? AND invoice_key = ? AND status <> ?", a.Company.ID, e.ID, e.VendorKey, e.InvoiceKey, "void").Count(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			return invalid("This vendor and invoice number already belong to a non-void expense in this company.")
		}
	}
	return nil
}
func nextExpenseCode(tx *gorm.DB, cid string) (string, error) {
	if err := tx.Model(&Company{}).Where("id = ?", cid).UpdateColumn("next_expense_number", gorm.Expr("next_expense_number + 1")).Error; err != nil {
		return "", err
	}
	var c Company
	if err := tx.Select("next_expense_number").First(&c, "id = ?", cid).Error; err != nil {
		return "", err
	}
	return fmt.Sprintf("EXP-%04d", c.NextExpenseNumber), nil
}
func (s *Server) createExpense(w http.ResponseWriter, r *http.Request) error {
	a, err := s.access(r)
	if err != nil {
		return err
	}
	f, err := readFields(w, r, append(append([]string{}, expenseFields...), "retryKey")...)
	if err != nil {
		return err
	}
	key, err := optionalBusinessKey(f)
	if err != nil {
		return err
	}
	delete(f, "retryKey")
	var result BusinessResult
	err = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		apply := func() (BusinessResult, error) {
			e, err := prepareExpenseCreate(tx, a, f)
			if err != nil {
				return BusinessResult{}, err
			}
			if err = insertExpenseDraft(tx, a, &e); err != nil {
				return BusinessResult{}, err
			}
			return BusinessResult{Kind: "expense", IDs: []string{e.ID}, Versions: []int64{e.Version}}, nil
		}
		if key == "" {
			result, err = apply()
			return err
		}
		result, err = businessMutation(tx, a, "expense_create", key, f, func() error { return authorizeExpenseCreation(tx, a, f) }, func(result BusinessResult) error { return authorizeExpenseResults(tx, a, result) }, apply)
		return err
	})
	if err != nil {
		return err
	}
	return ok(w, result.IDs[0])
}
func saveExpenseVersion(tx *gorm.DB, e *Expense, version int64) error {
	e.Version = version + 1
	e.UpdatedAt = nowString()
	res := tx.Model(&Expense{}).Where("id = ? AND company_id = ? AND version = ?", e.ID, e.CompanyID, version).Select(expenseColumns).Updates(e)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return financeConflict()
	}
	return nil
}
func (s *Server) patchExpense(w http.ResponseWriter, r *http.Request) error {
	a, err := s.access(r)
	if err != nil {
		return err
	}
	f, err := readFields(w, r, append(append([]string{}, expenseFields...), "version")...)
	if err != nil {
		return err
	}
	version, err := financialVersion(f)
	if err != nil {
		return err
	}
	if len(f) == 0 {
		return invalid("Provide an expense field to update.")
	}
	err = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		old, err := scopedExpense(tx, a, r.PathValue("id"))
		if err != nil {
			return err
		}
		next, err := prepareExpenseDraftPatch(tx, a, old, version, f, true)
		if err != nil {
			return err
		}
		return commitExpenseDraftPatch(tx, a, old, next, f)
	})
	if err != nil {
		return err
	}
	return ok(w, r.PathValue("id"))
}

func checkExpenseReceipt(tx *gorm.DB, e Expense) error {
	c, err := expenseCategory(tx, e.CompanyID, e.CategoryID)
	if err != nil {
		return err
	}
	if !c.ReceiptRequired {
		return nil
	}
	var count int64
	if err = tx.Model(&ExpenseReceipt{}).Where("company_id = ? AND expense_id = ?", e.CompanyID, e.ID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 && !meaningfulReason(e.ReceiptExceptionReason) {
		return invalid("This category requires a receipt. Attach evidence or record a receipt exception of at least 12 characters before submission or approval.")
	}
	return nil
}

// Budget capacity is checked while the company row is locked. Submitted requests
// remain separate from commitments; a payment keeps its original commitment in
// this sum and cannot consume a second allocation.
func expenseBudgetOverrideNeeded(tx *gorm.DB, e Expense) (string, error) {
	var b Budget
	err := tx.Where("company_id = ? AND department_id = ? AND start_date <= ? AND end_date >= ?", e.CompanyID, e.DepartmentID, e.ExpenseDate, e.ExpenseDate).First(&b).Error
	if err == gorm.ErrRecordNotFound {
		return "No budget covers the expense date.", nil
	}
	if err != nil {
		return "", err
	}
	if b.Status != "active" {
		return "The covering department budget is " + b.Status + ".", nil
	}
	var used int64
	if err = tx.Model(&Expense{}).Where("company_id = ? AND department_id = ? AND expense_date >= ? AND expense_date <= ? AND status IN ?", e.CompanyID, e.DepartmentID, b.StartDate, b.EndDate, []string{"approved", "paid"}).Select("COALESCE(SUM(amount_minor), 0)").Scan(&used).Error; err != nil {
		return "", err
	}
	if used > b.AmountMinor || e.AmountMinor > b.AmountMinor-used {
		return "This approval exceeds the remaining department budget.", nil
	}
	return "", nil
}
func expenseNotification(tx *gorm.DB, e Expense, uid, title, body string) error {
	if uid == "" {
		return nil
	}
	return tx.Create(&Notification{ID: newID("not"), CompanyID: e.CompanyID, ExpenseID: e.ID, UserID: uid, Title: title, Body: body, Kind: "finance", CreatedAt: nowString()}).Error
}
func notifyExpenseApprovers(tx *gorm.DB, a *access, e Expense) error {
	for uid, m := range a.Members {
		if !m.Active || uid == e.CreatedBy {
			continue
		}
		if financeAuthority(m.Role) || (m.Role == "head" && m.DepartmentID != "" && m.DepartmentID == e.DepartmentID) {
			if err := expenseNotification(tx, e, uid, "Expense awaiting approval", e.Code+" · "+e.Title+" · "+moneyLabel(e.Currency, e.AmountMinor)); err != nil {
				return err
			}
		}
	}
	return nil
}

type expenseTransitionInput struct {
	Action           string `json:"action"`
	Note             string `json:"note"`
	OverrideReason   string `json:"overrideReason"`
	PaidDate         string `json:"paidDate"`
	PaymentMethod    string `json:"paymentMethod"`
	PaymentReference string `json:"paymentReference"`
}

func (s *Server) transitionExpense(w http.ResponseWriter, r *http.Request) error {
	a, err := s.access(r)
	if err != nil {
		return err
	}
	f, err := readFields(w, r, "version", "action", "note", "overrideReason", "paidDate", "paymentMethod", "paymentReference")
	if err != nil {
		return err
	}
	version, err := financialVersion(f)
	if err != nil {
		return err
	}
	var v expenseTransitionInput
	if err = applyFields(f, &v); err != nil {
		return err
	}
	v.Note = strings.TrimSpace(v.Note)
	v.OverrideReason = strings.TrimSpace(v.OverrideReason)
	v.PaymentReference = strings.TrimSpace(v.PaymentReference)
	if !in(v.Action, "submit", "withdraw", "approve", "reject", "pay", "void") {
		return invalid("Choose submit, withdraw, approve, reject, pay or void.")
	}
	if !financeTextFits(v.Note, 4000) || !financeTextFits(v.OverrideReason, 4000) {
		return invalid("Decision notes and override reasons allow up to 4,000 Unicode characters.")
	}
	if v.OverrideReason != "" && (!meaningfulReason(v.OverrideReason) || v.Action != "approve") {
		return invalid("An approval override needs a reason of at least 12 characters and only applies to approve.")
	}
	if v.Action != "pay" && (v.PaidDate != "" || v.PaymentMethod != "" || v.PaymentReference != "") {
		return invalid("Payment details only apply when recording a payment.")
	}
	err = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		e, err := scopedExpense(tx, a, r.PathValue("id"))
		if err != nil {
			return err
		}
		if e.Version != version {
			return financeConflict()
		}
		if a.financeScope() == "none" {
			return denied()
		}
		if in(e.Status, "paid", "void") {
			return invalid("Paid and void expenses are final. Financial history cannot be reversed or deleted.")
		}
		oldStatus := e.Status
		switch v.Action {
		case "submit":
			if e.CreatedBy != a.User.ID || !a.canCreateExpense(e.DepartmentID) {
				return denied()
			}
			if !in(e.Status, "draft", "rejected") {
				return invalid("Submit a draft or rejected expense.")
			}
			if err = validateExpense(tx, a, &e); err != nil {
				return err
			}
			if err = checkExpenseReceipt(tx, e); err != nil {
				return err
			}
			e.Status = "submitted"
			e.SubmittedAt = nowString()
			e.ReviewedBy = ""
			e.ReviewedAt = ""
			e.ReviewNote = ""
			e.BudgetOverrideReason = ""
		case "withdraw":
			if e.CreatedBy != a.User.ID {
				return denied()
			}
			if e.Status != "submitted" {
				return invalid("Only submitted expenses can be withdrawn to draft.")
			}
			e.Status = "draft"
			e.SubmittedAt = ""
		case "approve":
			if !a.canApproveExpense(e) {
				return denied()
			}
			if e.Status != "submitted" {
				return invalid("Only submitted expenses can be approved.")
			}
			if v.OverrideReason != "" && !financeAuthority(a.Member.Role) {
				return denied()
			}
			if err = validateExpenseDate(a.Company, e.ExpenseDate); err != nil {
				return err
			}
			if err = checkExpenseReceipt(tx, e); err != nil {
				return err
			}
			if e.ReceiptExceptionReason != "" && !meaningfulReason(v.Note) {
				return invalid("Independently explain acceptance of this receipt exception in an approval note of at least 12 characters.")
			}
			reason, err := expenseBudgetOverrideNeeded(tx, e)
			if err != nil {
				return err
			}
			if reason != "" {
				if !financeAuthority(a.Member.Role) {
					return invalid(reason + " Ask a company finance authority to approve with an explicit override.")
				}
				if !meaningfulReason(v.OverrideReason) {
					return invalid(reason + " Record an explicit override reason of at least 12 characters.")
				}
			}
			e.Status = "approved"
			e.ReviewedBy = a.User.ID
			e.ReviewedAt = nowString()
			e.ReviewNote = v.Note
			e.BudgetOverrideReason = v.OverrideReason
		case "reject":
			if !a.canApproveExpense(e) {
				return denied()
			}
			if e.Status != "submitted" {
				return invalid("Only submitted expenses can be rejected.")
			}
			if !meaningfulReason(v.Note) {
				return invalid("Explain the required correction in a rejection note of at least 12 characters.")
			}
			e.Status = "rejected"
			e.ReviewedBy = a.User.ID
			e.ReviewedAt = nowString()
			e.ReviewNote = v.Note
			e.BudgetOverrideReason = ""
		case "pay":
			if !financeAuthority(a.Member.Role) || e.CreatedBy == a.User.ID {
				return denied()
			}
			if e.Status != "approved" {
				return invalid("Approve an expense before recording its payment.")
			}
			loc, err := time.LoadLocation(a.Company.Timezone)
			if err != nil {
				return err
			}
			if v.PaidDate == "" || !validDate(v.PaidDate) || v.PaidDate < e.ExpenseDate || v.PaidDate > time.Now().In(loc).Format("2006-01-02") {
				return invalid("Payment date must be on or after the expense date and no later than today in the company timezone.")
			}
			if !in(v.PaymentMethod, "bank_transfer", "upi", "card", "cash", "other") || !financeClean(v.PaymentReference, 240) {
				return invalid("Choose a payment method and provide an external payment reference of up to 240 characters.")
			}
			e.Status = "paid"
			e.PaidBy = a.User.ID
			e.PaidAt = nowString()
			e.PaidDate = v.PaidDate
			e.PaymentMethod = v.PaymentMethod
			e.PaymentReference = v.PaymentReference
		case "void":
			if e.Status == "approved" {
				if !a.canApproveExpense(e) {
					return denied()
				}
			} else if e.CreatedBy != a.User.ID {
				return denied()
			}
			if !in(e.Status, "draft", "rejected", "submitted", "approved") {
				return invalid("This expense cannot be voided.")
			}
			if !meaningfulReason(v.Note) {
				return invalid("Explain why this expense is void in a note of at least 12 characters.")
			}
			e.Status = "void"
		}
		if err = saveExpenseVersion(tx, &e, version); err != nil {
			return err
		}
		action := map[string]string{"submit": "expense_submitted", "withdraw": "expense_withdrawn", "approve": "expense_approved", "reject": "expense_rejected", "pay": "expense_paid", "void": "expense_voided"}[v.Action]
		detail := fmt.Sprintf("%s: %s → %s; %s.", e.Code, oldStatus, e.Status, moneyLabel(e.Currency, e.AmountMinor))
		if v.Note != "" {
			detail += " Note: " + v.Note
		}
		if v.OverrideReason != "" {
			detail += " Budget override: " + v.OverrideReason
		}
		if v.Action == "pay" {
			detail += fmt.Sprintf(" External payment recorded: %s, %s, reference %s. Expense-date budget attribution is unchanged.", e.PaidDate, e.PaymentMethod, e.PaymentReference)
		}
		if err = financeEvent(tx, e.CompanyID, e.DepartmentID, "expense", e.ID, a.User.ID, action, detail); err != nil {
			return err
		}
		if err := syncExpenseAttention(tx, a, Expense{Status: oldStatus}, e); err != nil {
			return err
		}
		if v.Action == "submit" {
			return notifyExpenseApprovers(tx, a, e)
		}
		if a.User.ID != e.CreatedBy {
			return expenseNotification(tx, e, e.CreatedBy, "Expense "+e.Status, e.Code+" · "+e.Title+" · "+v.Note)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return ok(w, r.PathValue("id"))
}
