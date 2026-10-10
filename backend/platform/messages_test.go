package platform

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
)

func sendMessage(t *testing.T, s *Server, c *http.Cookie, cid, id, key, body string) map[string]any {
	t.Helper()
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/messages", map[string]any{"clientMessageId": key, "body": body}, c)
	if st != 200 {
		t.Fatalf("send %d %s", st, w.Body.String())
	}
	return b["message"].(map[string]any)
}
func TestMessageRetryPayloadConflict(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	a := sendMessage(t, s, mc, cid, id, "one", "Keep private")
	b := sendMessage(t, s, mc, cid, id, "one", "Keep private")
	if a["id"] != b["id"] {
		t.Fatal("duplicate send")
	}
	path := "/api/companies/" + cid + "/conversations/" + id + "/messages"
	st, _, _ := req(t, s, "POST", path, map[string]any{"clientMessageId": "one", "body": "changed"}, mc)
	if st != 409 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "member", "active": false}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "POST", path, map[string]any{"clientMessageId": "one", "body": "Keep private"}, mc)
	if st != 404 {
		t.Fatalf("revoked replay %d", st)
	}
}
func TestAcceptedSendSurvivesRestart(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	a := sendMessage(t, s, mc, cid, id, "restart", "Durable")
	next, e := New(s.db, s.opts)
	if e != nil {
		t.Fatal(e)
	}
	b := sendMessage(t, next, mc, cid, id, "restart", "Durable")
	if a["id"] != b["id"] {
		t.Fatal("restart lost ACK")
	}
}
func TestConversationSequenceConcurrentSend(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	var wg sync.WaitGroup
	start := make(chan struct{})
	codes := make(chan int, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/messages", map[string]any{"clientMessageId": fmt.Sprint(i), "body": "Concurrent"}, mc)
			codes <- st
		}(i)
	}
	close(start)
	wg.Wait()
	close(codes)
	for st := range codes {
		if st != 200 {
			t.Fatal(st)
		}
	}
	st, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/conversations/"+id+"/messages", nil, c)
	if st != 200 {
		t.Fatal(st)
	}
	seen := map[float64]bool{}
	for _, m := range b["messages"].([]any) {
		seq := m.(map[string]any)["sequence"].(float64)
		if seen[seq] {
			t.Fatal("duplicate order")
		}
		seen[seq] = true
	}
	if len(seen) != 8 {
		t.Fatal(seen)
	}
}
func TestSyncEditsRemovalsAndStaleCursor(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, mc, cid, id, "edit", "Before")
	path := "/api/companies/" + cid + "/conversations/" + id
	mid := m["id"].(string)
	_, b, _ := req(t, s, "GET", path+"/sync", nil, c)
	cursor := b["cursor"].(string)
	st, _, _ := req(t, s, "PATCH", path+"/messages/"+mid, map[string]any{"expectedRevision": 1, "body": "After"}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, b, _ = req(t, s, "GET", path+"/sync?cursor="+cursor, nil, c)
	if st != 200 || len(b["events"].([]any)) != 1 {
		t.Fatalf("sync %d %v", st, b)
	}
	st, _, _ = req(t, s, "PATCH", path+"/messages/"+mid, map[string]any{"expectedRevision": 1, "body": "Stale"}, mc)
	if st != 409 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", path+"/messages/"+mid, map[string]any{"expectedRevision": 2, "removed": true}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, b, _ = req(t, s, "GET", path+"/messages", nil, c)
	if st != 200 || b["messages"].([]any)[0].(map[string]any)["body"] != "" {
		t.Fatalf("tombstone %d %v", st, b)
	}
}
