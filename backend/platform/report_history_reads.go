package platform

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"time"
)

func (s *Server) historicalReportRoutes() {
	const root = "/api/companies/{cid}/reports/history"
	s.route("POST "+root+"/snapshots", s.createHistoricalSnapshot)
	s.route("GET "+root+"/snapshots/{id}", s.readHistoricalSnapshot)
	s.route("GET "+root+"/snapshots/{id}/rows", s.readHistoricalRows)
	s.route("POST "+root+"/compare", s.compareHistoricalSnapshots)
}
func historicalInstant(raw string, fallback time.Time) time.Time {
	v, e := time.Parse(time.RFC3339Nano, raw)
	if e != nil {
		return fallback
	}
	return v
}

// Candidate pages are independent of the output limit: attribution may reject
// early events. A bounded total scan fails closed rather than returning a prefix.
const reportCandidateScanLimit = 100000

func scanHistoricalCandidates[T any](query *gorm.DB, scanned *int, id func(T) string, consume func([]T) error) error {
	cursor := ""
	for {
		var page []T
		q := query.Session(&gorm.Session{}).Order("id").Limit(500)
		if cursor != "" {
			q = q.Where("id > ?", cursor)
		}
		if e := q.Find(&page).Error; e != nil {
			return e
		}
		*scanned += len(page)
		if *scanned > reportCandidateScanLimit {
			return rangeTooLarge()
		}
		if e := consume(page); e != nil {
			return e
		}
		if len(page) < 500 {
			return nil
		}
		cursor = id(page[len(page)-1])
	}
}

// Caller owns the accepted company/session/current-actor transaction fence.
func captureHistoricalReportTx(tx *gorm.DB, a *access, input HistoricalReportRequest, definition *ReportDefinitionBasis) (HistoricalReportSnapshot, error) {
	snap := HistoricalReportSnapshot{}
	if e := validateHistoricalRequest(tx, a, input); e != nil {
		return snap, e
	}
	period, e := resolveReportPeriod(input.From, input.To, input.ReportZone)
	if e != nil {
		return snap, e
	}
	var tasks []Task
	scanned := 0
	if e := scanHistoricalCandidates(taskReadQuery(tx, a), &scanned, func(t Task) string { return t.ID }, func(page []Task) error { tasks = append(tasks, page...); return nil }); e != nil {
		return snap, e
	}
	now := time.Now().UTC()
	ids := []string{}
	visible := map[string]bool{}
	for _, task := range tasks {
		ids = append(ids, task.ID)
		visible[task.ID] = true
		if e := ensureObservedTaskState(tx, task, now); e != nil {
			return snap, e
		}
	}
	snap = HistoricalReportSnapshot{ID: newID("hs"), CompanyID: a.Company.ID, RequesterID: a.User.ID, SchemaVersion: 1, MetricVersion: 1, Basis: input.Basis, RequestHash: payloadHash(input), Request: input, Period: period, GeneratedAt: now}
	if definition != nil {
		snap.DefinitionID = definition.ID
		snap.DefinitionRevision = definition.Revision
	}
	rows := []HistoricalReportRow{}
	sourceRoles := map[string]string{}
	add := func(row HistoricalReportRow) error {
		row.SnapshotID = snap.ID
		row.RowID = newID("hr")
		row.Order = len(rows)
		row.LabelBasis = "generation_time"
		if u, ok := a.Users[row.State.OwnerID]; ok {
			row.OwnerLabel = u.Name
		}
		if row.State.DepartmentID != "" {
			var d Department
			if e := tx.First(&d, "company_id=? AND id=?", a.Company.ID, row.State.DepartmentID).Error; e == nil {
				row.DepartmentLabel = d.Name
			} else if e != gorm.ErrRecordNotFound {
				return e
			}
		}
		if row.State.ProjectID != "" {
			var p Project
			if e := tx.First(&p, "company_id=? AND id=?", a.Company.ID, row.State.ProjectID).Error; e == nil {
				ok, e := canReadProject(tx, a, p)
				if e != nil {
					return e
				}
				if ok {
					row.ProjectLabel = p.Name
				}
			} else if e != gorm.ErrRecordNotFound {
				return e
			}
		}
		if !visible[row.State.ParentID] {
			row.State.ParentID = ""
		} else if row.State.ParentID != "" {
			sourceRoles[row.State.ParentID] = "reference"
		}
		deps := []string{}
		for _, id := range row.State.Dependencies {
			if visible[id] {
				deps = append(deps, id)
				sourceRoles[id] = "reference"
			}
		}
		row.State.Dependencies = deps
		role := "contributing"
		if row.Kind == "coverage" {
			role = "coverage"
		}
		sourceRoles[row.TaskID] = role
		rows = append(rows, row)
		if len(rows) > reportRowLimit {
			return rangeTooLarge()
		}
		return nil
	}
	for start := 0; start < len(ids); start += 100 {
		end := start + 100
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[start:end]
		var covs []TaskHistoryCoverage
		if e := tx.Where("company_id=? AND task_id IN ?", a.Company.ID, batch).Find(&covs).Error; e != nil {
			return snap, e
		}
		// Database ranking bounds state materialization to one row per task.
		ranked := tx.Model(&TaskFact{}).Select("task_facts.*, ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY effective_at DESC, task_version DESC) AS rank").Where("company_id=? AND task_id IN ? AND effective_at < ?", a.Company.ID, batch, period.EndExclusive)
		var states []TaskFact
		if e := tx.Table("(?) AS ranked", ranked).Where("rank=1").Find(&states).Error; e != nil {
			return snap, e
		}
		known := map[string]TaskFact{}
		for _, f := range states {
			if historicalInstant(f.EffectiveAtRaw, f.EffectiveAt).Before(period.EndExclusive) {
				known[f.TaskID] = f
			}
		}
		for _, cov := range covs {
			f, ok := known[cov.TaskID]
			cutoffUnavailable := false
			var gaps []TaskHistoryGap
			if e := tx.Where("company_id=? AND task_id=? AND from_exclusive < ?", a.Company.ID, cov.TaskID, period.EndExclusive).Find(&gaps).Error; e != nil {
				return snap, e
			}
			for _, gap := range gaps {
				// Interval history and the latest known cutoff state are independent.
				// Every intersecting gap remains visible even after a later known fact.
				intersects := gap.ToExclusive == nil || gap.ToExclusive.After(period.StartInclusive)
				reason := "gap"
				if gap.ToExclusive == nil {
					reason = "inconsistent"
				}
				if intersects {
					if e := add(HistoricalReportRow{Kind: "coverage", TaskID: cov.TaskID, FactID: gap.ID, Reason: reason, Provenance: "unknown"}); e != nil {
						return snap, e
					}
				}
				if gap.ToExclusive != nil {
					if period.EndExclusive.After(gap.FromExclusive) && !period.EndExclusive.After(*gap.ToExclusive) {
						cutoffUnavailable = true
					}
				} else if !ok || !f.EffectiveAt.After(gap.FromExclusive) {
					cutoffUnavailable = true
				}
			}
			if cutoffUnavailable {
				continue
			}
			if !ok {
				if cov.UnknownBefore {
					if e := add(HistoricalReportRow{Kind: "coverage", TaskID: cov.TaskID, Reason: "unknown_before", Provenance: "observed_current_state"}); e != nil {
						return snap, e
					}
				}
				continue
			}
			if reportDimensionsMatch(f.State, input.Filters) {
				if cov.UnknownBefore && cov.FirstKnownAt.After(period.StartInclusive) {
					if e := add(HistoricalReportRow{Kind: "coverage", TaskID: cov.TaskID, Reason: "unknown_before", Provenance: "observed_current_state"}); e != nil {
						return snap, e
					}
				}
				if e := add(HistoricalReportRow{Kind: "state", TaskID: f.TaskID, FactID: f.ID, TaskVersion: f.TaskVersion, State: f.State, Provenance: f.Provenance}); e != nil {
					return snap, e
				}
			}
		}
		if e := scanHistoricalCandidates(tx.Where("company_id=? AND task_id IN ? AND accepted_at >= ? AND accepted_at < ?", a.Company.ID, batch, period.StartInclusive, period.EndExclusive), &scanned, func(f TaskAcceptanceFact) string { return f.ID }, func(acceptances []TaskAcceptanceFact) error {
			for _, f := range acceptances {
				at := historicalInstant(f.AcceptedAtRaw, f.AcceptedAt)
				if at.Before(period.StartInclusive) || !at.Before(period.EndExclusive) || !reportDimensionsMatch(f.State, input.Filters) {
					continue
				}
				if e := add(HistoricalReportRow{Kind: "acceptance", TaskID: f.TaskID, FactID: f.TaskFactID, TaskVersion: f.TaskVersion, AcceptanceID: f.ID, AcceptedAtRaw: f.AcceptedAtRaw, AcceptanceKind: f.AcceptanceKind, State: f.State, Provenance: "native_event"}); e != nil {
					return e
				}
			}
			return nil
		}); e != nil {
			return snap, e
		}
		if e := scanHistoricalCandidates(tx.Where("company_id=? AND task_id IN ? AND entry_date>=? AND entry_date<=? AND recorded_at<?", a.Company.ID, batch, input.From, input.To, period.EndExclusive), &scanned, func(f TaskTimeFact) string { return f.ID }, func(times []TaskTimeFact) error {
			for _, f := range times {
				if !historicalInstant(f.RecordedAtRaw, f.RecordedAt).Before(period.EndExclusive) {
					continue
				}
				var linked TaskFact
				if e := tx.First(&linked, "id=? AND company_id=?", f.TaskFactID, a.Company.ID).Error; e != nil {
					return e
				}
				if !reportDimensionsMatch(linked.State, input.Filters) {
					continue
				}
				if e := add(HistoricalReportRow{Kind: "time", TaskID: f.TaskID, FactID: f.TaskFactID, TaskVersion: f.TaskVersion, TimeFactID: f.ID, EntryDate: f.EntryDate, Hours: f.Hours, State: linked.State, Provenance: f.Provenance}); e != nil {
					return e
				}
			}
			return nil
		}); e != nil {
			return snap, e
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].TaskID != rows[j].TaskID {
			return rows[i].TaskID < rows[j].TaskID
		}
		if rows[i].Kind != rows[j].Kind {
			return rows[i].Kind < rows[j].Kind
		}
		return rows[i].FactID < rows[j].FactID
	})
	for i := range rows {
		rows[i].Order = i
	}
	snap.Summary = reduceHistoricalReport(rows, period)
	snap.Membership = snap.Summary.Metrics
	snap.RowCount = len(rows)
	canonical := struct {
		Snapshot HistoricalReportSnapshot
		Rows     []HistoricalReportRow
		Sources  map[string]string
	}{snap, rows, sourceRoles}
	bytes, e := json.Marshal(canonical)
	if e != nil {
		return snap, e
	}
	if len(bytes) > 8<<20 {
		return snap, rangeTooLarge()
	}
	snap.SerializedBytes = len(bytes)
	snap.ContentHash = payloadHash(canonical)
	if e := tx.Create(&snap).Error; e != nil {
		return snap, e
	}
	if len(rows) > 0 {
		if e := tx.CreateInBatches(&rows, 100).Error; e != nil {
			return snap, e
		}
	}
	sources := []ReportSnapshotSource{}
	for id, role := range sourceRoles {
		sources = append(sources, ReportSnapshotSource{a.Company.ID, snap.ID, id, role})
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].TaskID < sources[j].TaskID })
	if len(sources) > 0 {
		if e := tx.CreateInBatches(&sources, 100).Error; e != nil {
			return snap, e
		}
	}
	if e := authorizeHistoricalSources(tx, a, snap.ID); e != nil {
		return snap, e
	}
	return snap, nil
}
func (s *Server) captureHistoricalReport(ctx context.Context, a *access, input HistoricalReportRequest, definition *ReportDefinitionBasis) (HistoricalReportSnapshot, error) {
	var snap HistoricalReportSnapshot
	opts := &sql.TxOptions{}
	if s.db.Dialector.Name() == "postgres" {
		opts.Isolation = sql.LevelRepeatableRead
	}
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := lockCompany(tx, a.Company.ID); e != nil {
			return e
		}
		fresh, e := currentAttentionActorLocked(tx, a.Company.ID, a.User.ID)
		if e != nil {
			return e
		}
		*a = *fresh
		snap, e = captureHistoricalReportTx(tx, a, input, definition)
		return e
	}, opts)
	return snap, e
}
func (s *Server) createHistoricalSnapshot(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey string                  `json:"retryKey"`
		Request  HistoricalReportRequest `json:"request"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	var id string
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		out, e := businessMutation(tx, a, "report.history.capture", input.RetryKey, input.Request, func() error { return validateHistoricalRequest(tx, a, input.Request) }, func(out BusinessResult) error { return authorizeHistoricalSources(tx, a, out.IDs[0]) }, func() (BusinessResult, error) {
			snap, e := captureHistoricalReportTx(tx, a, input.Request, nil)
			if e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "historical_snapshot", IDs: []string{snap.ID}, Versions: []int64{1}}, nil
		})
		if e == nil {
			id = out.IDs[0]
		}
		return e
	}, s.reportCaptureOptions())
	if e != nil {
		return e
	}
	var snap HistoricalReportSnapshot
	if e := s.db.First(&snap, "id=?", id).Error; e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"snapshotId": id, "snapshot": snap})
}
func (s *Server) readHistoricalSnapshot(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var snap HistoricalReportSnapshot
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		if e := authorizeHistoricalSources(tx, a, r.PathValue("id")); e != nil {
			return e
		}
		return tx.First(&snap, "id=?", r.PathValue("id")).Error
	})
	if e != nil {
		return e
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return respond(w, 200, map[string]any{"snapshot": snap})
}

type historicalCursor struct {
	Snapshot   string `json:"s"`
	Metric     string `json:"m"`
	Membership string `json:"b"`
	Schema     int    `json:"v"`
	Offset     int    `json:"o"`
}

func (s *Server) readHistoricalRows(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	q := r.URL.Query()
	metric, membership := q.Get("metric"), q.Get("membership")
	if membership == "" {
		membership = "contributing"
	}
	if !in(membership, "contributing", "numerator", "denominator") {
		return invalid("Invalid metric membership.")
	}
	cursor := historicalCursor{r.PathValue("id"), metric, membership, 1, 0}
	if raw := q.Get("cursor"); raw != "" {
		b, e := base64.RawURLEncoding.DecodeString(raw)
		var c historicalCursor
		if len(raw) > 2048 || e != nil || json.Unmarshal(b, &c) != nil || c.Snapshot != cursor.Snapshot || c.Metric != metric || c.Membership != membership || c.Schema != 1 || c.Offset < 0 {
			return invalid("Cursor does not match the report metric.")
		}
		cursor = c
	}
	var snap HistoricalReportSnapshot
	rows := []HistoricalReportRow{}
	var m HistoricalReportMetric
	var next string
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		if e := authorizeHistoricalSources(tx, a, cursor.Snapshot); e != nil {
			return e
		}
		if e := tx.First(&snap, "id=?", cursor.Snapshot).Error; e != nil {
			return e
		}
		var ok bool
		m, ok = snap.Membership[metric]
		if !ok {
			return invalid("Choose a supported report metric.")
		}
		ids := m.Contributing
		if membership == "numerator" {
			ids = m.NumeratorRows
		}
		if membership == "denominator" {
			ids = m.DenominatorRows
		}
		if cursor.Offset > len(ids) {
			return invalid("Invalid report cursor.")
		}
		end := cursor.Offset + limit
		if end > len(ids) {
			end = len(ids)
		}
		if end < len(ids) {
			c := cursor
			c.Offset = end
			b, _ := json.Marshal(c)
			next = base64.RawURLEncoding.EncodeToString(b)
		}
		if end > cursor.Offset {
			return tx.Where("snapshot_id=? AND row_id IN ?", cursor.Snapshot, ids[cursor.Offset:end]).Order("row_order").Find(&rows).Error
		}
		return nil
	})
	if e != nil {
		return e
	}
	for i := range rows {
		rows[i].EpisodeIDs = append([]string{}, snap.Summary.Metrics["acceptance.unique_tasks"].EpisodeIDsByRow[rows[i].RowID]...)
	}
	return respond(w, 200, map[string]any{"code": m.Code, "value": m.Value, "unit": m.Unit, "numerator": m.Numerator, "denominator": m.Denominator, "rate": m.Rate, "coverage": m.Coverage, "rows": rows, "cursor": next})
}
func (s *Server) compareHistoricalSnapshots(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		Left  string `json:"leftSnapshotId"`
		Right string `json:"rightSnapshotId"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	comparisons := map[string]any{}
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		for _, id := range []string{input.Left, input.Right} {
			if e := authorizeHistoricalSources(tx, a, id); e != nil {
				return e
			}
		}
		var left, right HistoricalReportSnapshot
		if e := tx.First(&left, "id=?", input.Left).Error; e != nil {
			return e
		}
		if e := tx.First(&right, "id=?", input.Right).Error; e != nil {
			return e
		}
		if left.SchemaVersion != right.SchemaVersion || left.MetricVersion != right.MetricVersion || left.Basis != right.Basis || left.Request.ReportZone != right.Request.ReportZone || left.Request.Filters != right.Request.Filters {
			return invalid("Snapshots must share schema, basis, dimensions and report zone.")
		}
		for code, l := range left.Summary.Metrics {
			rr := right.Summary.Metrics[code]
			var pp *float64
			if l.Rate != nil && rr.Rate != nil {
				d := *rr.Rate - *l.Rate
				pp = &d
			}
			comparisons[code] = map[string]any{"left": l, "right": rr, "delta": rr.Value - l.Value, "percentagePoints": pp}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"comparisons": comparisons})
}

func (s *Server) reportCaptureOptions() *sql.TxOptions {
	opts := &sql.TxOptions{}
	if s.db.Dialector.Name() == "postgres" {
		opts.Isolation = sql.LevelRepeatableRead
	}
	return opts
}
