package platform

import (
	"context"
	"fmt"
	"gorm.io/gorm"
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

func TestAttentionReminderExpiredLeaseRetriesSameIntent(t *testing.T) {
	s, _, cid, uid, _ := attentionFixture(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	lease := now.Add(time.Minute)
	s.db.Where("company_id=? AND id<>?", cid, "attention-test").Delete(&AttentionItem{})
	job := AttentionReminder{ID: "held-attention-job", CompanyID: cid, ItemID: "attention-test", RecipientID: uid, Stage: "initial", WindowKey: "1", AvailableAt: now, LeaseToken: "abandoned", LeaseUntil: &lease, Attempts: 1}
	if e := s.db.Create(&job).Error; e != nil {
		t.Fatal(e)
	}
	n, e := s.RunAttention(context.Background(), now, 100)
	if e != nil || n != 0 {
		t.Fatal(n, e)
	}
	if e := s.db.Callback().Create().Before("gorm:create").Register("attention-test-fail", func(tx *gorm.DB) {
		if tx.Statement.Table == "attention_deliveries" {
			tx.AddError(fmt.Errorf("owned delivery failure"))
		}
	}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.RunAttention(context.Background(), lease.Add(time.Second), 100); e == nil {
		t.Fatal("failure not exercised")
	}
	s.db.Callback().Create().Remove("attention-test-fail")
	n, e = s.RunAttention(context.Background(), lease.Add(2*time.Minute), 100)
	if e != nil || n != 1 {
		t.Fatal(n, e)
	}
	var rows []AttentionReminder
	s.db.Where("item_id=?", "attention-test").Find(&rows)
	if len(rows) != 1 || rows[0].ID != job.ID || rows[0].Attempts != 3 || rows[0].DeliveredAt == nil {
		t.Fatal(rows)
	}
	var count int64
	s.db.Model(&AttentionDelivery{}).Where("item_id=?", "attention-test").Count(&count)
	if count != 1 {
		t.Fatal(count)
	}
}
func TestAttentionReminderEligibleEscalation(t *testing.T) {
	s, c, cid, uid, _ := attentionFixture(t)
	target := addPerson(t, s, c, cid, "attention-escalation-admin@example.com", "admin")
	now := time.Now().UTC().Truncate(time.Microsecond)
	s.db.Model(&AttentionItem{}).Where("id=?", "attention-test").Update("created_at", now.Add(-2*time.Hour))
	if e := s.db.Create(&AttentionPreference{CompanyID: cid, UserID: uid, Version: 1, EscalationEnabled: true, EscalationAfterMinutes: 1, EscalationUserID: target, WorkingDays: []int{}}).Error; e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for n := 0; n < 2; n++ {
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
	var count int64
	s.db.Model(&AttentionItem{}).Where("recipient_id=? AND occurrence_key LIKE ?", target, "escalation:%").Count(&count)
	if count != 1 {
		t.Fatal("escalation duplicate/missing", count)
	}
	s.db.Model(&AttentionDelivery{}).Where("item_id=? AND stage='escalation'", "attention-test").Count(&count)
	if count != 1 {
		t.Fatal("delivery duplicate", count)
	}
}
func TestAttentionReminderRevokedBatchDoesNotStarveCurrentItems(t *testing.T) {
	s, _, cid, uid, _ := attentionFixture(t)
	s.db.Where("company_id=? AND id<>?", cid, "attention-test").Delete(&AttentionItem{})
	now := time.Now().UTC()
	for n := 0; n < 12; n++ {
		item := AttentionItem{ID: fmt.Sprintf("revoked-batch-%02d", n), CompanyID: cid, RecipientID: uid, SourceKind: "task", SourceID: fmt.Sprintf("missing-source-%02d", n), Kind: "update", OccurrenceKey: "test", State: "open", Version: 1, CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour)}
		if e := s.db.Create(&item).Error; e != nil {
			t.Fatal(e)
		}
	}
	for n := 0; n < 4; n++ {
		if _, e := s.RunAttention(context.Background(), time.Now().UTC(), 5); e != nil {
			t.Fatal(e)
		}
	}
	var count int64
	s.db.Model(&AttentionDelivery{}).Where("item_id=?", "attention-test").Count(&count)
	if count != 1 {
		t.Fatal("revoked prefix starved current item", count)
	}
}

func TestAttentionReminderReusesOpenTargetObligation(t *testing.T) {
	s, c, cid, uid, _ := attentionFixture(t)
	target := addPerson(t, s, c, cid, "attention-existing-target@example.com", "admin")
	now := time.Now().UTC().Truncate(time.Microsecond)
	var item AttentionItem
	s.db.First(&item, "id=?", "attention-test")
	existing := item
	existing.ID = "existing-target"
	existing.RecipientID = target
	if e := ensureAttentionItem(s.db, existing); e != nil {
		t.Fatal(e)
	}
	s.db.Model(&AttentionItem{}).Where("id=?", item.ID).Update("created_at", now.Add(-time.Hour))
	if e := s.db.Create(&AttentionPreference{CompanyID: cid, UserID: uid, Version: 1, EscalationEnabled: true, EscalationAfterMinutes: 1, EscalationUserID: target, WorkingDays: []int{}}).Error; e != nil {
		t.Fatal(e)
	}
	if _, e := s.RunAttention(t.Context(), now, 100); e != nil {
		t.Fatal(e)
	}
	var count int64
	s.db.Model(&AttentionItem{}).Where("company_id=? AND recipient_id=? AND source_id=? AND kind=? AND state=?", cid, target, item.SourceID, item.Kind, "open").Count(&count)
	if count != 1 {
		t.Fatalf("duplicate target obligation %d", count)
	}
}
