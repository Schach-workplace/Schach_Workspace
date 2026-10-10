package platform

import (
	"testing"
	"time"
)

func TestRetentionPurgesDerivedPrivateTextButKeepsRetryTombstone(t *testing.T) {
	s, c, cid, owner, uid, _ := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	message := sendMessage(t, s, c, cid, conv, "retained-retry-key", "Secret message")
	mid := message["id"].(string)
	record := CommunicationRecord{ID: newID("rec"), CompanyID: cid, ConversationID: conv, AnchorMessageID: mid, SourceRevision: 1, Kind: "poll", Title: "Secret poll", Body: "Secret detail", Options: []string{"Secret option", "Other"}, CreatedBy: owner, RetryKey: "poll-retained", RequestHash: "hash", Revision: 1, State: "open", CreatedAt: nowString()}
	if e := s.db.Create(&record).Error; e != nil {
		t.Fatal(e)
	}
	if e := recordSnapshot(s.db, record, "Secret reason"); e != nil {
		t.Fatal(e)
	}
	recipient := CommunicationRecipient{RecordID: record.ID, Revision: 1, UserID: uid, CompanyID: cid, ConversationID: conv, Response: "Secret option"}
	if e := s.db.Create(&recipient).Error; e != nil {
		t.Fatal(e)
	}
	if e := s.db.Model(&Message{}).Where("id=?", mid).Update("created_at", time.Now().UTC().AddDate(0, 0, -400).Format(time.RFC3339Nano)).Error; e != nil {
		t.Fatal(e)
	}
	if n, e := s.RunMessageRetention(t.Context()); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	var revision CommunicationRecordRevision
	s.db.First(&revision, "record_id=?", record.ID)
	s.db.First(&record, "id=?", record.ID)
	s.db.First(&recipient, "record_id=?", record.ID)
	if len(record.Options) != 0 || len(revision.Options) != 0 || revision.Reason != "" || recipient.Response != "" {
		t.Fatalf("derived private text survives retention: options %v/%v, reason %q, response %q", record.Options, revision.Options, revision.Reason, recipient.Response)
	}
	replay := sendMessage(t, s, c, cid, conv, "retained-retry-key", "Secret message")
	if replay["id"] != mid || replay["body"] != "" || replay["removed"] != true {
		t.Fatal("purged retry invented new content", replay)
	}
	// Restored content must be scrubbed again without creating a new send.
	s.db.Model(&Message{}).Where("id=?", mid).Updates(map[string]any{"body": "restored secret", "content_purged": false})
	if n, e := s.RunMessageRetention(t.Context()); e != nil || n != 1 {
		t.Fatal("restored retention", n, e)
	}
	if n, e := s.RunMessageRetention(t.Context()); e != nil || n != 0 {
		t.Fatal("retention not idempotent", n, e)
	}
}
