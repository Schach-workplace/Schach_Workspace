package platform

import (
	"net/http"
	"testing"
)

func conversionInput(message map[string]any, task map[string]any, key string) map[string]any {
	return map[string]any{"retryKey": key, "anchorMessageId": message["id"], "sources": []any{map[string]any{"messageId": message["id"], "revision": message["revision"]}}, "task": task, "expectedPolicyVersion": 2, "publication": map[string]any{"excerpt": ""}}
}
func allowPublication(t *testing.T, s *Server, c *http.Cookie, cid, id string) {
	t.Helper()
	st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/conversations/"+id, map[string]any{"expectedVersion": 1, "forwarding": "selected"}, c)
	if st != 200 {
		t.Fatalf("policy %d %s", st, w.Body.String())
	}
}
func TestPrivateConversionPublicationDenied(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, mc, cid, id, "source", "Private instruction")
	input := conversionInput(m, taskBody(uid), "retry")
	input["expectedPolicyVersion"] = 1
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/task-conversions", input, mc)
	if st != 403 {
		t.Fatal(st)
	}
}
func TestConversionRetriesAndPrimaryAnchor(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	allowPublication(t, s, c, cid, id)
	m := sendMessage(t, s, mc, cid, id, "source", "Do work")
	input := conversionInput(m, taskBody(uid), "retry")
	path := "/api/companies/" + cid + "/conversations/" + id + "/task-conversions"
	st, b, w := req(t, s, "POST", path, input, mc)
	if st != 200 {
		t.Fatalf("conversion %d %s", st, w.Body.String())
	}
	first := b["id"]
	st, b, _ = req(t, s, "POST", path, input, mc)
	if st != 200 || b["id"] != first {
		t.Fatal("retry duplicated")
	}
	input["retryKey"] = "another"
	st, b, _ = req(t, s, "POST", path, input, c)
	if st != 200 || b["id"] != first {
		t.Fatal("primary duplicated")
	}
	input["task"].(map[string]any)["title"] = "Changed"
	input["retryKey"] = "retry"
	st, _, _ = req(t, s, "POST", path, input, mc)
	if st != 409 {
		t.Fatal(st)
	}
}
func TestConversionSourceAndAssignmentAreIndependent(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	allowPublication(t, s, c, cid, id)
	m := sendMessage(t, s, mc, cid, id, "source", "Please do work")
	input := conversionInput(m, taskBody(owner), "assign")
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/task-conversions", input, mc)
	if st != 403 {
		t.Fatal(st)
	}
}
func TestSourceRevisionConflict(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	allowPublication(t, s, c, cid, id)
	m := sendMessage(t, s, mc, cid, id, "source", "Old instruction")
	path := "/api/companies/" + cid + "/conversations/" + id
	st, _, _ := req(t, s, "PATCH", path+"/messages/"+m["id"].(string), map[string]any{"expectedRevision": 1, "body": "Changed"}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "POST", path+"/task-conversions", conversionInput(m, taskBody(uid), "stale"), mc)
	if st != 409 {
		t.Fatal(st)
	}
}

func TestSplitActionsAreExplicitDurableAndPrimaryContextIndependent(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	allowPublication(t, s, c, cid, id)
	m := sendMessage(t, s, mc, cid, id, "split-source", "Two separate work items")
	root := "/api/companies/" + cid + "/conversations/" + id
	bundle := map[string]any{"retryKey": "split-once", "anchorMessageId": m["id"], "sourceRevision": 1, "expectedPolicyVersion": 2, "titles": []string{"Prepare report", "Review figures"}}
	st, b, w := req(t, s, "POST", root+"/work-actions", bundle, mc)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	ids := b["actionIds"].([]any)
	st, b, _ = req(t, s, "POST", root+"/work-actions", bundle, mc)
	if st != 200 || b["actionIds"].([]any)[0] != ids[0] {
		t.Fatal("split retry duplicate", st, b)
	}
	input := conversionInput(m, taskBody(uid), "split-task")
	input["actionId"] = ids[0]
	first := financeOK(t, s, "POST", root+"/task-conversions", input, mc)["id"]
	input["retryKey"] = "split-second"
	input["actionId"] = ids[1]
	second := financeOK(t, s, "POST", root+"/task-conversions", input, mc)["id"]
	if first == second {
		t.Fatal("split actions collapsed")
	}
	input["actionId"] = "invented"
	input["retryKey"] = "arbitrary"
	if st, _, _ := req(t, s, "POST", root+"/task-conversions", input, mc); st != 404 {
		t.Fatal("arbitrary action accepted", st)
	}
	input["actionId"] = "primary"
	input["retryKey"] = "primary-first"
	primary := financeOK(t, s, "POST", root+"/task-conversions", input, mc)["id"]
	context := sendMessage(t, s, c, cid, id, "context", "Context B")
	input["retryKey"] = "primary-other"
	input["sources"] = []any{map[string]any{"messageId": m["id"], "revision": 1}, map[string]any{"messageId": context["id"], "revision": 1}}
	if financeOK(t, s, "POST", root+"/task-conversions", input, c)["id"] != primary {
		t.Fatal("A versus A+B duplicated primary")
	}
}
