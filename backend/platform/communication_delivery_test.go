package platform

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOutboxCommitRollbackAndWorkerRetry(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	var count int64
	e := s.db.Transaction(func(tx *gorm.DB) error {
		a, e := conversationAccess(tx, uid, cid, id)
		if e != nil {
			return e
		}
		if e = appendCommunicationEvent(tx, a, "test", "", 0); e != nil {
			return e
		}
		return errors.New("rollback")
	})
	if e == nil {
		t.Fatal("rollback missing")
	}
	s.db.Model(&CommunicationEvent{}).Count(&count)
	if count != 0 {
		t.Fatal("event survived rollback")
	}
	sendMessage(t, s, mc, cid, id, "worker", "Private delivery")
	n, e := s.RunCommunicationOutbox(t.Context(), 100)
	if e != nil || n != 1 {
		t.Fatalf("worker %d %v", n, e)
	}
	n, e = s.RunCommunicationOutbox(t.Context(), 100)
	if e != nil || n != 0 {
		t.Fatalf("duplicate worker %d %v", n, e)
	}
	s.db.Model(&CommunicationInbox{}).Count(&count)
	if count != 2 {
		t.Fatalf("intents %d", count)
	}
	// A dead lease is reclaimed; a removed recipient gets no new intent.
	sendMessage(t, s, mc, cid, id, "lost-worker", "Retry delivery")
	past := time.Now().UTC().Add(-time.Second)
	if e = s.db.Model(&CommunicationOutbox{}).Where("delivered = ?", false).Updates(map[string]any{"lease_token": "dead", "lease_until": past}).Error; e != nil {
		t.Fatal(e)
	}
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "member", "active": false}, c)
	if st != 200 {
		t.Fatal(st)
	}
	n, e = s.RunCommunicationOutbox(t.Context(), 100)
	if e != nil || n != 2 {
		t.Fatalf("reclaimed %d %v", n, e)
	}
	s.db.Model(&CommunicationInbox{}).Where("user_id = ?", uid).Count(&count)
	if count != 1 {
		t.Fatalf("removed delivery %d", count)
	}
}
func TestStreamRevocationAndOrigin(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	server := httptest.NewServer(s)
	defer server.Close()
	path := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/companies/" + cid + "/conversations/" + id + "/stream"
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
	defer cancel()
	headers := http.Header{"Cookie": []string{mc.String()}, "Origin": []string{"http://evil.invalid"}}
	conn, response, e := websocket.Dial(ctx, path, &websocket.DialOptions{HTTPHeader: headers})
	if e == nil {
		conn.CloseNow()
		t.Fatal("hostile origin accepted")
	}
	if response == nil || response.StatusCode != 403 {
		t.Fatalf("origin response %v", response)
	}
	headers.Set("Origin", server.URL)
	conn, _, e = websocket.Dial(ctx, path, &websocket.DialOptions{HTTPHeader: headers})
	if e != nil {
		t.Fatal(e)
	}
	defer conn.CloseNow()
	if _, _, e = conn.Read(ctx); e != nil {
		t.Fatal(e)
	}
	sendMessage(t, s, c, cid, id, "metric-stream-hint", "Scoped event hint")
	_, hint, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var event map[string]any
	if err = json.Unmarshal(hint, &event); err != nil || event["eventKind"] != "message_created" {
		t.Fatal("sanitized outbox kind", string(hint), err)
	}
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "member", "active": false}, c)
	if st != 200 {
		t.Fatal(st)
	}
	_, _, e = conn.Read(ctx)
	if websocket.CloseStatus(e) != websocket.StatusPolicyViolation {
		t.Fatalf("revoked socket %v", e)
	}
}
func TestChatDoesNotWaitForBusinessCompanyLock(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	if s.db.Dialector.Name() != "postgres" {
		t.Skip("Requires native separate connections")
	}
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	tx := s.db.Begin()
	defer tx.Rollback()
	if e := lockCompany(tx, cid); e != nil {
		t.Fatal(e)
	}
	done := make(chan int, 1)
	go func() {
		st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/messages", map[string]any{"clientMessageId": "independent", "body": "No company lock"}, mc)
		done <- st
	}()
	select {
	case st := <-done:
		if st != 200 {
			t.Fatal(st)
		}
	case <-time.After(3 * time.Second):
		var blockers []struct {
			Query     string
			WaitEvent string
		}
		s.db.Raw("SELECT query, wait_event FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'").Scan(&blockers)
		t.Fatalf("Chat waited for company business lock: %+v", blockers)
	}
}
func TestInboxProjectsSanitizedEventKind(t *testing.T) {
	s, c, cid, owner, uid, member := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	sendMessage(t, s, c, cid, id, "hint-inbox", "private body")
	if _, e := s.RunCommunicationOutbox(t.Context(), 100); e != nil {
		t.Fatal(e)
	}
	status, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/communication/inbox", nil, member)
	if status != 200 {
		t.Fatal(status, b)
	}
	rows := b["events"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["kind"] != "message_created" {
		t.Fatal(rows)
	}
}
