package platform

import (
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/url"
	"time"
)

func financeDuplicateReadQuery(tx *gorm.DB, a *access) *gorm.DB {
	parents := expenseReadQuery(tx, a).Select("id")
	jobs := financeExtractionReadQuery(tx, a).Select("id")
	return tx.Model(&FinanceDuplicateCandidate{}).Where("company_id=? AND state<>'stale' AND compared_expense_id IN (?) AND EXISTS(SELECT 1 FROM expenses p WHERE p.id=finance_duplicate_candidates.compared_expense_id AND p.company_id=finance_duplicate_candidates.company_id AND p.version=finance_duplicate_candidates.compared_version) AND ((source_kind='expense' AND source_id IN (?) AND EXISTS(SELECT 1 FROM expenses x WHERE x.id=finance_duplicate_candidates.source_id AND x.company_id=finance_duplicate_candidates.company_id AND x.version=finance_duplicate_candidates.source_version)) OR (source_kind='extraction' AND source_id IN (?) AND EXISTS(SELECT 1 FROM receipt_extraction_results result JOIN finance_assistance_jobs job ON job.id=result.job_id AND job.company_id=result.company_id WHERE job.id=finance_duplicate_candidates.source_id AND job.company_id=finance_duplicate_candidates.company_id AND result.revision=finance_duplicate_candidates.source_version AND result.acceptance_id='')))", a.Company.ID, parents, parents, jobs)
}
func financeReconciliationAttentionQuery(tx *gorm.DB, a *access) *gorm.DB {
	q := tx.Model(&FinanceStatementRow{}).Where("company_id=?", a.Company.ID)
	if !financeAuthority(a.Member.Role) {
		return q.Where("1=0")
	}
	return q.Where("EXISTS(SELECT 1 FROM finance_statement_imports imp WHERE imp.id=finance_statement_rows.import_id AND imp.company_id=finance_statement_rows.company_id)").Where("NOT EXISTS(SELECT 1 FROM finance_reconciliation_allocations al WHERE al.company_id=finance_statement_rows.company_id AND al.row_id=finance_statement_rows.id AND al.active=true)")
}
func projectFinanceAttention(tx *gorm.DB, a *access, item AttentionItem, replay bool, v AttentionView) (AttentionView, error) {
	switch item.SourceKind {
	case "finance_extraction":
		j, result, e := authorizeReceiptExtraction(tx, a, item.SourceID)
		if e != nil || result == nil {
			return v, missing()
		}
		if item.Kind != "receipt_review" || !replay && (j.Status != "ready" || result.AcceptanceID != "" || item.OccurrenceKey != fmt.Sprintf("%s:%d", j.ID, result.Revision)) {
			return v, missing()
		}
		v.Title = "Review receipt candidates"
		v.SourceVersion = result.Revision
		v.Link = "#finance?company=" + url.QueryEscape(a.Company.ID) + "&extraction=" + url.QueryEscape(j.ID)
	case "finance_duplicate":
		c, e := authorizeFinanceDuplicate(tx, a, item.SourceID)
		if e != nil {
			return v, e
		}
		if item.Kind != "duplicate_review" || !replay && (c.State != "open" || item.OccurrenceKey != fmt.Sprintf("%s:%d", c.ID, c.Version)) {
			return v, missing()
		}
		v.Title = "Review possible duplicate"
		v.SourceVersion = c.Version
		v.Link = "#finance?company=" + url.QueryEscape(a.Company.ID) + "&tool=duplicates&candidate=" + url.QueryEscape(c.ID)
	case "finance_reconciliation":
		row, e := authorizeStatementRow(tx, a, item.SourceID)
		if e != nil {
			return v, e
		}
		if item.Kind != "reconciliation_review" {
			return v, missing()
		}
		_, basis, e := reconciliationSuggestions(tx, a, row)
		if e != nil {
			return v, e
		}
		if !replay {
			var n int64
			if e := tx.Model(&FinanceReconciliationAllocation{}).Where("company_id=? AND row_id=? AND active=true", a.Company.ID, row.ID).Count(&n).Error; e != nil {
				return v, e
			}
			if n > 0 || item.OccurrenceKey != row.ID+":"+basis {
				return v, missing()
			}
			if e := tx.Model(&FinanceReconciliationDecision{}).Where("company_id=? AND row_id=? AND action='dismiss' AND suggestion_basis=?", a.Company.ID, row.ID, basis).Count(&n).Error; e != nil {
				return v, e
			}
			if n > 0 {
				return v, missing()
			}
		}
		v.Title = "Review statement association"
		v.SourceVersion = row.Version
		v.Link = "#finance?company=" + url.QueryEscape(a.Company.ID) + "&tool=reconciliation&import=" + url.QueryEscape(row.ImportID) + "&row=" + url.QueryEscape(row.ID)
	default:
		return v, missing()
	}
	return v, nil
}
func syncFinanceExtractionAttention(tx *gorm.DB, j FinanceAssistanceJob, revision int64) error {
	return ensureAttentionItem(tx, AttentionItem{CompanyID: j.CompanyID, RecipientID: j.RequesterID, SourceKind: "finance_extraction", SourceID: j.ID, SourceRevision: revision, Kind: "receipt_review", OccurrenceKey: fmt.Sprintf("%s:%d", j.ID, revision)})
}
func syncFinanceDuplicateAttention(tx *gorm.DB, a *access, c FinanceDuplicateCandidate) error {
	if c.State != "open" {
		return supersedeAttention(tx, a.Company.ID, "finance_duplicate", c.ID, "duplicate_review", "")
	}
	for uid, m := range a.Members {
		if !m.Active || a.Users[uid].Suspended {
			continue
		}
		other := attentionForMember(a, uid)
		if _, e := authorizeFinanceDuplicate(tx, other, c.ID); e != nil {
			if attentionMissing(e) {
				continue
			}
			return e
		}
		if e := ensureAttentionItem(tx, AttentionItem{CompanyID: a.Company.ID, RecipientID: uid, SourceKind: "finance_duplicate", SourceID: c.ID, SourceRevision: c.Version, Kind: "duplicate_review", OccurrenceKey: fmt.Sprintf("%s:%d", c.ID, c.Version)}); e != nil {
			return e
		}
	}
	return nil
}
func syncFinanceReconciliationAttention(tx *gorm.DB, a *access, row FinanceStatementRow) error {
	var active int64
	if e := tx.Model(&FinanceReconciliationAllocation{}).Where("company_id=? AND row_id=? AND active=true", a.Company.ID, row.ID).Count(&active).Error; e != nil {
		return e
	}
	if active > 0 {
		return supersedeAttention(tx, a.Company.ID, "finance_reconciliation", row.ID, "reconciliation_review", "")
	}
	_, basis, e := reconciliationSuggestions(tx, a, row)
	if e != nil {
		return e
	}
	episode := row.ID + ":" + basis
	var dismissed int64
	if e := tx.Model(&FinanceReconciliationDecision{}).Where("company_id=? AND row_id=? AND action='dismiss' AND suggestion_basis=?", a.Company.ID, row.ID, basis).Count(&dismissed).Error; e != nil {
		return e
	}
	if dismissed > 0 {
		return supersedeAttention(tx, a.Company.ID, "finance_reconciliation", row.ID, "reconciliation_review", "")
	}
	if e := supersedeAttention(tx, a.Company.ID, "finance_reconciliation", row.ID, "reconciliation_review", episode); e != nil {
		return e
	}
	for uid, m := range a.Members {
		if m.Active && !a.Users[uid].Suspended && financeAuthority(m.Role) {
			if e := ensureAttentionItem(tx, AttentionItem{CompanyID: a.Company.ID, RecipientID: uid, SourceKind: "finance_reconciliation", SourceID: row.ID, SourceRevision: row.Version, Kind: "reconciliation_review", OccurrenceKey: episode}); e != nil {
				return e
			}
		}
	}
	return nil
}

// Import rows have no allocation/dismissal yet. Batch their IDs-only initial
// obligations rather than adding thousands of per-row recipient queries.
func initialFinanceStatementAttention(tx *gorm.DB, a *access, rows []FinanceStatementRow) error {
	now := time.Now().UTC()
	items := []AttentionItem{}
	type queryKey struct {
		amount         int64
		currency, date string
	}
	candidatePages := map[queryKey][]Expense{}
	for _, row := range rows {
		key := queryKey{row.SignedAmountMinor, row.CompanyCurrency, row.BookedDate}
		expenses, ok := candidatePages[key]
		if !ok {
			var e error
			expenses, e = reconciliationPaidCandidates(tx, a, row)
			if e != nil {
				return e
			}
			candidatePages[key] = expenses
		}
		_, basis, e := reconciliationSuggestionsForCandidates(row, expenses)
		if e != nil {
			return e
		}
		for uid, m := range a.Members {
			if m.Active && !a.Users[uid].Suspended && financeAuthority(m.Role) {
				items = append(items, AttentionItem{ID: newID("attention"), CompanyID: a.Company.ID, RecipientID: uid, SourceKind: "finance_reconciliation", SourceID: row.ID, SourceRevision: row.Version, Kind: "reconciliation_review", OccurrenceKey: row.ID + ":" + basis, State: "open", Version: 1, CreatedAt: now, UpdatedAt: now})
			}
		}
	}
	if len(items) == 0 {
		return nil
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(items, 100).Error
}
