package platform

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

type fakeActionProvider struct{}

func (fakeActionProvider) Generate(_ context.Context, in GroundedInput) (ProviderOutput, error) {
	raw, _ := json.Marshal(map[string]any{"candidates": []IntelligenceCandidate{{Kind: "task", Title: "Selected reviewed delivery", Description: "Source-bound suggestion", SourceKeys: []string{in.Sources[0].Key}, Unresolved: []string{"owner", "dueDate", "reviewer"}}}})
	return ProviderOutput{Raw: raw}, nil
}
func TestIntelligenceReviewedPublicationAndPublishedRetry(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	sourceID := createTask(t, s, c, cid, taskBody(uid))
	path := "/api/companies/" + cid
	sources := []map[string]any{{"kind": "task_fields", "id": sourceID, "selectedFieldSet": "narrative"}}
	selection := map[string]any{"operation": "action_draft", "sources": sources}
	st, preview, _ := req(t, s, "POST", path+"/intelligence/selection-preview", selection, c)
	if st != 200 {
		t.Fatal(st, preview)
	}
	s.opts.Intelligence = &IntelligenceConfig{Summary: fakeActionProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
	selection["retryKey"] = "action"
	selection["selectionHash"] = preview["selectionHash"]
	selection["optIn"] = map[string]any{"accepted": true, "policyVersion": intelligencePolicy}
	st, b, _ := req(t, s, "POST", path+"/intelligence/jobs", selection, c)
	if st != 202 {
		t.Fatal(st, b)
	}
	jid := b["jobId"].(string)
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
		t.Fatal(e)
	}
	st, b, _ = req(t, s, "GET", path+"/intelligence/jobs/"+jid, nil, c)
	if st != 200 {
		t.Fatal(st, b)
	}
	basis := map[string]any{"jobId": jid, "resultHash": b["resultHash"], "sourceSetHash": b["sourceSetHash"]}
	task := taskBody(uid)
	task["title"] = "Human-reviewed selected work"
	task["retryKey"] = "publish-intelligence"
	task["intelligenceBasis"] = basis
	st, b, _ = req(t, s, "POST", path+"/tasks", task, c)
	if st != 409 {
		t.Fatal("write without audience review", st, b)
	}
	previewTask := taskBody(uid)
	previewTask["title"] = task["title"]
	st, b, _ = req(t, s, "POST", path+"/intelligence/jobs/"+jid+"/task-preview", map[string]any{"task": previewTask, "intelligenceBasis": basis}, c)
	if st != 200 {
		t.Fatal(st, b)
	}
	basis["reviewHash"] = b["intelligenceReviewHash"]
	st, b, _ = req(t, s, "POST", path+"/tasks", task, c)
	if st != 200 {
		t.Fatal(st, b)
	}
	published := b["id"]
	proof := map[string]any{"intelligenceBasis": basis, "retryKey": "publish-intelligence", "operation": "task_create"}
	proofPath := path + "/intelligence/jobs/" + jid + "/publication-access"
	st, b, _ = req(t, s, "POST", proofPath, proof, c)
	if st != 200 || b["current"] != true || b["committed"] != true {
		t.Fatal("published current authority", st, b)
	}
	// Raw job TTL and source version are deliberately not prerequisites for a
	// successful canonical business replay. Current ALL-source ACL still is.
	db.Model(&IntelligenceJob{}).Where("id=?", jid).Updates(map[string]any{"expires_at": time.Now().UTC().Add(-time.Hour), "state": "expired", "result_json": ""})
	req(t, s, "PATCH", path+"/tasks/"+sourceID, map[string]any{"version": 1, "title": "Readable later edit"}, c)
	st, b, _ = req(t, s, "POST", path+"/tasks", task, c)
	if st != 200 || b["id"] != published {
		t.Fatal("canonical replay demanded raw result", st, b)
	}
	st, b, _ = req(t, s, "POST", proofPath, proof, c)
	if st != 200 || b["current"] != true || b["committed"] != true {
		t.Fatal("published proof incorrectly required raw TTL/version", st, b)
	}
	task["retryKey"] = "second-unreviewed-write"
	st, b, _ = req(t, s, "POST", path+"/tasks", task, c)
	if st < 400 {
		t.Fatal("expired raw result created new record")
	}
	var n int64
	db.Model(&Task{}).Where("company_id=?", cid).Count(&n)
	if n != 2 {
		t.Fatal("duplicate work", n)
	}
	db.Delete(&Task{}, "id=?", sourceID)
	st, b, _ = req(t, s, "POST", proofPath, proof, c)
	if st != 403 && st != 404 {
		t.Fatal("published proof allowed lost source", st, b)
	}
	task["retryKey"] = "publish-intelligence"
	st, b, _ = req(t, s, "POST", path+"/tasks", task, c)
	if st < 400 {
		t.Fatal("canonical result disclosed after source loss")
	}
}

func TestIntelligenceReviewedPublicationCompletePrivateScope(t *testing.T) {
	source := func(conv, id string) BoundIntelligenceSource {
		return BoundIntelligenceSource{Request: IntelligenceSourceRequest{Kind: "message", ID: id, ConversationID: conv}}
	}
	m := SourceManifest{Sources: []BoundIntelligenceSource{source("one", "a"), source("one", "b")}}
	if e := intelligencePublicationScope(m, "", nil); e == nil {
		t.Fatal("private source escaped through ordinary task create")
	}
	if e := intelligencePublicationScope(m, "one", []string{"a"}); e == nil {
		t.Fatal("partial source publication")
	}
	if e := intelligencePublicationScope(m, "one", []string{"b", "a"}); e != nil {
		t.Fatal(e)
	}
	m.Sources = append(m.Sources, source("two", "c"))
	if e := intelligencePublicationScope(m, "one", []string{"a", "b", "c"}); e == nil {
		t.Fatal("cross-private composite published")
	}
}
