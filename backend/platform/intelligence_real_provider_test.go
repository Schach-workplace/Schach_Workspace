package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestIntelligencePinnedProviderApplication(t *testing.T) {
	if os.Getenv("TEST_INTELLIGENCE_REAL") != "1" {
		t.Skip("explicit owned pinned-provider acceptance")
	}
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	conv := newConversation(t, s, c, cid, []string{uid}, "group")
	allowPublication(t, s, c, cid, conv)
	root := t.TempDir()
	scratch := filepath.Join(root, "scratch")
	if e := os.Mkdir(scratch, 0700); e != nil {
		t.Fatal(e)
	}
	script, e := filepath.Abs("../tools/whisper_transcribe.py")
	if e != nil {
		t.Fatal(e)
	}
	for key, value := range map[string]string{"INTELLIGENCE_ENABLED": "true", "INTELLIGENCE_SCRATCH_ROOT": scratch, "INTELLIGENCE_PYTHON": "/tmp/schach-improvements-ai-venv/bin/python", "INTELLIGENCE_WHISPER_SCRIPT": script, "INTELLIGENCE_WHISPER_MODEL": "/tmp/schach-improvements-ai-models/whisper-direct", "INTELLIGENCE_OLLAMA_URL": "http://127.0.0.1:11435"} {
		t.Setenv(key, value)
	}
	if e := ConfigureIntelligence(&s.opts); e != nil || s.opts.Intelligence == nil || s.opts.Intelligence.DisabledReason != "" {
		t.Fatal("configured pinned providers unavailable", e)
	}
	store, e := NewFileMediaStore(filepath.Join(root, "media"))
	if e != nil {
		t.Fatal(e)
	}
	s.opts.MediaStore = store
	s.opts.MediaScanner = ClamAVScanner{Address: "127.0.0.1:13310"}
	wave, e := os.ReadFile("/tmp/schach-roadmap-native-runtime-20261011/m10-fixtures/public-speech-fixture.wav")
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256(wave)
	digest := hex.EncodeToString(hash[:])
	if digest != "40caa4d41e4f0458f9ccaaaa1a16dff9fe47c14f5bc5d40713bde536325f967a" {
		t.Fatal("public fixture identity")
	}
	path := "/api/companies/" + cid
	reviewer := addPerson(t, s, c, cid, "public-reviewer@example.com", "member")
	department := financeOK(t, s, "POST", path+"/departments", map[string]any{"name": "Public review", "headId": "", "color": "#6366F1", "description": "Fictional acceptance"}, c)["id"].(string)
	category := financeOK(t, s, "POST", path+"/expense-categories", map[string]any{"name": "Fictional materials", "color": "#F97316", "receiptRequired": false}, c)["id"].(string)
	mediaPath := path + "/conversations/" + conv + "/media"
	st, b, _ := req(t, s, "POST", mediaPath, map[string]any{"fileName": "Public speech.wav", "size": len(wave), "sha256": digest}, c)
	if st != 200 {
		t.Fatal("reserve", st)
	}
	mid := b["id"].(string)
	upload := httptest.NewRequest("POST", mediaPath+"/"+mid+"/upload", bytes.NewReader(wave))
	upload.AddCookie(c)
	response := httptest.NewRecorder()
	s.ServeHTTP(response, upload)
	if response.Code != 200 {
		t.Fatal("upload", response.Code)
	}
	st, _, _ = req(t, s, "POST", mediaPath+"/"+mid+"/finalize", map[string]any{}, c)
	if st != 200 {
		t.Fatal("real clean scanner", st)
	}
	st, b, _ = req(t, s, "POST", path+"/conversations/"+conv+"/messages", map[string]any{"clientMessageId": "public-audio", "body": "Public speech selected for a review exercise.", "mediaIds": []string{mid}}, c)
	if st != 200 {
		t.Fatal("attach", st)
	}
	message := b["message"].(map[string]any)
	messageID := message["id"].(string)
	generate := func(op string, sources []map[string]any) IntelligenceJob {
		t.Helper()
		input := map[string]any{"operation": op, "sources": sources}
		st, p, _ := req(t, s, "POST", path+"/intelligence/selection-preview", input, c)
		if st != 200 {
			t.Fatal("preview", op, st)
		}
		input["selectionHash"] = p["selectionHash"]
		input["retryKey"] = op + "-real"
		input["optIn"] = map[string]any{"accepted": true, "policyVersion": intelligencePolicy}
		st, b, _ := req(t, s, "POST", path+"/intelligence/jobs", input, c)
		if st != 202 {
			t.Fatal("enqueue", op, st)
		}
		lease, e := s.claimIntelligence(t.Context())
		if e != nil || lease == nil {
			t.Fatal("claim", e)
		}
		started := time.Now()
		if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
			t.Fatal("real adapter", op, e)
		}
		var j IntelligenceJob
		db.First(&j, "id=?", b["jobId"])
		if j.State != "ready" || j.ResultJSON == "" {
			t.Fatal("not ready", op, j.ReasonCode)
		}
		t.Logf("operation=%s elapsed_ms=%d validated_result_bytes=%d", op, time.Since(started).Milliseconds(), len(j.ResultJSON))
		st, _, _ = req(t, s, "GET", path+"/intelligence/jobs/"+j.ID, nil, c)
		if st != 200 {
			t.Fatal("authorized read", op, st)
		}
		return j
	}
	transcript := generate("transcript", []map[string]any{{"kind": "voice_media", "id": mid, "parentId": messageID, "conversationId": conv, "selectedFieldSet": "audio", "expectedRevision": message["revision"]}})
	var result IntelligenceResult
	json.Unmarshal([]byte(transcript.ResultJSON), &result)
	text := ""
	for _, segment := range result.Segments {
		text += segment.Text
	}
	if !strings.Contains(strings.ToLower(text), "country") {
		t.Fatal("public English transcript incoherent")
	}
	additional := sendMessage(t, s, c, cid, conv, "public-review-action", "Prepare a reviewed task to discuss the public speech. A person will choose the owner, reviewer and deadline.")
	sources := []map[string]any{{"kind": "transcript", "id": transcript.ID, "selectedFieldSet": "segments"}, {"kind": "message", "id": additional["id"], "conversationId": conv, "expectedRevision": additional["revision"], "selectedFieldSet": "body"}}
	generate("summary", sources)
	action := generate("action_draft", sources)
	reviewed := financeOK(t, s, "GET", path+"/intelligence/jobs/"+action.ID, nil, c)
	basis := map[string]any{"jobId": action.ID, "resultHash": action.ResultHash, "sourceSetHash": action.SourceSetHash}
	publication := reviewed["publication"].(map[string]any)
	task := taskBody(uid)
	task["reviewerId"] = reviewer
	task["requiresApproval"] = true
	task["dueDate"] = "2026-11-15"
	task["title"] = "Human reviewed public speech discussion"
	input := conversionInput(additional, task, "real-publication-task")
	input["sources"] = publication["sources"]
	input["intelligenceBasis"] = basis
	target := path + "/conversations/" + conv + "/task-conversions"
	preview := financeOK(t, s, "POST", target+"/preview", input, c)
	basis["reviewHash"] = preview["intelligenceReviewHash"]
	created := financeOK(t, s, "POST", target, input, c)
	replay := financeOK(t, s, "POST", target, input, c)
	if created["id"] != replay["id"] {
		t.Fatal("real canonical task replay duplicated")
	}
	var count int64
	db.Model(&Task{}).Where("id=?", created["id"]).Count(&count)
	if count != 1 {
		t.Fatal("canonical count")
	}
	delete(basis, "reviewHash")
	delete(input, "task")
	input["retryKey"] = "real-publication-expense"
	input["expense"] = map[string]any{"title": "Fictional reviewed materials", "description": "Public exercise", "departmentId": department, "categoryId": category, "vendor": "Fictional supplier", "expenseDate": "2026-10-11", "amountMinor": 130050, "taskId": "", "projectId": "", "invoiceNumber": "", "receiptExceptionReason": ""}
	target = path + "/conversations/" + conv + "/expense-conversions"
	preview = financeOK(t, s, "POST", target+"/preview", input, c)
	basis["reviewHash"] = preview["intelligenceReviewHash"]
	created = financeOK(t, s, "POST", target, input, c)
	replay = financeOK(t, s, "POST", target, input, c)
	if created["id"] != replay["id"] {
		t.Fatal("real canonical expense replay duplicated")
	}
	delete(basis, "reviewHash")
	intake := map[string]any{"retryKey": "real-publication-intake", "anchorMessageId": additional["id"], "sourceRevision": additional["revision"], "expectedPolicyVersion": 2, "departmentId": department, "title": "Human reviewed public request", "summary": "Discuss public speech", "intelligenceBasis": basis}
	target = path + "/conversations/" + conv + "/requests"
	preview = financeOK(t, s, "POST", target+"/preview", intake, c)
	basis["reviewHash"] = preview["intelligenceReviewHash"]
	created = financeOK(t, s, "POST", target, intake, c)
	replay = financeOK(t, s, "POST", target, intake, c)
	if created["id"] != replay["id"] {
		t.Fatal("real canonical intake replay duplicated")
	}
	snapshot := financeOK(t, s, "POST", path+"/reports/history/snapshots", map[string]any{"retryKey": "real-historical-explanation", "request": historyRequest()}, c)
	generate("report_explanation", []map[string]any{{"kind": "report_snapshot", "id": snapshot["snapshotId"], "selectedFieldSet": "metrics"}})
	t.Log("reviewed task/expense/intake canonical retries each returned one business record; historical explanation validated against server facts")
	entries, e := os.ReadDir(scratch)
	if e != nil || len(entries) != 0 {
		t.Fatal("scratch cleanup", e)
	}
}

func TestIntelligenceRealContextBoundaryAndCancellation(t *testing.T) {
	if os.Getenv("TEST_INTELLIGENCE_REAL") != "1" {
		t.Skip("explicit owned pinned-provider acceptance")
	}
	p, e := NewLocalOllama("http://127.0.0.1:11435")
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 120*time.Second)
	defer cancel()
	in := GroundedInput{Operation: "summary", Sources: []GroundedSource{{Key: "fictional-selected", Text: "The fictional review is ready. Repeated non-instruction context: " + strings.Repeat("Fictional context supports a pending review. ", 250)}}}
	p.ContextTokens = 512
	p.OutputTokens = 1
	before := time.Now()
	out, e := p.Generate(ctx, in)
	var api *apiError
	if !errors.As(e, &api) || api.Code != "source_too_large" || len(out.Raw) != 0 {
		t.Fatal("actual bounded overflow mapping", e)
	}
	t.Logf("actual_context_overflow mapped=source_too_large result_bytes=0 elapsed_ms=%d", time.Since(before).Milliseconds())
	p.ContextTokens = 8192
	p.OutputTokens = 1024
	before = time.Now()
	out, e = p.Generate(ctx, in)
	if e != nil {
		t.Fatal("configured full-context success", e)
	}
	if out.InputTokens < 512 || out.InputTokens > 6144 || out.OutputTokens > 1024 {
		t.Fatalf("actual token boundary input=%d output=%d", out.InputTokens, out.OutputTokens)
	}
	if _, e = validateIntelligenceOutput("summary", out.Raw, SourceManifest{Sources: []BoundIntelligenceSource{{SourceKey: "fictional-selected"}}}, nil); e != nil {
		t.Fatal(e)
	}
	t.Logf("actual_configured_context_success input_tokens=%d output_tokens=%d elapsed_ms=%d", out.InputTokens, out.OutputTokens, time.Since(before).Milliseconds())
	short, stop := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer stop()
	before = time.Now()
	_, e = p.Generate(short, in)
	if e == nil || time.Since(before) > 3*time.Second {
		t.Fatal("real adapter cancellation not bounded", e)
	}
	t.Log("actual adapter request cancellation joined without output")
}

func TestIntelligenceRealOverflowIsTerminalInApplication(t *testing.T) {
	if os.Getenv("TEST_INTELLIGENCE_REAL") != "1" {
		t.Skip("explicit owned pinned-provider acceptance")
	}
	p, e := NewLocalOllama("http://127.0.0.1:11435")
	if e != nil {
		t.Fatal(e)
	}
	p.ContextTokens = 512
	p.OutputTokens = 1
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	body := taskBody(uid)
	body["description"] = strings.Repeat("Fictional context supports a pending review. ", 250)
	id := createTask(t, s, c, cid, body)
	s.opts.Intelligence = &IntelligenceConfig{Summary: p, Identity: p.Identity}
	source := []map[string]any{{"kind": "task_fields", "id": id, "selectedFieldSet": "narrative"}}
	_, preview := intelligencePreview(t, s, c, cid, source)
	st, j, _ := req(t, s, "POST", "/api/companies/"+cid+"/intelligence/jobs", map[string]any{"operation": "summary", "sources": source, "selectionHash": preview["selectionHash"], "retryKey": "real-bounded-context", "optIn": map[string]any{"accepted": true, "policyVersion": intelligencePolicy}}, c)
	if st != 202 {
		t.Fatal(st, j)
	}
	var before, after int64
	db.Model(&Task{}).Count(&before)
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	_ = s.runIntelligenceLease(t.Context(), *lease)
	var row IntelligenceJob
	db.First(&row, "id=?", j["jobId"])
	db.Model(&Task{}).Count(&after)
	if row.State != "failed" || row.ReasonCode != "source_too_large" || row.ResultJSON != "" || row.Attempts != 1 || before != after {
		t.Fatal("actual overflow did not fail without output/retry/mutation", row.State, row.ReasonCode, row.Attempts)
	}
	var publications int64
	db.Model(&IntelligencePublication{}).Count(&publications)
	if publications != 0 {
		t.Fatal("overflow publication")
	}
	t.Log("actual adapter overflow → terminal source_too_large; one attempt, zero result bytes, zero publications and unchanged business rows")
}

func TestIntelligencePinnedCurrentReportFacts(t *testing.T) {
	if os.Getenv("TEST_INTELLIGENCE_REAL") != "1" {
		t.Skip("explicit owned current-report adapter acceptance")
	}
	p, e := NewLocalOllama("http://127.0.0.1:11435")
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	e = p.Verify(ctx)
	cancel()
	if e != nil {
		t.Fatal(e)
	}
	s, c, cid, owner, _, _ := conversationFixture(t)
	createTask(t, s, c, cid, taskBody(owner))
	base := "/api/companies/" + cid
	summary := financeOK(t, s, "GET", base+"/reports/tasks/summary?from=2026-10-01&to=2026-10-11", nil, c)
	s.opts.Intelligence = &IntelligenceConfig{Summary: p, Identity: p.Identity}
	id := enqueueSelectedIntelligence(t, s, c, cid, "report_explanation", []map[string]any{{"kind": "report_current", "id": summary["snapshot"], "selectedFieldSet": "metrics"}}, "actual-current-report")
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	started := time.Now()
	if e = s.runIntelligenceLease(t.Context(), *lease); e != nil {
		t.Fatal("actual current-report bounded adapter outcome", e)
	}
	view := financeOK(t, s, "GET", base+"/intelligence/jobs/"+id, nil, c)
	if view["state"] != "ready" {
		t.Fatal(view["state"], view["reasonCode"])
	}
	var job IntelligenceJob
	s.db.First(&job, "id=?", id)
	manifest, e := loadIntelligenceManifest(s.db, job)
	if e != nil {
		t.Fatal(e)
	}
	// Re-capture through the same actual frozen producer, then verify every model
	// selection is rendered with exact server prose, period and independent rates.
	var source IntelligenceSource
	s.db.First(&source, "job_id=?", id)
	snap := s.reportSnapshots[summary["snapshot"].(string)]
	source.Binding.Value = snap
	manifest.Sources = []BoundIntelligenceSource{source.Binding}
	facts, e := buildIntelligenceFacts(manifest)
	if e != nil {
		t.Fatal(e)
	}
	var result IntelligenceResult
	if e = json.Unmarshal([]byte(job.ResultJSON), &result); e != nil {
		t.Fatal(e)
	}
	if len(result.Items) == 0 {
		t.Fatal("no actual fact selections")
	}
	for _, item := range result.Items {
		if item.Text != facts[item.FactKey].Text {
			t.Fatal("renderer departed from server fact")
		}
	}
	for _, suffix := range []string{"original_deadline", "current_deadline"} {
		fact := facts[source.SourceKey+":"+suffix]
		if !strings.Contains(fact.Text, "Rate unavailable") || !strings.Contains(fact.Text, "2026-10-01 through 2026-10-11") {
			t.Fatal("actual zero-denominator period fact", fact.Text)
		}
	}
	t.Logf("actual_current_report elapsed_ms=%d selected_items=%d server_facts=%d period=2026-10-01..2026-10-11 model=%s config=%s", time.Since(started).Milliseconds(), len(result.Items), len(facts), p.Identity.Name, p.Identity.ConfigHash)
}
