package platform

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"gorm.io/gorm"
	"net/http"
	"time"
)

// Exact scheme/host origins, unlike WebSocket library glob patterns.
func (s *Server) communicationOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") != "cross-site"
	}
	for _, allowed := range s.opts.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return origin == scheme+"://"+r.Host
}
func (s *Server) streamCommunication(w http.ResponseWriter, r *http.Request) error {
	if !s.communicationOriginAllowed(r) {
		return &apiError{403, "origin_rejected", "Request origin is not allowed.", nil}
	}
	if r.URL.Query().Has("token") {
		return invalid("Use a session cookie, never a URL token.")
	}
	if r.PathValue("id") == "" {
		r.SetPathValue("id", r.URL.Query().Get("conversationId"))
	}
	if r.PathValue("id") == "" {
		return invalid("Choose a conversation.")
	}
	var after int64
	if e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error { after = a.Conversation.NextEvent; return nil }); e != nil {
		return e
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	connection, e := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if e != nil {
		return nil
	}
	defer connection.CloseNow()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx = connection.CloseRead(ctx)
	request := r.WithContext(ctx)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	write := func(hint any) error {
		b, e := json.Marshal(hint)
		if e != nil {
			return e
		}
		bounded, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		return connection.Write(bounded, websocket.MessageText, b)
	}
	if e = write(map[string]any{"kind": "ready", "conversationId": r.PathValue("id"), "eventSequence": after}); e != nil {
		return nil
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			e = s.withCommunicationTransaction(request, nil, func(tx *gorm.DB, a *conversationScope) error {
				events := []CommunicationEvent{}
				if e := tx.Where("company_id = ? AND conversation_id = ? AND sequence > ? AND (message_sequence = 0 OR message_sequence >= ?)", a.CompanyID, a.Conversation.ID, after, a.HistoryFromSequence).Order("sequence").Limit(51).Find(&events).Error; e != nil {
					return e
				}
				if len(events) > 50 {
					_ = write(map[string]any{"kind": "refetch_required", "conversationId": a.Conversation.ID})
					return conflict()
				}
				// Enqueue/write while current membership locks are held. Removal ordered after
				// these authorized bytes may finish after them; bytes in transit are irrevocable.
				for _, event := range events {
					if e := write(map[string]any{"kind": "changed", "conversationId": event.ConversationID, "eventId": event.ID, "eventSequence": event.Sequence, "eventKind": event.Kind}); e != nil {
						return e
					}
					after = event.Sequence
				}
				if len(events) == 0 {
					after = a.Conversation.NextEvent
				}
				return nil
			})
			if e != nil {
				_ = connection.Close(websocket.StatusPolicyViolation, "Refresh current access.")
				return nil
			}
		}
	}
}
