package platform

import (
	"gorm.io/gorm"
	"time"
)

// These hints scrub derived bytes in the source writer's transaction. Exact
// current-source authorization remains authoritative if a hint was missed.
func invalidateIntelligenceOwner(tx *gorm.DB, companyID, userID string) error {
	q := tx.Model(&IntelligenceJob{}).Where("actor_id=? AND state IN ?", userID, []string{"queued", "running", "retry_wait", "ready"})
	if companyID != "" {
		q = q.Where("company_id=?", companyID)
	}
	return q.Updates(map[string]any{"state": "invalidated", "reason_code": "source_unavailable", "result_json": "", "lease_token": "", "cancellation_version": gorm.Expr("cancellation_version+1"), "updated_at": time.Now().UTC()}).Error
}
func invalidateIntelligenceConversation(tx *gorm.DB, cid, conversationID, messageID string, authority bool) error {
	var sources []IntelligenceSource
	if e := tx.Where("company_id=? AND job_id IN (?) AND kind IN ?", cid, tx.Model(&IntelligenceJob{}).Select("id").Where("company_id=? AND state IN ?", cid, []string{"queued", "running", "retry_wait", "ready"}), []string{"message", "record", "voice_media", "transcript", "goal_measurement"}).Find(&sources).Error; e != nil {
		return e
	}
	jobs := map[string]bool{}
	for _, source := range sources {
		b := source.Binding
		matches := b.Request.ConversationID == conversationID && (messageID == "" || b.Request.ID == messageID || b.Request.ParentID == messageID)
		if b.BindingMode == "immutable_fact" && !authority {
			matches = false
		}
		for _, root := range b.Roots {
			if root.Evidence != nil && root.Evidence.Kind == "message" && root.Evidence.ParentID == conversationID && (messageID == "" || root.ID == messageID) && authority {
				matches = true
			}
		}
		if matches {
			jobs[source.JobID] = true
		}
	}
	// A derived transcript source's minimal root ID retains the original media;
	// propagate by originating job identity without retaining any source prose.
	for changed := true; changed; {
		changed = false
		for _, source := range sources {
			if source.Kind == "transcript" && jobs[source.SourceID] && !jobs[source.JobID] {
				jobs[source.JobID] = true
				changed = true
			}
		}
	}
	for id := range jobs {
		if e := tx.Model(&IntelligenceJob{}).Where("id=? AND state IN ?", id, []string{"queued", "running", "retry_wait", "ready"}).Updates(map[string]any{"state": "invalidated", "reason_code": "source_unavailable", "result_json": "", "lease_token": "", "cancellation_version": gorm.Expr("cancellation_version+1"), "updated_at": time.Now().UTC()}).Error; e != nil {
			return e
		}
	}
	return nil
}

// Live business roots invalidate direct projections; immutable historic facts
// remain governed by their independent complete current ACL checks.
func invalidateIntelligenceBusinessSource(tx *gorm.DB, cid, kind, id string) error {
	jobs := tx.Model(&IntelligenceSource{}).Select("job_id").Where("company_id=? AND kind=? AND source_id=?", cid, kind, id)
	return tx.Model(&IntelligenceJob{}).Where("id IN (?) AND state IN ?", jobs, []string{"queued", "running", "retry_wait", "ready"}).Updates(map[string]any{"state": "invalidated", "reason_code": "source_changed", "result_json": "", "lease_token": "", "cancellation_version": gorm.Expr("cancellation_version+1"), "updated_at": time.Now().UTC()}).Error
}
