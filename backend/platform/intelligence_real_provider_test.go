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
