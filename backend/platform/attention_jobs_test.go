package platform

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestAttentionWindows(t *testing.T) {
	monday := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		name      string
		pref      AttentionPreference
		zone      string
		now, want time.Time
		fail      bool
	}{
		{name: "disabled", zone: "UTC", now: monday, want: monday},
		{name: "start", zone: "UTC", pref: AttentionPreference{WorkingHoursEnabled: true, WorkingDays: []int{1}, WorkingStart: "09:00", WorkingEnd: "18:00"}, now: monday, want: monday},
		{name: "end", zone: "UTC", pref: AttentionPreference{WorkingHoursEnabled: true, WorkingDays: []int{1}, WorkingStart: "09:00", WorkingEnd: "18:00"}, now: monday.Add(9 * time.Hour), want: monday.AddDate(0, 0, 7)},
		{name: "overnight", zone: "UTC", pref: AttentionPreference{WorkingHoursEnabled: true, WorkingDays: []int{1}, WorkingStart: "22:00", WorkingEnd: "06:00"}, now: monday.Add(16 * time.Hour), want: monday.Add(16 * time.Hour)},
		{name: "quiet", zone: "UTC", pref: AttentionPreference{QuietStart: "22:00", QuietEnd: "07:00"}, now: monday.Add(14 * time.Hour), want: monday.Add(22 * time.Hour)},
		{name: "allquiet", zone: "UTC", pref: AttentionPreference{QuietStart: "09:00", QuietEnd: "09:00"}, now: monday, fail: true},
		{name: "nooverlap", zone: "UTC", pref: AttentionPreference{WorkingHoursEnabled: true, WorkingDays: []int{1}, WorkingStart: "09:00", WorkingEnd: "10:00", QuietStart: "08:00", QuietEnd: "11:00"}, now: monday, fail: true},
		{name: "badzone", zone: "Imaginary/Zone", now: monday, fail: true},
		{name: "springgap", zone: "America/New_York", pref: AttentionPreference{WorkingHoursEnabled: true, WorkingDays: []int{7}, WorkingStart: "02:30", WorkingEnd: "04:00"}, now: time.Date(2026, 3, 8, 6, 55, 0, 0, time.UTC), want: time.Date(2026, 3, 8, 7, 0, 0, 0, time.UTC)},
		{name: "repeated", zone: "America/New_York", pref: AttentionPreference{WorkingHoursEnabled: true, WorkingDays: []int{7}, WorkingStart: "01:30", WorkingEnd: "02:00"}, now: time.Date(2026, 11, 1, 6, 10, 0, 0, time.UTC), want: time.Date(2026, 11, 1, 6, 30, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, e := nextAttentionWindow(c.pref, c.zone, c.now)
			if c.fail {
				if e == nil {
					t.Fatal("accepted invalid policy")
				}
				return
			}
			if e != nil || !got.Equal(c.want) {
				t.Fatalf("got %v %v want %v", got, e, c.want)
			}
		})
	}
}
func TestAttentionReminderLeaseAndEscalation(t *testing.T) {
	s, c, cid, uid, _ := attentionFixture(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	if _, e := s.RunAttention(context.Background(), now, 100); e != nil {
		t.Fatal(e)
	}
	var count int64
	s.db.Model(&AttentionReminder{}).Where("item_id=? AND delivered_at IS NOT NULL", "attention-test").Count(&count)
	if count != 1 {
		t.Fatalf("delivery %d", count)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.RunAttention(context.Background(), now, 100); errs <- e }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	s.db.Model(&AttentionReminder{}).Where("item_id=?", "attention-test").Count(&count)
	if count != 1 {
		t.Fatalf("duplicate %d", count)
	}
	st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/attention/preferences", map[string]any{"version": 1, "workingHoursEnabled": false, "workingDays": []int{}, "workingStart": "", "workingEnd": "", "quietStart": "", "quietEnd": "", "escalationEnabled": false, "escalationAfterMinutes": 0, "escalationUserId": ""}, c)
	if st != 200 {
		t.Fatalf("preference %d %s", st, w.Body.String())
	}
	var p AttentionPreference
	s.db.First(&p, "company_id=? AND user_id=?", cid, uid)
	if p.Version != 2 {
		t.Fatal(p)
	}
}
func TestAttentionReminderDeferralCancellationAndEligibility(t *testing.T) {
	s, c, cid, uid, id := attentionFixture(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	future := now.Add(time.Hour)
	s.db.Model(&AttentionItem{}).Where("id=?", "attention-test").Update("snoozed_until", future)
	if _, e := s.RunAttention(context.Background(), now, 100); e != nil {
		t.Fatal(e)
	}
	var job AttentionReminder
	if e := s.db.First(&job, "item_id=?", "attention-test").Error; e != nil {
		t.Fatal(e)
	}
	if !job.AvailableAt.Equal(future) || job.DeliveredAt != nil {
		t.Fatal("snooze ignored", job)
	}
	body := map[string]any{"expectedVersion": 1, "retryKey": "cancel-reminder", "action": "resolve", "reason": "Followed up"}
	st, _, w := req(t, s, "POST", "/api/companies/"+cid+"/attention/attention-test/transition", body, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	if _, e := s.RunAttention(context.Background(), future, 100); e != nil {
		t.Fatal(e)
	}
	s.db.First(&job, "id=?", job.ID)
	if job.CancelledAt == nil || job.DeliveredAt != nil {
		t.Fatal("resolved reminder delivered")
	}
	target := addPerson(t, s, c, cid, "attention-no-access@example.com", "member")
	s.db.Create(&AttentionPreference{CompanyID: cid, UserID: uid, Version: 1, WorkingDays: []int{}, EscalationEnabled: true, EscalationAfterMinutes: 1, EscalationUserID: target})
	s.db.Create(&AttentionItem{ID: "escalation-test", CompanyID: cid, RecipientID: uid, SourceKind: "task", SourceID: id, OccurrenceKey: "escalation", Kind: "update", State: "open", Version: 1, CreatedAt: now.Add(-2 * time.Hour)})
	if _, e := s.RunAttention(context.Background(), future, 100); e != nil {
		t.Fatal(e)
	}
	var count int64
	s.db.Model(&AttentionItem{}).Where("recipient_id=? AND source_id=?", target, id).Count(&count)
	if count != 0 {
		t.Fatal("unauthorized escalation")
	}
	s.db.Create(&AttentionItem{ID: "revoked-reminder", CompanyID: cid, RecipientID: uid, SourceKind: "task", SourceID: id, OccurrenceKey: "revoked", Kind: "update", State: "open", Version: 1, SnoozedUntil: &future})
	if _, e := s.RunAttention(context.Background(), now, 100); e != nil {
		t.Fatal(e)
	}
	s.db.Delete(&Task{}, "id=?", id)
	if _, e := s.RunAttention(context.Background(), future, 100); e != nil {
		t.Fatal(e)
	}
	var revoked AttentionReminder
	s.db.First(&revoked, "item_id=?", "revoked-reminder")
	if revoked.CancelledAt == nil || revoked.DeliveredAt != nil {
		t.Fatal("revoked source delivered")
	}
}
