package platform

import (
	"bytes"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"gorm.io/gorm"
)

type reportSnapshot struct {
	Period        *ResolvedReportPeriod
	MetricVersion int
	Token         string
	Company       string
	User          string
	Access        string
	Filters       string
	Timezone      string
	Generated     time.Time
	Rows          []Task
	Summary       map[string]any
	People        map[string]Person
	Departments   map[string]string
	Projects      map[string]string
	Bytes         int
}

const reportRowLimit = 10000

func reportFilters(r *http.Request) (string, error) {
	q := r.URL.Query()
	from, to := q.Get("from"), q.Get("to")
	if from == "" || to == "" || !validDate(from) || !validDate(to) || from > to {
		return "", invalid("Choose a valid report start and end date.")
	}
	return payloadHash([]string{from, to, q.Get("departmentId"), q.Get("ownerId"), q.Get("projectId")}), nil
}
func deadlineMet(t Task, loc *time.Location, original bool) (bool, bool) {
	at, e := time.Parse(time.RFC3339Nano, t.CompletedAt)
	if e != nil {
		return false, false
	}
	mode, due, instant := t.DeadlineMode, t.DueDate, t.DueAt
	if original {
		mode, due, instant = t.OriginalDeadlineMode, t.OriginalDueDate, t.OriginalDueAt
	}
	if mode == "timed" {
		end, e := time.Parse(time.RFC3339Nano, string(instant))
		return e == nil && !at.After(end), e == nil
	}
	if due == "" || !validDate(due) {
		return false, false
	}
	return at.In(loc).Format("2006-01-02") <= due, true
}
func summarizeReport(rows []Task, from, to, zone string, now time.Time) map[string]any {
	loc, _ := time.LoadLocation(zone)
	counts := map[string]int{"needsAttention": 0, "rows": len(rows), "cohort": 0, "accepted": 0, "originals": 0, "ontime": 0, "currents": 0, "currentOnTime": 0, "overdue": 0, "changed": 0, "done": 0, "blocked": 0, "pending": 0}
	dates := []string{}
	for _, t := range rows {
		if t.DueDate != "" && t.DueDate >= from && t.DueDate <= to && t.Status != "cancelled" {
			counts["cohort"]++
			if taskOverdue(t, now, zone) || in(t.Status, "blocked", "in_review") {
				counts["needsAttention"]++
			}
			if t.Status == "done" {
				counts["done"]++
			}
			if t.Status == "blocked" {
				counts["blocked"]++
			}
			if t.Status == "in_review" {
				counts["pending"]++
			}
			if taskOverdue(t, now, zone) {
				counts["overdue"]++
			}
			original := t
			original.DueDate = t.OriginalDueDate
			original.DueAt = t.OriginalDueAt
			original.DeadlineMode = t.OriginalDeadlineMode
			original.DueTimezone = t.OriginalDueTimezone
			if (t.OriginalDueDate != "" || t.OriginalDueAt != "") && deadlineChanged(t, original) {
				counts["changed"]++
			}
		}
		at, e := time.Parse(time.RFC3339Nano, t.CompletedAt)
		day := at.In(loc).Format("2006-01-02")
		if t.Status == "done" && e == nil && day >= from && day <= to {
			counts["accepted"]++
			dates = append(dates, day)
			if met, valid := deadlineMet(t, loc, true); valid {
				counts["originals"]++
				if met {
					counts["ontime"]++
				}
			}
			if met, valid := deadlineMet(t, loc, false); valid {
				counts["currents"]++
				if met {
					counts["currentOnTime"]++
				}
			}
		}
	}
	start, _ := time.Parse("2006-01-02", from)
	end, _ := time.Parse("2006-01-02", to)
	days := int(end.Sub(start).Hours()/24) + 1
	size := (days + 11) / 12
	buckets := []map[string]any{}
	for i := 0; i < days; i += size {
		last := i + size - 1
		if last >= days {
			last = days - 1
		}
		s, e := start.AddDate(0, 0, i).Format("2006-01-02"), start.AddDate(0, 0, last).Format("2006-01-02")
		count := 0
		for _, d := range dates {
			if d >= s && d <= e {
				count++
			}
		}
		buckets = append(buckets, map[string]any{"start": s, "end": e, "count": count})
	}
	out := map[string]any{"buckets": buckets, "valid": true}
	for k, v := range counts {
		out[k] = v
	}
	return out
}
func (s *Server) createReportSnapshot(r *http.Request) (*reportSnapshot, error) {
	filters, e := reportFilters(r)
	if e != nil {
		return nil, e
	}
	snap := &reportSnapshot{Token: newID("report"), Filters: filters, Generated: time.Now().UTC()}
	txopts := &sql.TxOptions{ReadOnly: true}
	if s.db.Dialector.Name() == "postgres" {
		txopts.Isolation = sql.LevelRepeatableRead
	}
	e = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		scoped := &Server{db: tx, opts: s.opts}
		a, e := scoped.access(r)
		if e != nil {
			return e
		}
		if _, e = time.LoadLocation(a.Company.Timezone); e != nil {
			return invalid("The company report timezone is invalid.")
		}
		snap.Company = a.Company.ID
		snap.User = a.User.ID
		snap.Access = accessBasis(a)
		snap.Timezone = a.Company.Timezone
		period, e := resolveReportPeriod(r.URL.Query().Get("from"), r.URL.Query().Get("to"), a.Company.Timezone)
		if e != nil {
			return e
		}
		snap.Period = &period
		snap.MetricVersion = 1
		snap.People = map[string]Person{}
		for id, m := range a.Members {
			snap.People[id] = person(a.Users[id], m, a.Company.PermissionEpoch)
		}
		snap.Departments = map[string]string{}
		snap.Projects = map[string]string{}
		var ds []Department
		var ps []Project
		if e = tx.Where("company_id = ?", a.Company.ID).Find(&ds).Error; e != nil {
			return e
		}
		if e = tx.Where("company_id = ?", a.Company.ID).Find(&ps).Error; e != nil {
			return e
		}
		for _, d := range ds {
			snap.Departments[d.ID] = d.Name
		}
		for _, p := range ps {
			snap.Projects[p.ID] = p.Name
		}
		q := r.URL.Query()
		query := taskReadQuery(tx, a).Omit("Checklist").Where("status <> 'cancelled'")
		for _, f := range []struct{ k, c string }{{"departmentId", "department_id"}, {"ownerId", "owner_id"}, {"projectId", "project_id"}} {
			if v := q.Get(f.k); v != "" {
				query = query.Where(f.c+" = ?", v)
			}
		}
		// Apply calendar acceptance in Go to preserve both native and SQLite datetime semantics.
		// A broad UTC window bounds candidates; final company calendar filter is exact.
		from, to := q.Get("from"), q.Get("to")
		start, _ := time.Parse("2006-01-02", from)
		end, _ := time.Parse("2006-01-02", to)
		query = query.Where("(due_date >= ? AND due_date <= ?) OR (status = 'done' AND completed_at >= ? AND completed_at < ?)", from, to, start.AddDate(0, 0, -1).Format(time.RFC3339), end.AddDate(0, 0, 2).Format(time.RFC3339))
		rows := []Task{}
		if e = query.Order("created_at DESC, id DESC").Limit(reportRowLimit + 1).Find(&rows).Error; e != nil {
			return e
		}
		if len(rows) > reportRowLimit {
			return invalid("Report exceeds 10000 rows. Narrow the date range or filters.")
		}
		loc, _ := time.LoadLocation(snap.Timezone)
		snap.Rows = []Task{}
		for _, t := range rows {
			due := t.DueDate != "" && t.DueDate >= from && t.DueDate <= to
			accepted := false
			if t.Status == "done" {
				if at, e := time.Parse(time.RFC3339Nano, t.CompletedAt); e == nil {
					day := at.In(loc).Format("2006-01-02")
					accepted = day >= from && day <= to
				}
			}
			if due || accepted {
				snap.Rows = append(snap.Rows, t)
			}
		}
		if e = pruneTaskLinks(tx, a, snap.Rows); e != nil {
			return e
		}
		snap.Summary = summarizeReport(snap.Rows, from, to, snap.Timezone, snap.Generated)
		groups := map[string][]Task{}
		for _, t := range snap.Rows {
			groups[t.DepartmentID] = append(groups[t.DepartmentID], t)
		}
		departments := map[string]any{}
		for id, rows := range groups {
			departments[id] = summarizeReport(rows, from, to, snap.Timezone, snap.Generated)
		}
		snap.Summary["departments"] = departments
		return nil
	}, txopts)
	if e != nil {
		return nil, e
	}
	b, _ := json.Marshal(snap)
	snap.Bytes = len(b)
	if snap.Bytes > 8<<20 {
		return nil, invalid("Report payload is too large. Narrow its filters.")
	}
	s.reportMu.Lock()
	defer s.reportMu.Unlock()
	if s.reportSnapshots == nil {
		s.reportSnapshots = map[string]*reportSnapshot{}
	}
	for k, v := range s.reportSnapshots {
		if time.Since(v.Generated) > 5*time.Minute {
			delete(s.reportSnapshots, k)
		}
	}
	total := snap.Bytes
	for _, v := range s.reportSnapshots {
		total += v.Bytes
	}
	for len(s.reportSnapshots) >= 64 || total > 32<<20 {
		keys := make([]string, 0, len(s.reportSnapshots))
		for k := range s.reportSnapshots {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			return s.reportSnapshots[keys[i]].Generated.Before(s.reportSnapshots[keys[j]].Generated)
		})
		total -= s.reportSnapshots[keys[0]].Bytes
		delete(s.reportSnapshots, keys[0])
	}
	s.reportSnapshots[snap.Token] = snap
	return snap, nil
}
func (s *Server) readReportSnapshot(r *http.Request) (*reportSnapshot, error) {
	a, e := s.access(r)
	if e != nil {
		return nil, e
	}
	filters, e := reportFilters(r)
	if e != nil {
		return nil, e
	}
	s.reportMu.Lock()
	snap := s.reportSnapshots[r.URL.Query().Get("snapshot")]
	s.reportMu.Unlock()
	if snap == nil || time.Since(snap.Generated) > 5*time.Minute {
		return nil, &apiError{409, "snapshot_expired", "Generate a new report summary before continuing.", nil}
	}
	if e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		return authorizeCurrentReportSnapshot(tx, a, snap, filters)
	}); e != nil {
		return nil, e
	}
	return snap, nil
}

func authorizeCurrentReportSnapshot(tx *gorm.DB, a *access, snap *reportSnapshot, filters string) error {
	if snap == nil || time.Since(snap.Generated) > 5*time.Minute {
		return &apiError{409, "snapshot_expired", "Generate a new report summary before continuing.", nil}
	}
	if snap.Company != a.Company.ID || snap.User != a.User.ID {
		return missing()
	}
	if snap.Filters != filters {
		return invalid("This snapshot belongs to different report filters.")
	}
	if snap.Access != accessBasis(a) {
		return &apiError{409, "access_changed", "Company access changed. Generate a new report.", nil}
	}
	// Frozen values never grant continuing access. Reassignment/deletion and
	// changed visibility of references invalidate the entire read basis.
	ids := map[string]bool{}
	for _, t := range snap.Rows {
		ids[t.ID] = true
		if t.ParentID != "" {
			ids[t.ParentID] = true
		}
		for _, id := range t.Dependencies {
			ids[id] = true
		}
	}
	requested := make([]string, 0, len(ids))
	for id := range ids {
		requested = append(requested, id)
	}
	if len(requested) > 0 {
		var count int64
		if e := taskReadQuery(tx, a).Where("id IN ?", requested).Count(&count).Error; e != nil {
			return e
		}
		if count != int64(len(requested)) {
			return &apiError{409, "access_changed", "Task access changed. Generate a new report.", nil}
		}
	}
	return nil
}

// Reuse the exact cached snapshot and original request session at every output
// boundary. No snapshot renewal, row dropping, or authority lock spans I/O.
func (s *Server) recheckCurrentReportSnapshot(r *http.Request, snap *reportSnapshot) error {
	a := &access{Company: Company{ID: snap.Company}, User: User{ID: snap.User}}
	return s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		return authorizeCurrentReportSnapshot(tx, a, snap, snap.Filters)
	})
}

func (s *Server) reportSummary(w http.ResponseWriter, r *http.Request) error {
	snap, e := s.createReportSnapshot(r)
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"snapshot": snap.Token, "summary": snap.Summary, "period": snap.Period, "metricVersion": snap.MetricVersion, "timezone": snap.Timezone, "generatedAt": snap.Generated.Format(time.RFC3339Nano), "basis": "snapshot_current_state", "expiresAt": snap.Generated.Add(5 * time.Minute).Format(time.RFC3339Nano)})
}
func (s *Server) reportRows(w http.ResponseWriter, r *http.Request) error {
	snap, e := s.readReportSnapshot(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	rows, e := snapshotRowsForTab(snap, r)
	if e != nil {
		return e
	}
	basis := snap.Token + ":" + r.URL.Query().Get("tab")
	offset := 0
	if v := r.URL.Query().Get("cursor"); v != "" {
		c, e := decodeReadCursor(v, basis)
		if e != nil {
			return e
		}
		offset, e = strconv.Atoi(c.ID)
		if e != nil || offset < 0 || offset > len(rows) {
			return invalid("Invalid report cursor.")
		}
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	more := end < len(rows)
	cursor := ""
	if more {
		cursor = encodeReadCursor(readCursor{Basis: basis, ID: strconv.Itoa(end)})
	}
	page := append([]Task{}, rows[offset:end]...)
	for i := range page {
		page[i].Description = ""
	}
	return respond(w, 200, map[string]any{"tasks": page, "cursor": cursor, "hasMore": more, "snapshot": snap.Token, "basis": "snapshot_current_state"})
}
func snapshotRowsForTab(snap *reportSnapshot, r *http.Request) ([]Task, error) {
	tab := r.URL.Query().Get("tab")
	if tab == "" {
		return snap.Rows, nil
	}
	if !in(tab, "commitments", "accepted", "exceptions") {
		return nil, invalid("Choose a valid report tab.")
	}
	q := r.URL.Query()
	from, to := q.Get("from"), q.Get("to")
	loc, _ := time.LoadLocation(snap.Timezone)
	rows := []Task{}
	for _, t := range snap.Rows {
		cohort := t.DueDate != "" && t.DueDate >= from && t.DueDate <= to && t.Status != "cancelled"
		accepted := false
		if at, e := time.Parse(time.RFC3339Nano, t.CompletedAt); e == nil && t.Status == "done" {
			day := at.In(loc).Format("2006-01-02")
			accepted = day >= from && day <= to
		}
		if (tab == "commitments" && cohort) || (tab == "accepted" && accepted) || (tab == "exceptions" && cohort && (taskOverdue(t, snap.Generated, snap.Timezone) || in(t.Status, "blocked", "in_review"))) {
			rows = append(rows, t)
		}
	}
	return rows, nil
}
func safeCSV(v string) string {
	trimmed := strings.TrimLeftFunc(v, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) })
	if trimmed != "" && strings.ContainsRune("=+-@", rune(trimmed[0])) {
		return "'" + v
	}
	return v
}
func (s *Server) reportExport(w http.ResponseWriter, r *http.Request) error {
	snap, e := s.readReportSnapshot(r)
	if e != nil {
		return e
	}
	rows, e := snapshotRowsForTab(snap, r)
	if e != nil {
		return e
	}
	// The snapshot already has a hard 8 MiB encoded-data ceiling. Serialize
	// its frozen values once so even a large row uses bounded output chunks.
	var content bytes.Buffer
	writer := csv.NewWriter(&content)
	if e = writer.Write([]string{"ID", "Title", "Department", "Project", "Owner", "Reviewer", "Status", "Priority", "Original deadline", "Current deadline", "Due date", "Deadline mode", "Due at", "Due timezone", "Original deadline mode", "Original due at", "Original due timezone", "Owner email", "Deadline change reason", "Progress %", "Estimated hours", "Actual hours", "Accepted at", "Description", "Blocker"}); e != nil {
		return e
	}
	for _, t := range rows {
		if e = r.Context().Err(); e != nil {
			return e
		}
		if e = writer.Write(csvTaskRow(t, snap)); e != nil {
			return e
		}
	}
	writer.Flush()
	if e = writer.Error(); e != nil {
		return e
	}
	if e = s.recheckCurrentReportSnapshot(r, snap); e != nil {
		return e
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=task-report.csv")
	w.Header().Set("X-Report-Basis", "snapshot_current_state")
	w.Header().Set("X-Report-Rows", strconv.Itoa(len(rows)))
	w.Header().Set("Content-Length", strconv.Itoa(content.Len()))
	data := content.Bytes()
	for start := 0; start < len(data); start += 64 << 10 {
		if e = r.Context().Err(); e == nil {
			e = s.recheckCurrentReportSnapshot(r, snap)
		}
		if e != nil {
			if start == 0 {
				// No bytes/status have started: preserve the normal JSON denial
				// instead of declaring the frozen CSV's length/attachment.
				for _, name := range []string{"Content-Type", "Content-Length", "Content-Disposition", "X-Report-Basis", "X-Report-Rows"} {
					w.Header().Del(name)
				}
			}
			return e
		}
		end := min(start+(64<<10), len(data))
		if _, e = w.Write(data[start:end]); e != nil {
			return e
		}
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	return nil
}

func csvTaskRow(t Task, snap *reportSnapshot) []string {
	values := []string{t.Code, t.Title, snap.Departments[t.DepartmentID], snap.Projects[t.ProjectID], snap.People[t.OwnerID].Name, snap.People[t.ReviewerID].Name, t.Status, t.Priority, t.OriginalDueDate, t.DueDate, t.DueDate, t.DeadlineMode, string(t.DueAt), t.DueTimezone, t.OriginalDeadlineMode, string(t.OriginalDueAt), t.OriginalDueTimezone, snap.People[t.OwnerID].Email, t.DeadlineChangeReason, strconv.FormatFloat(t.Progress, 'f', -1, 64), strconv.FormatFloat(t.EstimatedHours, 'f', -1, 64), strconv.FormatFloat(t.ActualHours, 'f', -1, 64), t.CompletedAt, t.Description, t.BlockerReason}
	for i, v := range values {
		values[i] = safeCSV(v)
	}
	return values
}
