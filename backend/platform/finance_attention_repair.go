package platform

import (
	"context"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

// IDs-only resumable producer work. Company lock serializes mutation marks and pages.
// An older page may never clear a newer revision, including when multiple workers run.
type FinanceReconciliationAttentionWork struct {
	CompanyID         string `gorm:"primaryKey"`
	Revision          int64
	ProcessedRevision int64
	Cursor            string
	UpdatedAt         time.Time `gorm:"index"`
}

func markFinanceReconciliationDirty(tx *gorm.DB, cid string) error {
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "company_id"}}, DoUpdates: clause.Assignments(map[string]any{"revision": gorm.Expr("finance_reconciliation_attention_works.revision+1"), "cursor": "", "updated_at": time.Now().UTC()})}).Create(&FinanceReconciliationAttentionWork{CompanyID: cid, Revision: 1, UpdatedAt: time.Now().UTC()}).Error
}
func finishFinanceAttentionPage(tx *gorm.DB, w FinanceReconciliationAttentionWork, cursor string, complete bool) error {
	updates := map[string]any{"cursor": cursor, "updated_at": time.Now().UTC()}
	if complete {
		updates["processed_revision"] = w.Revision
		updates["cursor"] = ""
	}
	result := tx.Model(&FinanceReconciliationAttentionWork{}).Where("company_id=? AND revision=? AND processed_revision=? AND cursor=?", w.CompanyID, w.Revision, w.ProcessedRevision, w.Cursor).Updates(updates)
	return result.Error
}

// At most limit source rows/empty company attempts per pass; each company gets
// at most25 rows before moving to the back of the pending queue for fairness.
func (s *Server) repairFinanceReconciliationAttention(ctx context.Context, limit int) error {
	for remaining := limit; remaining > 0; {
		var selected FinanceReconciliationAttentionWork
		e := s.db.WithContext(ctx).Where("revision>processed_revision").Order("updated_at,company_id").First(&selected).Error
		if e == gorm.ErrRecordNotFound {
			return nil
		}
		if e != nil {
			return e
		}
		used := 1
		e = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, selected.CompanyID); e != nil {
				return e
			}
			var work FinanceReconciliationAttentionWork
			if e := tx.First(&work, "company_id=?", selected.CompanyID).Error; e != nil {
				return e
			}
			if work.Revision == work.ProcessedRevision {
				return nil
			}
			var member Membership
			e := tx.Where("company_id=? AND active=true AND role IN ? AND EXISTS(SELECT 1 FROM users u WHERE u.id=memberships.user_id AND u.suspended=false)", work.CompanyID, []string{"founder", "ceo", "admin", "finance"}).Order("user_id").First(&member).Error
			if e == gorm.ErrRecordNotFound {
				return finishFinanceAttentionPage(tx, work, work.Cursor, false)
			}
			if e != nil {
				return e
			}
			a, e := currentAttentionActorLocked(tx, work.CompanyID, member.UserID)
			if e != nil {
				return e
			}
			page := remaining
			if page > 25 {
				page = 25
			}
			var rows []FinanceStatementRow
			if e := tx.Where("company_id=? AND id>? AND EXISTS(SELECT 1 FROM finance_statement_imports imp WHERE imp.company_id=finance_statement_rows.company_id AND imp.id=finance_statement_rows.import_id)", work.CompanyID, work.Cursor).Order("id").Limit(page).Find(&rows).Error; e != nil {
				return e
			}
			for _, row := range rows {
				if e := syncFinanceReconciliationAttention(tx, a, row); e != nil {
					return e
				}
			}
			cursor := work.Cursor
			if len(rows) > 0 {
				cursor = rows[len(rows)-1].ID
				used = len(rows)
			}
			return finishFinanceAttentionPage(tx, work, cursor, len(rows) < page)
		})
		if e != nil {
			return e
		}
		remaining -= used
	}
	return nil
}
