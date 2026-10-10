package platform

import (
	"errors"
	"gorm.io/gorm"
	"net/http"
	"testing"
	"time"
)

func TestAttentionProducerAtomicityAndDedup(t *testing.T) {
	s, c, cid, uid, _ := attentionFixture(t)
	member := addPerson(t, s, c, cid, "attention-producer@example.com", "member")
	b := taskBody(member)
	b["reviewerId"] = uid
	b["status"] = "in_review"
	b["requiresApproval"] = true
	id := createTask(t, s, c, cid, b)
	var count int64
	s.db.Model(&AttentionItem{}).Where("source_kind=? AND source_id=? AND kind=? AND recipient_id=? AND state=?", "task", id, "task_review", uid, "open").Count(&count)
	if count != 1 {
		t.Fatalf("review intent %d", count)
	}
	var task Task
	s.db.First(&task, "id=?", id)
	e := s.db.Transaction(func(tx *gorm.DB) error {
		a, e := currentAttentionActorLocked(tx, cid, uid)
		if e != nil {
			return e
		}
		if e = syncTaskAttention(tx, a, nil, task); e != nil {
			return e
		}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	s.db.Model(&AttentionItem{}).Where("source_id=? AND kind=? AND state=?", id, "task_review", "open").Count(&count)
	if count != 1 {
		t.Fatalf("dedup %d", count)
	}
	e = s.db.Transaction(func(tx *gorm.DB) error {
		a, e := currentAttentionActorLocked(tx, cid, uid)
		if e != nil {
			return e
		}
		task.ID = "rolled-back"
		task.Code = "ROLLBACK"
		if e = tx.Omit("Comments", "TimeEntries", "Attachments").Create(&task).Error; e != nil {
			return e
		}
		if e = syncTaskAttention(tx, a, nil, task); e != nil {
			return e
		}
		return errors.New("rollback")
	})
	if e == nil {
		t.Fatal("expected rollback")
	}
	s.db.Model(&AttentionItem{}).Where("source_id=?", "rolled-back").Count(&count)
	if count != 0 {
		t.Fatal("leaked rollback")
	}
	st, _, w := req(t, s, "POST", "/api/companies/"+cid+"/tasks/"+id+"/review", map[string]any{"version": 1, "decision": "request_changes", "comment": "Please correct evidence"}, c)
	if st != 200 {
		t.Fatalf("review %d %s", st, w.Body.String())
	}
	s.db.Model(&AttentionItem{}).Where("source_id=? AND kind=? AND state=?", id, "task_review", "open").Count(&count)
	if count != 0 {
		t.Fatal("obsolete review retained")
	}
}
func TestAttentionRecordRejoinBoundary(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	message := sendMessage(t, s, c, cid, conv, "instruction", "Private notice")
	root := "/api/companies/" + cid + "/conversations/" + conv + "/records"
	st, b, w := req(t, s, "POST", root, map[string]any{"retryKey": "attention-ack", "kind": "ack", "anchorMessageId": message["id"], "sourceRevision": 1, "title": "Notice", "body": "Read", "recipientIds": []string{uid}}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var item AttentionItem
	if e := s.db.First(&item, "source_id=? AND recipient_id=?", b["id"], uid).Error; e != nil {
		t.Fatal("missing private producer", e)
	}
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/attention/"+item.ID, nil, mc)
	if st != 200 {
		t.Fatal(st)
	}
	s.db.Model(&ConversationMember{}).Where("company_id=? AND conversation_id=? AND user_id=?", cid, conv, uid).Updates(map[string]any{"epoch": 2, "history_from_sequence": message["sequence"].(float64) + 1})
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/attention/"+item.ID, nil, mc)
	if st != 404 {
		t.Fatalf("rejoin old action %d", st)
	}
}

func TestAttentionProducerFinanceIntakeAndEvidenceLifecycle(t *testing.T) {
	f := newFinanceFixture(t)
	finance, finID := f.person(t, "attention-finance@example.com", "finance", "")
	_ = finance
	f.addBudget(t, 10000, "active")
	expense := f.addExpense(t, 1200, f.cookie)
	path := f.base() + "/expenses/" + expense + "/transition"
	financeOK(t, f.s, "POST", path, map[string]any{"version": 1, "action": "submit"}, f.cookie)
	var count int64
	f.db.Model(&AttentionItem{}).Where("source_kind='expense' AND source_id=? AND recipient_id=? AND state='open'", expense, finID).Count(&count)
	if count != 1 {
		t.Fatal("submit intent", count)
	}
	financeOK(t, f.s, "POST", path, map[string]any{"version": 2, "action": "withdraw"}, f.cookie)
	f.db.Model(&AttentionItem{}).Where("source_kind='expense' AND source_id=? AND state='open'", expense).Count(&count)
	if count != 0 {
		t.Fatal("withdraw retained pending", count)
	}
	mc, uid := f.person(t, "attention-requester@example.com", "member", f.department)
	conv := newConversation(t, f.s, f.cookie, f.cid, []string{f.uid, uid}, "group")
	allowPublication(t, f.s, f.cookie, f.cid, conv)
	m := sendMessage(t, f.s, mc, f.cid, conv, "intake-attention", "Private input")
	rid := financeOK(t, f.s, "POST", f.base()+"/conversations/"+conv+"/requests", map[string]any{"retryKey": "attention-intake-once", "anchorMessageId": m["id"], "sourceRevision": 1, "expectedPolicyVersion": 2, "departmentId": f.department, "title": "Selected published work", "summary": "Published briefing"}, mc)["id"].(string)
	f.db.Model(&AttentionItem{}).Where("source_kind='intake' AND source_id=? AND recipient_id=? AND state='open'", rid, f.uid).Count(&count)
	if count != 1 {
		t.Fatal("published intent", count)
	}
	body := taskBody(uid)
	body["departmentId"] = f.department
	tid := financeOK(t, f.s, "POST", f.base()+"/communication/requests/"+rid+"/assign", map[string]any{"expectedVersion": 1, "task": body}, f.cookie)["id"].(string)
	f.db.Model(&AttentionItem{}).Where("source_kind='intake' AND source_id=? AND state='open'", rid).Count(&count)
	if count != 0 {
		t.Fatal("assigned triage remained", count)
	}
	f.db.Model(&AttentionItem{}).Where("source_kind='task' AND source_id=? AND recipient_id=? AND state='open'", tid, uid).Count(&count)
	if count != 1 {
		t.Fatal("assigned task missing", count)
	}
	reviewBody := taskBody(uid)
	reviewBody["reviewerId"] = f.uid
	reviewBody["status"] = "in_review"
	reviewBody["requiresApproval"] = true
	review := createTask(t, f.s, f.cookie, f.cid, reviewBody)
	if e := f.db.Transaction(func(tx *gorm.DB) error {
		a, e := currentAttentionActorLocked(tx, f.cid, uid)
		if e != nil {
			return e
		}
		return appendTaskEvidence(tx, a, review, Attachment{ID: "owned-evidence", FileName: "fictional.txt", Size: 5, Data: []byte("owned"), MimeType: "text/plain"})
	}); e != nil {
		t.Fatal(e)
	}
	var pending []AttentionItem
	f.db.Where("source_id=? AND kind='task_review' AND state='open'", review).Find(&pending)
	if len(pending) != 1 || pending[0].SourceRevision != 2 {
		t.Fatal("evidence did not advance review", pending)
	}
}
func TestAttentionBookmarkOwnershipAndRecordResponseLifecycle(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, c, cid, conv, "attention-saved", "Exact saved source")
	root := "/api/companies/" + cid + "/conversations/" + conv
	save := root + "/messages/" + m["id"].(string) + "/save"
	at := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	for _, cookie := range []*http.Cookie{c, mc} {
		st, _, w := req(t, s, "POST", save, map[string]any{"saved": true, "remindAt": at}, cookie)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	st, _, w := req(t, s, "POST", save, map[string]any{"saved": false}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var count int64
	s.db.Model(&AttentionItem{}).Where("source_kind='bookmark' AND source_id=? AND recipient_id=? AND state='open'", m["id"], uid).Count(&count)
	if count != 1 {
		t.Fatal("one user's removal superseded another saved reminder", count)
	}
	st, b, w := req(t, s, "POST", root+"/records", map[string]any{"retryKey": "record-lifecycle", "kind": "ack", "anchorMessageId": m["id"], "sourceRevision": 1, "title": "Fixed audience notice", "body": "Acknowledgement required", "recipientIds": []string{uid}}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	record := b["id"].(string)
	st, _, w = req(t, s, "GET", root+"/records/"+record, nil, mc)
	if st != 200 {
		t.Fatal("targeted record", st, w.Body.String())
	}
	st, _, w = req(t, s, "PATCH", root+"/records/"+record, map[string]any{"expectedRevision": 1, "title": "Updated notice", "body": "Current exact instruction", "options": []string{}, "dueAt": "", "reason": "Material correction"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var pending AttentionItem
	if e := s.db.First(&pending, "source_kind='record' AND source_id=? AND recipient_id=? AND state='open'", record, uid).Error; e != nil || pending.RecordRevision != 2 {
		t.Fatal(pending, e)
	}
	st, _, w = req(t, s, "POST", root+"/records/"+record+"/respond", map[string]any{"expectedRevision": 2, "response": "acknowledged"}, mc)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	s.db.Model(&AttentionItem{}).Where("source_kind='record' AND source_id=? AND state='open'", record).Count(&count)
	if count != 0 {
		t.Fatal("answered record retained action", count)
	}
}

func TestAttentionDeadlineAndBoundedLegacyReconciliation(t *testing.T) {
	s, c, cid, uid, id := attentionFixture(t)
	var task Task
	s.db.First(&task, "id=?", id)
	task.OwnerID = addPerson(t, s, c, cid, "legacy-owner@example.com", "member")
	task.ReviewerID = uid
	task.Status = "in_review"
	task.DeadlineMode = "timed"
	task.DueAt = "2026-10-12T10:00:00Z"
	task.DueTimezone = "Asia/Kolkata"
	s.db.Model(&Task{}).Where("id=?", id).Updates(map[string]any{"owner_id": task.OwnerID, "reviewer_id": uid, "status": task.Status, "deadline_mode": task.DeadlineMode, "due_at": task.DueAt, "due_timezone": task.DueTimezone})
	s.db.Where("company_id=?", cid).Delete(&AttentionItem{})
	cursor, err := s.ReconcileAttention(t.Context(), cid, "", 1)
	if err != nil || cursor == "" {
		t.Fatalf("first pass %q %v", cursor, err)
	}
	if _, err = s.ReconcileAttention(t.Context(), cid, "", 1); err != nil {
		t.Fatal(err)
	} // persisted old cursor is safe to replay
	for i := 0; cursor != "" && i < 20; i++ {
		cursor, err = s.ReconcileAttention(t.Context(), cid, cursor, 1)
		if err != nil {
			t.Fatal(err)
		}
	}
	if cursor != "" {
		t.Fatal("bounded pass did not finish")
	}
	st, v, _ := req(t, s, "GET", "/api/companies/"+cid+"/attention?decisionsOnly=true", nil, c)
	if st != 200 || len(v["items"].([]any)) != 1 {
		t.Fatalf("legacy decision %d %v", st, v)
	}
	now := time.Now().UTC()
	if err = ensureDeadlineAttention(s.db, task, "approaching:2026-10-11", now); err != nil {
		t.Fatal(err)
	}
	if err = ensureDeadlineAttention(s.db, task, "approaching:2026-10-11", now); err != nil {
		t.Fatal(err)
	}
	var item AttentionItem
	s.db.First(&item, "source_id=? AND kind=?", id, "deadline")
	before := task
	task.DueAt = "2026-10-14T10:00:00Z"
	task.Version++
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if e := lockCompany(tx, cid); e != nil {
			return e
		}
		a, e := currentAttentionActorLocked(tx, cid, uid)
		if e != nil {
			return e
		}
		if e = tx.Model(&Task{}).Where("id=?", id).Updates(map[string]any{"due_at": task.DueAt, "version": task.Version}).Error; e != nil {
			return e
		}
		return syncTaskAttention(tx, a, &before, task)
	})
	if err != nil {
		t.Fatal(err)
	}
	s.db.First(&item, "id=?", item.ID)
	if item.State != "superseded" {
		t.Fatalf("obsolete deadline %s", item.State)
	}
	if err = ensureDeadlineAttention(s.db, task, "approaching:2026-10-11", now); err != nil {
		t.Fatal(err)
	}
	var count int64
	s.db.Model(&AttentionItem{}).Where("source_id=? AND kind=? AND state=?", id, "deadline", "open").Count(&count)
	if count != 1 {
		t.Fatalf("new deadline count %d", count)
	}
}

func TestAttentionReconcilePrivateRecipientAfterCreatorRevocation(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, c, cid, conv, "legacy-private", "Legacy private source")
	root := "/api/companies/" + cid + "/conversations/" + conv
	st, b, w := req(t, s, "POST", root+"/records", map[string]any{"retryKey": "legacy-record", "kind": "ack", "anchorMessageId": m["id"], "sourceRevision": 1, "title": "Legacy fixed audience", "body": "Current recipient only", "recipientIds": []string{uid}}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	record := b["id"].(string)
	s.db.Where("company_id=?", cid).Delete(&AttentionItem{})
	s.db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, owner).Update("active", false)
	if _, err := s.ReconcileAttention(t.Context(), cid, "record:", 1); err != nil {
		t.Fatal(err)
	}
	st, v, _ := req(t, s, "GET", "/api/companies/"+cid+"/attention", nil, mc)
	if st != 200 || len(v["items"].([]any)) != 1 {
		t.Fatalf("current fixed recipient %d %v", st, v)
	}
	if v["items"].([]any)[0].(map[string]any)["sourceId"] != record {
		t.Fatal(v)
	}
}

func TestAttentionBookmarkRefreshUsesExactRevision(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, c, cid, conv, "saved-revision", "First revision")
	root := "/api/companies/" + cid + "/conversations/" + conv + "/messages/" + m["id"].(string)
	at := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	for _, cookie := range []*http.Cookie{c, mc} {
		st, _, w := req(t, s, "POST", root+"/save", map[string]any{"saved": true, "remindAt": at}, cookie)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	st, _, w := req(t, s, "PATCH", root, map[string]any{"expectedRevision": 1, "body": "Current edited revision"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	st, _, w = req(t, s, "POST", root+"/save", map[string]any{"saved": true, "remindAt": at}, mc)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var rows []AttentionItem
	s.db.Where("source_kind=? AND source_id=? AND recipient_id=? AND state=?", "bookmark", m["id"], uid, "open").Find(&rows)
	if len(rows) != 1 || rows[0].SourceRevision != 2 {
		t.Fatalf("fresh reminder %+v", rows)
	}
	st, v, _ := req(t, s, "GET", "/api/companies/"+cid+"/attention/"+rows[0].ID, nil, mc)
	if st != 200 || v["item"].(map[string]any)["summary"] != "Current edited revision" {
		t.Fatal(st, v)
	}
}
