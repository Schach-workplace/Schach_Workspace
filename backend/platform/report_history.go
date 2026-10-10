package platform

import (
	"time"
)

type ReportDimensionFilters struct {
	OwnerID      string `json:"ownerId"`
	DepartmentID string `json:"departmentId"`
	ProjectID    string `json:"projectId"`
}
type HistoricalReportRequest struct {
	From       string                 `json:"from"`
	To         string                 `json:"to"`
	ReportZone string                 `json:"reportZone"`
	Filters    ReportDimensionFilters `json:"filters"`
	Basis      string                 `json:"basis"`
}
type ResolvedReportPeriod struct {
	From           string    `json:"from"`
	To             string    `json:"to"`
	Zone           string    `json:"zone"`
	StartInclusive time.Time `json:"startInclusive"`
	EndExclusive   time.Time `json:"endExclusive"`
}
type ReportDefinitionBasis struct {
	ID       string
	Revision int64
}
type HistoricalReportRow struct {
	SnapshotID      string          `json:"-" gorm:"primaryKey"`
	RowID           string          `json:"rowId" gorm:"primaryKey"`
	Order           int             `json:"-" gorm:"column:row_order"`
	Kind            string          `json:"kind"`
	TaskID          string          `json:"taskId"`
	FactID          string          `json:"factId"`
	TaskVersion     int64           `json:"taskVersion"`
	AcceptanceID    string          `json:"acceptanceId,omitempty"`
	TimeFactID      string          `json:"timeFactId,omitempty"`
	State           ReportTaskState `json:"state" gorm:"serializer:json;type:jsonb"`
	AcceptedAtRaw   string          `json:"acceptedAtRaw,omitempty"`
	AcceptanceKind  string          `json:"acceptanceKind,omitempty"`
	EntryDate       string          `json:"entryDate,omitempty"`
	Hours           float64         `json:"hours,omitempty"`
	Provenance      string          `json:"provenance"`
	Reason          string          `json:"reason,omitempty"`
	LabelBasis      string          `json:"labelBasis"`
	OwnerLabel      string          `json:"ownerLabel"`
	DepartmentLabel string          `json:"departmentLabel"`
	ProjectLabel    string          `json:"projectLabel"`
}
type HistoricalReportMetric struct {
	Code            string   `json:"code"`
	Value           float64  `json:"value"`
	Unit            string   `json:"unit"`
	Numerator       *int     `json:"numerator,omitempty"`
	Denominator     *int     `json:"denominator,omitempty"`
	Rate            *float64 `json:"rate"`
	Coverage        []string `json:"coverage"`
	Contributing    []string `json:"contributingRows"`
	NumeratorRows   []string `json:"numeratorRows"`
	DenominatorRows []string `json:"denominatorRows"`
}
type HistoricalReportSummary struct {
	Metrics  map[string]HistoricalReportMetric `json:"metrics"`
	Coverage []string                          `json:"coverage"`
}
type HistoricalReportSnapshot struct {
	ID                 string                            `json:"id" gorm:"primaryKey"`
	CompanyID          string                            `json:"companyId" gorm:"index"`
	RequesterID        string                            `json:"requesterId"`
	SchemaVersion      int                               `json:"schemaVersion"`
	MetricVersion      int                               `json:"metricVersion"`
	Basis              string                            `json:"basis"`
	RequestHash        string                            `json:"requestHash"`
	Request            HistoricalReportRequest           `json:"request" gorm:"serializer:json;type:jsonb"`
	Period             ResolvedReportPeriod              `json:"period" gorm:"serializer:json;type:jsonb"`
	GeneratedAt        time.Time                         `json:"generatedAt"`
	DefinitionID       string                            `json:"definitionId"`
	DefinitionRevision int64                             `json:"definitionRevision"`
	ContentHash        string                            `json:"contentHash"`
	SerializedBytes    int                               `json:"serializedBytes"`
	RowCount           int                               `json:"rowCount"`
	Summary            HistoricalReportSummary           `json:"summary" gorm:"serializer:json;type:jsonb"`
	Membership         map[string]HistoricalReportMetric `json:"-" gorm:"serializer:json;type:jsonb"`
}
type ReportSnapshotSource struct {
	CompanyID  string `gorm:"primaryKey"`
	SnapshotID string `gorm:"primaryKey"`
	TaskID     string `gorm:"primaryKey"`
	Role       string
}

func resolveReportPeriod(from, to, zone string) (ResolvedReportPeriod, error) {
	p := ResolvedReportPeriod{From: from, To: to, Zone: zone}
	if from == "" || to == "" || !validDate(from) || !validDate(to) || from > to {
		return p, invalid("Choose a valid report start and end date.")
	}
	loc, e := time.LoadLocation(zone)
	if e != nil || zone == "" {
		return p, invalid("Choose an IANA report timezone.")
	}
	p.StartInclusive, e = time.ParseInLocation("2006-01-02", from, loc)
	if e != nil {
		return p, e
	}
	end, e := time.ParseInLocation("2006-01-02", to, loc)
	if e != nil {
		return p, e
	}
	p.EndExclusive = end.AddDate(0, 0, 1)
	return p, nil
}
func reportDimensionsMatch(state ReportTaskState, f ReportDimensionFilters) bool {
	return (f.OwnerID == "" || state.OwnerID == f.OwnerID) && (f.DepartmentID == "" || state.DepartmentID == f.DepartmentID) && (f.ProjectID == "" || state.ProjectID == f.ProjectID)
}
func reportDeadlineMet(raw string, d ReportDeadline, zone string) (bool, bool) {
	accepted, e := time.Parse(time.RFC3339Nano, raw)
	if e != nil {
		return false, false
	}
	if d.Mode == "timed" {
		due, e := time.Parse(time.RFC3339Nano, d.At)
		return e == nil && !accepted.After(due), e == nil
	}
	if d.Mode != "all_day" || d.Date == "" || !validDate(d.Date) {
		return false, false
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return false, false
	}
	return accepted.In(loc).Format("2006-01-02") <= d.Date, true
}
func reduceHistoricalReport(rows []HistoricalReportRow, p ResolvedReportPeriod) HistoricalReportSummary {
	summary := HistoricalReportSummary{Metrics: map[string]HistoricalReportMetric{}, Coverage: []string{}}
	codes := []string{"state.cohort", "state.done", "state.blocked", "state.pending_review", "state.overdue", "state.deadline_changed", "state.actual_hours", "acceptance.episodes", "acceptance.unique_tasks", "acceptance.original_on_time", "acceptance.current_on_time", "effort.logged_hours", "effort.observed_hours", "coverage.unknown_before", "coverage.gaps", "coverage.observed_time", "coverage.invalid_deadline"}
	for _, c := range codes {
		unit := "count"
		if c == "state.actual_hours" || c == "effort.logged_hours" || c == "effort.observed_hours" {
			unit = "hours"
		}
		summary.Metrics[c] = HistoricalReportMetric{Code: c, Unit: unit, Coverage: []string{}, Contributing: []string{}, NumeratorRows: []string{}, DenominatorRows: []string{}}
	}
	add := func(code string, r HistoricalReportRow, value float64) {
		m := summary.Metrics[code]
		m.Value += value
		m.Contributing = append(m.Contributing, r.RowID)
		summary.Metrics[code] = m
	}
	unique := map[string]bool{}
	for _, r := range rows {
		switch r.Kind {
		case "coverage":
			code := "coverage.unknown_before"
			if r.Reason == "gap" || r.Reason == "inconsistent" {
				code = "coverage.gaps"
			}
			add(code, r, 1)
			summary.Coverage = append(summary.Coverage, r.RowID)
		case "state":
			d := r.State.Current
			if d.Date == "" || !validDate(d.Date) {
				add("coverage.invalid_deadline", r, 1)
				continue
			}
			if r.State.Status == "cancelled" || d.Date < p.From || d.Date > p.To {
				continue
			}
			add("state.cohort", r, 1)
			add("state.actual_hours", r, r.State.ActualHours)
			switch r.State.Status {
			case "done":
				add("state.done", r, 1)
			case "blocked":
				add("state.blocked", r, 1)
			case "in_review":
				add("state.pending_review", r, 1)
			}
			if !in(r.State.Status, "done", "cancelled") {
				overdue := d.Date <= p.To
				if d.Mode == "timed" {
					at, e := time.Parse(time.RFC3339Nano, d.At)
					overdue = e == nil && at.Before(p.EndExclusive)
				}
				if overdue {
					add("state.overdue", r, 1)
				}
			}
			if r.State.Current != r.State.Original {
				add("state.deadline_changed", r, 1)
			}
		case "acceptance":
			add("acceptance.episodes", r, 1)
			if !unique[r.TaskID] {
				add("acceptance.unique_tasks", r, 1)
				unique[r.TaskID] = true
			}
			for _, x := range []struct {
				code     string
				deadline ReportDeadline
			}{{"acceptance.original_on_time", r.State.Original}, {"acceptance.current_on_time", r.State.Current}} {
				met, valid := reportDeadlineMet(r.AcceptedAtRaw, x.deadline, r.State.CompanyPolicyZone)
				m := summary.Metrics[x.code]
				if valid {
					m.DenominatorRows = append(m.DenominatorRows, r.RowID)
					if met {
						m.NumeratorRows = append(m.NumeratorRows, r.RowID)
					}
				} else {
					m.Coverage = append(m.Coverage, r.RowID)
					add("coverage.invalid_deadline", r, 1)
				}
				summary.Metrics[x.code] = m
			}
		case "time":
			if r.Provenance == "native_time_entry" {
				add("effort.logged_hours", r, r.Hours)
			} else {
				add("effort.observed_hours", r, r.Hours)
				add("coverage.observed_time", r, 1)
			}
		}
	}
	for _, code := range []string{"acceptance.original_on_time", "acceptance.current_on_time"} {
		m := summary.Metrics[code]
		n, d := len(m.NumeratorRows), len(m.DenominatorRows)
		m.Numerator = &n
		m.Denominator = &d
		m.Value = float64(n)
		m.Unit = "percent"
		if d > 0 {
			v := float64(n) * 100 / float64(d)
			m.Rate = &v
		}
		summary.Metrics[code] = m
	}
	for _, code := range []string{"state.done", "state.blocked", "state.pending_review", "state.overdue", "state.deadline_changed"} {
		m := summary.Metrics[code]
		m.NumeratorRows = append([]string{}, m.Contributing...)
		m.DenominatorRows = append([]string{}, summary.Metrics["state.cohort"].Contributing...)
		n, d := len(m.NumeratorRows), len(m.DenominatorRows)
		m.Numerator = &n
		m.Denominator = &d
		if d > 0 {
			rate := float64(n) * 100 / float64(d)
			m.Rate = &rate
		}
		summary.Metrics[code] = m
	}
	return summary
}
