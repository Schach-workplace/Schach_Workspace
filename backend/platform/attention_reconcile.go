package platform

import (
	"context"
	"gorm.io/gorm"
	"strings"
)

// ReconcileAttention performs one bounded IDs-only pass. Its returned kind/id
// cursor lets an explicit caller finish preexisting current work without a poll
// or inventing historical episode timestamps. Empty result means pass complete.
func (s *Server) ReconcileAttention(ctx context.Context, cid, cursor string, limit int) (string, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	kind, last := "task", ""
	if cursor != "" {
		parts := strings.SplitN(cursor, ":", 2)
		if len(parts) != 2 || !in(parts[0], "task", "expense", "intake", "record", "bookmark") {
			return "", invalid("Invalid reconciliation cursor.")
		}
		kind, last = parts[0], parts[1]
	}
	next := ""
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := lockCompany(tx, cid); e != nil {
			return e
		}
		var members []Membership
		if e := lockCommunicationRow(tx, "UPDATE").Where("company_id=?", cid).Order("user_id").Find(&members).Error; e != nil {
			return e
		}
		uid := ""
		for _, m := range members {
			if m.Active {
				var user User
				if e := tx.First(&user, "id=?", m.UserID).Error; e != nil {
					return e
				}
				if !user.Suspended {
					uid = m.UserID
					break
				}
			}
		}
		if uid == "" {
			return nil
		}
		a, e := currentAttentionActorLocked(tx, cid, uid)
		if e != nil {
			return e
		}
		ids := []string{}
		table, col := "tasks", "id"
		switch kind {
		case "expense":
			table = "expenses"
		case "intake":
			table = "communication_requests"
		case "record":
			table = "communication_records"
		case "bookmark":
			table = "communication_bookmarks"
			col = "message_id"
		}
		if e := tx.Table(table).Where("company_id=? AND "+col+">?", cid, last).Order(col).Limit(limit).Pluck(col, &ids).Error; e != nil {
			return e
		}
		for _, id := range ids {
			switch kind {
			case "task":
				var t Task
				if e := tx.First(&t, "company_id=? AND id=?", cid, id).Error; e != nil {
					return e
				}
				if e := syncTaskAttention(tx, a, nil, t); e != nil {
					return e
				}
			case "expense":
				var item Expense
				if e := tx.First(&item, "company_id=? AND id=?", cid, id).Error; e != nil {
					return e
				}
				if e := syncExpenseAttention(tx, a, Expense{}, item); e != nil {
					return e
				}
			case "intake":
				var item CommunicationRequest
				if e := tx.First(&item, "company_id=? AND id=?", cid, id).Error; e != nil {
					return e
				}
				if e := syncIntakeAttention(tx, a, item); e != nil {
					return e
				}
			case "record":
				var record CommunicationRecord
				if e := tx.First(&record, "company_id=? AND id=?", cid, id).Error; e != nil {
					return e
				}
				var c Conversation
				if e := lockCommunicationRow(tx, "SHARE").Where("company_id=? AND id=?", cid, record.ConversationID).First(&c).Error; e != nil {
					return e
				}
				scope, e := conversationAccess(tx, record.CreatedBy, cid, c.ID)
				if e != nil {
					continue
				}
				if e = syncRecordAttention(tx, scope, record); e != nil {
					if attentionMissing(e) {
						continue
					}
					return e
				}
			case "bookmark":
				var rows []CommunicationBookmark
				if e := tx.Where("company_id=? AND message_id=?", cid, id).Find(&rows).Error; e != nil {
					return e
				}
				for _, b := range rows {
					scope, e := conversationAccess(tx, b.UserID, cid, b.ConversationID)
					if e != nil {
						continue
					}
					if e := syncBookmarkAttention(tx, scope, b); e != nil {
						if attentionMissing(e) {
							continue
						}
						return e
					}
				}
			}
		}
		if len(ids) == limit {
			next = kind + ":" + ids[len(ids)-1]
		} else {
			switch kind {
			case "task":
				next = "expense:"
			case "expense":
				next = "intake:"
			case "intake":
				next = "record:"
			case "record":
				next = "bookmark:"
			}
		}
		return nil
	})
	return next, e
}
