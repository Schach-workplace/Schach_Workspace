package platform

import (
	"context"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"testing"
	"time"
)

// attentionPushFixture binds an open task item to a non-leadership member with a
// registered native push device. The item is not yet locally delivered.
func attentionPushFixture(t *testing.T) (s *Server, founder *http.Cookie, cid, uid, task, device string, member *http.Cookie, sender *testPushSender) {
	t.Helper()
	s, founder, cid, _, uid, member = conversationFixture(t)
	task = createTask(t, s, founder, cid, taskBody(uid))
	// Assignment produces the real task "update" Inbox item; give it a stable id.
	if r := s.db.Model(&AttentionItem{}).Where("company_id=? AND recipient_id=? AND source_kind=? AND source_id=?", cid, uid, "task", task).Update("id", "attention-push"); r.Error != nil || r.RowsAffected != 1 {
		t.Fatal("assignment attention item", r.Error, r.RowsAffected)
	}
	sender = &testPushSender{}
	s.opts.PushSender = sender
	device = financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "android", "name": "Native", "pushProvider": "fcm", "pushToken": "opaque-device-token"}, member)["id"].(string)
	return
}
func runAttentionPush(t *testing.T, s *Server, now time.Time) int {
	t.Helper()
	n, e := s.RunAttentionPush(t.Context(), now)
	if e != nil {
		t.Fatal(e)
	}
	return n
}
func deliverAttention(t *testing.T, s *Server, now time.Time) {
	t.Helper()
	if _, e := s.RunAttention(t.Context(), now, 100); e != nil {
		t.Fatal(e)
	}
}

func TestAttentionPushSendsOpaqueHintOnceAfterLocalDelivery(t *testing.T) {
	s, _, cid, uid, _, _, _, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	if n := runAttentionPush(t, s, now); n != 0 {
		t.Fatal("pushed before attention preferences allowed local delivery", n)
	}
	deliverAttention(t, s, now)
	if n := runAttentionPush(t, s, now); n != 1 {
		t.Fatal("eligible push", n)
	}
	hint := sender.Hints[0]
	if hint.AttentionID != "attention-push" || hint.CompanyID != cid || hint.EventID == "" || hint.ConversationID != "" {
		t.Fatalf("hint scope %+v", hint)
	}
	raw, _ := json.Marshal(hint)
	var fields map[string]any
	json.Unmarshal(raw, &fields)
	keys := []string{}
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) != 3 || keys[0] != "attentionId" || keys[1] != "companyId" || keys[2] != "eventId" {
		t.Fatal("hint carries more than opaque ids", string(raw))
	}
	data, collapse := nativePushData(hint)
	if len(data) != 3 || data["attentionId"] != "attention-push" || data["companyId"] != cid || data["eventId"] != hint.EventID || collapse != "attention-push" {
		t.Fatal("provider data", data, collapse)
	}
	if n := runAttentionPush(t, s, now.Add(time.Minute)); n != 0 {
		t.Fatal("duplicate push", n)
	}
	// A later delivery (another reminder window) of the same item stays deduplicated per device.
	s.db.Create(&AttentionDelivery{ID: "second-window", CompanyID: cid, ItemID: "attention-push", RecipientID: uid, Stage: "initial", CreatedAt: now})
	if n := runAttentionPush(t, s, now.Add(2*time.Minute)); n != 0 || len(sender.Hints) != 1 {
		t.Fatal("redelivery push", n)
	}
}

func TestAttentionPushConversationHintShapeUnchanged(t *testing.T) {
	data, collapse := nativePushData(PushHint{EventID: "e", CompanyID: "c", ConversationID: "conv"})
	if len(data) != 3 || data["conversationId"] != "conv" || collapse != "conv" {
		t.Fatal(data, collapse)
	}
	raw, _ := json.Marshal(PushHint{EventID: "e", CompanyID: "c", ConversationID: "conv"})
	if string(raw) != `{"eventId":"e","companyId":"c","conversationId":"conv"}` {
		t.Fatal(string(raw))
	}
}

func TestAttentionPushSkipsResolvedItems(t *testing.T) {
	s, _, cid, _, _, _, member, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	deliverAttention(t, s, now)
	body := map[string]any{"expectedVersion": 1, "retryKey": "push-resolve", "action": "resolve", "reason": "Handled"}
	financeOK(t, s, "POST", "/api/companies/"+cid+"/attention/attention-push/transition", body, member)
	if n := runAttentionPush(t, s, now); n != 0 || len(sender.Hints) != 0 {
		t.Fatal("resolved item pushed", n)
	}
}

func TestAttentionPushReauthorizesSourceAtSendTime(t *testing.T) {
	s, founder, cid, _, task, device, _, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	deliverAttention(t, s, now)
	// The intent exists before source authority changes; final send reloads it.
	var member Membership
	s.db.First(&member, "company_id=? AND user_id=?", cid, sender.uid(s, device))
	s.db.Create(&AttentionPush{ItemID: "attention-push", DeviceID: device, EventID: "pending", CompanyID: cid, UserID: member.UserID, CreatedAt: now})
	owner := me(t, s, founder)
	if e := s.db.Model(&Task{}).Where("id=?", task).Updates(map[string]any{"owner_id": owner, "collaborators": "[]"}).Error; e != nil {
		t.Fatal(e)
	}
	if n := runAttentionPush(t, s, now); n != 0 || len(sender.Hints) != 0 {
		t.Fatal("revoked source pushed", n)
	}
	var job AttentionPush
	s.db.First(&job, "item_id=? AND device_id=?", "attention-push", device)
	if !job.Done {
		t.Fatal("revoked intent remains pending")
	}
}

func TestAttentionPushStopsAfterMembershipRevocation(t *testing.T) {
	s, founder, cid, uid, _, _, _, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	deliverAttention(t, s, now)
	financeOK(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": false}, founder)
	if n := runAttentionPush(t, s, now); n != 0 || len(sender.Hints) != 0 {
		t.Fatal("departed member pushed", n)
	}
}

func TestAttentionPushRoleChangeRevokesReviewAuthority(t *testing.T) {
	s, founder, cid, uid, task, device, _, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	reviewer := addPerson(t, s, founder, cid, "push-reviewer@example.com", "manager")
	rc := login(t, s, "push-reviewer@example.com")
	rdevice := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "ios", "name": "Reviewer", "pushProvider": "apns", "pushToken": "reviewer-token"}, rc)["id"].(string)
	s.db.Model(&Task{}).Where("id=?", task).Updates(map[string]any{"status": "in_review", "reviewer_id": reviewer})
	s.db.Model(&AttentionItem{}).Where("id=?", "attention-push").Update("state", "resolved")
	s.db.Create(&AttentionItem{ID: "attention-review", CompanyID: cid, RecipientID: reviewer, SourceKind: "task", SourceID: task, OccurrenceKey: "review", Kind: "task_review", State: "open", Version: 1, CreatedAt: now, UpdatedAt: now})
	deliverAttention(t, s, now)
	s.db.Create(&AttentionPush{ItemID: "attention-review", DeviceID: rdevice, EventID: "pending", CompanyID: cid, UserID: reviewer, CreatedAt: now})
	// Demotion to viewer removes review authority without departure.
	s.db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, reviewer).Update("role", "viewer")
	if n := runAttentionPush(t, s, now); n != 0 || len(sender.Hints) != 0 {
		t.Fatal("viewer received review push", n)
	}
	_, _ = uid, device
}

func TestAttentionPushRecipientBoundReportReadyOnlyForEligibleRecipient(t *testing.T) {
	s, _, cid, uid, _, device, _, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	s.db.Model(&AttentionItem{}).Where("id=?", "attention-push").Update("state", "resolved")
	// A report_ready item addressed to this member for a job they are not bound to.
	s.db.Create(&AttentionItem{ID: "attention-report", CompanyID: cid, RecipientID: uid, SourceKind: "report_export", SourceID: "someone-elses-job", OccurrenceKey: "report:x", Kind: "report_ready", State: "open", Version: 1, CreatedAt: now, UpdatedAt: now})
	s.db.Create(&AttentionDelivery{ID: "report-delivery", CompanyID: cid, ItemID: "attention-report", RecipientID: uid, Stage: "initial", CreatedAt: now})
	if n := runAttentionPush(t, s, now); n != 0 || len(sender.Hints) != 0 {
		t.Fatal("foreign report pushed", n)
	}
	_ = device
}

func TestAttentionPushDefersDuringQuietHours(t *testing.T) {
	s, _, cid, _, _, device, member, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	deliverAttention(t, s, now)
	// Mute retires (TestAttentionPushRetiresMutedAndStaleIntents); quiet hours defer.
	clock := now.Add(-time.Hour).Format("15:04")
	end := now.Add(time.Hour).Format("15:04")
	financeOK(t, s, "POST", "/api/companies/"+cid+"/devices/"+device+"/preferences", map[string]any{"muted": false, "timezone": "UTC", "quietStart": clock, "quietEnd": end}, member)
	if n := runAttentionPush(t, s, now.Add(2*time.Minute)); n != 0 {
		t.Fatal("quiet device pushed", n)
	}
	financeOK(t, s, "POST", "/api/companies/"+cid+"/devices/"+device+"/preferences", map[string]any{"muted": false, "timezone": "UTC"}, member)
	// Attention quiet hours from the recipient's Inbox delivery preferences also defer.
	s.db.Create(&AttentionPreference{CompanyID: cid, UserID: sender.uid(s, device), Version: 2, WorkingDays: []int{}, QuietStart: clock, QuietEnd: end})
	if n := runAttentionPush(t, s, now.Add(4*time.Minute)); n != 0 {
		t.Fatal("attention quiet hours pushed", n)
	}
	s.db.Model(&AttentionPreference{}).Where("company_id=?", cid).Updates(map[string]any{"quiet_start": "", "quiet_end": ""})
	if n := runAttentionPush(t, s, now.Add(6*time.Minute)); n != 1 || len(sender.Hints) != 1 {
		t.Fatal("deferred push not sent after quiet hours", n)
	}
}

func TestAttentionPushRequiresActiveDeviceAndSession(t *testing.T) {
	s, _, cid, uid, _, device, _, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	deliverAttention(t, s, now)
	s.db.Model(&CommunicationDevice{}).Where("id=?", device).Update("active", false)
	if n := runAttentionPush(t, s, now); n != 0 {
		t.Fatal("inactive device pushed", n)
	}
	s.db.Model(&CommunicationDevice{}).Where("id=?", device).Update("active", true)
	s.db.Model(&SessionRecord{}).Where("user_id=?", uid).Update("expires_at", now.Add(-time.Minute))
	if n := runAttentionPush(t, s, now); n != 0 || len(sender.Hints) != 0 {
		t.Fatal("expired session pushed", n)
	}
	// A pending intent for an expired session is retired at send time.
	s.db.Create(&AttentionPush{ItemID: "attention-push", DeviceID: device, EventID: "pending", CompanyID: cid, UserID: uid, CreatedAt: now})
	if n := runAttentionPush(t, s, now); n != 0 || len(sender.Hints) != 0 {
		t.Fatal("expired session intent pushed", n)
	}
}

func (p *testPushSender) uid(s *Server, device string) string {
	var d CommunicationDevice
	s.db.First(&d, "id=?", device)
	return d.UserID
}

// lockProbeSender proves Send runs outside any transaction: it performs the same
// company-fence write HTTP access uses, which blocks (and times out) if the
// worker still holds a write/row lock or the single SQLite connection.
type lockProbeSender struct {
	s      *Server
	cid    string
	probes []error
	fail   map[string]bool
	hints  []PushHint
}

func (p *lockProbeSender) Send(ctx context.Context, device CommunicationDevice, hint PushHint) error {
	probe, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	p.probes = append(p.probes, p.s.db.WithContext(probe).Transaction(func(tx *gorm.DB) error { return lockCompany(tx, p.cid) }))
	if p.fail[device.ID] {
		return errors.New("provider unavailable")
	}
	p.hints = append(p.hints, hint)
	return nil
}

func TestAttentionPushSendsOutsideAnyTransaction(t *testing.T) {
	s, _, cid, _, _, _, _, _ := attentionPushFixture(t)
	probe := &lockProbeSender{s: s, cid: cid}
	s.opts.PushSender = probe
	now := time.Now().UTC()
	deliverAttention(t, s, now)
	if n := runAttentionPush(t, s, now); n != 1 || len(probe.probes) != 1 || probe.probes[0] != nil {
		t.Fatal("send held a transaction or lock", n, probe.probes)
	}
}

func TestAttentionPushProviderFailureIsCappedAndDoesNotBlockBatch(t *testing.T) {
	s, _, cid, uid, _, device, member, _ := attentionPushFixture(t)
	second := financeOK(t, s, "POST", "/api/devices", map[string]any{"deviceId": "second-device-id-0001", "platform": "ios", "name": "Second", "pushProvider": "apns", "pushToken": "second-device-token"}, member)["id"].(string)
	if second == device {
		t.Fatal("expected a second registration")
	}
	probe := &lockProbeSender{s: s, cid: cid, fail: map[string]bool{device: true}}
	s.opts.PushSender = probe
	now := time.Now().UTC()
	deliverAttention(t, s, now)
	n, e := s.RunAttentionPush(t.Context(), now)
	if e == nil || n != 1 || len(probe.hints) != 1 {
		t.Fatal("poisoned device blocked the healthy device", n, e, len(probe.hints))
	}
	for i := 1; i < attentionPushMaxAttempts+2; i++ {
		s.RunAttentionPush(t.Context(), now.Add(time.Duration(i)*time.Minute))
	}
	var job AttentionPush
	s.db.First(&job, "item_id=? AND device_id=?", "attention-push", device)
	if !job.Done || job.Attempts != attentionPushMaxAttempts {
		t.Fatal("failing intent not capped", job.Done, job.Attempts)
	}
	_ = uid
}

func TestAttentionPushRetiresMutedAndStaleIntents(t *testing.T) {
	s, _, cid, uid, _, device, member, sender := attentionPushFixture(t)
	now := time.Now().UTC()
	deliverAttention(t, s, now)
	financeOK(t, s, "POST", "/api/companies/"+cid+"/devices/"+device+"/preferences", map[string]any{"muted": true, "timezone": "UTC"}, member)
	runAttentionPush(t, s, now)
	var job AttentionPush
	s.db.First(&job, "item_id=? AND device_id=?", "attention-push", device)
	if !job.Done || len(sender.Hints) != 0 {
		t.Fatal("muted intent kept rescheduling", job)
	}
	// Quiet hours defer; once the intent outlives the freshness window it retires.
	s.db.Model(&AttentionPush{}).Where("item_id=?", "attention-push").Updates(map[string]any{"done": false, "lease_until": nil})
	financeOK(t, s, "POST", "/api/companies/"+cid+"/devices/"+device+"/preferences", map[string]any{"muted": false, "timezone": "UTC", "quietStart": now.Add(-time.Hour).Format("15:04"), "quietEnd": now.Add(time.Hour).Format("15:04")}, member)
	runAttentionPush(t, s, now)
	s.db.First(&job, "item_id=? AND device_id=?", "attention-push", device)
	if job.Done {
		t.Fatal("quiet hours retired a fresh intent")
	}
	s.db.Model(&AttentionPush{}).Where("item_id=?", "attention-push").Updates(map[string]any{"lease_until": nil, "created_at": now.Add(-attentionPushFreshness - time.Minute)})
	runAttentionPush(t, s, now)
	s.db.First(&job, "item_id=? AND device_id=?", "attention-push", device)
	if !job.Done || len(sender.Hints) != 0 {
		t.Fatal("stale intent not retired", job)
	}
	_ = uid
}
