package platform

import (
	"encoding/base64"
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
)

type communicationCursor struct {
	Company      string `json:"c"`
	User         string `json:"u"`
	Conversation string `json:"v"`
	Epoch        int64  `json:"e"`
	Version      int64  `json:"p"`
	After        int64  `json:"a"`
	Kind         string `json:"k"`
}

func makeCommunicationCursor(a *conversationScope, after int64, kind string) string {
	b, _ := json.Marshal(communicationCursor{a.CompanyID, a.UserID, a.Conversation.ID, a.Epoch, a.Version, after, kind})
	return base64.RawURLEncoding.EncodeToString(b)
}
func parseCommunicationCursor(a *conversationScope, raw, kind string) (int64, error) {
	if raw == "" {
		return 0, nil
	}
	var c communicationCursor
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil || len(b) > 2048 {
		return 0, invalid("Invalid communication cursor.")
	}
	if e = json.Unmarshal(b, &c); e != nil {
		return 0, invalid("Invalid communication cursor.")
	}
	if c.Company != a.CompanyID || c.User != a.UserID || c.Conversation != a.Conversation.ID || c.Epoch != a.Epoch || c.Version != a.Version || c.Kind != kind || c.After < 0 {
		return 0, &apiError{409, "refetch_required", "Permissions or history changed. Fetch current authorized history again.", nil}
	}
	return c.After, nil
}
func (s *Server) listMessages(w http.ResponseWriter, r *http.Request) error {
	rows := []Message{}
	cursor := ""
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		after, e := parseCommunicationCursor(a, r.URL.Query().Get("cursor"), "messages")
		if e != nil {
			return e
		}
		if after == 0 {
			after = a.Conversation.NextSequence + 1
		}
		if e := tx.Where("company_id = ? AND conversation_id = ? AND sequence >= ? AND sequence < ?", a.CompanyID, a.Conversation.ID, a.HistoryFromSequence, after).Order("sequence DESC").Limit(100).Find(&rows).Error; e != nil {
			return e
		}
		for i, m := range rows {
			rows[i] = projectMessage(tx, a, m)
			after = m.Sequence
		}
		for left, right := 0, len(rows)-1; left < right; left, right = left+1, right-1 {
			rows[left], rows[right] = rows[right], rows[left]
		}
		cursor = makeCommunicationCursor(a, after, "messages")
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"messages": rows, "cursor": cursor, "hasMore": len(rows) == 100})
}
func (s *Server) syncCommunication(w http.ResponseWriter, r *http.Request) error {
	rows := []CommunicationEvent{}
	cursor := ""
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		after, e := parseCommunicationCursor(a, r.URL.Query().Get("cursor"), "events")
		if e != nil {
			return e
		}
		if e := tx.Where("company_id = ? AND conversation_id = ? AND sequence > ? AND (message_sequence = 0 OR message_sequence >= ?)", a.CompanyID, a.Conversation.ID, after, a.HistoryFromSequence).Order("sequence").Limit(100).Find(&rows).Error; e != nil {
			return e
		}
		for _, event := range rows {
			after = event.Sequence
		}
		if len(rows) < 100 {
			after = a.Conversation.NextEvent
		}
		cursor = makeCommunicationCursor(a, after, "events")
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"events": rows, "cursor": cursor, "hasMore": len(rows) == 100})
}
