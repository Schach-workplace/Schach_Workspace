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
		first, e := time.ParseInLocation("2006-01-02", f.From, location)
		if e != nil {
			return e
		}
		last, e := time.ParseInLocation("2006-01-02", f.To, location)
		if e != nil {
			return e
		}
		end := last.AddDate(0, 0, 1)
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
		// Filter actual instants by company-local day boundaries before row cap. UTC
		// boundaries also handle DST; stale denormalized timed due_date is never used.
		query = query.Where("((deadline_mode='all_day' AND due_date >= ? AND due_date <= ?) OR (deadline_mode='timed' AND ("+timed+")))", f.From, f.To, first.UTC().Format(time.RFC3339Nano), end.UTC().Format(time.RFC3339Nano))
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
