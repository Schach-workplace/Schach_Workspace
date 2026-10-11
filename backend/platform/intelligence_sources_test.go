package platform

import (
	"net/http"
	"testing"
)

func intelligencePreview(t *testing.T, s *Server, c *http.Cookie, cid string, sources []map[string]any) (int, map[string]any) {
	t.Helper()
	status, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/intelligence/selection-preview", map[string]any{"operation": "summary", "sources": sources}, c)
	return status, b
}
func TestIntelligenceSelectionBinding(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	tasks := []Task{}
	for i := 0; i < 2; i++ {
		id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
		var task Task
		db.First(&task, "id=?", id)
		tasks = append(tasks, task)
	}
	one := map[string]any{"kind": "task_fields", "id": tasks[0].ID, "selectedFieldSet": "narrative", "expectedVersion": tasks[0].Version}
	two := map[string]any{"kind": "task_fields", "id": tasks[1].ID, "selectedFieldSet": "narrative", "expectedVersion": tasks[1].Version}
	status, a := intelligencePreview(t, s, c, cid, []map[string]any{one, two})
	if status != 200 {
		t.Fatalf("authorized selected task preview: %d %v", status, a)
	}
	status, b := intelligencePreview(t, s, c, cid, []map[string]any{two, one})
	if status != 200 || a["selectionHash"] != b["selectionHash"] {
		t.Fatal(status, a, b)
	}
	for _, sources := range [][]map[string]any{{one, one}, {{"kind": "directory", "id": "all", "selectedFieldSet": "narrative"}}, {{"kind": "task_fields", "id": tasks[0].ID}}, {{"kind": "task_fields", "id": tasks[0].ID, "selectedFieldSet": "narrative", "parentId": "spoof"}}} {
		if status, _ := intelligencePreview(t, s, c, cid, sources); status < 400 {
			t.Fatal("invalid source accepted", sources)
		}
	}
	one["expectedVersion"] = tasks[0].Version + 1
	if status, _ := intelligencePreview(t, s, c, cid, []map[string]any{one}); status != 409 {
		t.Fatal("stale source", status)
	}
}
func TestIntelligenceNestedEvidenceBinding(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	taskID := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	var task Task
	db.First(&task, "id=?", taskID)
	comment := Comment{ID: "intel-comment", CompanyID: cid, TaskID: task.ID, UserID: me(t, s, c), Body: "Exact selected comment", CreatedAt: nowString()}
	if e := db.Create(&comment).Error; e != nil {
		t.Fatal(e)
	}
	source := map[string]any{"kind": "task_comment", "id": comment.ID, "parentId": task.ID, "selectedFieldSet": "body"}
	status, b := intelligencePreview(t, s, c, cid, []map[string]any{source})
	if status != 200 {
		t.Fatal(status, b)
	}
	hash := b["sources"].([]any)[0].(map[string]any)["contentHash"]
	db.Model(&comment).Update("body", "Changed without task version")
	source["expectedContentHash"] = hash
	if status, _ := intelligencePreview(t, s, c, cid, []map[string]any{source}); status != 409 {
		t.Fatal("nested edit accepted", status)
	}
	fields := map[string]any{"kind": "task_fields", "id": task.ID, "selectedFieldSet": "narrative"}
	_, before := intelligencePreview(t, s, c, cid, []map[string]any{fields})
	db.Model(&comment).Update("body", "Another independent edit")
	_, after := intelligencePreview(t, s, c, cid, []map[string]any{fields})
	if before["selectionHash"] != after["selectionHash"] {
		t.Fatal("unselected comment changed fields")
	}
}

func TestIntelligenceNestedEvidenceRecordAndHistorical(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	convID := newConversation(t, s, c, cid, []string{uid}, "group")
	var conv Conversation
	db.First(&conv, "id=?", convID)
	sent := sendMessage(t, s, c, cid, convID, "int-message", "Selected anchor")
	var m Message
	db.First(&m, "id=?", sent["id"])
	created := financeOK(t, s, "POST", "/api/companies/"+cid+"/conversations/"+convID+"/records", map[string]any{"retryKey": "int-record", "kind": "poll", "anchorMessageId": m.ID, "sourceRevision": 1, "title": "Decision", "body": "Selected decision", "recipientIds": []string{uid}, "options": []string{"First", "Second"}}, c)
	var record CommunicationRecord
	db.First(&record, "id=?", created["id"])
	if record.ID == "" {
		db.Where("conversation_id=?", convID).First(&record)
	}
	var response CommunicationRecipient
	db.First(&response, "record_id=? AND user_id=?", record.ID, uid)
	db.Model(&response).Update("response", "First")
	source := map[string]any{"kind": "record", "id": record.ID, "parentId": m.ID, "conversationId": conv.ID, "selectedFieldSet": "content_responses"}
	st, b := intelligencePreview(t, s, c, cid, []map[string]any{source})
	if st != 200 {
		t.Fatal(st, b)
	}
	hash := b["sources"].([]any)[0].(map[string]any)["contentHash"]
	db.Model(&response).Update("response", "Second")
	source["expectedContentHash"] = hash
	if st, _ := intelligencePreview(t, s, c, cid, []map[string]any{source}); st != 409 {
		t.Fatal("same-record-revision response changed", st)
	}
	delete(source, "expectedContentHash")
	source["selectedFieldSet"] = "content"
	_, before := intelligencePreview(t, s, c, cid, []map[string]any{source})
	db.Model(&response).Update("response", "First")
	_, after := intelligencePreview(t, s, c, cid, []map[string]any{source})
	if before["selectionHash"] != after["selectionHash"] {
		t.Fatal("unselected responses included")
	}
	db.Model(&m).Update("content_purged", true)
	if st, _ := intelligencePreview(t, s, c, cid, []map[string]any{source}); st < 400 {
		t.Fatal("purged anchor accepted")
	}
	// Immutable historical facts survive readable parent edits, but never deletion.
	taskID := createTask(t, s, c, cid, taskBody(uid))
	path := "/api/companies/" + cid
	db.Where("company_id=?", cid).Delete(&TaskFact{})
	db.Where("company_id=?", cid).Delete(&TaskHistoryCoverage{})
	st, b, _ = req(t, s, "POST", path+"/reports/history/snapshots", map[string]any{"retryKey": "int-history", "request": historyRequest()}, c)
	if st != 200 {
		t.Fatal(st, b)
	}
	historical := map[string]any{"operation": "report_explanation", "sources": []any{map[string]any{"kind": "report_snapshot", "id": b["snapshotId"], "selectedFieldSet": "metrics"}}}
	st, b, _ = req(t, s, "POST", path+"/intelligence/selection-preview", historical, c)
	if st != 200 {
		t.Fatal(st, b)
	}
	original := b["selectionHash"]
	req(t, s, "PATCH", path+"/tasks/"+taskID, map[string]any{"version": 1, "title": "Readable edit"}, c)
	st, b, _ = req(t, s, "POST", path+"/intelligence/selection-preview", historical, c)
	if st != 200 || original != b["selectionHash"] {
		t.Fatal("immutable parent version coupled", st, b)
	}
	db.Delete(&Task{}, "id=?", taskID)
	st, b, _ = req(t, s, "POST", path+"/intelligence/selection-preview", historical, c)
	if st < 400 {
		t.Fatal("historical removed root accepted")
	}
}
func TestIntelligenceSelectionIntent(t *testing.T) {
	source := IntelligenceSourceRequest{Kind: "task_fields", ID: "task", SelectedFieldSet: "narrative"}
	in := IntelligenceEnqueue{IntelligenceSelection: IntelligenceSelection{Operation: "summary", Sources: []IntelligenceSourceRequest{source}}, RetryKey: "one", OptIn: IntelligenceOptIn{Accepted: true, PolicyVersion: intelligencePolicy}}
	provider := ProviderIdentity{Name: "local", Version: "pinned", Digest: "digest"}
	client, effective, e := hashIntelligenceIntent(in, provider)
	if e != nil {
		t.Fatal(e)
	}
	in.RetryKey = "retry"
	again, _, _ := hashIntelligenceIntent(in, provider)
	if again != client {
		t.Fatal("retry key bound")
	}
	in.Language = "hi"
	changed, _, _ := hashIntelligenceIntent(in, provider)
	if changed == client {
		t.Fatal("language not bound")
	}
	in.Language = ""
	provider.Version = "changed"
	again, newEffective, _ := hashIntelligenceIntent(in, provider)
	if again != client || newEffective == effective {
		t.Fatal("provider settings not independently frozen")
	}
}
