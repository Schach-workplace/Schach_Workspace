package platform

import (
	"fmt"
	"net/http"
	"testing"
)

func conversationFixture(t *testing.T) (*Server, *http.Cookie, string, string, string, *http.Cookie) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := me(t, s, c)
	uid := addPerson(t, s, c, cid, "member@example.com", "member")
	mc := login(t, s, "member@example.com")
	return s, c, cid, owner, uid, mc
}
func newConversation(t *testing.T, s *Server, c *http.Cookie, cid string, members []string, kind string) string {
	t.Helper()
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/conversations", map[string]any{"title": "Private coordination", "kind": kind, "participantIds": members}, c)
	if st != 200 {
		t.Fatalf("conversation %d %s", st, w.Body.String())
	}
	return b["id"].(string)
}
func TestConversationCompanyAndPrivateMetadataIsolation(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	outsider := addPerson(t, s, c, cid, "admin@example.com", "admin")
	_ = outsider
	ac := login(t, s, "admin@example.com")
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	for _, cookie := range []*http.Cookie{ac, nil} {
		st, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/conversations/"+id, nil, cookie)
		if cookie == nil {
			if st != 401 {
				t.Fatal(st)
			}
		} else if st != 404 || b["title"] != nil {
			t.Fatalf("private metadata %d %v", st, b)
		}
	}
	st, _, _ := req(t, s, "GET", "/api/companies/foreign/conversations/"+id, nil, mc)
	if st != 404 {
		t.Fatalf("foreign %d", st)
	}
	st, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/conversations", nil, ac)
	if st != 200 || len(b["conversations"].([]any)) != 0 {
		t.Fatalf("private list %d %v", st, b)
	}
}
func TestViewerCannotPostOrManage(t *testing.T) {
	s, c, cid, owner, _, _ := conversationFixture(t)
	v := addPerson(t, s, c, cid, "viewer@example.com", "viewer")
	vc := login(t, s, "viewer@example.com")
	id := newConversation(t, s, c, cid, []string{owner, v}, "group")
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations", map[string]any{"title": "x", "kind": "group", "participantIds": []string{v}}, vc)
	if st != 403 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", "/api/companies/"+cid+"/conversations/"+id, map[string]any{"expectedVersion": 1, "archived": true}, vc)
	if st != 403 {
		t.Fatal(st)
	}
}
func TestDMCompanyPairUnique(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "dm")
	id2 := newConversation(t, s, mc, cid, []string{uid, owner}, "dm")
	if id != id2 {
		t.Fatalf("duplicate DM %s %s", id, id2)
	}
}

func TestBlockBeforeDMCreationPreventsNewPair(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	financeOK(t, s, "POST", "/api/companies/"+cid+"/communication/blocks", map[string]any{"userId": uid, "blocked": true}, c)
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations", map[string]any{"title": "Blocked pair", "kind": "dm", "participantIds": []string{owner}}, mc)
	if st != 403 {
		t.Fatalf("blocked new DM %d", st)
	}
	var n int64
	s.db.Model(&Conversation{}).Where("company_id=? AND kind='dm'", cid).Count(&n)
	if n != 0 {
		t.Fatal("blocked DM persisted")
	}
}
func TestJoinRejoinHistoryBoundary(t *testing.T) {
	s, c, cid, owner, uid, _ := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	if e := s.db.Model(&Conversation{}).Where("id = ?", id).Update("next_sequence", 7).Error; e != nil {
		t.Fatal(e)
	}
	for i, active := range []bool{false, true} {
		st, _, w := req(t, s, "POST", fmt.Sprintf("/api/companies/%s/conversations/%s/members", cid, id), map[string]any{"expectedVersion": i + 1, "userId": uid, "role": "member", "active": active}, c)
		if st != 200 {
			t.Fatalf("membership %d %s", st, w.Body.String())
		}
	}
	scope, e := conversationAccess(s.db, uid, cid, id)
	if e != nil || scope.HistoryFromSequence != 8 {
		t.Fatalf("history %v %v", scope, e)
	}
}
func TestRevocationWinsAfterCommit(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": false}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/conversations/"+id, nil, mc)
	if st != 401 {
		t.Fatalf("revoked session %d", st)
	}
}

func TestCompanyReactivationDoesNotRestorePrivateHistory(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	for _, active := range []bool{false, true} {
		st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": active}, c)
		if st != 200 {
			t.Fatalf("company membership %d %s", st, w.Body.String())
		}
	}
	st, _, _ := req(t, s, "GET", "/api/companies/"+cid+"/conversations/"+id, nil, mc)
	if st != 401 {
		t.Fatalf("rejoin restored old account session: %d", st)
	}
	mc = login(t, s, "member@example.com")
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/conversations/"+id, nil, mc)
	if st != 404 {
		t.Fatalf("private membership restored %d", st)
	}
}
