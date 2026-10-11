package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"time"
)

type FinanceReconciliationAllocation struct {
	ID                      string     `json:"id" gorm:"primaryKey"`
	CompanyID               string     `json:"-"`
	RowID                   string     `json:"rowId"`
	ExpenseID               string     `json:"expenseId"`
	ExpectedRowVersion      int64      `json:"expectedRowVersion"`
	ExpectedExpenseVersion  int64      `json:"expectedExpenseVersion"`
	PaidEconomicFingerprint string     `json:"-"`
	RequestHash             string     `json:"-"`
	AmountMinor             int64      `json:"amountMinor"`
	ActorID                 string     `json:"actorId"`
	Reason                  string     `json:"reason"`
	Active                  bool       `json:"active"`
	Version                 int64      `json:"version"`
	CreatedAt               time.Time  `json:"createdAt"`
	ReversedAt              *time.Time `json:"reversedAt,omitempty"`
}
type FinanceReconciliationDecision struct {
	ID              string    `json:"id" gorm:"primaryKey"`
	CompanyID       string    `json:"-"`
	RowID           string    `json:"rowId"`
	AllocationID    string    `json:"allocationId,omitempty"`
	SuggestionBasis string    `json:"suggestionBasis"`
	ActorID         string    `json:"actorId"`
	Reason          string    `json:"reason"`
	Action          string    `json:"action"`
	RetryKey        string    `json:"-"`
	ReviewedVersion int64     `json:"reviewedVersion"`
	CreatedAt       time.Time `json:"createdAt"`
}
type FinanceReconciliationSuggestion struct {
	ExpenseID      string `json:"expenseId"`
	ExpenseVersion int64  `json:"expenseVersion"`
	Reason         string `json:"reason"`
}

func authorizeStatementRow(tx *gorm.DB, a *access, id string) (FinanceStatementRow, error) {
	var row FinanceStatementRow
	if !financeAuthority(a.Member.Role) || a.Users[a.User.ID].Suspended {
		return row, missing()
	}
	if e := tx.First(&row, "company_id=? AND id=?", a.Company.ID, id).Error; e != nil {
		return row, missing()
	}
	if _, e := authorizeFinanceStatementImport(tx, a, row.ImportID); e != nil {
		return row, e
	}
	return row, nil
}
func authorizeReconciliationAllocation(tx *gorm.DB, a *access, id string) (FinanceReconciliationAllocation, error) {
	var allocation FinanceReconciliationAllocation
	if !financeAuthority(a.Member.Role) {
		return allocation, missing()
	}
	if e := tx.First(&allocation, "company_id=? AND id=?", a.Company.ID, id).Error; e != nil {
		return allocation, missing()
	}
	if _, e := authorizeStatementRow(tx, a, allocation.RowID); e != nil {
		return allocation, e
	}
	if _, e := scopedExpense(tx, a, allocation.ExpenseID); e != nil {
		return allocation, e
	}
	return allocation, nil
}
func reconciliationPaidCandidates(tx *gorm.DB, a *access, row FinanceStatementRow) ([]Expense, error) {
	if row.SignedAmountMinor >= 0 {
		return []Expense{}, nil
	}
	date, e := time.Parse("2006-01-02", row.BookedDate)
	if e != nil {
		return nil, e
	}
	active := tx.Model(&FinanceReconciliationAllocation{}).Select("expense_id").Where("company_id=? AND active=true", a.Company.ID)
	var expenses []Expense
	if e := expenseReadQuery(tx, a).Where("status='paid' AND amount_minor=? AND currency=? AND paid_date>=? AND paid_date<=? AND id NOT IN (?)", -row.SignedAmountMinor, row.CompanyCurrency, date.AddDate(0, 0, -7).Format("2006-01-02"), date.AddDate(0, 0, 7).Format("2006-01-02"), active).Order("paid_date,id").Limit(100).Find(&expenses).Error; e != nil {
		return nil, e
	}
	return expenses, nil
}
func reconciliationSuggestionsForCandidates(row FinanceStatementRow, expenses []Expense) ([]FinanceReconciliationSuggestion, string, error) {
	suggestions := []FinanceReconciliationSuggestion{}
	if row.SignedAmountMinor >= 0 {
		basis, e := businessHash([]any{row.ID, row.Version, "credit"})
		return suggestions, basis, e
	}
	for _, expense := range expenses {
		reason := "exact_amount_date"
		if invoiceKey(row.Reference) != "" && invoiceKey(row.Reference) == invoiceKey(expense.PaymentReference) {
			reason = "exact_payment_reference"
		}
		suggestions = append(suggestions, FinanceReconciliationSuggestion{expense.ID, expense.Version, reason})
	}
	basis, e := businessHash([]any{row.ID, row.Version, suggestions})
	return suggestions, basis, e
}
func reconciliationSuggestions(tx *gorm.DB, a *access, row FinanceStatementRow) ([]FinanceReconciliationSuggestion, string, error) {
	expenses, e := reconciliationPaidCandidates(tx, a, row)
	if e != nil {
		return nil, "", e
	}
	return reconciliationSuggestionsForCandidates(row, expenses)
}
func (s *Server) financeReconciliationRoutes() {
	base := "/api/companies/{cid}/finance/reconciliation"
	s.route("GET "+base, s.getFinanceReconciliation)
	s.route("GET "+base+"/rows/{id}/history", s.getFinanceReconciliationHistory)
	s.route("POST "+base+"/matches", s.matchFinanceReconciliation)
	s.route("POST "+base+"/rows/{id}/dismiss", s.dismissFinanceReconciliation)
	s.route("POST "+base+"/matches/{id}/unmatch", s.unmatchFinanceReconciliation)
}
func (s *Server) matchFinanceReconciliation(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "rowId", "expectedRowVersion", "expenseId", "expectedExpenseVersion", "reason")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		RowID                  string
		ExpectedRowVersion     int64
		ExpenseID              string
		ExpectedExpenseVersion int64
		Reason                 string
	}
	if e = applyFields(f, &input); e != nil {
		return e
	}
	if !meaningfulReason(input.Reason) {
		return invalid("Explain the full recorded payment match in 12–4,000 Unicode characters.")
	}
	hash, e := businessHash(f)
	if e != nil {
		return e
	}
	var canonical BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var row FinanceStatementRow
		var expense Expense
		auth := func() error {
			var e error
			row, e = authorizeStatementRow(tx, a, input.RowID)
			if e != nil {
				return e
			}
			expense, e = scopedExpense(tx, a, input.ExpenseID)
			return e
		}
		replay := func(out BusinessResult) error { _, e := authorizeReconciliationAllocation(tx, a, out.IDs[0]); return e }
		var e error
		canonical, e = financeBusinessMutation(tx, a, "reconciliation_match", key, f, auth, replay, func() (BusinessResult, error) {
			var existing FinanceReconciliationAllocation
			err := tx.First(&existing, "company_id=? AND row_id=? AND expense_id=? AND request_hash=?", a.Company.ID, row.ID, expense.ID, hash).Error
			if err == nil {
				return BusinessResult{Kind: "reconciliation_allocation", IDs: []string{existing.ID}, Versions: []int64{existing.Version}}, nil
			}
			if err != gorm.ErrRecordNotFound {
				return BusinessResult{}, err
			}
			if row.Version != input.ExpectedRowVersion || expense.Version != input.ExpectedExpenseVersion {
				return BusinessResult{}, financeConflict()
			}
			if expense.Status != "paid" || row.SignedAmountMinor >= 0 || -row.SignedAmountMinor != expense.AmountMinor || row.CompanyCurrency != expense.Currency {
				return BusinessResult{}, invalid("Only one exact negative bank row can match one full already-recorded paid expense in the same currency.")
			}
			var n int64
			if e := tx.Model(&FinanceReconciliationAllocation{}).Where("company_id=? AND active=true AND (row_id=? OR expense_id=?)", a.Company.ID, row.ID, expense.ID).Count(&n).Error; e != nil {
				return BusinessResult{}, e
			}
			if n > 0 {
				return BusinessResult{}, financeConflict()
			}
			fingerprint, _ := businessHash([]any{expense.AmountMinor, expense.Currency, expense.Status, expense.PaidDate, expense.PaymentMethod, expense.PaymentReference, expense.Version})
			allocation := FinanceReconciliationAllocation{ID: newID("fra"), CompanyID: a.Company.ID, RowID: row.ID, ExpenseID: expense.ID, ExpectedRowVersion: row.Version, ExpectedExpenseVersion: expense.Version, PaidEconomicFingerprint: fingerprint, RequestHash: hash, AmountMinor: expense.AmountMinor, ActorID: a.User.ID, Reason: input.Reason, Active: true, Version: 1, CreatedAt: time.Now().UTC()}
			if e := tx.Create(&allocation).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Create(&FinanceReconciliationDecision{ID: newID("frd"), CompanyID: a.Company.ID, RowID: row.ID, AllocationID: allocation.ID, ActorID: a.User.ID, Reason: input.Reason, Action: "match", RetryKey: key, ReviewedVersion: expense.Version, CreatedAt: time.Now().UTC()}).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := syncFinanceReconciliationAttention(tx, a, row); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "reconciliation_allocation", IDs: []string{allocation.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": canonical.IDs[0], "version": canonical.Versions[0]})
}
func (s *Server) unmatchFinanceReconciliation(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedVersion", "reason")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		ExpectedVersion int64
		Reason          string
	}
	if e = applyFields(f, &input); e != nil {
		return e
	}
	if !meaningfulReason(input.Reason) {
		return invalid("Explain the reversal in 12–4,000 Unicode characters.")
	}
	var canonical BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var allocation FinanceReconciliationAllocation
		auth := func() error {
			var e error
			allocation, e = authorizeReconciliationAllocation(tx, a, r.PathValue("id"))
			return e
		}
		var e error
		canonical, e = financeBusinessMutation(tx, a, "reconciliation_unmatch", key, map[string]any{"id": r.PathValue("id"), "fields": f}, auth, func(out BusinessResult) error { return nil }, func() (BusinessResult, error) {
			if !allocation.Active || allocation.Version != input.ExpectedVersion {
				return BusinessResult{}, financeConflict()
			}
			now := time.Now().UTC()
			allocation.Active = false
			allocation.Version++
			allocation.ReversedAt = &now
			if e := tx.Save(&allocation).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Create(&FinanceReconciliationDecision{ID: newID("frd"), CompanyID: a.Company.ID, RowID: allocation.RowID, AllocationID: allocation.ID, ActorID: a.User.ID, Reason: input.Reason, Action: "unmatch", RetryKey: key, ReviewedVersion: input.ExpectedVersion, CreatedAt: now}).Error; e != nil {
				return BusinessResult{}, e
			}
			row, e := authorizeStatementRow(tx, a, allocation.RowID)
			if e != nil {
				return BusinessResult{}, e
			}
			if e := syncFinanceReconciliationAttention(tx, a, row); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "reconciliation_allocation", IDs: []string{allocation.ID}, Versions: []int64{allocation.Version}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": canonical.IDs[0], "version": canonical.Versions[0]})
}
func (s *Server) dismissFinanceReconciliation(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedRowVersion", "suggestionBasis", "reason")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		ExpectedRowVersion      int64
		SuggestionBasis, Reason string
	}
	if e = applyFields(f, &input); e != nil {
		return e
	}
	if !meaningfulReason(input.Reason) {
		return invalid("Explain this discrepancy in 12–4,000 Unicode characters.")
	}
	var canonical BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var row FinanceStatementRow
		auth := func() error { var e error; row, e = authorizeStatementRow(tx, a, r.PathValue("id")); return e }
		var e error
		canonical, e = financeBusinessMutation(tx, a, "reconciliation_dismiss", key, map[string]any{"id": r.PathValue("id"), "fields": f}, auth, func(out BusinessResult) error { return nil }, func() (BusinessResult, error) {
			if row.Version != input.ExpectedRowVersion {
				return BusinessResult{}, financeConflict()
			}
			_, basis, e := reconciliationSuggestions(tx, a, row)
			if e != nil {
				return BusinessResult{}, e
			}
			if basis != input.SuggestionBasis {
				return BusinessResult{}, financeConflict()
			}
			decision := FinanceReconciliationDecision{ID: newID("frd"), CompanyID: a.Company.ID, RowID: row.ID, SuggestionBasis: basis, ActorID: a.User.ID, Reason: input.Reason, Action: "dismiss", RetryKey: key, ReviewedVersion: row.Version, CreatedAt: time.Now().UTC()}
			if e := tx.Create(&decision).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := syncFinanceReconciliationAttention(tx, a, row); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "reconciliation_decision", IDs: []string{decision.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": canonical.IDs[0]})
}
func (s *Server) getFinanceReconciliation(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	importID := r.URL.Query().Get("importId")
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "unmatched"
	}
	if !in(state, "unmatched", "matched", "all", "dismissed") {
		return invalid("Choose a reconciliation state.")
	}
	items := []map[string]any{}
	expenses := []Expense{}
	allocations := []FinanceReconciliationAllocation{}
	cursor := ""
	more := false
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !financeAuthority(a.Member.Role) || a.Users[a.User.ID].Suspended {
			return denied()
		}
		if importID != "" {
			if _, e := authorizeFinanceStatementImport(tx, a, importID); e != nil {
				return e
			}
		}
		basis := payloadHash([]string{accessBasis(a), "reconciliation", importID, state})
		q := tx.Model(&FinanceStatementRow{}).Where("company_id=?", a.Company.ID)
		if importID != "" {
			q = q.Where("import_id=?", importID)
		}
		active := tx.Model(&FinanceReconciliationAllocation{}).Select("row_id").Where("company_id=? AND active=true", a.Company.ID)
		if state == "unmatched" {
			q = q.Where("id NOT IN (?)", active)
		} else if state == "matched" {
			q = q.Where("id IN (?)", active)
		} else if state == "dismissed" {
			decisions := tx.Model(&FinanceReconciliationDecision{}).Select("row_id").Where("company_id=? AND action='dismiss'", a.Company.ID)
			q = q.Where("id IN (?)", decisions)
		}
		rowAfter, expenseAfter := "", ""
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			c, err := decodeReadCursor(raw, basis)
			if err != nil {
				return err
			}
			rowAfter, expenseAfter = c.Created, c.ID
		}
		if rowAfter == "end" {
			q = q.Where("1=0")
		} else if rowAfter != "" {
			q = q.Where("id<?", rowAfter)
		}
		var rows []FinanceStatementRow
		if e := q.Order("id DESC").Limit(limit + 1).Find(&rows).Error; e != nil {
			return e
		}
		more = len(rows) > limit
		if more {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			rowAfter = last.ID
		}
		if !more {
			rowAfter = "end"
		}
		for _, row := range rows {
			suggestions, basis, e := reconciliationSuggestions(tx, a, row)
			if e != nil {
				return e
			}
			var history []FinanceReconciliationDecision
			if e := tx.Where("company_id=? AND row_id=?", a.Company.ID, row.ID).Order("created_at DESC,id DESC").Limit(21).Find(&history).Error; e != nil {
				return e
			}
			items = append(items, map[string]any{"row": row, "suggestions": suggestions, "suggestionBasis": basis, "history": history[:min(20, len(history))], "hasMoreHistory": len(history) > 20})
			var attached []FinanceReconciliationAllocation
			if e := tx.Where("company_id=? AND row_id=?", a.Company.ID, row.ID).Order("active DESC,created_at DESC,id DESC").Limit(20).Find(&attached).Error; e != nil {
				return e
			}
			allocations = append(allocations, attached...)
		}
		activeExpenses := tx.Model(&FinanceReconciliationAllocation{}).Select("expense_id").Where("company_id=? AND active=true", a.Company.ID)
		paidQuery := expenseReadQuery(tx, a).Where("status='paid' AND id NOT IN (?)", activeExpenses)
		if expenseAfter == "end" {
			paidQuery = paidQuery.Where("1=0")
		} else if expenseAfter != "" {
			paidQuery = paidQuery.Where("id<?", expenseAfter)
		}
		if err := paidQuery.Order("id DESC").Limit(limit + 1).Find(&expenses).Error; err != nil {
			return err
		}
		paidMore := len(expenses) > limit
		if paidMore {
			expenses = expenses[:limit]
			expenseAfter = expenses[len(expenses)-1].ID
		} else {
			expenseAfter = "end"
		}
		more = more || paidMore
		if more {
			cursor = encodeReadCursor(readCursor{basis, rowAfter, expenseAfter})
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"items": items, "unallocatedExpenses": expenses, "allocations": allocations, "cursor": cursor, "hasMore": more, "method": "Exact full recorded paid amounts only. Credits and partial amounts remain unmatched; multiple suggestions require a deliberate choice."})
}

var _ = json.RawMessage{}
