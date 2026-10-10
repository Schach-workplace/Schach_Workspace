package platform

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type Message struct {
	ContentPurged   bool     `json:"-"`
	MentionIDs      []string `json:"mentionIds" gorm:"serializer:json;type:jsonb"`
	MentionAll      bool     `json:"mentionAll"`
	MediaIDs        []string `json:"mediaIds" gorm:"serializer:json;type:jsonb"`
	ID              string   `json:"id" gorm:"primaryKey;size:80"`
	CompanyID       string   `json:"-" gorm:"index;uniqueIndex:message_send;uniqueIndex:message_order"`
	ConversationID  string   `json:"conversationId" gorm:"index;uniqueIndex:message_send;uniqueIndex:message_order"`
	SenderID        string   `json:"senderId" gorm:"uniqueIndex:message_send"`
	ClientMessageID string   `json:"clientMessageId" gorm:"uniqueIndex:message_send"`
	RequestHash     string   `json:"-"`
	Body            string   `json:"body"`
	ReplyToID       string   `json:"replyToId"`
	Sequence        int64    `json:"sequence" gorm:"uniqueIndex:message_order"`
	Revision        int64    `json:"revision"`
	Removed         bool     `json:"removed"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}
type MessageRevision struct {
	CompanyID      string `json:"-"`
	ConversationID string `json:"conversationId"`
	MessageID      string `json:"messageId" gorm:"primaryKey;size:80"`
	Revision       int64  `json:"revision" gorm:"primaryKey"`
	Body           string `json:"body"`
	Removed        bool   `json:"removed"`
	CreatedAt      string `json:"createdAt"`
}
type SendMessageInput struct {
	MentionIDs      []string `json:"mentionIds"`
	MentionAll      bool     `json:"mentionAll"`
	MediaIDs        []string `json:"mediaIds"`
	ClientMessageID string   `json:"clientMessageId"`
	Body            string   `json:"body"`
	ReplyToID       string   `json:"replyToId"`
}

func payloadHash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func validateMessageBody(body string) error {
	if !utf8.ValidString(body) || strings.TrimSpace(body) == "" || utf8.RuneCountInString(body) > 10000 {
		return invalid("Messages require 1–10,000 Unicode characters.")
	}
	return nil
}
func scopedMessage(tx *gorm.DB, a *conversationScope, id string) (Message, error) {
	var m Message
	e := tx.Where("company_id = ? AND conversation_id = ? AND id = ? AND sequence >= ?", a.CompanyID, a.Conversation.ID, id, a.HistoryFromSequence).First(&m).Error
	if e == gorm.ErrRecordNotFound {
		return m, missing()
	}
	return m, e
}
func projectMessage(tx *gorm.DB, a *conversationScope, m Message) Message {
	if m.Removed {
		m.Body = ""
		m.ReplyToID = ""
		m.MediaIDs = []string{}
		m.MentionIDs = []string{}
		m.MentionAll = false
	}
	if m.ReplyToID != "" {
		parent, e := scopedMessage(tx, a, m.ReplyToID)
		if e != nil || parent.Removed {
			m.ReplyToID = ""
		}
	}
	return m
}
func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request) error {
	var input SendMessageInput
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !clean(input.ClientMessageID, 100) {
		return invalid("A durable client message ID up to 100 characters is required.")
	}
	if input.MentionIDs == nil {
		input.MentionIDs = []string{}
	}
	if input.MediaIDs == nil {
		input.MediaIDs = []string{}
	}
	if len(input.MediaIDs) > 10 {
		return invalid("Attach at most 10 media objects.")
	}
	if e := validateMessageBody(input.Body); e != nil {
		return e
	}
	var result Message
	e := s.withCommunicationTransaction(r, input.MentionIDs, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		var old Message
		e := tx.Where("company_id = ? AND conversation_id = ? AND sender_id = ? AND client_message_id = ?", a.CompanyID, a.Conversation.ID, a.UserID, input.ClientMessageID).First(&old).Error
		if e == nil {
			if old.RequestHash != payloadHash(input) {
				return conflict()
			}
			if old.Sequence < a.HistoryFromSequence {
				return missing()
			}
			result = projectMessage(tx, a, old)
			return nil
		}
		if e != gorm.ErrRecordNotFound {
			return e
		}
		if e := verifyMentions(tx, a, input); e != nil {
			return e
		}
		if input.ReplyToID != "" {
			parent, e := scopedMessage(tx, a, input.ReplyToID)
			if e != nil {
				return e
			}
			if parent.Removed {
				return missing()
			}
		}
		media := []CommunicationMedia{}
		seen := map[string]bool{}
		for _, id := range input.MediaIDs {
			if seen[id] {
				return invalid("Media references must be unique.")
			}
			seen[id] = true
			m, e := s.media(tx, a, id)
			if e != nil {
				return e
			}
			if m.UserID != a.UserID || m.MessageID != "" || m.State != "clean" {
				return missing()
			}
			media = append(media, m)
		}

		result = Message{MentionIDs: input.MentionIDs, MentionAll: input.MentionAll, MediaIDs: input.MediaIDs, ID: newID("msg"), CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, SenderID: a.UserID, ClientMessageID: input.ClientMessageID, RequestHash: payloadHash(input), Body: input.Body, ReplyToID: input.ReplyToID, Sequence: a.Conversation.NextSequence + 1, Revision: 1, CreatedAt: nowString(), UpdatedAt: nowString()}
		if e := tx.Create(&result).Error; e != nil {
			return e
		}
		for _, m := range media {
			if e := tx.Model(&CommunicationMedia{}).Where("company_id=? AND id=?", a.CompanyID, m.ID).Updates(map[string]any{"message_id": result.ID, "history_sequence": result.Sequence, "expires_at": time.Now().UTC().AddDate(0, 0, s.opts.MediaRetentionDays).Format(time.RFC3339Nano)}).Error; e != nil {
				return e
			}
		}

		if e := tx.Create(&MessageRevision{CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, MessageID: result.ID, Revision: 1, Body: result.Body, CreatedAt: result.CreatedAt}).Error; e != nil {
			return e
		}
		a.Conversation.NextSequence = result.Sequence
		return appendCommunicationEvent(tx, a, "message_created", result.ID, result.Sequence)
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"message": result})
}
func (s *Server) editMessage(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		ExpectedRevision int64   `json:"expectedRevision"`
		Body             *string `json:"body"`
		Removed          bool    `json:"removed"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	var result Message
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		m, e := scopedMessage(tx, a, r.PathValue("mid"))
		if e != nil {
			return e
		}
		if m.SenderID != a.UserID && !(input.Removed && a.canManage()) {
			return denied()
		}
		if m.Removed {
			return missing()
		}
		if input.ExpectedRevision != m.Revision {
			return conflict()
		}
		kind := "message_edited"
		if input.Removed {
			m.Body = ""
			m.Removed = true
			kind = "message_removed"
		} else {
			if input.Body == nil {
				return invalid("Supply a message body.")
			}
			if e := validateMessageBody(*input.Body); e != nil {
				return e
			}
			m.Body = *input.Body
		}
		m.Revision++
		m.UpdatedAt = nowString()
		if e := tx.Save(&m).Error; e != nil {
			return e
		}
		if e := tx.Create(&MessageRevision{CompanyID: a.CompanyID, ConversationID: m.ConversationID, MessageID: m.ID, Revision: m.Revision, Body: m.Body, Removed: m.Removed, CreatedAt: m.UpdatedAt}).Error; e != nil {
			return e
		}
		result = projectMessage(tx, a, m)
		return appendCommunicationEvent(tx, a, kind, m.ID, m.Sequence)
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"message": result})
}
