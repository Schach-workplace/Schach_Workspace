package platform

import (
	"database/sql/driver"
	"fmt"
	"gorm.io/gorm"
	"time"
)

// DeadlineInstant serializes absent instants as the API's empty string and stores
// absent native PostgreSQL instants as NULL, never an invented midnight.
type DeadlineInstant string

func (v DeadlineInstant) Value() (driver.Value, error) {
	if v == "" {
		return nil, nil
	}
	if _, e := time.Parse(time.RFC3339Nano, string(v)); e != nil {
		return nil, e
	}
	return string(v), nil
}
func (v *DeadlineInstant) Scan(value any) error {
	if value == nil {
		*v = ""
		return nil
	}
	switch x := value.(type) {
	case time.Time:
		*v = DeadlineInstant(x.UTC().Format(time.RFC3339Nano))
	case string:
		t, e := time.Parse(time.RFC3339Nano, x)
		if e != nil {
			return e
		}
		*v = DeadlineInstant(t.UTC().Format(time.RFC3339Nano))
	case []byte:
		return v.Scan(string(x))
	default:
		return fmt.Errorf("unsupported deadline instant %T", value)
	}
	return nil
}
func validateDeadline(t *Task) error {
	if t.DeadlineMode == "" {
		t.DeadlineMode = "all_day"
	}
	if t.DeadlineMode == "all_day" {
		if t.DueAt != "" || t.DueTimezone != "" {
			return invalid("All-day commitments cannot include a time or timezone.")
		}
		return nil
	}
	if t.DeadlineMode != "timed" {
		return invalid("Choose all_day or timed deadline mode.")
	}
	if t.Recurrence != "" && t.Recurrence != "none" {
		return invalid("Timed recurrence requires a separate wall-clock recurrence policy; use an all-day recurring commitment.")
	}
	location, e := time.LoadLocation(t.DueTimezone)
	if e != nil || t.DueTimezone == "" {
		return invalid("Choose an IANA commitment timezone.")
	}
	instant, e := time.Parse(time.RFC3339Nano, string(t.DueAt))
	if e != nil {
		return invalid("Timed commitments require RFC3339 with an explicit offset; select the offset for ambiguous local times.")
	}
	local := instant.In(location)
	// Canonical Z is an absolute instant. Other offsets describe local wall time,
	// so gaps and offsets inconsistent with the selected IANA zone are rejected.
	if len(t.DueAt) > 0 && t.DueAt[len(t.DueAt)-1] != 'Z' {
		_, provided := instant.Zone()
		_, actual := local.Zone()
		if provided != actual || instant.Format("2006-01-02T15:04:05") != local.Format("2006-01-02T15:04:05") {
			return invalid("Local time/offset does not exist in the selected timezone. Choose a valid offset.")
		}
	}
	if !validDate(t.DueDate) || t.DueDate == "" || local.Format("2006-01-02") != t.DueDate {
		return invalid("Due date must match the instant in its commitment timezone.")
	}
	t.DueAt = DeadlineInstant(instant.UTC().Format(time.RFC3339Nano))
	return nil
}
func deadlineChanged(a, b Task) bool {
	return a.DueDate != b.DueDate || a.DeadlineMode != b.DeadlineMode || a.DueAt != b.DueAt || a.DueTimezone != b.DueTimezone
}
func taskOverdue(t Task, now time.Time, companyZone string) bool {
	if in(t.Status, "done", "cancelled") {
		return false
	}
	if t.DeadlineMode == "timed" {
		due, e := time.Parse(time.RFC3339Nano, string(t.DueAt))
		return e == nil && now.After(due)
	}
	location, e := time.LoadLocation(companyZone)
	if e != nil {
		location = time.UTC
	}
	return t.DueDate != "" && t.DueDate < now.In(location).Format("2006-01-02")
}

func timedDeadlineReminder(tx *gorm.DB, t Task, now time.Time, loc *time.Location) (int, error) {
	due, e := time.Parse(time.RFC3339Nano, string(t.DueAt))
	if e != nil {
		return 0, e
	}
	revision := payloadHash([]string{t.DeadlineMode, string(t.DueAt), t.DueTimezone})
	base := "timed:" + t.ID + ":" + revision + ":"
	today := now.In(loc).Format("2006-01-02")
	kind, title, key := "approaching", "Deadline approaching", base+"approaching"
	if now.After(due) {
		kind, title, key = "overdue", "Task overdue", base+"overdue"
	} else if due.Sub(now) > 24*time.Hour {
		return 0, nil
	}
	if e := ensureDeadlineAttention(tx, t, kind+":"+today, now); e != nil {
		return 0, e
	}
	claimed, e := claimAutomation(tx, t.CompanyID, key)
	if e != nil {
		return 0, e
	}
	if kind == "overdue" {
		daily, e := claimAutomation(tx, t.CompanyID, base+"late:"+today)
		if e != nil {
			return 0, e
		}
		if !claimed && !daily {
			return 0, nil
		}
		claimed = true
	}
	if !claimed {
		return 0, nil
	}
	if e := notification(tx, t.CompanyID, t.ID, t.OwnerID, title, t.Code+" · "+t.Title+" · due "+string(t.DueAt)+" ("+t.DueTimezone+")", "deadline"); e != nil {
		return 0, e
	}
	return 1, nil
}
