package platform

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"sort"
	"strings"
	"time"
)

type CommunicationBlock struct {
	CompanyID     string `gorm:"primaryKey;size:80"`
	UserID        string `gorm:"primaryKey;size:80"`
	BlockedUserID string `gorm:"primaryKey;size:80"`
}
type CommunicationPin struct {
	CompanyID      string `gorm:"primaryKey;size:80"`
	ConversationID string
	MessageID      string `gorm:"primaryKey;size:80"`
	CreatedBy      string
	CreatedAt      string
}

func (s *Server) blockCommunicationUser(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		UserID  string `json:"userId"`
		Blocked bool   `json:"blocked"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	e := s.withCommunicationTransaction(r, []string{input.UserID}, func(tx *gorm.DB, a *conversationScope) error {
		if input.UserID == a.UserID {
			return invalid("Choose another company member.")
		}
		ids := []string{a.UserID, input.UserID}
		sort.Strings(ids)
		pair := strings.Join(ids, ":")
		if tx.Dialector.Name() == "postgres" {
			if e := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", a.CompanyID+":"+pair).Error; e != nil {
				return e
			}
		}
		// Serialize with DM sends/call grants after pair creation has completed.
		var conversations []Conversation
		if e := lockCommunicationRow(tx, "UPDATE").Where("company_id=? AND pair_key=?", a.CompanyID, pair).Find(&conversations).Error; e != nil {
			return e
		}
		row := CommunicationBlock{CompanyID: a.CompanyID, UserID: a.UserID, BlockedUserID: input.UserID}
		if input.Blocked {
			return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
		}
		return tx.Where("company_id=? AND user_id=? AND blocked_user_id=?", a.CompanyID, a.UserID, input.UserID).Delete(&CommunicationBlock{}).Error
	})
	if e != nil {
		return e
	}
	return ok(w, "")
}
func (s *Server) pinCommunicationMessage(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Pinned           bool  `json:"pinned"`
		ExpectedRevision int64 `json:"expectedRevision"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canManage() || !a.canPost() {
			return denied()
		}
		m, e := scopedMessage(tx, a, r.PathValue("mid"))
		if e != nil {
			return e
		}
		if m.Removed {
			return missing()
		}
		if m.Revision != input.ExpectedRevision {
			return conflict()
		}
		if input.Pinned {
			if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&CommunicationPin{CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, MessageID: m.ID, CreatedBy: a.UserID, CreatedAt: nowString()}).Error; e != nil {
				return e
			}
		} else {
			if e := tx.Where("company_id=? AND message_id=?", a.CompanyID, m.ID).Delete(&CommunicationPin{}).Error; e != nil {
				return e
			}
		}
		return appendCommunicationEvent(tx, a, "pins_changed", m.ID, m.Sequence)
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("mid"))
}
func (s *Server) listCommunicationPins(w http.ResponseWriter, r *http.Request) error {
	rows := []Message{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if e := tx.Table("messages m").Select("m.*").Joins("JOIN communication_pins p ON p.company_id=m.company_id AND p.message_id=m.id").Where("m.company_id=? AND m.conversation_id=? AND m.sequence>=? AND m.removed=?", a.CompanyID, a.Conversation.ID, a.HistoryFromSequence, false).Order("p.created_at DESC").Limit(100).Find(&rows).Error; e != nil {
			return e
		}
		for i, m := range rows {
			rows[i] = projectMessage(tx, a, m)
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"messages": rows})
}
func (s *Server) communicationThread(w http.ResponseWriter, r *http.Request) error {
	var root Message
	rows := []Message{}
	reactions := []CommunicationReaction{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		m, e := scopedMessage(tx, a, r.PathValue("mid"))
		if e != nil {
			return e
		}
		if m.Removed {
			return missing()
		}
		root = projectMessage(tx, a, m)
		if e := tx.Where("company_id=? AND conversation_id=? AND reply_to_id=? AND sequence>=?", a.CompanyID, a.Conversation.ID, m.ID, a.HistoryFromSequence).Order("sequence DESC").Limit(100).Find(&rows).Error; e != nil {
			return e
		}
		for i, m := range rows {
			rows[i] = projectMessage(tx, a, m)
		}
		return tx.Where("company_id=? AND conversation_id=? AND message_id=?", a.CompanyID, a.Conversation.ID, root.ID).Find(&reactions).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"root": root, "messages": rows, "reactions": reactions})
}
func verifyMentions(tx *gorm.DB, a *conversationScope, input SendMessageInput) error {
	if len(input.MentionIDs) > 100 {
		return invalid("Mention at most 100 current participants.")
	}
	seen := map[string]bool{}
	for _, uid := range input.MentionIDs {
		if seen[uid] {
			return invalid("Mention recipients must be unique.")
		}
		seen[uid] = true
		scope, e := conversationAccess(tx, uid, a.CompanyID, a.Conversation.ID)
		if e != nil || scope.HistoryFromSequence > a.Conversation.NextSequence+1 {
			return invalid("Mention only current conversation participants.")
		}
	}
	if input.MentionAll {
		if !a.canManage() {
			return denied()
		}
		var count int64
		if e := tx.Model(&Message{}).Where("company_id=? AND conversation_id=? AND mention_all=? AND created_at>?", a.CompanyID, a.Conversation.ID, true, time.Now().UTC().Add(-5*time.Minute).Format(time.RFC3339Nano)).Count(&count).Error; e != nil {
			return e
		}
		if count > 0 {
			return &apiError{429, "mention_rate", "Group-wide mentions are limited to one every five minutes.", nil}
		}
	}
	return nil
}
func (s *Server) communicationAttention(w http.ResponseWriter, r *http.Request) error {
	type Attention struct {
		ConversationID string `json:"conversationId"`
		Unread         int64  `json:"unread"`
		ReadSequence   int64  `json:"readSequence"`
	}
	rows := []Attention{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		return tx.Table("conversations c").Select("c.id AS conversation_id,COALESCE(cm.read_sequence,0) AS read_sequence,COUNT(m.id) AS unread").Joins("LEFT JOIN conversation_members cm ON cm.company_id=c.company_id AND cm.conversation_id=c.id AND cm.user_id=?", a.UserID).Joins("LEFT JOIN messages m ON m.company_id=c.company_id AND m.conversation_id=c.id AND m.removed=? AND m.sequence>COALESCE(cm.read_sequence,0) AND (c.public=? OR m.sequence>=cm.history_from_sequence)", false, true).Where("c.company_id=? AND (c.public=? OR cm.active=?)", a.CompanyID, true, true).Group("c.id,cm.read_sequence").Order("c.id").Limit(100).Scan(&rows).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"conversations": rows})
}
func (s *Server) communicationControlRoutes() {
	s.route("POST /api/companies/{cid}/communication/blocks", s.blockCommunicationUser)
	s.route("GET /api/companies/{cid}/communication/attention", s.communicationAttention)
	s.route("POST /api/companies/{cid}/conversations/{id}/messages/{mid}/pin", s.pinCommunicationMessage)
	s.route("GET /api/companies/{cid}/conversations/{id}/pins", s.listCommunicationPins)
	s.route("GET /api/companies/{cid}/conversations/{id}/messages/{mid}/thread", s.communicationThread)
}
