package platform

import (
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestDeadlineTimedInstantAndOriginalCommitment(t *testing.T) {
	s, c, cid, _, uid, _ := conversationFixture(t)
	body := taskBody(uid)
	body["deadlineMode"] = "timed"
	body["dueDate"] = "2026-10-14"
	body["dueAt"] = "2026-10-14T16:00:00+05:30"
	body["dueTimezone"] = "Asia/Kolkata"
	id := createTask(t, s, c, cid, body)
	state := taskState(t, s, c, cid, id)
	if state["dueAt"] != "2026-10-14T10:30:00Z" || state["originalDueAt"] != state["dueAt"] {
		t.Fatal(state)
	}
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "dueAt": "2026-10-14T17:00:00+05:30"}, c)
	if st != 422 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "dueAt": "2026-10-14T17:00:00+05:30", "deadlineChangeReason": "Agreed new time"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	state = taskState(t, s, c, cid, id)
	if state["originalDueAt"] != "2026-10-14T10:30:00Z" {
		t.Fatal("original changed")
	}
}
func TestDeadlineDSTAndLegacySemantics(t *testing.T) {
	for _, value := range []string{"2026-03-08T02:30:00-05:00", "2026-11-01T01:30:00", "2026-11-01T01:30:00-06:00"} {
		task := Task{DeadlineMode: "timed", DueTimezone: "America/New_York", DueDate: value[:10], DueAt: DeadlineInstant(value), Recurrence: "none"}
		if validateDeadline(&task) == nil {
			t.Fatalf("invalid offset/gap accepted %s", value)
		}
	}
	for _, offset := range []string{"-04:00", "-05:00"} {
		task := Task{DeadlineMode: "timed", DueTimezone: "America/New_York", DueDate: "2026-11-01", DueAt: DeadlineInstant("2026-11-01T01:30:00" + offset), Recurrence: "none"}
		if e := validateDeadline(&task); e != nil {
			t.Fatal(e)
		}
	}
	task := Task{DueDate: "2026-10-14", Status: "todo"}
	if e := validateDeadline(&task); e != nil || task.DeadlineMode != "all_day" || task.OriginalDueAt != "" {
		t.Fatal(task, e)
	}
	now, _ := time.Parse(time.RFC3339, "2026-10-14T10:30:00Z")
	task = Task{DeadlineMode: "timed", DueAt: DeadlineInstant(now.Format(time.RFC3339)), Status: "todo"}
	if taskOverdue(task, now, "UTC") || !taskOverdue(task, now.Add(time.Second), "UTC") {
		t.Fatal("deadline equality")
	}
}

func TestTimedReminderClaimsRescheduleAndCompanyDays(t *testing.T) {
	s, c, cid, _, uid, _ := conversationFixture(t)
	body := taskBody(uid)
	body["deadlineMode"] = "timed"
	body["dueDate"] = "2026-10-14"
	body["dueAt"] = "2026-10-14T16:00:00+05:30"
	body["dueTimezone"] = "Asia/Kolkata"
	id := createTask(t, s, c, cid, body)
	var task Task
	s.db.First(&task, "id=?", id)
	due, _ := time.Parse(time.RFC3339, string(task.DueAt))
	loc, _ := time.LoadLocation("Asia/Kolkata")
	check := func(at time.Time, want int) {
		t.Helper()
		n := 0
		e := s.db.Transaction(func(tx *gorm.DB) error { var e error; n, e = timedDeadlineReminder(tx, task, at, loc); return e })
		if e != nil || n != want {
			t.Fatal(at, n, want, e)
		}
	}
	check(due.Add(-25*time.Hour), 0)
	check(due.Add(-24*time.Hour), 1)
	check(due.Add(-time.Hour), 0)
	check(due, 0)
	check(due.Add(time.Second), 1)
	check(due.Add(time.Hour), 0)
	check(due.Add(24*time.Hour), 1)
	check(due.Add(25*time.Hour), 0)
	task.DueAt = DeadlineInstant(due.Add(48 * time.Hour).Format(time.RFC3339))
	check(due.Add(25*time.Hour), 1)
	check(due.Add(26*time.Hour), 0)
}
