package platform

import (
	"gorm.io/gorm"
)

// Caller holds the existing company business lock. Evidence and optimistic
// review version change atomically, including message publication callers.
func appendTaskEvidence(tx *gorm.DB, a *access, taskID string, file Attachment) error {
	if a.Member.Role == "viewer" {
		return denied()
	}
	t, e := scopedTask(tx, a, taskID)
	if e != nil {
		return e
	}
	if t.Status == "done" {
		return invalid("Reopen accepted work before adding evidence.")
	}
	if len(file.Data) == 0 || len(file.Data) > maxUpload {
		return invalid("Evidence must contain 1 byte to 10 MiB.")
	}
	name := safeFileName(file.FileName)
	kind, e := uploadType(name, file.Data)
	if e != nil {
		return e
	}
	file.CompanyID = a.Company.ID
	file.TaskID = t.ID
	file.FileName = name
	file.MimeType = kind
	file.Size = int64(len(file.Data))
	file.UploadedBy = a.User.ID
	if file.ID == "" {
		file.ID = newID("att")
	}
	file.CreatedAt = nowString()
	if e := tx.Create(&file).Error; e != nil {
		return e
	}
	if e := tx.Model(&Task{}).Where("id = ? AND company_id = ?", t.ID, a.Company.ID).Updates(map[string]any{"version": gorm.Expr("version+1"), "updated_at": nowString()}).Error; e != nil {
		return e
	}
	if e := audit(tx, a.Company.ID, t.ID, a.User.ID, "evidence_uploaded", file.FileName+" added; review version advanced."); e != nil {
		return e
	}
	if t.Status == "in_review" && a.activeUser(t.ReviewerID) {
		return notification(tx, a.Company.ID, t.ID, t.ReviewerID, "Review evidence changed", t.Code+" requires a fresh evidence review.", "review")
	}
	return nil
}
