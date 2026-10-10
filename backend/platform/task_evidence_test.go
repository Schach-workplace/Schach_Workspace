package platform

import (
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTaskEvidenceInvalidatesOpenReview(t *testing.T) {
	s, c, cid, _, uid, mc := conversationFixture(t)
	t.Cleanup(func() { assertNativeTaskFacts(t, s) })
	b := taskBody(uid)
	b["reviewerId"] = me(t, s, c)
	b["requiresApproval"] = true
	b["status"] = "in_review"
	id := createTask(t, s, c, cid, b)
	r := requestForAccess("/api/companies/"+cid+"/tasks/"+id, mc, cid)
	a, e := s.access(r)
	if e != nil {
		t.Fatal(e)
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		return appendTaskEvidence(tx, a, id, Attachment{ID: newID("att"), FileName: "proof.txt", MimeType: "text/plain", Size: 5, Data: []byte("proof"), UploadedBy: uid, CreatedAt: nowString()})
	})
	if e != nil {
		t.Fatal(e)
	}
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks/"+id+"/review", map[string]any{"version": 1, "decision": "approve", "comment": "Inspected"}, c)
	if st != 409 {
		t.Fatalf("stale review accepted %d", st)
	}
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/tasks/"+id+"/review", map[string]any{"version": 2, "decision": "approve", "comment": "Inspected new evidence"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	var acceptance TaskAcceptanceFact
	if e := s.db.First(&acceptance, "task_id=?", id).Error; e != nil {
		t.Fatal(e)
	}
	if acceptance.AcceptanceKind != "independent_review" || acceptance.ActorID != me(t, s, c) || acceptance.State.OwnerID == acceptance.ActorID {
		t.Fatal("review provenance lost", acceptance)
	}
}
func TestAcceptedTaskRequiresReopenForEvidence(t *testing.T) {
	s, c, cid, _, uid, mc := conversationFixture(t)
	b := taskBody(uid)
	b["status"] = "done"
	id := createTask(t, s, c, cid, b)
	r := requestForAccess("/api/companies/"+cid+"/tasks/"+id, mc, cid)
	a, e := s.access(r)
	if e != nil {
		t.Fatal(e)
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error { return appendTaskEvidence(tx, a, id, Attachment{ID: newID("att")}) })
	if e == nil {
		t.Fatal("accepted evidence changed")
	}
}

func requestForAccess(path string, c *http.Cookie, cid string) *http.Request {
	r := httptest.NewRequest("POST", path, nil)
	r.AddCookie(c)
	r.SetPathValue("cid", cid)
	return r
}
