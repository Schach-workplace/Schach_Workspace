package platform

import (
	"gorm.io/gorm"
	"sync"
	"testing"
	"time"
)

func waitSignal(t *testing.T, c <-chan struct{}) {
	t.Helper()
	select {
	case <-c:
	case <-time.After(5 * time.Second):
		t.Fatal("transaction barrier timed out")
	}
}
func TestNativeSendRemovalOrdering(t *testing.T) {
	for _, sendFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "send_before_removal", false: "removal_before_send"}[sendFirst], func(t *testing.T) {
			s, c, cid, owner, uid, mc := conversationFixture(t)
			if s.db.Dialector.Name() != "postgres" {
				t.Skip("native row locks")
			}
			id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
			root := "/api/companies/" + cid
			entered := make(chan struct{})
			release := make(chan struct{})
			var once sync.Once
			if sendFirst {
				s.db.Callback().Create().After("gorm:create").Register("send_barrier", func(tx *gorm.DB) {
					if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "Message" {
						once.Do(func() { close(entered); <-release })
					}
				})
				defer s.db.Callback().Create().Remove("send_barrier")
			} else {
				s.db.Callback().Update().Before("gorm:update").Register("removal_barrier", func(tx *gorm.DB) {
					if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "Membership" {
						once.Do(func() { close(entered); <-release })
					}
				})
				defer s.db.Callback().Update().Remove("removal_barrier")
			}
			send := func() int {
				st, _, _ := req(t, s, "POST", root+"/conversations/"+id+"/messages", map[string]any{"clientMessageId": "ordered", "body": "Acknowledge only committed sends"}, mc)
				return st
			}
			remove := func() int {
				st, _, _ := req(t, s, "PATCH", root+"/people/"+uid, map[string]any{"active": false}, c)
				return st
			}
			first := make(chan int, 1)
			second := make(chan int, 1)
			if sendFirst {
				go func() { first <- send() }()
			} else {
				go func() { first <- remove() }()
			}
			waitSignal(t, entered)
			if sendFirst {
				go func() { second <- remove() }()
			} else {
				go func() { second <- send() }()
			}
			select {
			case st := <-second:
				close(release)
				t.Fatalf("later operation bypassed row lock %d", st)
			case <-time.After(200 * time.Millisecond):
			}
			close(release)
			if st := <-first; st != 200 {
				t.Fatal("first operation failed", st)
			}
			st := <-second
			if sendFirst && st != 200 || !sendFirst && st != 404 {
				t.Fatal("removal order ignored", st)
			}
			if st := send(); st != 404 {
				t.Fatal("departed send replay", st)
			}
		})
	}
}
func TestConcurrentPrimaryClaimUsesAnchorAcrossContextSelections(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	allowPublication(t, s, c, cid, id)
	a := sendMessage(t, s, mc, cid, id, "a", "Primary instruction")
	b := sendMessage(t, s, c, cid, id, "b", "Additional context")
	first := conversionInput(a, taskBody(uid), "concurrent-a")
	second := conversionInput(a, taskBody(uid), "concurrent-a-b")
	second["sources"] = []any{map[string]any{"messageId": a["id"], "revision": 1}, map[string]any{"messageId": b["id"], "revision": 1}}
	path := "/api/companies/" + cid + "/conversations/" + id + "/task-conversions"
	type result struct {
		status int
		id     any
	}
	results := make(chan result, 2)
	go func() { st, v, _ := req(t, s, "POST", path, first, mc); results <- result{st, v["id"]} }()
	go func() { st, v, _ := req(t, s, "POST", path, second, c); results <- result{st, v["id"]} }()
	left, right := <-results, <-results
	if left.status != 200 || right.status != 200 || left.id != right.id {
		t.Fatal("anchor primary duplicated", left, right)
	}
}
func TestHiddenWorkLinksAndSourceRevisionFlags(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	other := addPerson(t, s, c, cid, "other@example.com", "member")
	oc := login(t, s, "other@example.com")
	id := newConversation(t, s, c, cid, []string{owner, uid, other}, "group")
	allowPublication(t, s, c, cid, id)
	m := sendMessage(t, s, mc, cid, id, "work", "Private instruction")
	root := "/api/companies/" + cid + "/conversations/" + id
	tid := financeOK(t, s, "POST", root+"/task-conversions", conversionInput(m, taskBody(uid), "link-once"), mc)["id"].(string)
	result := financeOK(t, s, "GET", root+"/work-links", nil, oc)
	if len(result["tasks"].([]any)) != 0 {
		t.Fatal("hidden task badge")
	}
	if st, _, _ := req(t, s, "GET", root+"/work-links/"+tid+"/sources", nil, oc); st != 404 {
		t.Fatal("source-only reader got task provenance", st)
	}
	financeOK(t, s, "PATCH", root+"/messages/"+m["id"].(string), map[string]any{"expectedRevision": 1, "body": "Changed instruction"}, mc)
	sources := financeOK(t, s, "GET", root+"/work-links/"+tid+"/sources", nil, c)["sources"].([]any)
	if len(sources) != 1 || sources[0].(map[string]any)["outOfDate"] != true {
		t.Fatal("changed source silently retargeted", sources)
	}
}
