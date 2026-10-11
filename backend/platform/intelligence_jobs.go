package platform

import (
	"gorm.io/gorm"
	"time"
)

// Caller holds the company and current directory User fence. Reading the
// original session here must not acquire an earlier-class session lock.
func intelligenceOriginalAuthority(tx *gorm.DB, a *access, j IntelligenceJob) error {
	if j.ActorID != a.User.ID || j.CompanyID != a.Company.ID || a.User.SessionEpoch <= 0 || a.User.SessionEpoch != j.CapturedUserEpoch || a.Company.PermissionEpoch != j.CapturedCompanyAuthorityEpoch {
		return intelligenceError(403, "source_unavailable")
	}
	return financeOriginalSession(tx, j.CompanyID, j.ActorID, j.OriginatingSessionRef)
}
func loadIntelligenceManifest(tx *gorm.DB, j IntelligenceJob) (SourceManifest, error) {
	out := SourceManifest{Sources: []BoundIntelligenceSource{}, SourceSetHash: j.SourceSetHash, ExpiresAt: j.ExpiresAt}
	var rows []IntelligenceSource
	if e := tx.Where("job_id=? AND company_id=?", j.ID, j.CompanyID).Order("source_key").Find(&rows).Error; e != nil {
		return out, e
	}
	if len(rows) == 0 || len(rows) > 50 {
		return out, intelligenceError(403, "source_unavailable")
	}
	for _, row := range rows {
		out.Sources = append(out.Sources, row.Binding)
	}
	return out, nil
}

var _ = time.Now
