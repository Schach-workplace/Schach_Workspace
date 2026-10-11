package platform

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

type blockingIntelligenceProvider struct {
	entered chan struct{}
	calls   atomic.Int32
}

func (p *blockingIntelligenceProvider) Generate(ctx context.Context, in GroundedInput) (ProviderOutput, error) {
	p.calls.Add(1)
	select {
	case p.entered <- struct{}{}:
	default:
	}
	<-ctx.Done()
	return ProviderOutput{}, ctx.Err()
}
func intelligenceQueuedFixture(t *testing.T, p SummaryProvider) (*Server, *http.Cookie, string, string) {
	t.Helper()
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	sources := []map[string]any{{"kind": "task_fields", "id": id, "selectedFieldSet": "narrative"}}
	_, preview := intelligencePreview(t, s, c, cid, sources)
	s.opts.Intelligence = &IntelligenceConfig{Summary: p, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
	st, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/intelligence/jobs", map[string]any{"operation": "summary", "sources": sources, "selectionHash": preview["selectionHash"], "retryKey": "worker", "optIn": map[string]any{"accepted": true, "policyVersion": intelligencePolicy}}, c)
	if st != 202 {
		t.Fatal(st, b)
	}
	return s, c, cid, b["jobId"].(string)
}
func TestIntelligenceLeaseCancellation(t *testing.T) {
	p := &blockingIntelligenceProvider{entered: make(chan struct{}, 1)}
	s, c, cid, id := intelligenceQueuedFixture(t, p)
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() { done <- s.runIntelligenceLease(t.Context(), *lease) }()
	select {
	case <-p.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("provider not entered")
	}
	st, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/intelligence/jobs/"+id+"/cancel", map[string]any{}, c)
	if st != 200 {
		t.Fatal(st, b)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("cancel did not join provider")
	}
	var job IntelligenceJob
	s.db.First(&job, "id=?", id)
	if job.State != "cancelled" || job.ResultJSON != "" {
		t.Fatal("cancelled provider persisted output")
	}
}
func TestIntelligenceWorkerReadyAndLeaseFence(t *testing.T) {
	s, c, cid, id := intelligenceQueuedFixture(t, fakeIntelligenceProvider{})
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	second, e := s.claimIntelligence(t.Context())
	if e != nil || second != nil {
		t.Fatal("double claim", e)
	}
	if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
		t.Fatal(e)
	}
	st, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/intelligence/jobs/"+id, nil, c)
	if st != 200 || b["state"] != "ready" || b["result"] == nil {
		t.Fatal(st, b)
	}
	if e = s.runIntelligenceLease(t.Context(), *lease); e == nil {
		t.Fatal("stale lease reused")
	}
}
func TestIntelligenceWorkerSharedBudgetAndStop(t *testing.T) {
	p := &blockingIntelligenceProvider{entered: make(chan struct{}, 1)}
	s, _, _, _ := intelligenceQueuedFixture(t, p)
	budget := NewLocalProviderBudget(1)
	s.opts.LocalProviderBudget = budget
	release, e := budget.Acquire(t.Context())
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { defer close(done); s.RunIntelligenceWorker(ctx) }()
	time.Sleep(80 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("worker budget wait not joined")
	}
	release()
	if p.calls.Load() != 0 {
		t.Fatal("shared OCR slot ignored")
	}
}
