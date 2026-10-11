package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestIntelligenceRecordCitationExactRead(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, c, cid, conv, "citation-record", "Fictional selected record")
	base := "/api/companies/" + cid + "/conversations/" + conv + "/records"
	b := financeOK(t, s, "POST", base, map[string]any{"retryKey": "citation-record", "kind": "poll", "anchorMessageId": m["id"], "sourceRevision": 1, "title": "Explicit poll", "body": "Selected options", "recipientIds": []string{owner}, "options": []string{"First", "Second"}}, c)
	path := base + "/" + b["id"].(string)
	st, body, _ := req(t, s, "GET", path, nil, c)
	if st != 200 || body["record"] == nil {
		t.Fatal("registered exact record read", st, body)
	}
	st, _, _ = req(t, s, "GET", path, nil, mc)
	if st != 404 {
		t.Fatal("nonrecipient member read", st)
	}
	s.db.Model(&Message{}).Where("id=?", m["id"]).Update("content_purged", true)
	st, body, _ = req(t, s, "GET", path, nil, c)
	if st != 404 || body["record"] != nil {
		t.Fatal("purged record disclosed", st)
	}

	s.db.Model(&Message{}).Where("id=?", m["id"]).Update("content_purged", false)
	both := financeOK(t, s, "POST", base, map[string]any{"retryKey": "both-recipients", "kind": "poll", "anchorMessageId": m["id"], "sourceRevision": 1, "title": "Exact fixed audience", "body": "No cross-recipient responses", "recipientIds": []string{owner, uid}, "options": []string{"First", "Second"}}, c)
	bothPath := base + "/" + both["id"].(string)
	for _, entry := range []struct {
		id     string
		cookie *http.Cookie
	}{{owner, c}, {uid, mc}} {
		got := financeOK(t, s, "GET", bothPath, nil, entry.cookie)
		rows := got["responses"].([]any)
		if len(rows) != 1 || rows[0].(map[string]any)["userId"] != entry.id {
			t.Fatal("cross-recipient responses", got)
		}
	}
	financeOK(t, s, "POST", "/api/companies/"+cid+"/conversations/"+conv+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "member", "active": false}, c)
	st, _, _ = req(t, s, "GET", bothPath, nil, mc)
	if st != 404 {
		t.Fatal("departed recipient history", st)
	}
	financeOK(t, s, "GET", bothPath, nil, c)
	s.db.Model(&Message{}).Where("id=?", m["id"]).Update("removed", true)
	st, _, _ = req(t, s, "GET", bothPath, nil, c)
	if st != 404 {
		t.Fatal("removed anchor", st)
	}
}

func TestIntelligenceCurrentReportSemanticFacts(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)

	for i := 0; i < 3; i++ {
		id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
		values := map[string]any{"status": "done", "completed_at": "2026-10-05T12:00:00Z", "due_date": "2026-10-05", "deadline_mode": "timed", "due_at": "2026-10-05T12:00:00Z", "due_timezone": "UTC", "original_deadline_mode": "timed", "original_due_date": "2026-10-05", "original_due_at": "2026-10-05T12:00:00Z", "original_due_timezone": "UTC"}
		if i == 1 {
			values["original_due_at"] = "2026-10-05T11:59:59Z"
		}
		if i == 2 {
			values["original_deadline_mode"] = "all_day"
			values["original_due_date"] = ""
			values["original_due_at"] = nil
			values["original_due_timezone"] = ""
			values["deadline_mode"] = "all_day"
			values["due_at"] = nil
			values["due_timezone"] = ""
			values["due_date"] = "2026-10-04"
		}
		if e := s.db.Model(&Task{}).Where("id=?", id).Updates(values).Error; e != nil {
			t.Fatal(e)
		}
	}
	b := financeOK(t, s, "GET", "/api/companies/"+cid+"/reports/tasks/summary?from=2026-10-01&to=2026-10-11", nil, c)
	if b["period"] == nil {
		t.Fatal("current producer omitted frozen selected period")
	}
	snap := s.reportSnapshots[b["snapshot"].(string)]
	if snap.Period.StartInclusive.IsZero() || snap.Period.EndExclusive.IsZero() {
		t.Fatal("producer emitted unresolved period instants")
	}
	facts, e := buildIntelligenceFacts(SourceManifest{Sources: []BoundIntelligenceSource{{SourceKey: "current", Value: snap}}})
	if e != nil {
		t.Fatal(e)
	}
	if _, ok := facts["current:valid"]; ok {
		t.Fatal("transport validity treated as fact")
	}
	for key, wants := range map[string][]string{"current:original_deadline": {"Numerator 1; denominator 2", "Rate 50%", "2026-10-01", "2026-10-11"}, "current:current_deadline": {"Numerator 2; denominator 3", "66.66666666666667"}, "current:deadline_definition": {"exact instants including equality", "company calendar"}, "current:coverage": {"current state", "not historical"}} {
		for _, want := range wants {
			if !strings.Contains(facts[key].Text, want) {
				t.Fatal(key, want, facts[key].Text)
			}
		}
	}
	empty := financeOK(t, s, "GET", "/api/companies/"+cid+"/reports/tasks/summary?from=2026-01-01&to=2026-01-02", nil, c)
	snap = s.reportSnapshots[empty["snapshot"].(string)]
	facts, e = buildIntelligenceFacts(SourceManifest{Sources: []BoundIntelligenceSource{{SourceKey: "current", Value: snap}}})
	if e != nil || !strings.Contains(facts["current:original_deadline"].Text, "Rate unavailable") {
		t.Fatal("zero denominator", e, facts)
	}
	snap.Period = nil
	snap.MetricVersion = 0
	facts, e = buildIntelligenceFacts(SourceManifest{Sources: []BoundIntelligenceSource{{SourceKey: "current", Value: snap}}})
	if e != nil || !strings.Contains(facts["current:original_deadline"].Text, "Selected period unavailable for this legacy snapshot") {
		t.Fatal("legacy period inferred", e, facts)
	}

}

func TestIntelligenceExistingClaimAndExplicitAction(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	allowPublication(t, s, c, cid, conv)
	m := sendMessage(t, s, mc, cid, conv, "actions", "Fictional selected instructions")
	base := "/api/companies/" + cid
	target := base + "/conversations/" + conv + "/task-conversions"
	original := conversionInput(m, taskBody(uid), "manual-primary")
	original["actionId"] = "primary"
	first := financeOK(t, s, "POST", target, original, mc)["id"].(string)
	bundle := financeOK(t, s, "POST", base+"/conversations/"+conv+"/work-actions", map[string]any{"retryKey": "human-actions", "anchorMessageId": m["id"], "sourceRevision": 1, "expectedPolicyVersion": 2, "titles": []string{"Explicit first action", "Explicit alternate action"}}, mc)
	alternate := bundle["actionIds"].([]any)[1].(string)
	s.opts.Intelligence = &IntelligenceConfig{Summary: fakeActionProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
	jid := enqueueSelectedIntelligence(t, s, mc, cid, "action_draft", []map[string]any{{"kind": "message", "id": m["id"], "conversationId": conv, "selectedFieldSet": "body"}}, "review-actions")
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
		t.Fatal(e)
	}
	view := financeOK(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
	basis := map[string]any{"jobId": jid, "resultHash": view["resultHash"], "sourceSetHash": view["sourceSetHash"]}
	task := taskBody(uid)
	task["title"] = "New reviewed fields must not overwrite primary"
	input := conversionInput(m, task, "review-primary")
	input["actionId"] = "primary"
	input["intelligenceBasis"] = basis
	preview := financeOK(t, s, "POST", target+"/preview", input, mc)
	if preview["outcome"] != "existing" || preview["existingTaskId"] != first {
		t.Fatal("preclaimed outcome undisclosed", preview)
	}
	basis["reviewHash"] = strings.Repeat("0", 64)
	input["retryKey"] = "invalid-existing-review"
	stInvalid, _, _ := req(t, s, "POST", target, input, mc)
	if stInvalid != 409 {
		t.Fatal("existing claim bypassed review proof", stInvalid)
	}
	var invalidRetries int64
	s.db.Model(&CommunicationRetry{}).Where("retry_key=?", "invalid-existing-review").Count(&invalidRetries)
	if invalidRetries != 0 {
		t.Fatal("invalid existing claim recorded canonical key")
	}
	input["retryKey"] = "review-primary"
	basis["reviewHash"] = preview["intelligenceReviewHash"]
	result := financeOK(t, s, "POST", target, input, mc)
	if result["id"] != first || result["outcome"] != "existing" {
		t.Fatal("existing claim misreported", result)
	}
	var row Task
	s.db.First(&row, "id=?", first)
	if row.Title == task["title"] {
		t.Fatal("existing task overwritten")
	}
	primaryReview := basis["reviewHash"]
	delete(basis, "reviewHash")
	second := conversionInput(m, taskBody(uid), "review-alternate")
	second["actionId"] = alternate
	second["intelligenceBasis"] = basis
	preview = financeOK(t, s, "POST", target+"/preview", second, mc)
	basis["reviewHash"] = preview["intelligenceReviewHash"]
	created := financeOK(t, s, "POST", target, second, mc)
	if created["id"] == first || created["outcome"] != "created" {
		t.Fatal("explicit alternate not created", created)
	}
	// The original primary payload keeps its own exact audience review hash.
	input["intelligenceBasis"] = map[string]any{"jobId": jid, "resultHash": view["resultHash"], "sourceSetHash": view["sourceSetHash"], "reviewHash": primaryReview}
	var publication IntelligencePublication
	s.db.First(&publication, "job_id=? AND retry_key=?", jid, "review-primary")
	if publication.ID == "" {
		t.Fatal("missing existing-claim provenance")
	}
	s.db.Model(&IntelligenceJob{}).Where("id=?", jid).Update("expires_at", time.Now().UTC().Add(-time.Minute))
	st, _, _ := req(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
	if st != 403 {
		t.Fatal("first expiry", st)
	}
	proof := financeOK(t, s, "POST", base+"/intelligence/jobs/"+jid+"/publication-access", map[string]any{"intelligenceBasis": input["intelligenceBasis"], "retryKey": "review-primary", "operation": "task_conversion"}, mc)
	if proof["committed"] != true {
		t.Fatal("expired existing claim not independently recoverable", proof)
	}
	replay := financeOK(t, s, "POST", target, input, mc)
	if replay["id"] != first || replay["outcome"] != "existing" {
		t.Fatal("existing retry changed outcome", replay)
	}
	var count int64
	s.db.Model(&CommunicationAction{}).Where("company_id=? AND anchor_message_id=?", cid, m["id"]).Count(&count)
	if count != 2 {
		t.Fatal("claims duplicated", count)
	}
}

func TestIntelligenceDisabledWorkerMaintainsRawTTL(t *testing.T) {
	for _, mode := range []string{"missing", "disabled", "identity_failure", "missing_model"} {
		t.Run(mode, func(t *testing.T) {
			s, _, _, id := intelligenceQueuedFixture(t, fakeIntelligenceProvider{})
			lease, e := s.claimIntelligence(t.Context())
			if e != nil || lease == nil {
				t.Fatal(e)
			}
			if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
				t.Fatal(e)
			}
			s.db.Model(&IntelligenceJob{}).Where("id=?", id).Update("expires_at", time.Now().UTC().Add(-time.Minute))
			if mode == "identity_failure" || mode == "missing_model" {
				t.Setenv("INTELLIGENCE_ENABLED", "true")
				scratch := t.TempDir()
				if e := os.Chmod(scratch, 0700); e != nil {
					t.Fatal(e)
				}
				t.Setenv("INTELLIGENCE_SCRATCH_ROOT", scratch)
				owned := filepath.Join(scratch, "schach-intelligence-old")
				os.Mkdir(owned, 0700)
				os.WriteFile(filepath.Join(owned, "lease.json"), []byte(`{"jobId":"retired","leaseToken":"old"}`), 0600)
				os.Chtimes(owned, time.Now().Add(-time.Hour), time.Now().Add(-time.Hour))
				foreign := filepath.Join(scratch, "unmarked")
				os.Mkdir(foreign, 0700)
				os.Chtimes(foreign, time.Now().Add(-time.Hour), time.Now().Add(-time.Hour))
				t.Cleanup(func() {
					if _, e := os.Stat(owned); !os.IsNotExist(e) {
						t.Error("marked owned scratch not retired")
					}
					if _, e := os.Stat(foreign); e != nil {
						t.Error("unmarked path was changed")
					}
				})
				t.Setenv("INTELLIGENCE_PYTHON", "/bin/false")
				t.Setenv("INTELLIGENCE_WHISPER_SCRIPT", "/bin/false")
				t.Setenv("INTELLIGENCE_WHISPER_MODEL", "/bin/false")
				if mode == "missing_model" {
					t.Setenv("INTELLIGENCE_WHISPER_MODEL", filepath.Join(scratch, "absent-model"))
				}
				if e := ConfigureIntelligence(&s.opts); e != nil || s.opts.Intelligence.DisabledReason == "" {
					t.Fatal("expected real identity-command failure", e)
				}
				if s.opts.Intelligence.ScratchRoot != scratch {
					t.Fatal("validated scratch root not retained on identity failure")
				}
			} else if mode == "disabled" {
				s.opts.Intelligence.DisabledReason = "provider_unavailable"
			} else {
				s.opts.Intelligence = nil
			}
			ctx, cancel := context.WithCancel(t.Context())
			done := make(chan struct{})
			go func() { defer close(done); s.RunIntelligenceWorker(ctx) }()
			defer func() {
				cancel()
				select {
				case <-done:
				case <-time.After(time.Second):
					t.Error("maintenance worker Stop did not join")
				}
			}()
			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				var j IntelligenceJob
				s.db.First(&j, "id=?", id)
				if j.State == "expired" && j.ResultJSON == "" {
					return
				}
				time.Sleep(10 * time.Millisecond)
			}
			t.Fatal("provider configuration prevented independent startup retirement")
		})
	}
}

// Observe real PostgreSQL waiters before releasing the owned row lock. This
// proves overlap; sequential claims and a package-wide race run cannot do that.
func intelligencePGBarrier(t *testing.T, s *Server, model any, id string) (func(int), func()) {
	t.Helper()
	tx := s.db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })
	if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(model, "id=?", id).Error; e != nil {
		t.Fatal(e)
	}
	var pid int
	if e := tx.Raw("SELECT pg_backend_pid()").Scan(&pid).Error; e != nil {
		t.Fatal(e)
	}
	wait := func(want int) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			var n int64
			e := s.db.Raw(`WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))) SELECT count(DISTINCT pid) FROM blocked`, pid).Scan(&n).Error
			if e != nil {
				t.Fatal(e)
			}
			if n >= int64(want) {
				t.Logf("actual simultaneous PostgreSQL waiters=%d", n)
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("did not observe %d concurrent database waiters", want)
	}
	return wait, func() {
		if e := tx.Commit().Error; e != nil {
			t.Fatal(e)
		}
	}
}
func TestIntelligencePostgresConcurrentWorkerClaim(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("requires owned PostgreSQL")
	}
	s, _, cid, id := intelligenceQueuedFixture(t, fakeIntelligenceProvider{})
	wait, release := intelligencePGBarrier(t, s, &Company{}, cid)
	type outcome struct {
		lease *IntelligenceLease
		err   error
	}
	done := make(chan outcome, 2)
	for i := 0; i < 2; i++ {
		go func() { l, e := s.claimIntelligence(t.Context()); done <- outcome{l, e} }()
		wait(i + 1)
	}
	release()
	var winner *IntelligenceLease
	for i := 0; i < 2; i++ {
		r := <-done
		if r.err != nil {
			t.Fatal(r.err)
		}
		if r.lease != nil {
			if winner != nil {
				t.Fatal("two workers claimed same job")
			}
			winner = r.lease
		}
	}
	if winner == nil {
		t.Fatal("no claim")
	}
	if e := s.runIntelligenceLease(t.Context(), *winner); e != nil {
		t.Fatal(e)
	}
	var j IntelligenceJob
	s.db.First(&j, "id=?", id)
	if j.Attempts != 1 || j.State != "ready" {
		t.Fatal(j.Attempts, j.State)
	}
}
func TestIntelligencePostgresPublicationRevokeLockOrders(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("requires owned PostgreSQL")
	}
	for _, revokeFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "revoke_first", false: "publication_first"}[revokeFirst], func(t *testing.T) {
			s, c, cid, owner, uid, mc := conversationFixture(t)
			conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
			allowPublication(t, s, c, cid, conv)
			m := sendMessage(t, s, mc, cid, conv, "race-source", "Fictional concurrent publication source")
			s.opts.Intelligence = &IntelligenceConfig{Summary: fakeActionProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
			jid := enqueueSelectedIntelligence(t, s, mc, cid, "action_draft", []map[string]any{{"kind": "message", "id": m["id"], "conversationId": conv, "selectedFieldSet": "body"}}, "race-job")
			l, e := s.claimIntelligence(t.Context())
			if e != nil || l == nil {
				t.Fatal(e)
			}
			if e = s.runIntelligenceLease(t.Context(), *l); e != nil {
				t.Fatal(e)
			}
			base := "/api/companies/" + cid
			target := base + "/conversations/" + conv + "/task-conversions"
			view := financeOK(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
			basis := map[string]any{"jobId": jid, "resultHash": view["resultHash"], "sourceSetHash": view["sourceSetHash"]}
			input := conversionInput(m, taskBody(uid), "race-publish")
			input["intelligenceBasis"] = basis
			preview := financeOK(t, s, "POST", target+"/preview", input, mc)
			basis["reviewHash"] = preview["intelligenceReviewHash"]
			wait, release := intelligencePGBarrier(t, s, &Conversation{}, conv)
			type outcome struct {
				kind   string
				status int
			}
			done := make(chan outcome, 2)
			publish := func() { st, _, _ := req(t, s, "POST", target, input, mc); done <- outcome{"publish", st} }
			revoke := func() {
				st, _, _ := req(t, s, "POST", base+"/conversations/"+conv+"/members", map[string]any{"expectedVersion": 2, "userId": uid, "role": "member", "active": false}, c)
				done <- outcome{"revoke", st}
			}
			if revokeFirst {
				go revoke()
			} else {
				go publish()
			}
			wait(1)
			if revokeFirst {
				go publish()
			} else {
				go revoke()
			}
			wait(2)
			release()
			results := map[string]int{}
			for i := 0; i < 2; i++ {
				r := <-done
				results[r.kind] = r.status
			}
			if results["revoke"] != 200 {
				t.Fatal(results)
			}
			if revokeFirst {
				if results["publish"] != 403 && results["publish"] != 404 {
					t.Fatal(results)
				}
			} else if results["publish"] != 200 {
				t.Fatal(results)
			}
			var n int64
			s.db.Model(&IntelligencePublication{}).Where("job_id=?", jid).Count(&n)
			want := int64(1)
			if revokeFirst {
				want = 0
			}
			if n != want {
				t.Fatal("publication count", n, want)
			}
			st, b, _ := req(t, s, "POST", base+"/intelligence/jobs/"+jid+"/publication-access", map[string]any{"retryKey": "race-publish", "operation": "task_conversion", "intelligenceBasis": basis}, mc)
			if st < 400 || b["current"] == true {
				t.Fatal("revoked proof", st, b)
			}
			t.Logf("both operations overlapped, revokeFirst=%v outcomes=%v publications=%d", revokeFirst, results, n)
		})
	}
}

// This adapter selects every server fact without supplying prose or arithmetic.
type intelligenceAllFactsProvider struct{}

func (intelligenceAllFactsProvider) Generate(_ context.Context, in GroundedInput) (ProviderOutput, error) {
	keys := []string{}
	for k := range in.Facts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	items := []any{}
	for _, k := range keys {
		f := in.Facts[k]
		items = append(items, map[string]any{"factKey": k, "relation": f.Relations[0], "explanationCode": "selected_fact_v1", "sourceKeys": f.SourceKeys})
	}
	raw, e := json.Marshal(map[string]any{"items": items})
	return ProviderOutput{Raw: raw}, e
}
func TestIntelligenceReportOffpageReassignmentConsumer(t *testing.T) {
	for _, kind := range []string{"report_current", "report_snapshot"} {
		t.Run(kind, func(t *testing.T) {
			s, c, cid, owner, uid, mc := conversationFixture(t)
			base := "/api/companies/" + cid
			ids := []string{}
			for i := 0; i < 23; i++ {
				body := taskBody(uid)
				body["title"] = fmt.Sprintf("Off page fixture %02d", i)
				ids = append(ids, createTask(t, s, c, cid, body))
			}
			before := financeOK(t, s, "GET", base+"/bootstrap", nil, mc)["readBasis"]
			var sid, hidden string
			if kind == "report_current" {
				b := financeOK(t, s, "GET", base+"/reports/tasks/summary?from=2026-01-01&to=2026-12-31", nil, mc)
				sid = b["snapshot"].(string)
				page := financeOK(t, s, "GET", base+"/reports/tasks/rows?snapshot="+sid+"&from=2026-01-01&to=2026-12-31&tab=commitments&limit=1", nil, mc)
				if page["hasMore"] != true {
					t.Fatal("fixture not paginated", page)
				}
				first := page["tasks"].([]any)[0].(map[string]any)["id"]
				for _, id := range ids {
					if id != first {
						hidden = id
						break
					}
				}
			} else {
				s.db.Where("company_id=?", cid).Delete(&TaskFact{})
				s.db.Where("company_id=?", cid).Delete(&TaskHistoryCoverage{})
				b := financeOK(t, s, "POST", base+"/reports/history/snapshots", map[string]any{"retryKey": "offpage", "request": historyRequest()}, mc)
				sid = b["snapshotId"].(string)
				page := financeOK(t, s, "GET", base+"/reports/history/snapshots/"+sid+"/rows?metric=coverage.unknown_before&limit=1", nil, mc)
				if page["cursor"] == "" {
					t.Fatal("fixture not paginated", page)
				}
				// Bind the actual row page, then choose an authorized root absent from it.
				raw, _ := json.Marshal(page)
				for _, id := range ids {
					if !strings.Contains(string(raw), id) {
						hidden = id
						break
					}
				}
			}
			if hidden == "" {
				t.Fatal("no off-page root")
			}
			s.opts.Intelligence = &IntelligenceConfig{Summary: intelligenceAllFactsProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
			jid := enqueueSelectedIntelligence(t, s, mc, cid, "report_explanation", []map[string]any{{"kind": kind, "id": sid, "selectedFieldSet": "metrics"}}, "offpage-job")
			lease, e := s.claimIntelligence(t.Context())
			if e != nil || lease == nil {
				t.Fatal(e)
			}
			if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
				t.Fatal(e)
			}
			view := financeOK(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
			if view["result"] == nil {
				t.Fatal(view)
			}
			// Change a nonpage root's audience independently of aggregate/bootstrap epochs.
			if e := s.db.Model(&Task{}).Where("id=?", hidden).Updates(map[string]any{"owner_id": owner, "reviewer_id": "", "created_by": owner}).Error; e != nil {
				t.Fatal(e)
			}
			after := financeOK(t, s, "GET", base+"/bootstrap", nil, mc)["readBasis"]
			if before != after {
				t.Fatal("fixture changed aggregate epoch")
			}
			st, view, _ := req(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
			if st < 400 || view["result"] != nil || view["sources"] != nil {
				t.Fatal("offpage output leak", st, view)
			}
			var j IntelligenceJob
			s.db.First(&j, "id=?", jid)
			if j.ResultJSON != "" {
				t.Fatal("raw result not scrubbed")
			}
			t.Log("actual paginated producer -> ready M10 explanation -> nonpage root reassignment, same bootstrap basis -> denied and scrubbed")
		})
	}
}
func TestIntelligenceMeasurementIndirectPrivateConsumer(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	base := "/api/companies/" + cid
	other := addPerson(t, s, c, cid, "intelligence-observer@example.com", "ceo")
	_ = other
	oc := login(t, s, "intelligence-observer@example.com")
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, mc, cid, conv, "measurement-root", "Private fictional evidence")
	gid := createMeasuredGoal(t, s, c, cid, uid)
	path := base + "/goals/" + gid
	proof := financeOK(t, s, "GET", path+"/evidence-preview?kind=message&sourceId="+m["id"].(string)+"&parentId="+conv, nil, mc)
	saved := financeOK(t, s, "POST", path+"/measurements", map[string]any{"retryKey": "measured", "expectedVersion": 1, "value": 4, "effectiveAt": "2026-10-02T00:00:00Z", "reason": "Shared measured outcome", "evidence": []any{map[string]any{"kind": "message", "sourceId": m["id"], "parentId": conv, "revision": m["revision"], "contentHash": proof["contentHash"]}}}, mc)
	source := map[string]any{"kind": "goal_measurement", "id": saved["measurementId"], "parentId": gid, "selectedFieldSet": "measurement_evidence"}
	financeOK(t, s, "GET", path, nil, oc)
	st, b, _ := req(t, s, "POST", base+"/intelligence/selection-preview", map[string]any{"operation": "report_explanation", "sources": []any{source}}, oc)
	if st < 400 || b["sources"] != nil {
		t.Fatal("ordinary goal audience inherited private evidence", st, b)
	}
	s.opts.Intelligence = &IntelligenceConfig{Summary: intelligenceAllFactsProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
	jid := enqueueSelectedIntelligence(t, s, mc, cid, "report_explanation", []map[string]any{source}, "measurement-job")
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
		t.Fatal(e)
	}
	financeOK(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
	before := financeOK(t, s, "GET", base+"/bootstrap", nil, mc)["readBasis"]
	financeOK(t, s, "POST", base+"/conversations/"+conv+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "member", "active": false}, c)
	if financeOK(t, s, "GET", base+"/bootstrap", nil, mc)["readBasis"] != before {
		t.Fatal("aggregate basis changed")
	}
	financeOK(t, s, "GET", path, nil, mc)
	st, b, _ = req(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
	if st == 200 && b["state"] == "ready" || b["result"] != nil || b["sources"] != nil {
		t.Fatal("indirect root disclosed", st, b)
	}
	var j IntelligenceJob
	s.db.First(&j, "id=?", jid)
	if j.ResultJSON != "" {
		t.Fatal("indirect root result not scrubbed")
	}
}

func TestIntelligencePostgresCompanyFenceCompatibility(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("requires owned PostgreSQL")
	}
	s, c, cid, owner, uid, _ := conversationFixture(t)
	tx := s.db.Begin()
	defer tx.Rollback()
	if e := lockIntelligenceCompany(tx, cid); e != nil {
		t.Fatal(e)
	}
	var pid int
	tx.Raw("SELECT pg_backend_pid()").Scan(&pid)
	// This is the actual FK lock mode needed by a concurrent private writer.
	if e := s.db.Transaction(func(other *gorm.DB) error {
		var company Company
		return other.Clauses(clause.Locking{Strength: "KEY SHARE", Options: "NOWAIT"}).First(&company, "id=?", cid).Error
	}); e != nil {
		t.Fatal("FK key share blocked", e)
	}
	done := make(chan int, 2)
	go func() {
		st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"role": "manager", "expectedVersion": 1}, c)
		done <- st
	}()
	go func() { st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks", taskBody(owner), c); done <- st }()
	deadline := time.Now().Add(5 * time.Second)
	blocked := int64(0)
	for time.Now().Before(deadline) {
		s.db.Raw(`WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(DISTINCT pid) FROM blocked`, pid).Scan(&blocked)
		if blocked == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if blocked != 2 {
		t.Fatal("authority and business writes did not wait", blocked)
	}
	if e := tx.Commit().Error; e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		if st := <-done; st != 200 {
			t.Fatal("serialized writer", st)
		}
	}
	var company Company
	s.db.First(&company, "id=?", cid)
	if company.PermissionEpoch <= 1 {
		t.Fatal("authority write not committed")
	}
	t.Log("FK KEY SHARE proceeded; actual authority PATCH and task POST both waited before committing")
	// Ordinary unique-key mutation still obtains strongest Company UPDATE before
	// touching memberships. Do not introduce a late lock upgrade for slug writes.
	keytx := s.db.Begin()
	defer keytx.Rollback()
	if e := keytx.Clauses(clause.Locking{Strength: "KEY SHARE"}).First(&company, "id=?", cid).Error; e != nil {
		t.Fatal(e)
	}
	keytx.Raw("SELECT pg_backend_pid()").Scan(&pid)
	go func() {
		st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid, map[string]any{"slug": "changed-fixture-slug"}, c)
		done <- st
	}()
	deadline = time.Now().Add(5 * time.Second)
	blocked = 0
	for time.Now().Before(deadline) {
		s.db.Raw("SELECT count(*) FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid))", pid).Scan(&blocked)
		if blocked > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if blocked != 1 {
		t.Fatal("key mutator did not first request strongest fence", blocked)
	}
	var members []Membership
	if e := keytx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).Where("company_id=?", cid).Find(&members).Error; e != nil {
		t.Fatal("key mutator locked downstream before Company", e)
	}
	keytx.Commit()
	if st := <-done; st != 200 {
		t.Fatal("company key mutation", st)
	}
}

func TestIntelligenceOutcomeMigration(t *testing.T) {
	for _, suffix := range []string{"up", "down"} {
		name := "58_intelligence_publication_outcome." + suffix + ".sql"
		a, e := os.ReadFile("../migrations/" + name)
		if e != nil {
			t.Fatal(e)
		}
		b, e := os.ReadFile("../../encore/api/migrations/" + name)
		if e != nil || !bytes.Equal(a, b) {
			t.Fatal("SQL58 mirrors", e)
		}
	}
	if os.Getenv("TEST_DATABASE_URL") == "" {
		return
	}
	s, _, _, id := intelligenceQueuedFixture(t, fakeIntelligenceProvider{})
	var j IntelligenceJob
	s.db.First(&j, "id=?", id)
	down, _ := os.ReadFile("../migrations/58_intelligence_publication_outcome.down.sql")
	up, _ := os.ReadFile("../migrations/58_intelligence_publication_outcome.up.sql")
	if e := s.db.Exec(string(down)).Error; e != nil {
		t.Fatal(e)
	}
	if e := s.db.Exec(`INSERT INTO intelligence_publications(id,job_id,company_id,actor_id,result_hash,destination_kind,canonical_result_id,canonical_operation,retry_key,reviewed_payload_hash,manifest) VALUES(?,?,?,?,?,'task',?,'task_conversion',?,?,'{}')`, "legacy-publication", id, j.CompanyID, j.ActorID, "legacy-hash", "canonical-result", "legacy-key", "reviewed-hash").Error; e != nil {
		t.Fatal(e)
	}
	if e := s.db.Exec(string(up)).Error; e != nil {
		t.Fatal(e)
	}
	var pub IntelligencePublication
	if e := s.db.First(&pub, "id=?", "legacy-publication").Error; e != nil || pub.Outcome != "created" {
		t.Fatal("legacy created outcome", e, pub.Outcome)
	}
	if e := s.db.Model(&IntelligencePublication{}).Where("id=?", pub.ID).Update("outcome", "fabricated").Error; e == nil {
		t.Fatal("unbounded outcome accepted")
	}
	if e := s.db.Exec(string(down)).Error; e != nil {
		t.Fatal(e)
	}
	if e := s.db.Exec(string(up)).Error; e != nil {
		t.Fatal(e)
	}
	var n int64
	s.db.Model(&IntelligencePublication{}).Count(&n)
	if n != 1 {
		t.Fatal("migration lost provenance")
	}
}

func TestIntelligenceReassignedCompositeAndOutsideDM(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	base := "/api/companies/" + cid
	other := addPerson(t, s, c, cid, "intelligence-private-peer@example.com", "member")
	dm := newConversation(t, s, mc, cid, []string{uid, other}, "dm")
	m := sendMessage(t, s, mc, cid, dm, "private-dm", "Fictional private source")
	if st, _ := intelligencePreview(t, s, c, cid, []map[string]any{{"kind": "message", "id": m["id"], "conversationId": dm, "selectedFieldSet": "body"}}); st != 404 {
		t.Fatal("founder outside DM", st)
	}
	first := createTask(t, s, c, cid, taskBody(uid))
	second := createTask(t, s, c, cid, taskBody(uid))
	sources := []map[string]any{{"kind": "task_fields", "id": first, "selectedFieldSet": "narrative"}, {"kind": "task_fields", "id": second, "selectedFieldSet": "narrative"}}
	s.opts.Intelligence = &IntelligenceConfig{Summary: fakeIntelligenceProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
	id := enqueueSelectedIntelligence(t, s, mc, cid, "summary", sources, "composite-reassign")
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
		t.Fatal(e)
	}
	financeOK(t, s, "GET", base+"/intelligence/jobs/"+id, nil, mc)
	before := financeOK(t, s, "GET", base+"/bootstrap", nil, mc)["readBasis"]
	if e := s.db.Model(&Task{}).Where("id=?", second).Updates(map[string]any{"owner_id": owner, "created_by": owner}).Error; e != nil {
		t.Fatal(e)
	}
	if financeOK(t, s, "GET", base+"/bootstrap", nil, mc)["readBasis"] != before {
		t.Fatal("aggregate basis changed")
	}
	st, b, _ := req(t, s, "GET", base+"/intelligence/jobs/"+id, nil, mc)
	if st < 400 || b["result"] != nil || b["sources"] != nil {
		t.Fatal("partial composite claim exposed", st, b)
	}
}

func TestIntelligenceMediaAndUnrevisedMessageCurrentAuthorization(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	base := "/api/companies/" + cid
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	s.opts.MediaStore = store
	s.opts.MediaScanner = cleanTestScanner{}
	wave := ownedWave()
	hash := sha256.Sum256(wave)
	mediaPath := base + "/conversations/" + conv + "/media"
	reservation := financeOK(t, s, "POST", mediaPath, map[string]any{"fileName": "fictional.wav", "size": len(wave), "sha256": hex.EncodeToString(hash[:])}, mc)
	mid := reservation["id"].(string)
	request := httptest.NewRequest("POST", mediaPath+"/"+mid+"/upload", bytes.NewReader(wave))
	request.AddCookie(mc)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, request)
	if w.Code != 200 {
		t.Fatal("upload", w.Code)
	}
	financeOK(t, s, "POST", mediaPath+"/"+mid+"/finalize", map[string]any{}, mc)
	sent := financeOK(t, s, "POST", base+"/conversations/"+conv+"/messages", map[string]any{"clientMessageId": "intelligence-audio", "body": "Selected fictional audio", "mediaIds": []string{mid}}, mc)
	message := sent["message"].(map[string]any)
	other := sendMessage(t, s, mc, cid, conv, "other-parent", "Other fictional message")
	source := map[string]any{"kind": "voice_media", "id": mid, "parentId": message["id"], "conversationId": conv, "selectedFieldSet": "audio"}
	preview := func() int {
		st, _, _ := req(t, s, "POST", base+"/intelligence/selection-preview", map[string]any{"operation": "transcript", "sources": []any{source}}, mc)
		return st
	}
	if st := preview(); st != 200 {
		t.Fatal("real attached clean selected media", st)
	}
	var original CommunicationMedia
	s.db.First(&original, "id=?", mid)
	for _, kind := range []string{"nonclean", "expired", "unattached", "wrong_parent", "removed", "purged"} {
		t.Run(kind, func(t *testing.T) {
			switch kind {
			case "nonclean":
				s.db.Model(&CommunicationMedia{}).Where("id=?", mid).Update("state", "rejected")
			case "expired":
				s.db.Model(&CommunicationMedia{}).Where("id=?", mid).Update("expires_at", time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano))
			case "unattached":
				s.db.Model(&CommunicationMedia{}).Where("id=?", mid).Update("message_id", "")
			case "wrong_parent":
				source["parentId"] = other["id"]
			case "removed":
				s.db.Model(&Message{}).Where("id=?", message["id"]).Update("removed", true)
			case "purged":
				s.db.Model(&Message{}).Where("id=?", message["id"]).Update("content_purged", true)
			}
			if st := preview(); st < 400 {
				t.Fatal("unavailable selected media", kind, st)
			}
			source["parentId"] = message["id"]
			s.db.Model(&CommunicationMedia{}).Where("id=?", mid).Updates(map[string]any{"state": original.State, "expires_at": original.ExpiresAt, "message_id": original.MessageID})
			s.db.Model(&Message{}).Where("id=?", message["id"]).Updates(map[string]any{"removed": false, "content_purged": false})
		})
	}
}
func TestIntelligenceCurrentReportIndirectReferenceConsumer(t *testing.T) {
	for _, field := range []string{"parent", "dependency"} {
		t.Run(field, func(t *testing.T) {
			s, c, cid, owner, uid, mc := conversationFixture(t)
			base := "/api/companies/" + cid
			parentBody := taskBody(uid)
			parentBody["dueDate"] = "2026-11-20"
			parent := createTask(t, s, c, cid, parentBody)
			childBody := taskBody(uid)
			if field == "parent" {
				childBody["parentId"] = parent
			} else {
				childBody["dependencies"] = []string{parent}
			}
			createTask(t, s, c, cid, childBody)
			b := financeOK(t, s, "GET", base+"/reports/tasks/summary?from=2026-10-20&to=2026-10-20", nil, mc)
			snap := s.reportSnapshots[b["snapshot"].(string)]
			for _, row := range snap.Rows {
				if row.ID == parent {
					t.Fatal("reference fixture is a selected row")
				}
			}
			s.opts.Intelligence = &IntelligenceConfig{Summary: intelligenceAllFactsProvider{}, Identity: ProviderIdentity{Name: "fixture", Version: "1"}}
			jid := enqueueSelectedIntelligence(t, s, mc, cid, "report_explanation", []map[string]any{{"kind": "report_current", "id": b["snapshot"], "selectedFieldSet": "metrics"}}, "indirect-reference")
			lease, e := s.claimIntelligence(t.Context())
			if e != nil || lease == nil {
				t.Fatal(e)
			}
			if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
				t.Fatal(e)
			}
			financeOK(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
			before := financeOK(t, s, "GET", base+"/bootstrap", nil, mc)["readBasis"]
			s.db.Model(&Task{}).Where("id=?", parent).Updates(map[string]any{"owner_id": owner, "created_by": owner})
			if financeOK(t, s, "GET", base+"/bootstrap", nil, mc)["readBasis"] != before {
				t.Fatal("aggregate basis changed")
			}
			st, view, _ := req(t, s, "GET", base+"/intelligence/jobs/"+jid, nil, mc)
			if st < 400 || view["result"] != nil {
				t.Fatal("indirect reference output leak", st, view)
			}
		})
	}
}
