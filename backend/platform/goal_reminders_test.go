package platform

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestGoalReminderScopes(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := addPerson(t, s, c, cid, "reminderowner@example.com", "member")
	mc := login(t, s, "reminderowner@example.com")
	id := createMeasuredGoal(t, s, c, cid, uid)
	p := "/api/companies/" + cid + "/goals/" + id + "/reminder-preference"
	status, b, _ := req(t, s, "GET", p, nil, mc)
	if status != 200 || b["preference"].(map[string]any)["enabled"] != false {
		t.Fatal(status, b)
	}
	input := map[string]any{"retryKey": "enable-reminder", "expectedVersion": 0, "reason": "Weekly update reminder", "enabled": true, "cadence": "weekly", "weekday": 1, "monthDay": 1, "localTime": "09:00"}
	status, b, _ = req(t, s, "PATCH", p, input, c)
	if status != 403 {
		t.Fatal(status, b)
	}
	status, b, _ = req(t, s, "PATCH", p, input, mc)
	if status != 200 {
		t.Fatal(status, b)
	}
	var g Goal
	db.First(&g, "id=?", id)
	if g.Version != 1 || g.Current != 4.8 {
		t.Fatal(g)
	}
	status, b, _ = req(t, s, "PATCH", p, input, mc)
	if status != 200 {
		t.Fatal(status, b)
	}
}
func TestGoalReminderPeriods(t *testing.T) {
	p := GoalReminderPreference{CompanyID: "company-a", GoalID: "goal", UserID: "owner", Enabled: true, Version: 1, Cadence: "weekly", Weekday: 7, MonthDay: 1, LocalTime: "02:30", UpdatedAt: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)}
	o, e := latestGoalOccurrence(p, "America/New_York", time.Date(2026, 3, 8, 8, 0, 0, 0, time.UTC))
	if e != nil || o.DueAt.Format(time.RFC3339) != "2026-03-08T07:00:00Z" {
		t.Fatal(o, e)
	}
	p.LocalTime = "01:30"
	o, e = latestGoalOccurrence(p, "America/New_York", time.Date(2026, 11, 1, 8, 0, 0, 0, time.UTC))
	if e != nil || o.DueAt.Format(time.RFC3339) != "2026-11-01T05:30:00Z" {
		t.Fatal(o, e)
	}
	p.CompanyID = "company-b"
	other, _ := latestGoalOccurrence(p, "America/New_York", time.Date(2026, 11, 1, 8, 0, 0, 0, time.UTC))
	if other.Key == o.Key || !strings.Contains(other.Key, "company-b") {
		t.Fatal(other)
	}
	p.Cadence = "monthly"
	p.MonthDay = 28
	o, e = latestGoalOccurrence(p, "Asia/Kolkata", time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC))
	if e != nil || o.Period != "2026-09" {
		t.Fatal(o, e)
	}
}
func TestGoalReminderQuietAndLease(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, uid)
	now := time.Now().UTC().Truncate(time.Microsecond)
	p := GoalReminderPreference{CompanyID: cid, GoalID: id, UserID: uid, Version: 1, Enabled: true, Cadence: "weekly", Weekday: 1, MonthDay: 1, LocalTime: "00:00", CreatedAt: now.AddDate(0, 0, -14), UpdatedAt: now.AddDate(0, 0, -14)}
	if e := db.Create(&p).Error; e != nil {
		t.Fatal(e)
	}
	for n := 0; n < 2; n++ {
		if _, e := s.RunAttention(context.Background(), now, 100); e != nil {
			t.Fatal(e)
		}
	}
	var items []AttentionItem
	db.Where("source_kind='goal' AND source_id=?", id).Find(&items)
	if len(items) != 1 {
		t.Fatal(items)
	}
	var deliveries int64
	db.Model(&AttentionDelivery{}).Where("item_id=?", items[0].ID).Count(&deliveries)
	if deliveries != 1 {
		t.Fatal(deliveries)
	}
	status, b, w := req(t, s, "GET", "/api/companies/"+cid+"/attention?sourceKind=goal&kind=update&sourceId="+id, nil, c)
	if status != 200 || strings.Contains(w.Body.String(), "Independent observed result") || strings.Contains(w.Body.String(), "4.8") {
		t.Fatal(status, b)
	}
	db.Model(&GoalReminderPreference{}).Where("goal_id=?", id).Update("enabled", false)
	if _, e := s.RunAttention(context.Background(), now, 100); e != nil {
		t.Fatal(e)
	}
	status, b, _ = req(t, s, "GET", "/api/companies/"+cid+"/attention/"+items[0].ID, nil, c)
	if status != 404 {
		t.Fatal(status, b)
	}
}
func TestGoalAttentionSource(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	id := createMeasuredGoal(t, s, c, cid, uid)
	now := time.Now().UTC().Truncate(time.Microsecond)
	p := GoalReminderPreference{CompanyID: cid, GoalID: id, UserID: uid, Version: 1, Enabled: true, Cadence: "weekly", Weekday: 1, MonthDay: 1, LocalTime: "00:00", CreatedAt: now.AddDate(0, 0, -14), UpdatedAt: now.AddDate(0, 0, -14)}
	if e := db.Create(&p).Error; e != nil {
		t.Fatal(e)
	}
	if _, e := s.RunAttention(context.Background(), now, 100); e != nil {
		t.Fatal(e)
	}
	var item AttentionItem
	if e := db.First(&item, "source_kind='goal' AND source_id=?", id).Error; e != nil {
		t.Fatal(e)
	}
	path := "/api/companies/" + cid
	status, b, _ := req(t, s, "POST", path+"/attention/"+item.ID+"/transition", map[string]any{"retryKey": "resolved", "expectedVersion": 1, "action": "resolve", "reason": "Reminder handled separately"}, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	var g Goal
	db.First(&g, "id=?", id)
	if g.Current != 4.8 || g.Version != 1 {
		t.Fatal(g)
	}
	status, b, _ = req(t, s, "POST", path+"/goals/"+id+"/measurements", map[string]any{"retryKey": "period-observation", "expectedVersion": 1, "value": 4, "effectiveAt": now.Add(-time.Minute).Format(time.RFC3339Nano), "reason": "Real observed update"}, c)
	if status != 200 {
		t.Fatal(status, b)
	}
	if _, e := s.RunAttention(context.Background(), time.Now().UTC(), 100); e != nil {
		t.Fatal(e)
	}
	var count int64
	db.Model(&AttentionItem{}).Where("source_kind='goal' AND source_id=? AND state='open'", id).Count(&count)
	if count != 0 {
		t.Fatal("measurement did not suppress", count)
	}
}
