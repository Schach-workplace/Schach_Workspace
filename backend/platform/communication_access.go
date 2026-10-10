package platform

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"sort"
	"time"
)

type conversationScope struct {
	Blocked             bool
	CompanyID           string
	UserID              string
	Role                string
	HistoryFromSequence int64
	Version             int64
	Epoch               int64
	CompanyRole         string
	Conversation        Conversation
}

func conversationAccess(tx *gorm.DB, userID, companyID, conversationID string) (*conversationScope, error) {
	var m Membership
	if e := tx.Where("company_id = ? AND user_id = ? AND active = ?", companyID, userID, true).First(&m).Error; e != nil {
		if e == gorm.ErrRecordNotFound {
			return nil, missing()
		}
		return nil, e
	}
	var c Conversation
	if e := tx.Where("company_id = ? AND id = ?", companyID, conversationID).First(&c).Error; e != nil {
		if e == gorm.ErrRecordNotFound {
			return nil, missing()
		}
		return nil, e
	}
	cm := ConversationMember{}
	e := tx.Where("company_id = ? AND conversation_id = ? AND user_id = ? AND active = ?", companyID, conversationID, userID, true).First(&cm).Error
	if e != nil && e != gorm.ErrRecordNotFound {
		return nil, e
	}
	if e != nil && !c.Public {
		return nil, missing()
	}
	role, from, epoch := "member", int64(1), int64(0)
	if e == nil {
		role = cm.Role
		from = cm.HistoryFromSequence
		epoch = cm.Epoch
	}
	if c.Public {
		from = 1
	}
	if m.Role == "viewer" {
		role = "viewer"
	}
	blocked := false
	if c.Kind == "dm" {
		var count int64
		if e := tx.Model(&CommunicationBlock{}).Where("company_id=? AND user_id IN (SELECT user_id FROM conversation_members WHERE company_id=? AND conversation_id=?) AND blocked_user_id IN (SELECT user_id FROM conversation_members WHERE company_id=? AND conversation_id=?)", companyID, companyID, c.ID, companyID, c.ID).Count(&count).Error; e != nil {
			return nil, e
		}
		blocked = count > 0
	}
	return &conversationScope{Blocked: blocked, CompanyID: companyID, UserID: userID, Role: role, HistoryFromSequence: from, Version: c.Version, Epoch: epoch, CompanyRole: m.Role, Conversation: c}, nil
}
func lockCommunicationRow(tx *gorm.DB, strength string) *gorm.DB {
	if tx.Dialector.Name() == "postgres" {
		return tx.Clauses(clause.Locking{Strength: strength})
	}
	return tx
}

// Lock order: optional business company -> session -> sorted company memberships
// -> conversation -> dependent records. Chat never obtains the business lock.
func (s *Server) withCommunicationTransaction(r *http.Request, extraUsers []string, fn func(*gorm.DB, *conversationScope) error) error {
	u, hash, e := s.authenticate(r)
	if e != nil {
		return e
	}
	return s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var session SessionRecord
		if e := lockCommunicationRow(tx, "SHARE").Where("token_hash = ? AND user_id = ? AND expires_at > ?", hash, u.ID, time.Now().UTC()).First(&session).Error; e != nil {
			return &apiError{401, "unauthenticated", "Please sign in again.", nil}
		}
		ids := append([]string{u.ID}, extraUsers...)
		sort.Strings(ids)
		var members []Membership
		if e := lockCommunicationRow(tx, "SHARE").Where("company_id = ? AND user_id IN ?", r.PathValue("cid"), ids).Order("user_id").Find(&members).Error; e != nil {
			return e
		}
		active := map[string]bool{}
		for _, m := range members {
			active[m.UserID] = m.Active
		}
		if !active[u.ID] {
			return missing()
		}
		for _, id := range ids {
			if !active[id] {
				return invalid("Participants must be active company members.")
			}
		}
		cid := r.PathValue("cid")
		id := r.PathValue("id")
		if id == "" {
			var m Membership
			for _, member := range members {
				if member.UserID == u.ID {
					m = member
				}
			}
			return fn(tx, &conversationScope{CompanyID: cid, UserID: u.ID, CompanyRole: m.Role, Role: m.Role})
		}
		var c Conversation
		if e := lockCommunicationRow(tx, "UPDATE").Where("company_id = ? AND id = ?", cid, id).First(&c).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return missing()
			}
			return e
		}
		scope, e := conversationAccess(tx, u.ID, cid, id)
		if e != nil {
			return e
		}
		return fn(tx, scope)
	})
}
func (a *conversationScope) canPost() bool {
	return a.Role != "viewer" && !a.Conversation.Archived && !a.Blocked
}
func (a *conversationScope) canManage() bool { return in(a.Role, "owner", "moderator") }

// Company departure closes private history intervals. Reactivation cannot restore
// access to old private content; a conversation owner must explicitly re-invite.
func revokeCompanyConversations(tx *gorm.DB, cid, uid string) error {
	var rows []Conversation
	if e := lockCommunicationRow(tx, "UPDATE").Where("company_id = ? AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.company_id = conversations.company_id AND cm.conversation_id = conversations.id AND cm.user_id = ? AND cm.active = ?)", cid, uid, true).Order("id").Find(&rows).Error; e != nil {
		return e
	}
	for _, c := range rows {
		if !c.Archived && c.Kind != "dm" {
			var owners int64
			if e := tx.Model(&ConversationMember{}).Where("company_id=? AND conversation_id=? AND user_id=? AND active=? AND role=?", cid, c.ID, uid, true, "owner").Count(&owners).Error; e != nil {
				return e
			}
			if owners > 0 {
				return invalid("Transfer or archive owned conversations before removing this company membership.")
			}
		}
		if c.Kind == "dm" && !c.Archived {
			if e := tx.Model(&c).Update("archived", true).Error; e != nil {
				return e
			}
		}
		if e := tx.Model(&ConversationInterval{}).Where("company_id = ? AND conversation_id = ? AND user_id = ? AND through_sequence IS NULL", cid, c.ID, uid).Updates(map[string]any{"through_sequence": c.NextSequence, "left_at": nowString()}).Error; e != nil {
			return e
		}
		if e := tx.Model(&ConversationMember{}).Where("company_id = ? AND conversation_id = ? AND user_id = ?", cid, c.ID, uid).Update("active", false).Error; e != nil {
			return e
		}
		if e := tx.Model(&Conversation{}).Where("company_id = ? AND id = ?", cid, c.ID).Update("version", c.Version+1).Error; e != nil {
			return e
		}
		if e := appendCommunicationEvent(tx, &conversationScope{CompanyID: cid, Conversation: c}, "membership_changed", "", 0); e != nil {
			return e
		}
	}
	return nil
}
