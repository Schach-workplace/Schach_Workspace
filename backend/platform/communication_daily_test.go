package platform

import (
	"testing"
)

func TestSearchAndBookmarksRespectRejoinHistory(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, mc, cid, id, "saved", "Confidential needle")
	root := "/api/companies/" + cid
	st, _, _ := req(t, s, "POST", root+"/conversations/"+id+"/messages/"+m["id"].(string)+"/save", map[string]any{"saved": true}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, b, _ := req(t, s, "GET", root+"/communication/search?q=needle", nil, mc)
	if st != 200 || len(b["messages"].([]any)) != 1 {
		t.Fatalf("search %d %v", st, b)
	}
	for i, active := range []bool{false, true} {
		st, _, _ = req(t, s, "POST", root+"/conversations/"+id+"/members", map[string]any{"expectedVersion": i + 1, "userId": uid, "role": "member", "active": active}, c)
		if st != 200 {
			t.Fatal(st)
		}
	}
	st, b, _ = req(t, s, "GET", root+"/communication/search?q=needle", nil, mc)
	if st != 200 || len(b["messages"].([]any)) != 0 {
		t.Fatal("old search leaked")
	}
	st, b, _ = req(t, s, "GET", root+"/communication/saved", nil, mc)
	if st != 200 || len(b["messages"].([]any)) != 0 {
		t.Fatal("old bookmark leaked")
	}
}
