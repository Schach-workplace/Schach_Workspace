package platform

import "gorm.io/gorm"

// attentionCandidates applies live business and private source scope in SQL
// before batching/limit. Projection additionally validates exact obligations.
func attentionCandidates(tx *gorm.DB, a *access) *gorm.DB {
	tasks := taskReadQuery(tx, a).Select("id")
	reviews := taskReadQuery(tx, a).Select("id").Where("status=? AND owner_id<>?", "in_review", a.User.ID)
	if a.Member.Role == "viewer" {
		reviews = reviews.Where("1=0")
	} else if !leadership(a.Member.Role) {
		reviews = reviews.Where("reviewer_id=?", a.User.ID)
	}
	blockers := taskReadQuery(tx, a).Select("id").Where("status=?", "blocked")
	expenses := expenseReadQuery(tx, a).Select("id")
	expenseReviews := expenseReadQuery(tx, a).Select("id").Where("status=? AND created_by<>?", "submitted", a.User.ID)
	if !(financeAuthority(a.Member.Role) || a.Member.Role == "head") {
		expenseReviews = expenseReviews.Where("1=0")
	}
	intake := tx.Model(&CommunicationRequest{}).Select("id").Where("company_id=?", a.Company.ID)
	if !leadership(a.Member.Role) {
		if a.Member.Role == "head" && a.Member.DepartmentID != "" {
			intake = intake.Where("department_id=? AND state=?", a.Member.DepartmentID, "open")
		} else {
			intake = intake.Where("1=0")
		}
	} else {
		intake = intake.Where("state=?", "open")
	}
	record := `EXISTS (SELECT 1 FROM communication_records rec JOIN messages m ON m.company_id=rec.company_id AND m.conversation_id=rec.conversation_id AND m.id=rec.anchor_message_id JOIN conversations c ON c.company_id=rec.company_id AND c.id=rec.conversation_id LEFT JOIN conversation_members cm ON cm.company_id=c.company_id AND cm.conversation_id=c.id AND cm.user_id=? AND cm.active=? LEFT JOIN communication_recipients rr ON rr.company_id=rec.company_id AND rr.record_id=rec.id AND rr.revision=rec.revision AND rr.user_id=? WHERE rec.company_id=attention_items.company_id AND rec.id=attention_items.source_id AND rec.conversation_id=attention_items.conversation_id AND m.id=attention_items.anchor_message_id AND m.removed=? AND m.sequence=attention_items.message_sequence AND m.revision=attention_items.source_revision AND rec.source_revision=m.revision AND rec.revision=attention_items.record_revision AND rec.state='open' AND (c.public=? OR cm.user_id IS NOT NULL) AND (c.public=? OR m.sequence>=cm.history_from_sequence) AND attention_items.recipient_epoch=COALESCE(cm.epoch,0) AND (rec.created_by=? OR rr.user_id IS NOT NULL) AND COALESCE(rr.response,'')='' AND (rec.kind<>'decision' OR (rec.reviewer_id=? AND rec.created_by<>?)))`
	bookmark := `EXISTS (SELECT 1 FROM communication_bookmarks b JOIN messages m ON m.company_id=b.company_id AND m.conversation_id=b.conversation_id AND m.id=b.message_id JOIN conversations c ON c.company_id=b.company_id AND c.id=b.conversation_id LEFT JOIN conversation_members cm ON cm.company_id=c.company_id AND cm.conversation_id=c.id AND cm.user_id=? AND cm.active=? WHERE b.company_id=attention_items.company_id AND b.user_id=? AND b.message_id=attention_items.source_id AND b.conversation_id=attention_items.conversation_id AND b.remind_at<>'' AND m.id=attention_items.anchor_message_id AND m.removed=? AND m.sequence=attention_items.message_sequence AND m.revision=attention_items.source_revision AND (c.public=? OR cm.user_id IS NOT NULL) AND (c.public=? OR m.sequence>=cm.history_from_sequence) AND attention_items.recipient_epoch=COALESCE(cm.epoch,0))`
	financeExtractions := financeExtractionReadQuery(tx, a).Select("id").Where("status='ready' AND result_id<>''")
	financeDuplicates := financeDuplicateReadQuery(tx, a).Select("id").Where("state='open'")
	financeRows := financeReconciliationAttentionQuery(tx, a).Select("id")
	q := tx.Model(&AttentionItem{}).Where(`company_id=? AND recipient_id=? AND ((source_kind='task' AND source_id IN (?) AND (kind<>'task_review' OR source_id IN (?)) AND (kind<>'blocker' OR source_id IN (?))) OR (source_kind='expense' AND source_id IN (?) AND (kind<>'expense_review' OR source_id IN (?))) OR (source_kind='intake' AND source_id IN (?)) OR (source_kind='record' AND `+record+`) OR (source_kind='bookmark' AND `+bookmark+`)) OR (company_id=? AND recipient_id=? AND ((source_kind='finance_extraction' AND source_id IN (?)) OR (source_kind='finance_duplicate' AND source_id IN (?)) OR (source_kind='finance_reconciliation' AND source_id IN (?))))`, a.Company.ID, a.User.ID, tasks, reviews, blockers, expenses, expenseReviews, intake, a.User.ID, true, a.User.ID, false, true, true, a.User.ID, a.User.ID, a.User.ID, a.User.ID, true, a.User.ID, false, true, true, a.Company.ID, a.User.ID, financeExtractions, financeDuplicates, financeRows).Or("id IN (?)", goalAttentionCandidates(tx, a).Select("id"))
	return tx.Model(&AttentionItem{}).Where("id IN (?)", q.Select("id")).Where("membership_epoch=?", a.Member.AccessEpoch)
}
