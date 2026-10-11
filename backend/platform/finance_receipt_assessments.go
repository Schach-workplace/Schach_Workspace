package platform

import (
	"gorm.io/gorm"
	"net/http"
	"time"
)

func scopedFinanceReceipt(tx *gorm.DB, a *access, id string) (ExpenseReceipt, Expense, error) {
	var receipt ExpenseReceipt
	if e := tx.First(&receipt, "id=? AND company_id=?", id, a.Company.ID).Error; e != nil {
		return receipt, Expense{}, missing()
	}
	parent, e := scopedExpense(tx, a, receipt.ExpenseID)
	if e != nil {
		return ExpenseReceipt{}, Expense{}, e
	}
	return receipt, parent, nil
}
func (s *Server) assessFinanceReceipt(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedExpenseVersion")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct{ ExpectedExpenseVersion int64 }
	if e = applyFields(f, &input); e != nil {
		return e
	}
	ref, e := financeSessionRef(r)
	if e != nil {
		return e
	}
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var receipt ExpenseReceipt
		var parent Expense
		auth := func() error {
			var e error
			receipt, parent, e = scopedFinanceReceipt(tx, a, r.PathValue("id"))
			return e
		}
		var e error
		result, e = financeBusinessMutation(tx, a, "receipt_assess", key, map[string]any{"receiptId": r.PathValue("id"), "fields": f}, auth, func(out BusinessResult) error {
			var job FinanceAssistanceJob
			if e := tx.First(&job, "id=? AND requester_id=?", out.IDs[0], a.User.ID).Error; e != nil {
				return missing()
			}
			return financeOriginalSession(tx, a.Company.ID, a.User.ID, job.SessionRef)
		}, func() (BusinessResult, error) {
			if parent.Version != input.ExpectedExpenseVersion {
				return BusinessResult{}, financeConflict()
			}
			now := time.Now().UTC()
			job := FinanceAssistanceJob{ID: newID("fjob"), CompanyID: a.Company.ID, RequesterID: a.User.ID, SessionRef: ref, Operation: "scan_receipt", SourceKind: "expense_receipt", SourceID: receipt.ID, SourceParentID: parent.ID, SourceVersion: parent.Version, InternalHash: financeDigest(receipt.Data), ContentGeneration: 1, Status: "queued", Version: 1, CreatedAt: now, UpdatedAt: now, AvailableAt: now, ExpiresAt: now.Add(s.opts.FinanceIntakeTTL)}
			if e := tx.Create(&job).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "finance_job", IDs: []string{job.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": result.IDs[0], "version": result.Versions[0]})
}
