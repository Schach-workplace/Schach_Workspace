package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type intelligencePhaseProvider struct {
	during func()
	calls  int
}

func (p *intelligencePhaseProvider) Generate(ctx context.Context, in GroundedInput) (ProviderOutput, error) {
	p.calls++
	p.during()
	return fakeIntelligenceProvider{}.Generate(ctx, in)
}
func TestIntelligenceLeaseRacesCurrentFinalFence(t *testing.T) {
	for _, kind := range []string{"source_body", "source_deleted", "user_epoch", "original_session_expiry", "company_epoch", "lease_token", "cancel_version"} {
		t.Run(kind, func(t *testing.T) {
			p := &intelligencePhaseProvider{}
			s, _, _, id := intelligenceQueuedFixture(t, p)
			lease, e := s.claimIntelligence(t.Context())
			if e != nil || lease == nil {
				t.Fatal(e)
			}
			p.during = func() {
				switch kind {
				case "source_body":
					s.db.Model(&Task{}).Where("id=?", lease.Job.Selection.Sources[0].ID).Update("description", "Changed without task version")
				case "source_deleted":
					s.db.Delete(&Task{}, "id=?", lease.Job.Selection.Sources[0].ID)
				case "user_epoch":
					s.db.Model(&User{}).Where("id=?", lease.Job.ActorID).Update("session_epoch", gorm.Expr("session_epoch+1"))
				case "original_session_expiry":
					s.db.Model(&SessionRecord{}).Where("token_hash=?", lease.Job.OriginatingSessionRef).Update("expires_at", time.Now().UTC().Add(-time.Hour))
				case "company_epoch":
					s.db.Model(&Company{}).Where("id=?", lease.Job.CompanyID).Update("permission_epoch", gorm.Expr("permission_epoch+1"))
				case "lease_token":
					s.db.Model(&IntelligenceJob{}).Where("id=?", id).Update("lease_token", "different")
				case "cancel_version":
					s.db.Model(&IntelligenceJob{}).Where("id=?", id).Update("cancellation_version", gorm.Expr("cancellation_version+1"))
				}
			}
			if e = s.runIntelligenceLease(t.Context(), *lease); e == nil {
				t.Fatal("stale final commit accepted")
			}
			var j IntelligenceJob
			s.db.First(&j, "id=?", id)
			if j.State == "ready" || j.ResultJSON != "" {
				t.Fatal("stale result bytes persisted")
			}
			if p.calls != 1 {
				t.Fatal("provider not exercised")
			}
		})
	}
}
func enqueueSelectedIntelligence(t *testing.T, s *Server, c *http.Cookie, cid string, op string, sources []map[string]any, key string) string {
	t.Helper()
	path := "/api/companies/" + cid + "/intelligence"
	input := map[string]any{"operation": op, "sources": sources}
	st, p, _ := req(t, s, "POST", path+"/selection-preview", input, c)
	if st != 200 {
		t.Fatal(st, p)
	}
	input["selectionHash"] = p["selectionHash"]
	input["retryKey"] = key
	input["optIn"] = map[string]any{"accepted": true, "policyVersion": intelligencePolicy}
	st, b, _ := req(t, s, "POST", path+"/jobs", input, c)
	if st != 202 {
		t.Fatal(st, b)
	}
	return b["jobId"].(string)
}
func TestIntelligenceReadPrivateIntervalAndRejoin(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, c, cid, conv, "selected-private", "Fictional selected private content")
	s.opts.Intelligence = &IntelligenceConfig{Summary: fakeIntelligenceProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
	sources := []map[string]any{{"kind": "message", "id": m["id"], "conversationId": conv, "selectedFieldSet": "body"}}
	jid := enqueueSelectedIntelligence(t, s, mc, cid, "summary", sources, "interval")
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
		t.Fatal(e)
	}
	base := "/api/companies/" + cid
	financeOK(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
	for i, active := range []bool{false, true} {
		financeOK(t, s, "POST", base+"/conversations/"+conv+"/members", map[string]any{"expectedVersion": i + 1, "userId": uid, "role": "member", "active": active}, c)
		st, b, _ := req(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
		if st == 200 && b["state"] == "ready" || b["result"] != nil || b["sources"] != nil {
			t.Fatal("private interval revived output", st, b)
		}
	}
	var j IntelligenceJob
	s.db.First(&j, "id=?", jid)
	if j.ResultJSON != "" {
		t.Fatal("revocation did not scrub")
	}
}
func TestIntelligenceEnqueueQuotaAndStrictRequest(t *testing.T) {
	s, c, cid, _ := intelligenceQueuedFixture(t, fakeIntelligenceProvider{})
	var initial IntelligenceJob
	s.db.First(&initial)
	for i := 1; i < 10; i++ {
		enqueueSelectedIntelligence(t, s, c, cid, "summary", []map[string]any{{"kind": "task_fields", "id": initial.Selection.Sources[0].ID, "selectedFieldSet": "narrative"}}, fmt.Sprint("quota", i))
	}
	input := IntelligenceEnqueue{IntelligenceSelection: initial.Selection, RetryKey: "overflow", SelectionHash: initial.SourceSetHash, OptIn: IntelligenceOptIn{Accepted: true, PolicyVersion: intelligencePolicy}}
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/intelligence/jobs", input, c)
	if st != 429 {
		t.Fatal("actor quota", st)
	}
	var n int64
	s.db.Model(&IntelligenceSource{}).Count(&n)
	if n != 10 {
		t.Fatal("quota left partial sources", n)
	}
	raw, _ := json.Marshal(input)
	duplicate := strings.Replace(string(raw), `"retryKey":"overflow"`, `"retryKey":"overflow","retryKey":"different"`, 1)
	r := httptest.NewRequest("POST", "/api/companies/"+cid+"/intelligence/jobs", strings.NewReader(duplicate))
	r.AddCookie(c)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 422 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("duplicate input or denial caching", w.Code)
	}
}
func TestIntelligenceRetentionAndLeaseExpiry(t *testing.T) {
	s, _, _, id := intelligenceQueuedFixture(t, fakeIntelligenceProvider{})
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	now := time.Now().UTC()
	s.db.Model(&IntelligenceJob{}).Where("id=?", id).Update("lease_until", now.Add(-time.Second))
	if _, e = s.RunIntelligenceMaintenance(t.Context(), now, 100); e != nil {
		t.Fatal(e)
	}
	var j IntelligenceJob
	s.db.First(&j, "id=?", id)
	if j.State != "retry_wait" {
		t.Fatal("lost lease not retried", j.State)
	}
	if e = s.commitIntelligenceResult(t.Context(), *lease, IntelligenceResult{SourceSetHash: j.SourceSetHash}); e == nil {
		t.Fatal("old lease committed")
	}
	s.db.Model(&IntelligenceJob{}).Where("id=?", id).Updates(map[string]any{"expires_at": now.Add(-time.Second), "result_json": "must scrub"})
	if _, e = s.RunIntelligenceMaintenance(t.Context(), now, 100); e != nil {
		t.Fatal(e)
	}
	s.db.First(&j, "id=?", id)
	if j.State != "expired" || j.ResultJSON != "" {
		t.Fatal("expired bytes retained")
	}
}
