package platform

import (
	"gorm.io/gorm"
	"time"
)

func historicalAccessChanged() error {
	return &apiError{Status: 409, Code: "access_changed", Message: "Report access changed. Generate a new authorized report."}
}
func rangeTooLarge() error {
	return &apiError{Status: 422, Code: "range_too_large", Message: "Report exceeds 10000 rows or 8 MiB. Narrow its dates or filters."}
}
func authorizeHistoricalSources(tx *gorm.DB, a *access, id string) error {
	var snap HistoricalReportSnapshot
	if e := tx.First(&snap, "id=? AND company_id=? AND requester_id=?", id, a.Company.ID, a.User.ID).Error; e != nil {
		if e == gorm.ErrRecordNotFound {
			return missing()
		}
		return e
	}
	var sources []ReportSnapshotSource
	if e := tx.Where("snapshot_id=? AND company_id=?", id, a.Company.ID).Order("task_id").Find(&sources).Error; e != nil {
		return e
	}
	for start := 0; start < len(sources); start += 100 {
		end := start + 100
		if end > len(sources) {
			end = len(sources)
		}
		ids := []string{}
		for _, source := range sources[start:end] {
			ids = append(ids, source.TaskID)
		}
		var count int64
		if e := taskReadQuery(tx, a).Where("id IN ?", ids).Count(&count).Error; e != nil {
			return e
		}
		if count != int64(len(ids)) {
			return historicalAccessChanged()
		}
	}
	return nil
}
func validateHistoricalRequest(tx *gorm.DB, a *access, input HistoricalReportRequest) error {
	if input.Basis != "task_history_v1" {
		return invalid("Unsupported report basis.")
	}
	p, e := resolveReportPeriod(input.From, input.To, input.ReportZone)
	if e != nil {
		return e
	}
	if p.EndExclusive.After(time.Now().UTC()) {
		return invalid("Choose a completed report period.")
	}
	f := input.Filters
	if f.OwnerID != "" && !a.activeUser(f.OwnerID) {
		return missing()
	}
	if f.DepartmentID != "" && !departmentExists(tx, a.Company.ID, f.DepartmentID) {
		return missing()
	}
	if f.ProjectID != "" {
		var project Project
		if e := tx.First(&project, "id=? AND company_id=?", f.ProjectID, a.Company.ID).Error; e != nil {
			return missing()
		}
		ok, e := canReadProject(tx, a, project)
		if e != nil {
			return e
		}
		if !ok {
			return missing()
		}
	}
	return nil
}
