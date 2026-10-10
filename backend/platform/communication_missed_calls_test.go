package platform

import (
	"testing"
	"time"
)

func TestUnansweredCallsBecomeMissedAndJoinedCalleePreventsTimeout(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	s.opts.LiveKitURL = "http://127.0.0.1:1"
	s.opts.LiveKitAPIKey = "test"
	s.opts.LiveKitAPISecret = "01234567890123456789012345678901"
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	root := "/api/companies/" + cid
	makeCall := func(key string) string {
		return financeOK(t, s, "POST", root+"/conversations/"+conv+"/calls", map[string]any{"kind": "audio", "retryKey": key}, c)["id"].(string)
	}
	first := makeCall("missed")
	second := makeCall("answered")
	device := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "web", "name": "Callee"}, mc)["id"].(string)
	financeOK(t, s, "POST", root+"/calls/"+second+"/token", map[string]any{"deviceId": device}, mc)
	now := time.Now().UTC()
	s.db.Model(&CommunicationCallGrant{}).Where("call_id=?", second).Update("joined_at", now)
	if n, e := s.RunMissedCalls(t.Context(), now.Add(61*time.Second)); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	var a, b CommunicationCall
	s.db.First(&a, "id=?", first)
	s.db.First(&b, "id=?", second)
	if a.State != "missed" || a.Version != 2 || b.State != "active" {
		t.Fatal(a.State, a.Version, b.State)
	}
	if n, e := s.RunMissedCalls(t.Context(), now.Add(62*time.Second)); e != nil || n != 0 {
		t.Fatal("duplicate missed outcome", n, e)
	}
	var jobs int64
	s.db.Model(&CommunicationCallJob{}).Where("call_id=? AND operation=?", first, "DeleteRoom").Count(&jobs)
	if jobs != 1 {
		t.Fatal("room cleanup not durable")
	}
}
