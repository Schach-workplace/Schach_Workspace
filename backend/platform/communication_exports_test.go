package platform

import (
	"strings"
	"testing"
)

func TestSelectedExportIsCurrentOwnerOnlyAndAuditedPrivately(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	allowPublication(t, s, c, cid, conv)
	m := sendMessage(t, s, mc, cid, conv, "export", "Selected private content")
	body := map[string]any{"expectedPolicyVersion": 2, "messageIds": []string{m["id"].(string)}, "purpose": "Authorized selected record copy", "acknowledgedIndependentCopy": true}
	root := "/api/companies/" + cid + "/conversations/" + conv + "/exports"
	if st, _, _ := req(t, s, "POST", root, body, mc); st != 403 {
		t.Fatal("member transcript export", st)
	}
	result := financeOK(t, s, "POST", root, body, c)
	if len(result["messages"].([]any)) != 1 {
		t.Fatal(result)
	}
	var audit CommunicationExportAudit
	if e := s.db.First(&audit, "company_id=? AND conversation_id=?", cid, conv).Error; e != nil || audit.ActorID != owner {
		t.Fatal("missing private export audit", e)
	}
	var broad []Activity
	s.db.Where("company_id=?", cid).Find(&broad)
	for _, a := range broad {
		if strings.Contains(a.Detail, "Selected private content") {
			t.Fatal("private export in broad activity")
		}
	}
	financeOK(t, s, "POST", "/api/companies/"+cid+"/conversations/"+conv+"/members", map[string]any{"expectedVersion": 2, "userId": uid, "active": false, "role": "member"}, c)
	if st, _, _ := req(t, s, "POST", root, body, mc); st != 404 {
		t.Fatal("revoked export", st)
	}
}
func TestPublishedWorkBriefingDoesNotHarvestPrivateMessages(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, mc, cid, []string{uid}, "group")
	sendMessage(t, s, mc, cid, conv, "private", "Do not harvest this private briefing")
	_ = createTask(t, s, c, cid, taskBody(owner))
	st, b, w := req(t, s, "GET", "/api/companies/"+cid+"/communication/briefing", nil, c)
	if st != 200 || b["visibleTaskCount"] != float64(1) || strings.Contains(w.Body.String(), conv) || strings.Contains(w.Body.String(), "harvest") {
		t.Fatal("briefing leaks or omits visible work", st, w.Body.String())
	}
}
