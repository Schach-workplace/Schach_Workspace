package platform

import (
	"testing"
)

func TestBlockedDMStopsSendsWithoutLeadershipBypass(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "dm")
	sendMessage(t, s, c, cid, id, "before", "Before block")
	st, _, w := req(t, s, "POST", "/api/companies/"+cid+"/communication/blocks", map[string]any{"userId": owner, "blocked": true}, mc)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/messages", map[string]any{"clientMessageId": "after", "body": "Blocked founder"}, c)
	if st != 403 {
		t.Fatal("block bypass", st)
	}
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/conversations/"+id+"/messages", nil, c)
	if st != 200 {
		t.Fatal("block erased history", st)
	}
}
func TestThreadAndPinsRespectRejoinBoundary(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	root := "/api/companies/" + cid + "/conversations/" + id
	m := sendMessage(t, s, c, cid, id, "root", "Old root")
	mid := m["id"].(string)
	st, _, _ := req(t, s, "POST", root+"/messages/"+mid+"/pin", map[string]any{"pinned": true, "expectedRevision": 1}, mc)
	if st != 403 {
		t.Fatal("member pinned", st)
	}
	st, _, w := req(t, s, "POST", root+"/messages/"+mid+"/pin", map[string]any{"pinned": true, "expectedRevision": 1}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	for i, active := range []bool{false, true} {
		st, _, _ = req(t, s, "POST", root+"/members", map[string]any{"expectedVersion": i + 1, "userId": uid, "role": "member", "active": active}, c)
		if st != 200 {
			t.Fatal(st)
		}
	}
	sendMessage(t, s, c, cid, id, "fresh", "New history")
	st, _, _ = req(t, s, "GET", root+"/messages/"+mid+"/thread", nil, mc)
	if st != 404 {
		t.Fatal("hidden root", st)
	}
	st, b, w := req(t, s, "GET", root+"/pins", nil, mc)
	if st != 200 || len(b["messages"].([]any)) != 0 {
		t.Fatal("old pin leaked", st, w.Body.String())
	}
}
