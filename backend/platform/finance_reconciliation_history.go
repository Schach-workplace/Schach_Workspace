package platform

import (
	"gorm.io/gorm"
	"net/http"
)

// Selected row history has independent cursor pages. The queue carries only the
// latest bounded decisions/associations; old retained history stays reachable.
func (s *Server) getFinanceReconciliationHistory(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	items := []FinanceReconciliationDecision{}
	allocations := []FinanceReconciliationAllocation{}
	cursor := ""
	more := false
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		row, e := authorizeStatementRow(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		basis := payloadHash([]string{accessBasis(a), "reconciliation-history", row.ID})
		decisionAfter, allocationAfter := "", ""
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			c, err := decodeReadCursor(raw, basis)
			if err != nil {
				return err
			}
			decisionAfter, allocationAfter = c.Created, c.ID
		}
		decisions := tx.Model(&FinanceReconciliationDecision{}).Where("company_id=? AND row_id=?", a.Company.ID, row.ID)
		attached := tx.Model(&FinanceReconciliationAllocation{}).Where("company_id=? AND row_id=? AND expense_id IN (?)", a.Company.ID, row.ID, expenseReadQuery(tx, a).Select("id"))
		if decisionAfter == "end" {
			decisions = decisions.Where("1=0")
		} else if decisionAfter != "" {
			decisions = decisions.Where("id<?", decisionAfter)
		}
		if allocationAfter == "end" {
			attached = attached.Where("1=0")
		} else if allocationAfter != "" {
			attached = attached.Where("id<?", allocationAfter)
		}
		if e := decisions.Order("id DESC").Limit(limit + 1).Find(&items).Error; e != nil {
			return e
		}
		if e := attached.Order("id DESC").Limit(limit + 1).Find(&allocations).Error; e != nil {
			return e
		}
		if len(items) > limit {
			items = items[:limit]
			decisionAfter = items[len(items)-1].ID
			more = true
		} else {
			decisionAfter = "end"
		}
		if len(allocations) > limit {
			allocations = allocations[:limit]
			allocationAfter = allocations[len(allocations)-1].ID
			more = true
		} else {
			allocationAfter = "end"
		}
		if more {
			cursor = encodeReadCursor(readCursor{basis, decisionAfter, allocationAfter})
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"items": items, "allocations": allocations, "cursor": cursor, "hasMore": more})
}
