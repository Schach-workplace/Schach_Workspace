package platform

import (
	"context"
	"gorm.io/gorm"
	"time"
)

func (s *Server) RunMediaCleanup(ctx context.Context) (int, error) {
	if s.opts.MediaStore == nil {
		return 0, nil
	}
	rows := []CommunicationMedia{}
	if e := s.db.WithContext(ctx).Where("state <> ? AND expires_at < ?", "purged", time.Now().UTC().Format(time.RFC3339Nano)).Order("company_id,conversation_id,id").Limit(100).Find(&rows).Error; e != nil {
		return 0, e
	}
	count := 0
	for _, row := range rows {
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var c Conversation
			if e := lockCommunicationRow(tx, "UPDATE").First(&c, "company_id=? AND id=?", row.CompanyID, row.ConversationID).Error; e != nil {
				return e
			}
			var current CommunicationMedia
			if e := tx.First(&current, "id=?", row.ID).Error; e != nil {
				return e
			}
			if current.State == "purged" || current.ExpiresAt >= nowString() {
				return nil
			}
			if e := s.opts.MediaStore.Delete(ctx, row.ID); e != nil {
				return e
			}
			if e := tx.Model(&current).Update("state", "purged").Error; e != nil {
				return e
			}
			count++
			return nil
		})
		if e != nil {
			return count, e
		}
	}
	return count, nil
}
