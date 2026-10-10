package platform

import "testing"

// A person picker must work without naming a DM, from either side, on retries.
func TestNamelessDMReopensPairAndProjectsCurrentPeer(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	path := "/api/companies/" + cid + "/conversations"
	st, created, w := req(t, s, "POST", path, map[string]any{"kind": "dm", "participantIds": []string{uid}}, c)
	if st != 200 {
		t.Fatalf("nameless DM: %d %s", st, w.Body.String())
	}
	id := created["id"].(string)
	for _, attempt := range []struct{ reverse bool }{{false}, {true}, {false}} {
		cookie, peer := c, uid
		if attempt.reverse {
			cookie, peer = mc, owner
		}
		st, got, w := req(t, s, "POST", path, map[string]any{"kind": "dm", "participantIds": []string{peer}}, cookie)
		if st != 200 || got["id"] != id {
			t.Fatalf("reopen: %d %s", st, w.Body.String())
		}
		st, list, _ := req(t, s, "GET", path, nil, cookie)
		rows := list["conversations"].([]any)
		if st != 200 || len(rows) != 1 || rows[0].(map[string]any)["peerId"] != peer {
			t.Fatalf("peer projection: %d %v", st, list)
		}
		st, metadata, _ := req(t, s, "GET", path+"/"+id, nil, cookie)
		if st != 200 || metadata["conversation"].(map[string]any)["peerId"] != peer {
			t.Fatalf("metadata peer: %d %v", st, metadata)
		}
	}
	outsider := addPerson(t, s, c, cid, "outsider-dm@example.com", "admin")
	_ = outsider
	st, list, _ := req(t, s, "GET", path, nil, login(t, s, "outsider-dm@example.com"))
	if st != 200 || len(list["conversations"].([]any)) != 0 {
		t.Fatalf("private pair disclosed: %d %v", st, list)
	}
}

func TestConcurrentNamelessDMRequestsShareOnePair(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	type outcome struct {
		status int
		id     any
	}
	start := make(chan struct{})
	results := make(chan outcome, 8)
	for i := 0; i < 8; i++ {
		go func(reverse bool) {
			<-start
			cookie, peer := c, uid
			if reverse {
				cookie, peer = mc, owner
			}
			status, body, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations", map[string]any{"kind": "dm", "participantIds": []string{peer}}, cookie)
			results <- outcome{status, body["id"]}
		}(i%2 == 0)
	}
	close(start)
	var id any
	for i := 0; i < 8; i++ {
		result := <-results
		if result.status != 200 || result.id == nil {
			t.Fatalf("concurrent DM %v", result)
		}
		if id == nil {
			id = result.id
		}
		if id != result.id {
			t.Fatalf("duplicate DM: %v versus %v", id, result.id)
		}
	}
	var count int64
	if e := s.db.Model(&Conversation{}).Where("company_id=? AND kind=?", cid, "dm").Count(&count).Error; e != nil || count != 1 {
		t.Fatalf("DM count %d: %v", count, e)
	}
}
