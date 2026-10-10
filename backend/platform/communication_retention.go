package platform

import (
	"context"
	"gorm.io/gorm"
	"time"
)

func (s *Server) RunMessageRetention(ctx context.Context) (int, error) {
	cutoff := time.Now().UTC().AddDate(0, 0, -s.opts.MessageRetentionDays).Format(time.RFC3339Nano)
	rows := []Message{}
	if e := s.db.WithContext(ctx).Where("created_at<? AND content_purged=?", cutoff, false).Order("company_id,conversation_id,id").Limit(100).Find(&rows).Error; e != nil {
		return 0, e
	}
	if e := s.db.WithContext(ctx).Model(&CommunicationExportAudit{}).Where("created_at<? AND purpose<>?", cutoff, "Expired export purpose").Update("purpose", "Expired export purpose").Error; e != nil {
		return 0, e
	}
	count := 0
	for _, m := range rows {
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var c Conversation
			if e := lockCommunicationRow(tx, "UPDATE").First(&c, "company_id=? AND id=?", m.CompanyID, m.ConversationID).Error; e != nil {
				return e
			}
			if e := tx.Model(&Message{}).Where("id=?", m.ID).Updates(map[string]any{"body": "", "removed": true, "content_purged": true, "reply_to_id": "", "mention_ids": "[]", "mention_all": false, "media_ids": "[]"}).Error; e != nil {
				return e
			}
			if e := tx.Model(&MessageRevision{}).Where("message_id=?", m.ID).Updates(map[string]any{"body": "", "removed": true}).Error; e != nil {
				return e
			}
			if e := tx.Model(&CommunicationBundleAction{}).Where("company_id=? AND anchor_message_id=?", m.CompanyID, m.ID).Update("title", "Expired action").Error; e != nil {
				return e
			}
			var records []CommunicationRecord
			if e := tx.Where("company_id=? AND anchor_message_id=?", m.CompanyID, m.ID).Find(&records).Error; e != nil {
				return e
			}
			for _, record := range records {
				if e := tx.Model(&record).Updates(map[string]any{"body": "", "title": "Expired communication record", "state": "closed", "options": "[]"}).Error; e != nil {
					return e
				}
				if e := tx.Model(&CommunicationRecordRevision{}).Where("record_id=?", record.ID).Updates(map[string]any{"body": "", "title": "Expired communication record", "options": "[]", "reason": ""}).Error; e != nil {
					return e
				}
				if e := tx.Model(&CommunicationRecipient{}).Where("record_id=?", record.ID).Update("response", "").Error; e != nil {
					return e
				}
			}
			if e := tx.Where("company_id=? AND message_id=?", m.CompanyID, m.ID).Delete(&CommunicationBookmark{}).Error; e != nil {
				return e
			}
			if e := tx.Where("company_id=? AND message_id=?", m.CompanyID, m.ID).Delete(&CommunicationPin{}).Error; e != nil {
				return e
			}
			if e := tx.Model(&CommunicationMedia{}).Where("company_id=? AND message_id=? AND state<>?", m.CompanyID, m.ID, "purged").Update("expires_at", nowString()).Error; e != nil {
				return e
			}
			return appendCommunicationEvent(tx, &conversationScope{CompanyID: m.CompanyID, Conversation: c}, "content_expired", m.ID, m.Sequence)
		})
		if e != nil {
			return count, e
		}
		count++
	}
	return count, nil
}
