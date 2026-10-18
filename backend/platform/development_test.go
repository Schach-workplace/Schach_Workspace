package platform

import "testing"

func TestDevelopmentParticipantAuthorityAndRetries(t *testing.T) {
	s, db := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	ownerID := addPerson(t, s, founder, cid, "growth-owner@example.com", "member")
	mentorID := addPerson(t, s, founder, cid, "growth-mentor@example.com", "member")
	replacementID := addPerson(t, s, founder, cid, "growth-next@example.com", "member")
	owner := login(t, s, "growth-owner@example.com")
	mentor := login(t, s, "growth-mentor@example.com")
	base := "/api/companies/" + cid + "/growth"
	st, b, _ := req(t, s, "GET", base+"/catalog", nil, owner)
	if st != 200 {
		t.Fatalf("catalog: %d %v", st, b)
	}
	if len(b["pilots"].([]any)) != 3 {
		t.Fatal(b)
	}
	for i, name := range []string{"engineering", "office", "field"} {
		row := b["pilots"].([]any)[i].(map[string]any)
		if row["id"] != name || len(row["competencies"].([]any)) == 0 || len(row["levels"].([]any)) != 3 || row["roleMeaning"] == "" {
			t.Fatal(row)
		}
	}

	input := map[string]any{"retryKey": "create", "pilot": "engineering", "title": "Improve reliability", "careerRole": "Software engineer", "careerLevel": "practitioner", "competencyIds": []string{"engineering.reliability"}, "objective": "Learn incident analysis", "learningActions": []string{"Practice incident review"}, "evidenceNote": "I published my reflection", "mentorId": mentorID}
	st, b, _ = req(t, s, "POST", base+"/plans", input, owner)
	if st != 200 {
		t.Fatal(st, b)
	}
	id := b["id"].(string)
	path := base + "/plans/" + id
	{
		st, b, _ = req(t, s, "GET", path, nil, founder)
		if st != 404 {
			t.Fatal("leadership bypass", st, b)
		}
	}
	st, b, _ = req(t, s, "GET", base+"/plans", nil, founder)
	if st != 200 || len(b["plans"].([]any)) != 0 {
		t.Fatal(st, b)
	}
	review := map[string]any{"retryKey": "review", "expectedVersion": 1, "feedback": "Discussed published reflection", "nextStep": "Practice another review"}
	st, b, _ = req(t, s, "POST", path+"/reviews", review, owner)
	if st != 403 {
		t.Fatal("self review", st, b)
	}
	st, b, _ = req(t, s, "POST", path+"/reviews", review, mentor)
	if st != 200 || b["version"] != float64(2) {
		t.Fatal(st, b)
	}
	rid := b["reviewId"]
	st, b, _ = req(t, s, "GET", path, nil, mentor)
	if st != 200 || b["canReview"] != true || b["canEdit"] != false || len(b["reviews"].([]any)) != 1 {
		t.Fatal(st, b)
	}
	st, b, _ = req(t, s, "GET", base+"/plans", nil, mentor)
	if st != 200 || len(b["plans"].([]any)) != 1 {
		t.Fatal(st, b)
	}

	st, b, _ = req(t, s, "POST", path+"/reviews", review, mentor)
	if st != 200 || b["reviewId"] != rid {
		t.Fatal("retry", st, b)
	}
	var count int64
	db.Model(&DevelopmentReview{}).Count(&count)
	if count != 1 {
		t.Fatal("duplicate review", count)
	}
	review["feedback"] = "Changed"
	st, b, _ = req(t, s, "POST", path+"/reviews", review, mentor)
	if st != 409 {
		t.Fatal(st, b)
	}
	review["feedback"] = "Discussed published reflection"
	st, b, _ = req(t, s, "PATCH", path, map[string]any{"retryKey": "stale", "expectedVersion": 1, "title": "Changed title"}, owner)
	if st != 409 {
		t.Fatal(st, b)
	}
	st, b, _ = req(t, s, "PATCH", path, map[string]any{"retryKey": "replace", "expectedVersion": 2, "mentorId": replacementID}, owner)
	if st != 200 {
		t.Fatal(st, b)
	}
	st, b, _ = req(t, s, "GET", path, nil, mentor)
	if st != 404 {
		t.Fatal("former mentor", st, b)
	}
	st, b, _ = req(t, s, "POST", path+"/reviews", review, mentor)
	if st != 404 {
		t.Fatal("former mentor replay", st, b)
	}
	db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, mentorID).Update("active", false)
	st, b, _ = req(t, s, "POST", base+"/plans", input, owner)
	if st != 200 || b["version"] != float64(1) {
		t.Fatal("original create result", st, b)
	}
	st, b, _ = req(t, s, "PATCH", path, map[string]any{"retryKey": "unknown", "expectedVersion": 3, "taskIds": []string{"private"}}, owner)
	if st != 422 {
		t.Fatal(st, b)
	}
	st, b, _ = req(t, s, "PATCH", path, map[string]any{"retryKey": "bounds", "expectedVersion": 3, "title": ""}, owner)
	if st != 422 {
		t.Fatal(st, b)
	}
	st, b, _ = req(t, s, "PATCH", path, map[string]any{"retryKey": "self-mentor", "expectedVersion": 3, "mentorId": ownerID}, owner)
	if st != 422 {
		t.Fatal(st, b)
	}
	db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, ownerID).Update("active", false)
	st, b, _ = req(t, s, "GET", path, nil, owner)
	if st == 200 {
		t.Fatal("revoked member", st, b)
	}
}

func TestDevelopmentValidationAndTenantIsolation(t *testing.T) {
	s, _ := testServer(t)
	f := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, f)
	viewerID := addPerson(t, s, f, cid, "growth-viewer@example.com", "viewer")
	viewer := login(t, s, "growth-viewer@example.com")
	base := "/api/companies/" + cid + "/growth/plans"
	input := map[string]any{"retryKey": "v", "pilot": "office", "title": "Plan", "careerRole": "Coordinator", "careerLevel": "foundation", "competencyIds": []string{"office.communication"}, "objective": "Practice communication", "learningActions": []string{}, "evidenceNote": ""}
	st, b, _ := req(t, s, "POST", base, input, viewer)
	if st != 403 {
		t.Fatal(st, b)
	}
	input["mentorId"] = viewerID
	st, b, _ = req(t, s, "POST", base, input, f)
	if st != 422 {
		t.Fatal(st, b)
	}
	delete(input, "mentorId")
	input["retryKey"] = ""
	st, b, _ = req(t, s, "POST", base, input, f)
	if st != 422 {
		t.Fatal(st, b)
	}
	input["retryKey"] = "office"
	st, b, _ = req(t, s, "POST", base, input, f)
	if st != 200 {
		t.Fatal(st, b)
	}
	id := b["id"].(string)
	input["pilot"] = "field"
	input["competencyIds"] = []string{"field.quality"}
	input["retryKey"] = "field"
	st, b, _ = req(t, s, "POST", base, input, f)
	if st != 200 {
		t.Fatal(st, b)
	}
	st, b, _ = req(t, s, "POST", "/api/companies", map[string]any{"name": "Other growth company", "slug": "other-growth", "timezone": "UTC", "color": "#F97316"}, f)
	if st != 200 {
		t.Fatal(st, b)
	}
	cid2 := b["id"].(string)
	st, b, _ = req(t, s, "GET", "/api/companies/"+cid2+"/growth/plans/"+id, nil, f)
	if st != 404 {
		t.Fatal(st, b)
	}
	st, b, _ = req(t, s, "GET", base+"?limit=1", nil, f)
	if st != 200 || b["hasMore"] != true || len(b["plans"].([]any)) != 1 {
		t.Fatal(st, b)
	}
	cursor := b["cursor"].(string)
	st, b, _ = req(t, s, "GET", base+"?limit=1&cursor="+cursor, nil, f)
	if st != 200 || len(b["plans"].([]any)) != 1 {
		t.Fatal(st, b)
	}
	st, b, _ = req(t, s, "PATCH", base+"/"+id, map[string]any{"retryKey": "missing-version", "title": "New"}, f)
	if st != 422 {
		t.Fatal(st, b)
	}
}

func TestDevelopmentCursorRevokedByMentorReplacement(t *testing.T) {
	s, db := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	mentorID := addPerson(t, s, founder, cid, "growth-page-mentor@example.com", "member")
	mentor := login(t, s, "growth-page-mentor@example.com")
	base := "/api/companies/" + cid + "/growth/plans"
	ids := []string{}
	for _, key := range []string{"one", "two"} {
		st, b, _ := req(t, s, "POST", base, map[string]any{"retryKey": key, "pilot": "field", "title": "Practice", "careerRole": "Field specialist", "careerLevel": "foundation", "competencyIds": []string{"field.quality"}, "objective": "Practice quality", "learningActions": []string{}, "evidenceNote": "Published reflection", "mentorId": mentorID}, founder)
		if st != 200 {
			t.Fatal(st, b)
		}
		ids = append(ids, b["id"].(string))
	}
	st, b, _ := req(t, s, "GET", base+"?limit=1", nil, mentor)
	if st != 200 || b["hasMore"] != true {
		t.Fatal(st, b)
	}
	cursor := b["cursor"].(string)
	var before Company
	db.First(&before, "id=?", cid)
	st, b, _ = req(t, s, "PATCH", base+"/"+ids[0], map[string]any{"retryKey": "remove", "expectedVersion": 1, "mentorId": ""}, founder)
	if st != 200 {
		t.Fatal(st, b)
	}
	var after Company
	db.First(&after, "id=?", cid)
	if after.PermissionEpoch != before.PermissionEpoch+1 {
		t.Fatal("audience change did not advance company scope", before.PermissionEpoch, after.PermissionEpoch)
	}
	st, b, _ = req(t, s, "PATCH", base+"/"+ids[0], map[string]any{"retryKey": "remove", "expectedVersion": 1, "mentorId": ""}, founder)
	if st != 200 {
		t.Fatal(st, b)
	}
	var replay Company
	db.First(&replay, "id=?", cid)
	if replay.PermissionEpoch != after.PermissionEpoch {
		t.Fatal("retry advanced company scope", after.PermissionEpoch, replay.PermissionEpoch)
	}
	st, b, _ = req(t, s, "PATCH", base+"/"+ids[0], map[string]any{"retryKey": "title-only", "expectedVersion": 2, "title": "Edited"}, founder)
	if st != 200 {
		t.Fatal(st, b)
	}
	var edited Company
	db.First(&edited, "id=?", cid)
	if edited.PermissionEpoch != after.PermissionEpoch {
		t.Fatal("nonaudience edit advanced company scope", after.PermissionEpoch, edited.PermissionEpoch)
	}
	st, b, _ = req(t, s, "GET", base+"?limit=1&cursor="+cursor, nil, mentor)
	if st != 422 {
		t.Fatal("cursor survived participant revocation", st, b)
	}
	if _, ok := b["plans"]; ok {
		t.Fatal("revoked cursor returned plans", b)
	}
	db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, mentorID).Update("role", "viewer")
	st, b, _ = req(t, s, "GET", base+"/"+ids[1], nil, mentor)
	if st != 404 {
		t.Fatal("viewer mentor still read plan", st, b)
	}
	st, b, _ = req(t, s, "GET", base, nil, mentor)
	if st != 200 || len(b["plans"].([]any)) != 0 {
		t.Fatal("viewer mentor list", st, b)
	}

}
