package platform

import (
	"errors"
	"gorm.io/gorm"
	"testing"
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
