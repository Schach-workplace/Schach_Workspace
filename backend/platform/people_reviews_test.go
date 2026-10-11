package platform

import (
	"gorm.io/gorm"
	"testing"
)

func reviewDecisions(t *testing.T, db *gorm.DB, cid string, changes map[string]map[string]any) []any {
	t.Helper()
	var rows []Membership
	if e := db.Where("company_id=?", cid).Order("user_id").Find(&rows).Error; e != nil {
		t.Fatal(e)
	}
	out := []any{}
	for _, m := range rows {
		d := map[string]any{"userId": m.UserID, "expectedMembershipVersion": m.Version, "action": "keep"}
		for k, v := range changes[m.UserID] {
			d[k] = v
		}
		out = append(out, d)
	}
	return out
}
func TestAccessReviewHistoricalAttestation(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/people/access-reviews"
	uid := addPerson(t, s, c, cid, "review-person@example.invalid", "member")
	var before Company
	db.First(&before, "id=?", cid)
	decisions := reviewDecisions(t, db, cid, map[string]map[string]any{uid: {"action": "departure_required", "reason": "Arrange a separate handover."}})
	p := financeOK(t, s, "POST", base+"/preview", map[string]any{"retryKey": "review-preview", "reason": "Quarterly access attestation", "decisions": decisions}, c)
	body := map[string]any{"retryKey": "review-complete", "previewId": p["previewId"], "expectedReviewVersion": p["version"]}
	result := financeOK(t, s, "POST", base+"/"+p["id"].(string)+"/complete", body, c)
	if result["state"] != "completed" {
		t.Fatal("review did not complete")
	}
	replay := financeOK(t, s, "POST", base+"/"+p["id"].(string)+"/complete", body, c)
	if replay["id"] != result["id"] {
		t.Fatal("different canonical review")
	}
	var after Company
	db.First(&after, "id=?", cid)
	if after.PermissionEpoch != before.PermissionEpoch {
		t.Fatal("keep-only attestation revoked sessions")
	}
	var m Membership
	db.First(&m, "company_id=? AND user_id=?", cid, uid)
	if !m.Active {
		t.Fatal("pending handover implicitly revoked access")
	}
	history := financeOK(t, s, "GET", base+"/"+p["id"].(string), nil, c)
	found := false
	for _, raw := range history["decisions"].([]any) {
		d := raw.(map[string]any)
		if d["userId"] == uid {
			found = true
			if d["handoverStatus"] != "pending" {
				t.Fatal("pending handover misrepresented")
			}
		}
	}
	if !found {
		t.Fatal("decision absent")
	}
}
func TestAccessReviewFingerprint(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	uid := addPerson(t, s, c, cid, "stale-review@example.invalid", "member")
	p := financeOK(t, s, "POST", base+"/people/access-reviews/preview", map[string]any{"retryKey": "stale-review-preview", "reason": "Reviewed scope", "decisions": reviewDecisions(t, db, cid, nil)}, c)
	financeOK(t, s, "PATCH", base+"/people/"+uid, map[string]any{"title": "New title"}, c)
	st, _, _ := req(t, s, "POST", base+"/people/access-reviews/"+p["id"].(string)+"/complete", map[string]any{"retryKey": "stale-complete", "previewId": p["previewId"], "expectedReviewVersion": p["version"]}, c)
	if st != 409 {
		t.Fatalf("stale review: %d", st)
	}
}
func TestAccessReviewWholeGraph(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	a := addPerson(t, s, c, cid, "cycle-a@example.invalid", "manager")
	b := addPerson(t, s, c, cid, "cycle-b@example.invalid", "manager")
	ds := reviewDecisions(t, db, cid, map[string]map[string]any{a: {"action": "change", "fields": map[string]any{"managerId": b}}, b: {"action": "change", "fields": map[string]any{"managerId": a}}})
	st, _, _ := req(t, s, "POST", base+"/people/access-reviews/preview", map[string]any{"retryKey": "cycle-preview", "reason": "Reviewed changes", "decisions": ds}, c)
	if st != 422 {
		t.Fatalf("cyclic review: %d", st)
	}
}

func TestAccessReviewExplicitRevocationAndCanonicalHistory(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	uid := addPerson(t, s, c, cid, "review-revoke@example.invalid", "member")
	target := login(t, s, "review-revoke@example.invalid")
	task := financeOK(t, s, "POST", base+"/tasks", map[string]any{"title": "Untransferred responsibility", "ownerId": uid, "status": "todo", "priority": "medium"}, c)
	p := financeOK(t, s, "POST", base+"/people/access-reviews/preview", map[string]any{"retryKey": "revoke-preview", "reason": "Explicit access decision; handover remains separate", "decisions": reviewDecisions(t, db, cid, map[string]map[string]any{uid: {"action": "revoke_access"}})}, c)
	if effect := p["sessionEffect"].(map[string]any); effect["reauthenticate"] != true || effect["devicesMustReregister"] != true || effect["callsMustRejoin"] != true {
		t.Fatal("preview hid known session consequences")
	}
	body := map[string]any{"retryKey": "revoke-complete", "previewId": p["previewId"], "expectedReviewVersion": p["version"]}
	result := financeOK(t, s, "POST", base+"/people/access-reviews/"+p["id"].(string)+"/complete", body, c)
	st, _, _ := req(t, s, "GET", base+"/workspace", nil, target)
	if st != 401 {
		t.Fatalf("revoked session: %d", st)
	}
	var source Task
	db.First(&source, "id=?", task["id"])
	if source.OwnerID != uid || source.Version != 1 {
		t.Fatal("access review transferred source responsibility")
	}
	financeOK(t, s, "PATCH", base+"/people/"+uid, map[string]any{"active": true}, c)
	replay := financeOK(t, s, "POST", base+"/people/access-reviews/"+p["id"].(string)+"/complete", body, c)
	if replay["id"] != result["id"] {
		t.Fatal("canonical attestation changed")
	}
	var m Membership
	db.First(&m, "company_id=? AND user_id=?", cid, uid)
	if !m.Active {
		t.Fatal("historical review revoked later rejoin")
	}
	for _, raw := range replay["decisions"].([]any) {
		d := raw.(map[string]any)
		if d["userId"] == uid && (d["handoverStatus"] != "not_performed" || d["accessOutcome"] != "revoked") {
			t.Fatal("access history changed or handover misclassified")
		}
	}
}
