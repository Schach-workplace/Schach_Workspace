package platform

import (
	"testing"
)

func TestAcknowledgementExactRevisionAndIndependentDecision(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	message := sendMessage(t, s, c, cid, id, "instruction", "Read safety notice")
	root := "/api/companies/" + cid + "/conversations/" + id + "/records"
	st, b, w := req(t, s, "POST", root, map[string]any{"retryKey": "ack-once", "kind": "ack", "anchorMessageId": message["id"], "sourceRevision": 1, "title": "Notice", "body": "Confirm you read this revision", "recipientIds": []string{uid}}, c)
	if st != 200 {
		t.Fatalf("ack %d %s", st, w.Body.String())
	}
	record := b["id"].(string)
	st, _, _ = req(t, s, "POST", root+"/"+record+"/respond", map[string]any{"expectedRevision": 2, "response": "acknowledged"}, mc)
	if st != 409 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "POST", root+"/"+record+"/respond", map[string]any{"expectedRevision": 1, "response": "acknowledged"}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, b, w = req(t, s, "POST", root, map[string]any{"retryKey": "decision-once", "kind": "decision", "anchorMessageId": message["id"], "sourceRevision": 1, "title": "Reviewed decision", "body": "Choose supplier", "reviewerId": owner}, c)
	if st != 422 {
		t.Fatal("self review decision", st, w.Body.String())
	}
}
