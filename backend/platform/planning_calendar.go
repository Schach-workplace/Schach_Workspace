package platform

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
)

// CalendarTask is a current lean Task projection, not a separate calendar engine.
// DueDate is the current commitment's date in the company's timezone.
type CalendarTask struct {
	ID           string          `json:"id"`
	Code         string          `json:"code"`
	Title        string          `json:"title"`
	Version      int64           `json:"version"`
	OwnerID      string          `json:"ownerId"`
	DepartmentID string          `json:"departmentId"`
	ProjectID    string          `json:"projectId"`
	ParentID     string          `json:"parentId"`
	Dependencies []string        `json:"dependencies"`
	Status       string          `json:"status"`
	Priority     string          `json:"priority"`
	Progress     float64         `json:"progress"`
	DueDate      string          `json:"dueDate"`
	DeadlineMode string          `json:"deadlineMode"`
	DueAt        DeadlineInstant `json:"dueAt"`
	DueTimezone  string          `json:"dueTimezone"`
}
type CalendarView struct {
	Tasks     []CalendarTask `json:"tasks"`
	Complete  bool           `json:"complete"`
	Timezone  string         `json:"timezone"`
	ReadBasis string         `json:"readBasis"`
}

func (s *Server) planningCalendar(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f := planningFilters(r)
	rawOpen := r.URL.Query().Get("openOnly")
	if !planningDate(f.From) || !planningDate(f.To) || f.From > f.To {
		return invalid("Choose valid company dates from 1900–2200.")
	}
	from, _ := time.Parse("2006-01-02", f.From)
	to, _ := time.Parse("2006-01-02", f.To)
	if to.Sub(from) > 83*24*time.Hour {
		return invalid("Choose at most 84 calendar days.")
	}
	if len(f.OwnerID) > 80 || len(f.DepartmentID) > 80 || len(f.ProjectID) > 80 {
		return invalid("Calendar filter is too long.")
	}
	if !in(rawOpen, "", "true", "false") {
		return invalid("Choose openOnly true or false.")
	}
	v := CalendarView{Tasks: []CalendarTask{}}
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		location, e := time.LoadLocation(a.Company.Timezone)
		if e != nil {
			return invalid("Company timezone is unavailable.")
		}
		intervals, e := calendarCivilIntervals(from, to.AddDate(0, 0, 1), location)
		if e != nil {
			return e
		}
		query := taskReadQuery(tx, a)
		for _, filter := range []struct{ value, col string }{{f.OwnerID, "owner_id"}, {f.DepartmentID, "department_id"}, {f.ProjectID, "project_id"}} {
			if filter.value != "" {
				query = query.Where(filter.col+"=?", filter.value)
			}
		}
		if rawOpen != "false" {
			query = query.Where("status NOT IN ?", []string{"done", "cancelled"})
		}
		timed := "due_at >= ? AND due_at < ?"
		if tx.Dialector.Name() != "postgres" {
			// Task writes canonicalize UTC. Strip fractions before converting legacy
			// offsets so SQLite cannot round the final microsecond into the next day.
			seconds := "(CASE WHEN substr(due_at,-1)='Z' THEN substr(due_at,1,19) ELSE strftime('%Y-%m-%dT%H:%M:%S',substr(due_at,1,19)||substr(due_at,-6)) END)"
			timed = seconds + " >= substr(?,1,19) AND " + seconds + " < substr(?,1,19)"
		}
		// Exact inverse of instant.In(companyZone)'s selected civil dates, including
		// midnight gaps/overlaps/skipped days. Apply before all selected row/byte caps.
		predicates := []string{}
		args := []any{f.From, f.To}
		for _, interval := range intervals {
			predicates = append(predicates, "("+timed+")")
			args = append(args, interval.from.Format(time.RFC3339Nano), interval.to.Format(time.RFC3339Nano))
		}
		timedDates := "FALSE" // A skipped civil date has no timed instants.
		if len(predicates) > 0 {
			timedDates = strings.Join(predicates, " OR ")
		}
		query = query.Where("((deadline_mode='all_day' AND due_date >= ? AND due_date <= ?) OR (deadline_mode='timed' AND ("+timedDates+")))", args...)
		// Check selected row/byte bounds in SQL before transferring any large
		// legacy Task field. This is the same current Task source and fence.
		length := "length(CAST(%s AS BLOB))"
		if tx.Dialector.Name() == "postgres" {
			length = "octet_length(CAST(%s AS text))"
		}
		parts := []string{}
		for _, column := range []string{"id", "code", "title", "owner_id", "department_id", "project_id", "parent_id", "dependencies", "status", "priority", "due_date", "deadline_mode", "due_at", "due_timezone"} {
			parts = append(parts, "COALESCE("+fmt.Sprintf(length, column)+",0)")
		}
		var budget []struct {
			ID    string
			Bytes int64
		}
		if e = query.Select("id, (" + strings.Join(parts, "+") + ") AS bytes").Order("id").Limit(10001).Find(&budget).Error; e != nil {
			return e
		}
		if len(budget) > 10000 {
			return calendarRangeTooLarge()
		}
		var sourceBytes int64
		for _, row := range budget {
			sourceBytes += row.Bytes
			if sourceBytes > 8<<20 {
				return calendarRangeTooLarge()
			}
		}
		rows := []Task{}
		if e = query.Select("id", "code", "title", "version", "owner_id", "department_id", "project_id", "parent_id", "dependencies", "status", "priority", "progress", "due_date", "deadline_mode", "due_at", "due_timezone").Order("id").Limit(10001).Find(&rows).Error; e != nil {
			return e
		}
		if len(rows) > 10000 {
			return calendarRangeTooLarge()
		}
		for i := 0; i < len(rows); i += 100 {
			end := i + 100
			if end > len(rows) {
				end = len(rows)
			}
			for _, task := range rows[i:end] {
				if len(task.Dependencies) > 100 {
					return invalid("Calendar contains invalid recorded task references.")
				}
			}
			if e = pruneTaskLinks(tx, a, rows[i:end]); e != nil {
				return e
			}
		}
		v.Timezone = a.Company.Timezone
		v.ReadBasis = accessBasis(a)
		for _, t := range rows {
			date := t.DueDate
			if t.DeadlineMode == "timed" {
				instant, e := time.Parse(time.RFC3339Nano, string(t.DueAt))
				if e != nil {
					return invalid("Calendar contains an invalid timed commitment.")
				}
				date = instant.In(location).Format("2006-01-02")
			}
			if !finite(t.Progress) {
				return invalid("Calendar contains invalid recorded task progress.")
			}
			v.Tasks = append(v.Tasks, CalendarTask{ID: t.ID, Code: t.Code, Title: t.Title, Version: t.Version, OwnerID: t.OwnerID, DepartmentID: t.DepartmentID, ProjectID: t.ProjectID, ParentID: t.ParentID, Dependencies: t.Dependencies, Status: t.Status, Priority: t.Priority, Progress: t.Progress, DueDate: date, DeadlineMode: t.DeadlineMode, DueAt: t.DueAt, DueTimezone: t.DueTimezone})
		}
		v.Complete = true
		bytes, e := json.Marshal(v)
		if e != nil {
			return e
		}
		if len(bytes) > 8<<20 {
			return calendarRangeTooLarge()
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, v)
}
func calendarRangeTooLarge() error {
	return &apiError{Status: 422, Code: "range_too_large", Message: "Calendar exceeds 10000 tasks or 8 MiB. Narrow its dates or filters."}
}

// calendarCivilIntervals maps a half-open civil date range (represented in UTC
// solely as Gregorian fields) into its exact UTC intervals. Within each constant
// offset zone, local = UTC + offset, so intersect the shifted civil range with
// that zone's UTC bounds. No local midnight is constructed or normalized.
type calendarInstantInterval struct{ from, to time.Time }

func calendarCivilIntervals(from, to time.Time, location *time.Location) ([]calendarInstantInterval, error) {
	// LoadLocation's TZif offsets are signed32-bit seconds; its POSIX tail offsets
	// are smaller. This conservative envelope covers every possible offset without
	// assuming a24h bound or scanning minute-by-minute. Only zone transitions are
	// visited; unrelated Task rows are never fetched. Adjacent results are merged.
	const maxOffset = time.Duration(1<<31) * time.Second
	cursor, limit := from.Add(-maxOffset), to.Add(maxOffset)
	intervals := []calendarInstantInterval{}
	for cursor.Before(limit) {
		local := cursor.In(location)
		_, offset := local.Zone()
		_, zoneEnd := local.ZoneBounds()
		if zoneEnd.IsZero() || zoneEnd.After(limit) {
			zoneEnd = limit
		}
		if !zoneEnd.After(cursor) {
			// Go's POSIX-tail lookup uses yearStart+365days as its final
			// bound, even in leap years. Once all this year's transitions
			// have passed, that synthetic bound can be behind Dec31.
			// Continue the final zone only to the actual next UTC year.
			year := cursor.UTC().Year()
			yearStart := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
			nextYear := yearStart.AddDate(1, 0, 0)
			if cursor.Before(yearStart.Add(365*24*time.Hour)) || !cursor.Before(nextYear) {
				return nil, invalid("Calendar timezone transitions are unavailable.")
			}
			zoneEnd = nextYear
			if zoneEnd.After(limit) {
				zoneEnd = limit
			}
		}
		first, end := from.Add(-time.Duration(offset)*time.Second), to.Add(-time.Duration(offset)*time.Second)
		if first.Before(cursor) {
			first = cursor
		}
		if end.After(zoneEnd) {
			end = zoneEnd
		}
		if first.Before(end) {
			if len(intervals) > 0 && intervals[len(intervals)-1].to.Equal(first) {
				intervals[len(intervals)-1].to = end
			} else {
				intervals = append(intervals, calendarInstantInterval{first.UTC(), end.UTC()})
			}
		}
		cursor = zoneEnd.UTC()
	}
	return intervals, nil
}
