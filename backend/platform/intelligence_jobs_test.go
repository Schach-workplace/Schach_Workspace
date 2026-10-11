package platform

import (
	"bytes"
	"os"
	"sync"
	"testing"
	"time"
)

func TestIntelligenceEnqueueRetry(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	id := createTask(t, s, c, cid, taskBody(uid))
	sources := []map[string]any{{"kind": "task_fields", "id": id, "selectedFieldSet": "narrative"}}
	st, preview := intelligencePreview(t, s, c, cid, sources)
	if st != 200 {
		t.Fatal(st, preview)
	}
	path := "/api/companies/" + cid + "/intelligence/jobs"
	input := map[string]any{"operation": "summary", "sources": sources, "selectionHash": preview["selectionHash"], "retryKey": "frozen-job", "optIn": map[string]any{"accepted": true, "policyVersion": "local-selected-v1"}}
	st, b, _ := req(t, s, "POST", path, input, c)
	if st != 503 {
		t.Fatal("optional missing provider must preserve manual path", st, b)
	}
	// A configured deterministic local adapter exercises the application contract.
	s.opts.Intelligence = &IntelligenceConfig{Summary: fakeIntelligenceProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1", Digest: "fixed", ConfigHash: "fixed"}}
	st, b, _ = req(t, s, "POST", path, input, c)
	if st != 202 {
		t.Fatal(st, b)
	}
	jobID := b["jobId"]
	st, b, _ = req(t, s, "POST", path, input, c)
	if st != 202 || b["jobId"] != jobID {
		t.Fatal("canonical retry", st, b)
	}
	var n int64
	db.Model(&IntelligenceJob{}).Count(&n)
	if n != 1 {
		t.Fatal(n)
	}
	input["language"] = "hi"
	st, b, _ = req(t, s, "POST", path, input, c)
	if st != 409 {
		t.Fatal("changed intent", st, b)
	}
	delete(input, "language")
	var job IntelligenceJob
	db.First(&job, "id=?", jobID)
	if job.CapturedUserEpoch <= 0 || job.OriginatingSessionRef == "" || job.ExpiresAt.After(time.Now().Add(24*time.Hour)) {
		t.Fatal("durable authority or TTL missing")
	}
	input["retryKey"] = "no-opt"
	input["optIn"] = map[string]any{"accepted": false, "policyVersion": "local-selected-v1"}
	st, b, _ = req(t, s, "POST", path, input, c)
	if st < 400 {
		t.Fatal("opt-in required")
	}
}
func TestIntelligenceSourceAuthorizationOriginalEpoch(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	id := createTask(t, s, c, cid, taskBody(uid))
	sources := []map[string]any{{"kind": "task_fields", "id": id, "selectedFieldSet": "narrative"}}
	s.opts.Intelligence = &IntelligenceConfig{Summary: fakeIntelligenceProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
	_, preview := intelligencePreview(t, s, c, cid, sources)
	path := "/api/companies/" + cid + "/intelligence/jobs"
	st, b, _ := req(t, s, "POST", path, map[string]any{"operation": "summary", "sources": sources, "selectionHash": preview["selectionHash"], "retryKey": "original-session", "optIn": map[string]any{"accepted": true, "policyVersion": intelligencePolicy}}, c)
	if st != 202 {
		t.Fatal(st, b)
	}
	jid := b["jobId"].(string)
	// A fresh login does not revive a handle whose original session expired.
	var job IntelligenceJob
	db.First(&job, "id=?", jid)
	db.Model(&SessionRecord{}).Where("token_hash=?", job.OriginatingSessionRef).Update("expires_at", time.Now().UTC().Add(-time.Hour))
	newCookie := login(t, s, "founder@example.com")
	st, b, _ = req(t, s, "GET", path+"/"+jid, nil, newCookie)
	if st != 403 || b["result"] != nil {
		t.Fatal("fresh session revived old raw handle", st, b)
	}
	db.First(&job, "id=?", jid)
	if job.State != "invalidated" || job.ResultJSON != "" {
		t.Fatal("not durably retired")
	}
}

func TestIntelligenceMigration(t *testing.T) {
	for _, suffix := range []string{"up", "down"} {
		name := "57_intelligence_jobs." + suffix + ".sql"
		a, e := os.ReadFile("../migrations/" + name)
		if e != nil {
			t.Fatal(e)
		}
		b, e := os.ReadFile("../../encore/api/migrations/" + name)
		if e != nil || !bytes.Equal(a, b) {
			t.Fatal("migration mirrors", e)
		}
	}
	if os.Getenv("TEST_DATABASE_URL") == "" {
		return
	}
	s, db := testServer(t)
	_ = s
	down, _ := os.ReadFile("../migrations/57_intelligence_jobs.down.sql")
	up, _ := os.ReadFile("../migrations/57_intelligence_jobs.up.sql")
	if e := db.Exec(string(down)).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Exec(string(up)).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Exec(string(down)).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Exec(string(up)).Error; e != nil {
		t.Fatal(e)
	}
}
func TestIntelligenceEnqueueConcurrent(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	id := createTask(t, s, c, cid, taskBody(uid))
	sources := []map[string]any{{"kind": "task_fields", "id": id, "selectedFieldSet": "narrative"}}
	_, preview := intelligencePreview(t, s, c, cid, sources)
	s.opts.Intelligence = &IntelligenceConfig{Summary: fakeIntelligenceProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
	payload := map[string]any{"operation": "summary", "sources": sources, "selectionHash": preview["selectionHash"], "retryKey": "concurrent", "optIn": map[string]any{"accepted": true, "policyVersion": intelligencePolicy}}
	path := "/api/companies/" + cid + "/intelligence/jobs"
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, b, _ := req(t, s, "POST", path, payload, c)
			if st != 202 {
				t.Error(st, b)
			}
		}()
	}
	wg.Wait()
	var n int64
	db.Model(&IntelligenceJob{}).Count(&n)
	if n != 1 {
		t.Fatal("duplicate", n)
	}
}
