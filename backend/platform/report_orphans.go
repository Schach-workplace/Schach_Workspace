package platform

import (
	"gorm.io/gorm"
	"net/http"
	"time"
)

// Orphan management exposes identity/version/state only; ownership and content
// access never transfer to the leader performing the administrative transition.
type OrphanReportDefinition struct {
	ID      string `json:"id"`
	OwnerID string `json:"ownerId"`
	Version int64  `json:"version"`
	State   string `json:"state"`
}

func orphanReportDefinition(tx *gorm.DB, a *access, id string) (SavedReportDefinition, error) {
	var d SavedReportDefinition
	if !leadership(a.Member.Role) {
		return d, missing()
	}
	if e := tx.First(&d, "id=? AND company_id=?", id, a.Company.ID).Error; e != nil {
		if e == gorm.ErrRecordNotFound {
			return d, missing()
		}
		return d, e
	}
	member, ok := a.Members[d.OwnerID]
	user := a.Users[d.OwnerID]
	if ok && member.Active && user.ID != "" && !user.Suspended {
		return d, missing()
	}
	return d, nil
}
func orphanReportMetadata(d SavedReportDefinition) OrphanReportDefinition {
	return OrphanReportDefinition{d.ID, d.OwnerID, d.Version, d.State}
}
func (s *Server) listOrphanReports(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	rows := []OrphanReportDefinition{}
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !leadership(a.Member.Role) {
			return missing()
		}
		// Filter in SQL before the bound so healthy definitions cannot starve orphans.
		var defs []SavedReportDefinition
		if e := tx.Where("company_id=? AND state<>'deleted' AND (NOT EXISTS (SELECT 1 FROM memberships m WHERE m.company_id=saved_report_definitions.company_id AND m.user_id=saved_report_definitions.owner_id AND m.active=?) OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id=saved_report_definitions.owner_id AND u.suspended=?))", a.Company.ID, true, false).Order("id").Limit(100).Find(&defs).Error; e != nil {
			return e
		}
		for _, d := range defs {
			if _, e := orphanReportDefinition(tx, a, d.ID); e != nil {
				return e
			}
			rows = append(rows, orphanReportMetadata(d))
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"orphans": rows})
}
func (s *Server) updateOrphanReport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey        string `json:"retryKey"`
		ExpectedVersion int64  `json:"expectedVersion"`
		State           string `json:"state"`
	}
	if e = decode(w, r, &input); e != nil {
		return e
	}
	if input.ExpectedVersion < 1 || !in(input.State, "paused", "deleted") {
		return invalid("An orphan can only be paused or deleted with its inspected version.")
	}
	var d SavedReportDefinition
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		out, e := businessMutation(tx, a, "report.definition.orphan", input.RetryKey, []any{r.PathValue("id"), input.ExpectedVersion, input.State}, func() error { var e error; d, e = orphanReportDefinition(tx, a, r.PathValue("id")); return e }, func(out BusinessResult) error { _, e := orphanReportDefinition(tx, a, out.IDs[0]); return e }, func() (BusinessResult, error) {
			if d.Version != input.ExpectedVersion || d.State == "deleted" {
				return BusinessResult{}, conflict()
			}
			old := d.Version
			d.Version++
			d.State = input.State
			d.UpdatedAt = time.Now().UTC()
			result := tx.Model(&SavedReportDefinition{}).Where("id=? AND company_id=? AND version=?", d.ID, a.Company.ID, old).Select("version", "state", "updated_at").Updates(&d)
			if result.Error != nil {
				return BusinessResult{}, result.Error
			}
			if result.RowsAffected != 1 {
				return BusinessResult{}, conflict()
			}
			if e := tx.Create(&SavedReportRevision{a.Company.ID, d.ID, d.Version, d.State, d.Configuration, d.UpdatedAt}).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := cancelReportDefinitionOutputs(tx, a.Company.ID, d.ID, old); e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Model(&ReportSchedule{}).Where("company_id=? AND definition_id=?", a.Company.ID, d.ID).Updates(map[string]any{"state": "paused", "definition_revision": d.Version}).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "report_definition", IDs: []string{d.ID}, Versions: []int64{d.Version}}, nil
		})
		if e != nil {
			return e
		}
		return tx.First(&d, "id=? AND company_id=?", out.IDs[0], a.Company.ID).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, orphanReportMetadata(d))
}
