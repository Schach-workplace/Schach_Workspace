package platform

import (
	"gorm.io/gorm"
	"sync"
	"testing"
	"time"
)

func TestAttentionTransitionRetryAndSeparation(t *testing.T) {
	s, c, cid, _, id := attentionFixture(t)
	root := "/api/companies/" + cid + "/attention/attention-test/transition"
	body := map[string]any{"expectedVersion": 1, "retryKey": "resolve-once", "action": "resolve", "reason": "Handled separately"}
	st, b, w := req(t, s, "POST", root, body, c)
	if st != 200 {
		t.Fatalf("resolve %d %s", st, w.Body.String())
	}
	v := b["resultVersion"]
	st, b, w = req(t, s, "POST", root, body, c)
	if st != 200 || b["resultVersion"] != v {
		t.Fatalf("replay %d %s", st, w.Body.String())
	}
	body["reason"] = "Changed"
	st, _, _ = req(t, s, "POST", root, body, c)
	if st != 409 {
		t.Fatalf("hash conflict %d", st)
	}
	body["retryKey"] = "new"
	body["expectedVersion"] = 2
	st, _, _ = req(t, s, "POST", root, body, c)
	if st != 409 {
		t.Fatalf("closed episode %d", st)
	}
	var task Task
	s.db.First(&task, "id=?", id)
	if task.Status != "todo" {
		t.Fatalf("business changed %s", task.Status)
	}
	var a AttentionItem
	s.db.First(&a, "id=?", "attention-test")
	if a.State != "resolved" || a.Version != 2 {
		t.Fatal(a)
	}
	s.db.Delete(&Task{}, "id=?", id)
	body["retryKey"] = "resolve-once"
	body["expectedVersion"] = 1
	body["reason"] = "Handled separately"
	st, _, _ = req(t, s, "POST", root, body, c)
	if st != 404 {
		t.Fatalf("revoked replay %d", st)
	}
}
func TestAttentionRoutingEligibility(t *testing.T) {
	s, c, cid, uid, id := attentionFixture(t)
	target := addPerson(t, s, c, cid, "attention-route@example.com", "admin")
	root := "/api/companies/" + cid + "/attention/attention-test/transition"
	body := map[string]any{"expectedVersion": 1, "retryKey": "route-once", "action": "route", "reason": "Please follow up", "recipientId": target}
	st, b, w := req(t, s, "POST", root, body, c)
	if st != 200 {
		t.Fatalf("route %d %s", st, w.Body.String())
	}
	targetItem := b["resultItemId"].(string)
	st, b, _ = req(t, s, "POST", root, body, c)
	if st != 200 || b["resultItemId"] != targetItem {
		t.Fatal(st, b)
	}
	var task Task
	s.db.First(&task, "id=?", id)
	if task.OwnerID != uid {
		t.Fatal("routing reassigned business")
	}
	var item AttentionItem
	s.db.First(&item, "id=?", targetItem)
	if item.RecipientID != target || item.State != "open" {
		t.Fatal(item)
	}
	body["recipientId"] = uid
	st, _, _ = req(t, s, "POST", root, body, c)
	if st != 409 {
		t.Fatalf("changed target %d", st)
	}
}
func TestAttentionSnoozeValidation(t *testing.T) {
	s, c, cid, _, _ := attentionFixture(t)
	root := "/api/companies/" + cid + "/attention/attention-test/transition"
	body := map[string]any{"expectedVersion": 1, "retryKey": "snooze", "action": "snooze", "snoozedUntil": time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)}
	st, _, w := req(t, s, "POST", root, body, c)
	if st != 200 {
		t.Fatalf("snooze %d %s", st, w.Body.String())
	}
	body["approval"] = "approved"
	st, _, _ = req(t, s, "POST", root, body, c)
	if st != 422 && st != 400 {
		t.Fatalf("unknown business field %d", st)
	}
}
func TestAttentionExpiredSnoozeCanonicalRetry(t *testing.T) {
	s, c, cid, _, _ := attentionFixture(t)
	at := time.Now().Add(500 * time.Millisecond).UTC()
	body := map[string]any{"expectedVersion": 1, "retryKey": "expired-snooze", "action": "snooze", "snoozedUntil": at.Format(time.RFC3339Nano)}
	root := "/api/companies/" + cid + "/attention/attention-test/transition"
	st, _, w := req(t, s, "POST", root, body, c)
	if st != 200 {
		t.Fatalf("initial %d %s", st, w.Body.String())
	}
	time.Sleep(600 * time.Millisecond)
	st, _, w = req(t, s, "POST", root, body, c)
	if st != 200 {
		t.Fatalf("canonical expired retry %d %s", st, w.Body.String())
	}
}

func TestAttentionRouteClosedTargetAndConcurrentRetry(t *testing.T) {
	s, c, cid, _, id := attentionFixture(t)
	target := addPerson(t, s, c, cid, "attention-closed-target@example.com", "admin")
	var origin AttentionItem
	s.db.First(&origin, "id=?", "attention-test")
	closed := origin
	closed.ID = "closed-target"
	closed.RecipientID = target
	closed.State = "resolved"
	closed.Version = 2
	if e := s.db.Create(&closed).Error; e != nil {
		t.Fatal(e)
	}
	root := "/api/companies/" + cid + "/attention/attention-test/transition"
	body := map[string]any{"expectedVersion": 1, "retryKey": "route-concurrent", "action": "route", "reason": "New follow-up", "recipientId": target}
	var wg sync.WaitGroup
	results := make(chan string, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, b, w := req(t, s, "POST", root, body, c)
			if st != 200 {
				t.Errorf("route %d %s", st, w.Body.String())
				return
			}
			results <- b["resultItemId"].(string)
		}()
	}
	wg.Wait()
	close(results)
	canonical := ""
	for v := range results {
		if v == closed.ID {
			t.Fatal("closed target reused")
		}
		if canonical != "" && canonical != v {
			t.Fatal("retry produced duplicate")
		}
		canonical = v
	}
	var count int64
	s.db.Model(&AttentionItem{}).Where("company_id=? AND source_id=? AND recipient_id=? AND state='open'", cid, id, target).Count(&count)
	if count != 1 {
		t.Fatalf("open targets %d", count)
	}
	if e := s.db.Transaction(func(tx *gorm.DB) error {
		return supersedeAttention(tx, cid, "task", id, "update", origin.OccurrenceKey)
	}); e != nil {
		t.Fatal(e)
	}
	var routed AttentionItem
	s.db.First(&routed, "id=?", canonical)
	if routed.State != "open" {
		t.Fatal("reconciliation superseded current route", routed.State)
	}
}
func TestAttentionCanonicalReplayAfterBusinessSupersedes(t *testing.T) {
	s, c, cid, uid, _ := attentionFixture(t)
	member := addPerson(t, s, c, cid, "attention-completion-owner@example.com", "member")
	body := taskBody(member)
	body["reviewerId"] = uid
	body["requiresApproval"] = true
	body["status"] = "in_review"
	tid := createTask(t, s, c, cid, body)
	var item AttentionItem
	s.db.First(&item, "source_id=? AND recipient_id=? AND kind='task_review'", tid, uid)
	root := "/api/companies/" + cid + "/attention/" + item.ID + "/transition"
	input := map[string]any{"expectedVersion": 1, "retryKey": "superseded-replay", "action": "resolve", "reason": "Review tracked separately"}
	st, b, w := req(t, s, "POST", root, input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	canonical := b["resultVersion"]
	st, _, w = req(t, s, "POST", "/api/companies/"+cid+"/tasks/"+tid+"/review", map[string]any{"version": 1, "decision": "approve", "comment": "Accepted"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	st, b, w = req(t, s, "POST", root, input, c)
	if st != 200 || b["resultVersion"] != canonical {
		t.Fatal("authorized superseded retry", st, w.Body.String())
	}
	input["retryKey"] = "new-after-completion"
	input["expectedVersion"] = 3
	st, _, _ = req(t, s, "POST", root, input, c)
	if st != 409 {
		t.Fatal("new completed action", st)
	}
	s.db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, uid).Update("role", "viewer")
	input["retryKey"] = "superseded-replay"
	input["expectedVersion"] = 1
	st, _, _ = req(t, s, "POST", root, input, c)
	if st != 404 && st != 403 {
		t.Fatal("revoked review authority replay", st)
	}
}
func TestAttentionRecordRoutingDoesNotAddCreatorToFixedRecipients(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, c, cid, conv, "fixed-route", "Fixed route audience")
	root := "/api/companies/" + cid + "/conversations/" + conv + "/records"
	st, b, w := req(t, s, "POST", root, map[string]any{"retryKey": "fixed-route-record", "kind": "ack", "anchorMessageId": m["id"], "sourceRevision": 1, "title": "Fixed notice", "body": "Respond", "recipientIds": []string{uid}}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var item AttentionItem
	s.db.First(&item, "source_id=? AND recipient_id=?", b["id"], uid)
	st, _, w = req(t, s, "POST", "/api/companies/"+cid+"/attention/"+item.ID+"/transition", map[string]any{"expectedVersion": 1, "retryKey": "fixed-route", "action": "route", "reason": "Creator already reads source", "recipientId": owner}, mc)
	if st != 403 {
		t.Fatal("nonrecipient route", st, w.Body.String())
	}
}

func TestAttentionRouteCurrentTargetMembershipEpoch(t *testing.T) {
	s, c, cid, _, _ := attentionFixture(t)
	target := addPerson(t, s, c, cid, "route-epoch@example.invalid", "member")
	financeOK(t, s, "PATCH", "/api/companies/"+cid+"/people/"+target, map[string]any{"role": "admin"}, c)
	result := financeOK(t, s, "POST", "/api/companies/"+cid+"/attention/attention-test/transition", map[string]any{"expectedVersion": 1, "retryKey": "route-current-epoch", "action": "route", "reason": "Current independent recipient", "recipientId": target}, c)
	var item AttentionItem
	s.db.First(&item, "id=?", result["resultItemId"])
	var member Membership
	s.db.First(&member, "company_id=? AND user_id=?", cid, target)
	if item.MembershipEpoch != member.AccessEpoch {
		t.Fatal("routed episode retained previous recipient epoch")
	}
}
