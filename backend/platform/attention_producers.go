package platform

import (
	"fmt"
	"gorm.io/gorm"
	"strings"
	"time"
)

func attentionForMember(a *access, uid string) *access {
	return &access{Company: a.Company, User: a.Users[uid], Member: a.Members[uid], Members: a.Members, Users: a.Users}
}
func supersedeAttention(tx *gorm.DB, cid, kind, source, action, keep string, recipients ...string) error {
	q := tx.Model(&AttentionItem{}).Where("company_id=? AND source_kind=? AND source_id=? AND kind=? AND state IN ?", cid, kind, source, action, []string{"open", "resolved", "routed"})
	if len(recipients) > 0 {
		q = q.Where("recipient_id IN ?", recipients)
	}
	if keep != "" {
		q = q.Where("occurrence_key<>? AND occurrence_key NOT LIKE ?", keep, "%:"+keep+":%")
	}
	return q.Updates(map[string]any{"state": "superseded", "updated_at": time.Now().UTC(), "version": gorm.Expr("version+1")}).Error
}
func syncTaskAttention(tx *gorm.DB, a *access, before *Task, after Task) error {
	episode := fmt.Sprintf("task:%d", after.Version)
	// Natural current revision is stable on reconciliation; source mutations create
	// fresh review/evidence episodes while accepted work removes pending obligations.
	for _, kind := range []string{"task_review", "blocker"} {
		keep := ""
		if kind == "task_review" && after.Status == "in_review" || kind == "blocker" && after.Status == "blocked" {
			keep = episode
		}
		if e := supersedeAttention(tx, after.CompanyID, "task", after.ID, kind, keep); e != nil {
			return e
		}
	}
	for uid, m := range a.Members {
		u := a.Users[uid]
		if !m.Active || u.ID == "" || u.Suspended {
			continue
		}
		other := attentionForMember(a, uid)
		kind := ""
		if taskAttentionReviewer(other, after) {
			kind = "task_review"
		} else if uid == after.OwnerID && after.Status == "blocked" {
			kind = "blocker"
		}
		if kind != "" {
			if e := ensureAttentionItem(tx, AttentionItem{CompanyID: after.CompanyID, RecipientID: uid, SourceKind: "task", SourceID: after.ID, SourceRevision: after.Version, OccurrenceKey: episode, Kind: kind}); e != nil {
				return e
			}
		}
	}
	if before != nil && deadlineFingerprint(*before) != deadlineFingerprint(after) || in(after.Status, "done", "cancelled") {
		if e := supersedeAttention(tx, after.CompanyID, "task", after.ID, "deadline", ""); e != nil {
			return e
		}
	}
	if before == nil || before.OwnerID != after.OwnerID {
		if e := supersedeAttention(tx, after.CompanyID, "task", after.ID, "update", episode); e != nil {
			return e
		}
		if m := a.Members[after.OwnerID]; m.Active && !a.Users[after.OwnerID].Suspended && !in(after.Status, "done", "cancelled") {
			return ensureAttentionItem(tx, AttentionItem{CompanyID: after.CompanyID, RecipientID: after.OwnerID, SourceKind: "task", SourceID: after.ID, SourceRevision: after.Version, OccurrenceKey: episode, Kind: "update"})
		}
	}
	if in(after.Status, "done", "cancelled") {
		for _, kind := range []string{"update", "deadline"} {
			if e := supersedeAttention(tx, after.CompanyID, "task", after.ID, kind, ""); e != nil {
				return e
			}
		}
	}
	return nil
}
func syncExpenseAttention(tx *gorm.DB, a *access, before Expense, after Expense) error {
	episode := fmt.Sprintf("expense:%d", after.Version)
	keep := ""
	if after.Status == "submitted" {
		keep = episode
	}
	if e := supersedeAttention(tx, after.CompanyID, "expense", after.ID, "expense_review", keep); e != nil {
		return e
	}
	if after.Status != "submitted" {
		return nil
	}
	for uid, m := range a.Members {
		if m.Active && a.Users[uid].ID != "" && !a.Users[uid].Suspended && attentionForMember(a, uid).canApproveExpense(after) {
			if e := ensureAttentionItem(tx, AttentionItem{CompanyID: after.CompanyID, RecipientID: uid, SourceKind: "expense", SourceID: after.ID, SourceRevision: after.Version, OccurrenceKey: episode, Kind: "expense_review"}); e != nil {
				return e
			}
		}
	}
	return nil
}
func syncRecordAttention(tx *gorm.DB, scope *conversationScope, record CommunicationRecord) error {
	episode := fmt.Sprintf("record:%d", record.Revision)
	keep := ""
	if record.State == "open" {
		keep = episode
	}
	if e := supersedeAttention(tx, record.CompanyID, "record", record.ID, "decision", keep); e != nil {
		return e
	}
	if e := supersedeAttention(tx, record.CompanyID, "record", record.ID, "update", keep); e != nil {
		return e
	}
	if record.State != "open" {
		return nil
	}
	message, e := scopedMessage(tx, scope, record.AnchorMessageID)
	if e != nil || message.Removed || message.Revision != record.SourceRevision {
		return e
	}
	var recipients []CommunicationRecipient
	if e := tx.Where("company_id=? AND record_id=? AND revision=?", record.CompanyID, record.ID, record.Revision).Find(&recipients).Error; e != nil {
		return e
	}
	for _, r := range recipients {
		if r.Response != "" {
			if e := tx.Model(&AttentionItem{}).Where("company_id=? AND source_kind=? AND source_id=? AND recipient_id=? AND record_revision=? AND state=?", record.CompanyID, "record", record.ID, r.UserID, record.Revision, "open").Updates(map[string]any{"state": "superseded", "version": gorm.Expr("version+1")}).Error; e != nil {
				return e
			}
			continue
		}
		if record.Kind == "decision" && (r.UserID != record.ReviewerID || r.UserID == record.CreatedBy) {
			continue
		}
		other, e := conversationAccess(tx, r.UserID, record.CompanyID, record.ConversationID)
		if e != nil || other.Role == "viewer" || message.Sequence < other.HistoryFromSequence {
			continue
		}
		var user User
		if e := tx.First(&user, "id=?", r.UserID).Error; e != nil {
			return e
		}
		if user.Suspended {
			continue
		}
		kind := "update"
		if record.Kind == "decision" {
			kind = "decision"
		}
		if e := ensureAttentionItem(tx, AttentionItem{CompanyID: record.CompanyID, RecipientID: r.UserID, SourceKind: "record", SourceID: record.ID, SourceRevision: message.Revision, RecordRevision: record.Revision, OccurrenceKey: episode, Kind: kind, ConversationID: record.ConversationID, AnchorMessageID: message.ID, MessageSequence: message.Sequence, RecipientEpoch: other.Epoch}); e != nil {
			return e
		}
	}
	return nil
}
func syncIntakeAttention(tx *gorm.DB, a *access, item CommunicationRequest) error {
	episode := fmt.Sprintf("intake:%d", item.Version)
	keep := ""
	if item.State == "open" {
		keep = episode
	}
	if e := supersedeAttention(tx, item.CompanyID, "intake", item.ID, "intake_triage", keep); e != nil {
		return e
	}
	if item.State != "open" {
		return nil
	}
	for uid, m := range a.Members {
		if m.Active && a.Users[uid].ID != "" && !a.Users[uid].Suspended && attentionForMember(a, uid).canTriageIntake(item) {
			if e := ensureAttentionItem(tx, AttentionItem{CompanyID: item.CompanyID, RecipientID: uid, SourceKind: "intake", SourceID: item.ID, SourceRevision: item.Version, OccurrenceKey: episode, Kind: "intake_triage"}); e != nil {
				return e
			}
		}
	}
	return nil
}
func bookmarkOccurrence(at string, epoch, revision int64) string {
	return payloadHash([]any{at, epoch, revision})
}
func syncBookmarkAttention(tx *gorm.DB, scope *conversationScope, b CommunicationBookmark) error {
	episode := ""
	var m Message
	if b.RemindAt != "" {
		var e error
		m, e = scopedMessage(tx, scope, b.MessageID)
		if e != nil {
			return e
		}
		if m.Removed {
			return missing()
		}
		episode = bookmarkOccurrence(b.RemindAt, scope.Epoch, m.Revision)
	}
	if e := supersedeAttention(tx, b.CompanyID, "bookmark", b.MessageID, "saved_reminder", episode, b.UserID); e != nil {
		return e
	}
	if b.RemindAt == "" {
		return nil
	}
	due, e := time.Parse(time.RFC3339, b.RemindAt)
	if e != nil {
		return e
	}
	return ensureAttentionItem(tx, AttentionItem{CompanyID: b.CompanyID, RecipientID: b.UserID, SourceKind: "bookmark", SourceID: b.MessageID, SourceRevision: m.Revision, OccurrenceKey: episode, Kind: "saved_reminder", ConversationID: m.ConversationID, AnchorMessageID: m.ID, MessageSequence: m.Sequence, RecipientEpoch: scope.Epoch, DueAt: &due})
}
func deadlineFingerprint(t Task) string {
	return payloadHash([]any{t.DeadlineMode, t.DueDate, t.DueAt, t.DueTimezone})
}
func ensureDeadlineAttention(tx *gorm.DB, t Task, stage string, now time.Time) error {
	return ensureAttentionItem(tx, AttentionItem{CompanyID: t.CompanyID, RecipientID: t.OwnerID, SourceKind: "task", SourceID: t.ID, SourceRevision: t.Version, OccurrenceKey: "deadline:" + deadlineFingerprint(t) + ":" + stage, Kind: "deadline", DueAt: &now})
}

// Routing/escalation retain the natural source obligation across repeated handoffs.
func rootAttentionOccurrence(key string) string {
	for strings.HasPrefix(key, "route:") || strings.HasPrefix(key, "escalation:") {
		start := strings.IndexByte(key, ':')
		end := strings.LastIndexByte(key, ':')
		if end <= start {
			break
		}
		key = key[start+1 : end]
	}
	return key
}
