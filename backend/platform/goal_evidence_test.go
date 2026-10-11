package platform

import (
	"fmt"
	"strings"
	"testing"
)

func TestGoalEvidenceExactness(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	g := createMeasuredGoal(t, s, c, cid, uid)
	task := createTask(t, s, c, cid, taskBody(uid))
	comment := Comment{ID: newID("comment"), TaskID: task, CompanyID: cid, UserID: uid, Body: "Exact observation", CreatedAt: nowString()}
	db.Create(&comment)
	p := "/api/companies/" + cid + "/goals/" + g
	status, b, _ := req(t, s, "GET", p+"/evidence-preview?kind=task_comment&sourceId="+comment.ID+"&parentId="+task, nil, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	hash := b["contentHash"]
	input := map[string]any{"retryKey": "comment-evidence", "expectedVersion": 1, "value": 4, "effectiveAt": "2026-10-02T00:00:00Z", "reason": "Shared authored reason", "evidence": []any{map[string]any{"kind": "task_comment", "sourceId": comment.ID, "parentId": task, "contentHash": hash}}}
	db.Model(&Comment{}).Where("id=?", comment.ID).Update("body", "Changed independently of task version")
	status, b, _ = req(t, s, "POST", p+"/measurements", input, c)
	if status != 409 {
		t.Fatal(status, b)
	}
	db.Model(&Comment{}).Where("id=?", comment.ID).Update("body", comment.Body)
	status, b, _ = req(t, s, "POST", p+"/measurements", input, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	db.Model(&Comment{}).Where("id=?", comment.ID).Update("body", "Readable later change")
	status, b, _ = req(t, s, "POST", p+"/measurements", input, c)
	if status != 200 {
		t.Fatal("canonical authorized replay", status, b)
	}
	status, b, w := req(t, s, "GET", p+"/measurements", nil, c)
	if status != 200 || !strings.Contains(w.Body.String(), "changed_since_measurement") || strings.Contains(w.Body.String(), "Exact observation") {
		t.Fatal(status, b)
	}
	var n int64
	db.Model(&GoalMeasurement{}).Where("goal_id=?", g).Count(&n)
	if n != 2 {
		t.Fatal(n)
	}
}
func TestGoalEvidenceAudience(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	message := sendMessage(t, s, mc, cid, conv, "observation", "Private source phrase")
	leader := addPerson(t, s, c, cid, "evidenceleader@example.com", "ceo")
	_ = leader
	lc := login(t, s, "evidenceleader@example.com")
	g := createMeasuredGoal(t, s, c, cid, uid)
	p := "/api/companies/" + cid + "/goals/" + g
	status, b, _ := req(t, s, "GET", p+"/evidence-preview?kind=message&sourceId="+message["id"].(string)+"&parentId="+conv, nil, mc)
	if status != 200 {
		t.Fatal(status, b)
	}
	input := map[string]any{"retryKey": "private-evidence", "expectedVersion": 1, "value": 4, "effectiveAt": "2026-10-02T00:00:00Z", "reason": "Outcome shared with goal audience", "evidence": []any{map[string]any{"kind": "message", "sourceId": message["id"], "parentId": conv, "revision": message["revision"], "contentHash": b["contentHash"]}}}
	status, b, _ = req(t, s, "POST", p+"/measurements", input, mc)
	if status != 200 {
		t.Fatal(status, b)
	}
	status, b, w := req(t, s, "GET", p+"/measurements", nil, lc)
	if status != 200 || !strings.Contains(w.Body.String(), "evidence_unavailable") || strings.Contains(w.Body.String(), conv) || strings.Contains(w.Body.String(), message["id"].(string)) || strings.Contains(w.Body.String(), "Private source phrase") {
		t.Fatal(status, b)
	}
	db := s.db
	db.Model(&ConversationMember{}).Where("conversation_id=? AND user_id=?", conv, uid).Update("active", false)
	status, b, _ = req(t, s, "POST", p+"/measurements", input, mc)
	if status != 404 {
		t.Fatal(status, b)
	}
}
func TestGoalEvidenceReportOptions(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := addPerson(t, s, c, cid, "reportgoalowner@example.com", "member")
	mc := login(t, s, "reportgoalowner@example.com")
	g := createMeasuredGoal(t, s, c, cid, uid)
	own := createTask(t, s, c, cid, taskBody(uid))
	hidden := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	base := "/api/companies/" + cid
	makeSnapshot := func(key string) string {
		status, b, _ := req(t, s, "POST", base+"/reports/history/snapshots", map[string]any{"retryKey": key, "request": historyRequest()}, mc)
		if status != 200 {
			t.Fatal(status, b)
		}
		return b["snapshotId"].(string)
	}
	visible := makeSnapshot("visible")
	for i := 0; i < 3; i++ {
		sid := makeSnapshot(fmt.Sprint("inaccessible", i))
		if e := db.Create(&ReportSnapshotSource{CompanyID: cid, SnapshotID: sid, TaskID: hidden, Role: "reference"}).Error; e != nil {
			t.Fatal(e)
		}
	}
	status, b, _ := req(t, s, "GET", base+"/goals/"+g+"/evidence-options?kind=report_snapshot&limit=1", nil, mc)
	if status != 200 {
		t.Fatal(status, b)
	}
	options := b["options"].([]any)
	if len(options) != 1 || options[0].(map[string]any)["sourceId"] != visible || b["hasMore"] != false {
		t.Fatal(b)
	}
	status, b, _ = req(t, s, "GET", base+"/goals/"+g+"/evidence-preview?kind=report_snapshot&sourceId="+visible, nil, mc)
	if status != 200 {
		t.Fatal(status, b)
	}
	if e := db.Create(&ReportSnapshotSource{CompanyID: cid, SnapshotID: visible, TaskID: own, Role: "reference"}).Error; e != nil {
		t.Fatal(e)
	}
	db.Model(&Task{}).Where("id=?", own).Updates(map[string]any{"owner_id": me(t, s, c), "created_by": me(t, s, c)})
	status, b, _ = req(t, s, "GET", base+"/goals/"+g+"/evidence-preview?kind=report_snapshot&sourceId="+visible, nil, mc)
	if status != 409 {
		t.Fatal(status, b)
	}
}
