package platform

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOwnerTransferRequiresActiveRecipient(t *testing.T) {
	s, c, cid, owner, uid, _ := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "owner", "active": false}, c)
	if st != 422 {
		t.Fatalf("inactive ownership transfer accepted: %d", st)
	}
	var count int64
	s.db.Model(&ConversationMember{}).Where("conversation_id=? AND role=? AND active=?", id, "owner", true).Count(&count)
	if count != 1 {
		t.Fatal("active owner lost")
	}
}
func TestHistoryStartsAtNewestMessages(t *testing.T) {
	s, c, cid, owner, uid, _ := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	for i := 1; i <= 103; i++ {
		sendMessage(t, s, c, cid, id, fmt.Sprint(i), fmt.Sprint("message ", i))
	}
	root := "/api/companies/" + cid + "/conversations/" + id + "/messages"
	st, b, _ := req(t, s, "GET", root, nil, c)
	rows := b["messages"].([]any)
	if st != 200 || len(rows) != 100 || rows[0].(map[string]any)["sequence"] != float64(4) || rows[99].(map[string]any)["sequence"] != float64(103) {
		t.Fatal("latest history missing", st)
	}
	st, b, _ = req(t, s, "GET", root+"?cursor="+b["cursor"].(string), nil, c)
	if st != 200 || len(b["messages"].([]any)) != 3 {
		t.Fatal("older page", st, b)
	}
}
func TestRecordEditStartsNewFixedAudienceRevision(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, c, cid, id, "notice", "Notice")
	root := "/api/companies/" + cid + "/conversations/" + id + "/records"
	input := map[string]any{"retryKey": "create-once", "kind": "ack", "anchorMessageId": m["id"], "sourceRevision": 1, "title": "Notice", "body": "First revision", "recipientIds": []string{uid}}
	st, b, w := req(t, s, "POST", root, input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	rid := b["id"].(string)
	st, b, _ = req(t, s, "POST", root, input, c)
	if st != 200 || b["id"] != rid {
		t.Fatal("record retry duplicated", st, b)
	}
	st, _, _ = req(t, s, "POST", root+"/"+rid+"/respond", map[string]any{"expectedRevision": 1, "response": "acknowledged"}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, w = req(t, s, "PATCH", root+"/"+rid, map[string]any{"expectedRevision": 1, "title": "Notice", "body": "Material revision", "options": []string{}, "dueAt": "", "reason": "Corrected procedure"}, c)
	if st != 200 {
		t.Fatal("revision", st, w.Body.String())
	}
	st, _, _ = req(t, s, "POST", root+"/"+rid+"/respond", map[string]any{"expectedRevision": 1, "response": "acknowledged"}, mc)
	if st != 409 {
		t.Fatal("stale acknowledgement", st)
	}
	var recipients []CommunicationRecipient
	s.db.Where("record_id=?", rid).Order("revision").Find(&recipients)
	if len(recipients) != 2 || recipients[0].Response != "acknowledged" || recipients[1].Response != "" || recipients[1].Revision != 2 || recipients[1].UserID != uid {
		t.Fatalf("audience/revision overwritten %+v", recipients)
	}
}
func TestLoginCannotMintSessionAfterSuspension(t *testing.T) {
	s, c, cid, _, uid, _ := conversationFixture(t)
	_ = c
	_ = cid
	if s.db.Dialector.Name() != "postgres" {
		t.Skip("native concurrent account locking")
	}
	tx := s.db.Begin()
	defer tx.Rollback()
	var user User
	if e := lockCommunicationRow(tx, "UPDATE").First(&user, "id=?", uid).Error; e != nil {
		t.Fatal(e)
	}
	if e := tx.Model(&user).Update("suspended", true).Error; e != nil {
		t.Fatal(e)
	}
	done := make(chan int, 1)
	go func() {
		st, _, _ := req(t, s, "POST", "/api/auth/login", map[string]any{"email": user.Email, "password": "A-strong-password!2026"}, nil)
		done <- st
	}()
	select {
	case st := <-done:
		t.Fatalf("login bypassed locked account: %d", st)
	case <-time.After(400 * time.Millisecond):
	}
	if e := tx.Commit().Error; e != nil {
		t.Fatal(e)
	}
	select {
	case st := <-done:
		if st != http.StatusUnauthorized {
			t.Fatal("suspended session minted", st)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("login hung")
	}
}

func TestEndedCallProviderCleanupRetries(t *testing.T) {
	s, c, cid, owner, uid, _ := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	attempts := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		claims, e := parseCallToken(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), "test-secret-at-least-32-characters", "test-key")
		if e != nil || claims.Video["room"] == nil {
			t.Error("provider admin room scope missing")
		}
		if attempts == 1 {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	defer provider.Close()
	s.opts.LiveKitURL = provider.URL
	s.opts.LiveKitAPIKey = "test-key"
	s.opts.LiveKitAPISecret = "test-secret-at-least-32-characters"
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/calls", map[string]any{"kind": "audio", "retryKey": "end-cleanup"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	callID := b["id"].(string)
	st, _, w = req(t, s, "POST", "/api/companies/"+cid+"/calls/"+callID+"/end", map[string]any{"expectedVersion": 1}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	n, e := s.RunCallCleanup(t.Context())
	if e == nil || n != 0 {
		t.Fatalf("expected retryable failure %d %v", n, e)
	}
	s.db.Model(&CommunicationCallJob{}).Where("call_id=?", callID).Updates(map[string]any{"lease_until": nil})
	n, e = s.RunCallCleanup(t.Context())
	if e != nil || n != 1 {
		t.Fatalf("cleanup retry %d %v", n, e)
	}
	n, e = s.RunCallCleanup(t.Context())
	if e != nil || n != 0 || attempts != 2 {
		t.Fatal("duplicate cleanup", n, e, attempts)
	}
}
