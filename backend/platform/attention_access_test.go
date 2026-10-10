package platform

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func attentionFixture(t *testing.T) (*Server, *http.Cookie, string, string, string) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	id := createTask(t, s, c, cid, taskBody(uid))
	if e := db.Create(&AttentionItem{ID: "attention-test", CompanyID: cid, RecipientID: uid, SourceKind: "task", SourceID: id, OccurrenceKey: "test", Kind: "update", State: "open", Version: 1, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Error; e != nil {
		t.Fatal(e)
	}
	return s, c, cid, uid, id
}
func TestAttentionScopesAndRevocation(t *testing.T) {
	s, c, cid, uid, id := attentionFixture(t)
	st, _, w := req(t, s, "GET", "/api/companies/"+cid+"/attention/attention-test", nil, c)
	if st != 200 {
		t.Fatalf("detail %d %s", st, w.Body.String())
	}
	other := addPerson(t, s, c, cid, "attention-other@example.com", "member")
	oc := login(t, s, "attention-other@example.com")
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/attention/attention-test", nil, oc)
	if st != 404 {
		t.Fatalf("other %d", st)
	}
	s.db.Model(&AttentionItem{}).Where("id=?", "attention-test").Update("recipient_id", other)
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/attention/attention-test", nil, oc)
	if st != 404 {
		t.Fatalf("unshared %d", st)
	}
	s.db.Model(&Task{}).Where("id=?", id).Update("collaborators", `["`+other+`"]`)
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/attention/attention-test", nil, oc)
	if st != 200 {
		t.Fatalf("shared %d", st)
	}
	s.db.Model(&Task{}).Where("id=?", id).Update("collaborators", `[]`)
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/attention/attention-test", nil, oc)
	if st != 404 {
		t.Fatalf("revoked %d", st)
	}
	dep := Department{ID: "attention-dept", CompanyID: cid, Name: "Attention"}
	if e := s.db.Create(&dep).Error; e != nil {
		t.Fatal(e)
	}
	conv := newConversation(t, s, c, cid, []string{uid, other}, "group")
	msg := sendMessage(t, s, c, cid, conv, "text", "PRIVATE SOURCE")
	intake := CommunicationRequest{DepartmentID: dep.ID, CreatedBy: uid, RetryKey: "published", RequestHash: "test", ID: "published-test", CompanyID: cid, ConversationID: conv, AnchorMessageID: msg["id"].(string), SourceRevision: 1, Title: "Published", Summary: "Published summary", State: "open", Version: 3}
	if e := s.db.Create(&intake).Error; e != nil {
		t.Fatal(e)
	}
	if e := s.db.Create(&AttentionItem{ID: "intake-test", CompanyID: cid, RecipientID: uid, SourceKind: "intake", SourceID: intake.ID, SourceRevision: 99, ConversationID: intake.ConversationID, AnchorMessageID: intake.AnchorMessageID, MessageSequence: 42, OccurrenceKey: "test", Kind: "intake_triage", State: "open", Version: 1}).Error; e != nil {
		t.Fatal(e)
	}
	st, b, w := req(t, s, "GET", "/api/companies/"+cid+"/attention/intake-test", nil, c)
	if st != 200 {
		t.Fatalf("intake %d %s", st, w.Body.String())
	}
	for _, secret := range []string{conv, msg["id"].(string), "sourceRevision", "messageSequence", "anchorMessageId", "conversationId"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatalf("leak %s %s", secret, w.Body.String())
		}
	}
	if b["item"].(map[string]any)["sourceVersion"] != float64(3) {
		t.Fatal(b)
	}
}
func TestAttentionPaginationScopesBeforeLimit(t *testing.T) {
	s, c, cid, uid, _ := attentionFixture(t)
	for i := 0; i < 101; i++ {
		a := AttentionItem{ID: newID("hidden"), CompanyID: cid, RecipientID: uid, SourceKind: "record", SourceID: newID("record"), OccurrenceKey: "test", Kind: "decision", State: "open", Version: 1, CreatedAt: time.Now().UTC()}
		if e := s.db.Create(&a).Error; e != nil {
			t.Fatal(e)
		}
	}
	st, b, w := req(t, s, "GET", "/api/companies/"+cid+"/attention?limit=1", nil, c)
	if st != 200 || len(b["items"].([]any)) != 1 {
		t.Fatalf("reachable %d %s", st, w.Body.String())
	}
}
func TestAttentionPublishedIntakeDetailIndependentOfPrivateSource(t *testing.T) {
	s, c, cid, uid, _ := attentionFixture(t)
	member := addPerson(t, s, c, cid, "published-private@example.com", "member")
	conv := newConversation(t, s, c, cid, []string{uid, member}, "group")
	msg := sendMessage(t, s, c, cid, conv, "text", "Private source")
	dep := Department{ID: "published-dep", CompanyID: cid, Name: "Published"}
	if e := s.db.Create(&dep).Error; e != nil {
		t.Fatal(e)
	}
	item := CommunicationRequest{ID: "published-detail", CompanyID: cid, DepartmentID: dep.ID, ConversationID: conv, AnchorMessageID: msg["id"].(string), SourceRevision: 1, CreatedBy: member, RetryKey: "published-detail", RequestHash: "test", Title: "Published title", Summary: "Published only", State: "open", Version: 2}
	if e := s.db.Create(&item).Error; e != nil {
		t.Fatal(e)
	}
	leader := addPerson(t, s, c, cid, "published-leader@example.com", "admin")
	lc := login(t, s, "published-leader@example.com")
	st, _, w := req(t, s, "GET", "/api/companies/"+cid+"/communication/requests/"+item.ID, nil, lc)
	if st != 200 {
		t.Fatalf("published detail %d %s", st, w.Body.String())
	}
	for _, secret := range []string{conv, msg["id"].(string), "sourceRevision", "conversationId", "anchorMessageId"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatalf("intake detail leak %s", secret)
		}
	}
	if e := s.db.Create(&AttentionItem{ID: "leader-intake", CompanyID: cid, RecipientID: leader, SourceKind: "intake", SourceID: item.ID, SourceRevision: 99, ConversationID: conv, AnchorMessageID: item.AnchorMessageID, MessageSequence: 1, OccurrenceKey: "published", Kind: "intake_triage", State: "open", Version: 1}).Error; e != nil {
		t.Fatal(e)
	}
	st, _, w = req(t, s, "GET", "/api/companies/"+cid+"/attention/leader-intake", nil, lc)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	for _, secret := range []string{conv, msg["id"].(string), "sourceRevision", "conversationId", "anchorMessageId"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatal("attention intake leak", secret)
		}
	}
}
