package platform

import (
	"gorm.io/gorm"
	"net/http"
	"sort"
	"time"
)

type SavedReportConfiguration struct {
	Name           string                 `json:"name"`
	Basis          string                 `json:"basis"`
	Filters        ReportDimensionFilters `json:"filters"`
	PeriodRule     string                 `json:"periodRule"`
	From           string                 `json:"from"`
	To             string                 `json:"to"`
	TimezonePolicy string                 `json:"timezonePolicy"`
	ReportZone     string                 `json:"reportZone"`
	RecipientIDs   []string               `json:"recipientIds"`
}
type SavedReportDefinition struct {
	ID            string                   `json:"id" gorm:"primaryKey"`
	CompanyID     string                   `json:"companyId" gorm:"index"`
	OwnerID       string                   `json:"ownerId"`
	Version       int64                    `json:"version"`
	State         string                   `json:"state"`
	SchemaVersion int                      `json:"schemaVersion"`
	Basis         string                   `json:"basis"`
	Configuration SavedReportConfiguration `json:"configuration" gorm:"serializer:json;type:jsonb"`
	CreatedAt     time.Time                `json:"createdAt"`
	UpdatedAt     time.Time                `json:"updatedAt"`
}
type SavedReportRevision struct {
	CompanyID     string `gorm:"primaryKey"`
	DefinitionID  string `gorm:"primaryKey"`
	Version       int64  `gorm:"primaryKey"`
	State         string
	Configuration SavedReportConfiguration `gorm:"serializer:json;type:jsonb"`
	CreatedAt     time.Time
}
type ReportSchedule struct {
	ID                 string     `json:"id" gorm:"primaryKey"`
	CompanyID          string     `json:"companyId" gorm:"index"`
	DefinitionID       string     `json:"definitionId" gorm:"uniqueIndex"`
	DefinitionRevision int64      `json:"definitionRevision"`
	Version            int64      `json:"version"`
	Weekdays           []int      `json:"weekdays" gorm:"serializer:json;type:jsonb"`
	LocalMinute        string     `json:"localMinute"`
	ScheduleZone       string     `json:"scheduleZone"`
	NextOccurrenceUTC  time.Time  `json:"nextOccurrenceUTC" gorm:"index"`
	LastOccurrenceUTC  *time.Time `json:"lastOccurrenceUTC"`
	SkippedFrom        *time.Time `json:"skippedFrom"`
	SkippedTo          *time.Time `json:"skippedTo"`
	State              string     `json:"state"`
}

func (s *Server) savedReportRoutes() {
	const root = "/api/companies/{cid}/reports/definitions"
	s.route("GET "+root, s.listSavedReports)
	s.route("POST "+root, s.createSavedReport)
	s.route("GET "+root+"/recipients", s.savedReportRecipients)
	s.route("GET "+root+"/{id}", s.readSavedReport)
	s.route("PATCH "+root+"/{id}", s.updateSavedReport)
	s.route("POST "+root+"/{id}/generate", s.generateSavedReport)
}
func validateSavedConfiguration(tx *gorm.DB, a *access, c SavedReportConfiguration) error {
	if !clean(c.Name, 120) || c.Basis != "task_history_v1" || !in(c.PeriodRule, "fixed", "previous_week", "previous_month") || !in(c.TimezonePolicy, "explicit", "company_at_resolution") {
		return invalid("Choose a name, supported period and timezone policy.")
	}
	zone := a.Company.Timezone
	if c.TimezonePolicy == "explicit" {
		zone = c.ReportZone
	} else if c.ReportZone != "" {
		return invalid("Company timezone policy cannot include an explicit zone.")
	}
	if _, e := time.LoadLocation(zone); e != nil || zone == "" {
		return invalid("Choose an IANA report zone.")
	}
	if c.PeriodRule == "fixed" {
		if _, e := resolveReportPeriod(c.From, c.To, zone); e != nil {
			return e
		}
	} else if c.From != "" || c.To != "" {
		return invalid("Rolling reports resolve dates at generation.")
	}
	if len(c.RecipientIDs) < 1 || len(c.RecipientIDs) > 100 {
		return invalid("Choose 1–100 active recipients.")
	}
	seen := map[string]bool{}
	for _, id := range c.RecipientIDs {
		if seen[id] || !a.activeUser(id) {
			return invalid("Choose distinct active company recipients.")
		}
		seen[id] = true
	}
	req, e := resolveSavedReportRequest(c, a.Company.Timezone, time.Now().UTC())
	if e != nil {
		return e
	}
	return validateHistoricalRequest(tx, a, req)
}
func resolveSavedReportRequest(c SavedReportConfiguration, companyZone string, occurrence time.Time) (HistoricalReportRequest, error) {
	zone := c.ReportZone
	if c.TimezonePolicy == "company_at_resolution" {
		zone = companyZone
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return HistoricalReportRequest{}, invalid("Report zone is unavailable.")
	}
	from, to := c.From, c.To
	local := occurrence.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	switch c.PeriodRule {
	case "previous_week":
		offset := (int(today.Weekday()) + 6) % 7
		end := today.AddDate(0, 0, -offset-1)
		from = end.AddDate(0, 0, -6).Format("2006-01-02")
		to = end.Format("2006-01-02")
	case "previous_month":
		start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, loc)
		from = start.AddDate(0, -1, 0).Format("2006-01-02")
		to = start.AddDate(0, 0, -1).Format("2006-01-02")
	case "fixed":
	default:
		return HistoricalReportRequest{}, invalid("Unsupported saved period.")
	}
	return HistoricalReportRequest{From: from, To: to, ReportZone: zone, Filters: c.Filters, Basis: c.Basis}, nil
}
func savedDefinition(tx *gorm.DB, a *access, id string, manage bool) (SavedReportDefinition, error) {
	var d SavedReportDefinition
	if e := tx.First(&d, "id=? AND company_id=?", id, a.Company.ID).Error; e != nil {
		if e == gorm.ErrRecordNotFound {
			return d, missing()
		}
		return d, e
	}
	if d.OwnerID != a.User.ID {
		return d, missing()
	}
	if manage && a.Member.Role == "viewer" {
		return d, denied()
	}
	return d, nil
}
func cancelReportDefinitionOutputs(tx *gorm.DB, cid, id string, revision int64) error {
	if e := tx.Model(&ReportExportJob{}).Where("company_id=? AND definition_id=? AND definition_revision<=? AND state IN ?", cid, id, revision, []string{"queued", "running", "ready"}).Updates(map[string]any{"state": "cancelled", "failure_code": "definition_changed", "lease_token": "", "lease_until": nil, "updated_at": time.Now().UTC()}).Error; e != nil {
		return e
	}
	ids := tx.Model(&ReportExportJob{}).Select("id").Where("company_id=? AND definition_id=? AND definition_revision<=?", cid, id, revision)
	return tx.Model(&ReportDeliveryIntent{}).Where("company_id=? AND job_id IN (?)", cid, ids).Updates(map[string]any{"state": "cancelled", "updated_at": time.Now().UTC()}).Error
}
func (s *Server) createSavedReport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey      string                   `json:"retryKey"`
		Configuration SavedReportConfiguration `json:"configuration"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	var d SavedReportDefinition
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		out, e := businessMutation(tx, a, "report.definition.create", input.RetryKey, input.Configuration, func() error {
			if a.Member.Role == "viewer" {
				return denied()
			}
			return validateSavedConfiguration(tx, a, input.Configuration)
		}, func(out BusinessResult) error { _, e := savedDefinition(tx, a, out.IDs[0], true); return e }, func() (BusinessResult, error) {
			now := time.Now().UTC()
			d = SavedReportDefinition{ID: newID("rd"), CompanyID: a.Company.ID, OwnerID: a.User.ID, Version: 1, State: "active", SchemaVersion: 1, Basis: input.Configuration.Basis, Configuration: input.Configuration, CreatedAt: now, UpdatedAt: now}
			if e := tx.Create(&d).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Create(&SavedReportRevision{a.Company.ID, d.ID, 1, d.State, d.Configuration, now}).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "report_definition", IDs: []string{d.ID}, Versions: []int64{1}}, nil
		})
		if e != nil {
			return e
		}
		return tx.First(&d, "id=?", out.IDs[0]).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"definition": d})
}
func (s *Server) updateSavedReport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey        string                   `json:"retryKey"`
		ExpectedVersion int64                    `json:"expectedVersion"`
		Configuration   SavedReportConfiguration `json:"configuration"`
		State           string                   `json:"state"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if input.ExpectedVersion < 1 || !in(input.State, "active", "paused", "deleted") {
		return invalid("Choose a valid definition version and state.")
	}
	var d SavedReportDefinition
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		out, e := businessMutation(tx, a, "report.definition.update", input.RetryKey, []any{r.PathValue("id"), input.ExpectedVersion, input.Configuration, input.State}, func() error {
			var e error
			d, e = savedDefinition(tx, a, r.PathValue("id"), true)
			if e != nil {
				return e
			}
			return validateSavedConfiguration(tx, a, input.Configuration)
		}, func(out BusinessResult) error { _, e := savedDefinition(tx, a, out.IDs[0], true); return e }, func() (BusinessResult, error) {
			if d.Version != input.ExpectedVersion || d.State == "deleted" {
				return BusinessResult{}, conflict()
			}
			old := d.Version
			d.Version++
			d.Configuration = input.Configuration
			d.State = input.State
			d.UpdatedAt = time.Now().UTC()
			result := tx.Model(&SavedReportDefinition{}).Where("id=? AND company_id=? AND version=?", d.ID, a.Company.ID, old).Select("version", "configuration", "state", "updated_at").Updates(&d)
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
			if e := tx.Model(&ReportSchedule{}).Where("definition_id=?", d.ID).Updates(map[string]any{"state": "paused", "definition_revision": d.Version}).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "report_definition", IDs: []string{d.ID}, Versions: []int64{d.Version}}, nil
		})
		if e != nil {
			return e
		}
		return tx.First(&d, "id=?", out.IDs[0]).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"definition": d})
}
func (s *Server) listSavedReports(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var rows []SavedReportDefinition
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		return tx.Where("company_id=? AND owner_id=? AND state<>'deleted'", a.Company.ID, a.User.ID).Order("updated_at DESC,id").Limit(100).Find(&rows).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"definitions": rows})
}
func (s *Server) readSavedReport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var d SavedReportDefinition
	var schedule ReportSchedule
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		d, e = savedDefinition(tx, a, r.PathValue("id"), false)
		if e != nil {
			return e
		}
		return tx.Where("company_id=? AND definition_id=?", a.Company.ID, d.ID).Find(&schedule).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"definition": d, "schedule": schedule})
}
func (s *Server) savedReportRecipients(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	rows := []map[string]string{}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if a.Member.Role == "viewer" {
			return denied()
		}
		for uid := range a.Members {
			if a.activeUser(uid) {
				rows = append(rows, map[string]string{"id": uid, "name": a.Users[uid].Name})
			}
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i]["id"] < rows[j]["id"] })
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"recipients": rows})
}
func (s *Server) generateSavedReport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey        string `json:"retryKey"`
		ExpectedVersion int64  `json:"expectedVersion"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if input.ExpectedVersion < 1 {
		return invalid("A definition version is required.")
	}
	var sid string
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var d SavedReportDefinition
		out, e := businessMutation(tx, a, "report.definition.generate", input.RetryKey, []any{r.PathValue("id"), input.ExpectedVersion}, func() error {
			var e error
			d, e = savedDefinition(tx, a, r.PathValue("id"), false)
			if e != nil {
				return e
			}
			if d.State != "active" || d.Version != input.ExpectedVersion {
				return conflict()
			}
			return validateSavedConfiguration(tx, a, d.Configuration)
		}, func(out BusinessResult) error { return authorizeHistoricalSources(tx, a, out.IDs[0]) }, func() (BusinessResult, error) {
			request, e := resolveSavedReportRequest(d.Configuration, a.Company.Timezone, time.Now().UTC())
			if e != nil {
				return BusinessResult{}, e
			}
			snap, e := captureHistoricalReportTx(tx, a, request, &ReportDefinitionBasis{d.ID, d.Version})
			if e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "historical_snapshot", IDs: []string{snap.ID}, Versions: []int64{1}}, nil
		})
		if e == nil {
			sid = out.IDs[0]
		}
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"snapshotId": sid})
}
