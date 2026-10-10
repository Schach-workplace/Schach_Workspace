package platform

import (
	"context"
	"testing"
	"time"
)

type testPushSender struct {
	Hints []PushHint
	Fail  bool
}

func (p *testPushSender) Send(ctx context.Context, device CommunicationDevice, hint PushHint) error {
	p.Hints = append(p.Hints, hint)
	return nil
}
func TestPushHintsReauthorizeDeduplicateAndHonorAttention(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	sender := &testPushSender{}
	s.opts.PushSender = sender
	device := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "android", "name": "Native", "pushProvider": "fcm", "pushToken": "opaque-device-token"}, mc)["id"].(string)
	sendMessage(t, s, c, cid, id, "hint", "Private text must never enter push")
	if _, e := s.RunCommunicationOutbox(t.Context(), 100); e != nil {
		t.Fatal(e)
	}
	if n, e := s.RunCommunicationPush(t.Context(), time.Now().UTC()); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	if len(sender.Hints) != 1 || sender.Hints[0].CompanyID != cid || sender.Hints[0].ConversationID != id {
		t.Fatal("hint scope")
	}
	if n, e := s.RunCommunicationPush(t.Context(), time.Now().UTC()); e != nil || n != 0 {
		t.Fatal("duplicate push", n, e)
	}
	financeOK(t, s, "POST", "/api/companies/"+cid+"/devices/"+device+"/preferences", map[string]any{"muted": true, "timezone": "Asia/Kolkata"}, mc)
	sendMessage(t, s, c, cid, id, "muted", "Muted message")
	s.RunCommunicationOutbox(t.Context(), 100)
	if n, e := s.RunCommunicationPush(t.Context(), time.Now().UTC()); e != nil || n != 0 {
		t.Fatal("muted push", n, e)
	}
	financeOK(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": false}, c)
	if n, e := s.RunCommunicationPush(t.Context(), time.Now().UTC().Add(time.Hour)); e != nil || n != 0 {
		t.Fatal("departed push", n, e)
	}
}
