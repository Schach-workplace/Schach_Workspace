package platform

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"strings"
	"time"
)

type CommunicationBookmark struct {
	CompanyID      string `json:"-" gorm:"primaryKey;size:80"`
	UserID         string `json:"-" gorm:"primaryKey;size:80"`
	MessageID      string `json:"messageId" gorm:"primaryKey;size:80"`
	ConversationID string `json:"conversationId"`
	RemindAt       string `json:"remindAt"`
	CreatedAt      string `json:"createdAt"`
}
type CommunicationReaction struct {
	CompanyID      string `json:"-" gorm:"primaryKey;size:80"`
	ConversationID string `json:"conversationId"`
	MessageID      string `json:"messageId" gorm:"primaryKey;size:80"`
	UserID         string `json:"userId" gorm:"primaryKey;size:80"`
	Emoji          string `json:"emoji" gorm:"primaryKey;size:20"`
}

func (s *Server) searchCommunication(w http.ResponseWriter, r *http.Request) error {
	text := strings.TrimSpace(r.URL.Query().Get("q"))
	if !clean(text, 200) {
		return invalid("Search requires 1–200 characters.")
	}
	rows := []Message{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		query := tx.Table("messages AS m").Select("m.*").Joins("JOIN conversations c ON c.company_id=m.company_id AND c.id=m.conversation_id").Joins("LEFT JOIN conversation_members cm ON cm.company_id=m.company_id AND cm.conversation_id=m.conversation_id AND cm.user_id=?", a.UserID).
			Where("m.company_id=? AND m.removed=? AND (c.public=? OR (cm.active=? AND m.sequence >= cm.history_from_sequence))", a.CompanyID, false, true, true)
		if tx.Dialector.Name() == "postgres" {
			query = query.Where("to_tsvector('simple',m.body) @@ websearch_to_tsquery('simple',?)", text)
		} else {
			escaped := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(strings.ToLower(text))
			query = query.Where("lower(m.body) LIKE ? ESCAPE '\\'", "%"+escaped+"%")
		}
		if e := query.Order("m.created_at DESC,m.id").Limit(100).Find(&rows).Error; e != nil {
			return e
		}
		for i, m := range rows {
			scope, e := conversationAccess(tx, a.UserID, a.CompanyID, m.ConversationID)
			if e != nil {
				return e
			}
			rows[i] = projectMessage(tx, scope, m)
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"messages": rows})
}
func (s *Server) saveCommunicationMessage(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Saved    bool   `json:"saved"`
		RemindAt string `json:"remindAt"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if input.RemindAt != "" {
		instant, e := time.Parse(time.RFC3339, input.RemindAt)
		if e != nil || !instant.After(time.Now()) {
			return invalid("Choose a future reminder instant with an offset.")
		}
		input.RemindAt = instant.UTC().Format(time.RFC3339)
	}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		m, e := scopedMessage(tx, a, r.PathValue("mid"))
		if e != nil {
			return e
		}
		if m.Removed {
			return missing()
		}
		key := CommunicationBookmark{CompanyID: a.CompanyID, UserID: a.UserID, MessageID: m.ID, ConversationID: m.ConversationID, RemindAt: input.RemindAt, CreatedAt: nowString()}
		if !input.Saved && input.RemindAt == "" {
			return tx.Where("company_id = ? AND user_id = ? AND message_id = ?", a.CompanyID, a.UserID, m.ID).Delete(&CommunicationBookmark{}).Error
		}
		return tx.Save(&key).Error
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("mid"))
}
func (s *Server) listSavedCommunication(w http.ResponseWriter, r *http.Request) error {
	rows := []Message{}
	reminders := map[string]string{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		// Scope and history predicates precede the limit, including derived bookmarks.
		marks := []CommunicationBookmark{}
		if e := tx.Table("communication_bookmarks AS b").Select("b.*").Joins("JOIN messages m ON m.company_id=b.company_id AND m.id=b.message_id").Joins("JOIN conversations c ON c.company_id=b.company_id AND c.id=b.conversation_id").Joins("LEFT JOIN conversation_members cm ON cm.company_id=b.company_id AND cm.conversation_id=b.conversation_id AND cm.user_id=b.user_id").Where("b.company_id=? AND b.user_id=? AND m.removed=? AND (c.public=? OR (cm.active=? AND m.sequence>=cm.history_from_sequence))", a.CompanyID, a.UserID, false, true, true).Order("b.created_at DESC").Limit(100).Scan(&marks).Error; e != nil {
			return e
		}
		for _, mark := range marks {
			scope, e := conversationAccess(tx, a.UserID, a.CompanyID, mark.ConversationID)
			if e != nil {
				continue
			}
			m, e := scopedMessage(tx, scope, mark.MessageID)
			if e != nil {
				continue
			}
			rows = append(rows, projectMessage(tx, scope, m))
			reminders[m.ID] = mark.RemindAt
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"messages": rows, "reminders": reminders})
}
func (s *Server) reactCommunication(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Emoji  string `json:"emoji"`
		Active bool   `json:"active"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !in(input.Emoji, "👍", "👎", "❤️", "🎉", "✅", "👀", "❓") {
		return invalid("Choose an available reaction.")
	}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		m, e := scopedMessage(tx, a, r.PathValue("mid"))
		if e != nil {
			return e
		}
		if m.Removed {
			return missing()
		}
		reaction := CommunicationReaction{CompanyID: a.CompanyID, ConversationID: m.ConversationID, MessageID: m.ID, UserID: a.UserID, Emoji: input.Emoji}
		if input.Active {
			e = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&reaction).Error
		} else {
			e = tx.Where("company_id = ? AND message_id = ? AND user_id = ? AND emoji = ?", a.CompanyID, m.ID, a.UserID, input.Emoji).Delete(&CommunicationReaction{}).Error
		}
		if e != nil {
			return e
		}
		return appendCommunicationEvent(tx, a, "reaction_changed", m.ID, m.Sequence)
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("mid"))
}
func (s *Server) readCommunication(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Sequence int64 `json:"sequence"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if input.Sequence < 0 || input.Sequence > a.Conversation.NextSequence {
			return invalid("Read position must be within current message order.")
		}
		if !a.Conversation.Public && input.Sequence < a.HistoryFromSequence-1 {
			return missing()
		}
		var cm ConversationMember
		e := tx.First(&cm, "company_id=? AND conversation_id=? AND user_id=?", a.CompanyID, a.Conversation.ID, a.UserID).Error
		if e == gorm.ErrRecordNotFound && a.Conversation.Public {
			cm = ConversationMember{CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, UserID: a.UserID, Role: "member", Active: true, HistoryFromSequence: 1, Epoch: 1}
			if e := tx.Create(&cm).Error; e != nil {
				return e
			}
		} else if e != nil {
			return e
		}
		if input.Sequence <= cm.ReadSequence {
			return nil
		}
		return tx.Model(&ConversationMember{}).Where("company_id=? AND conversation_id=? AND user_id=?", a.CompanyID, a.Conversation.ID, a.UserID).Update("read_sequence", input.Sequence).Error
	})
	if e != nil {
		return e
	}
	return ok(w, "")
}
func (s *Server) dailyCommunicationRoutes() {
	s.route("GET /api/companies/{cid}/communication/search", s.searchCommunication)
	s.route("GET /api/companies/{cid}/communication/saved", s.listSavedCommunication)
	s.route("POST /api/companies/{cid}/conversations/{id}/messages/{mid}/save", s.saveCommunicationMessage)
	s.route("POST /api/companies/{cid}/conversations/{id}/messages/{mid}/reactions", s.reactCommunication)
	s.route("POST /api/companies/{cid}/conversations/{id}/read", s.readCommunication)
}
