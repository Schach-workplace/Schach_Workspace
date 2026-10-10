package platform

import (
	"testing"
	"time"
)

func TestCallTokenRequiresCurrentParticipantAndDevice(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	s.opts.LiveKitURL = "http://127.0.0.1:7880"
	s.opts.LiveKitAPIKey = "test-key"
	s.opts.LiveKitAPISecret = "test-secret-at-least-32-characters"
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/calls", map[string]any{"kind": "audio", "retryKey": "ring-once"}, mc)
	if st != 200 {
		t.Fatalf("call %d %s", st, w.Body.String())
	}
	call := b["id"].(string)
	st, b, _ = req(t, s, "POST", "/api/devices", map[string]any{"platform": "web", "name": "Browser"}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	device := b["id"].(string)
	path := "/api/companies/" + cid + "/calls/" + call + "/token"
	st, b, w = req(t, s, "POST", path, map[string]any{"deviceId": device}, mc)
	if st != 200 {
		t.Fatalf("token %d %s", st, w.Body.String())
	}
	token := b["token"].(string)
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "member", "active": false}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "POST", path, map[string]any{"deviceId": device}, mc)
	if st != 404 {
		t.Fatal("refreshed token after removal")
	}
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/calls/"+call+"/transport/rtc?access_token="+token, nil, nil)
	if st != 404 && st != 403 {
		t.Fatalf("cached token accepted %d", st)
	}
}

func TestProviderRefreshedTokenRejoinsOnlyWhileCurrentGrantIsAuthorized(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	s.opts.LiveKitURL = "http://127.0.0.1:1"
	s.opts.LiveKitAPIKey = "test-key"
	s.opts.LiveKitAPISecret = "01234567890123456789012345678901"
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	root := "/api/companies/" + cid
	call := financeOK(t, s, "POST", root+"/conversations/"+conv+"/calls", map[string]any{"kind": "audio", "retryKey": "refreshed"}, mc)["id"].(string)
	device := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "web", "name": "Refreshed"}, mc)["id"].(string)
	token := financeOK(t, s, "POST", root+"/calls/"+call+"/token", map[string]any{"deviceId": device}, mc)["token"].(string)
	claims, e := parseCallToken(token, s.opts.LiveKitAPISecret, s.opts.LiveKitAPIKey)
	if e != nil {
		t.Fatal(e)
	}
	s.db.Model(&CommunicationCallGrant{}).Where("call_id=?", call).Update("expires_at", time.Now().UTC().Add(-time.Minute))
	// LiveKit refreshes its signed JWT while preserving Schach grant metadata.
	claims.Expires = time.Now().Unix() + 3600
	refreshed, e := signCallToken(claims, s.opts.LiveKitAPISecret)
	if e != nil {
		t.Fatal(e)
	}
	claims, e = parseCallToken(refreshed, s.opts.LiveKitAPISecret, s.opts.LiveKitAPIKey)
	if e != nil {
		t.Fatal(e)
	}
	if e := s.authorizeCallGrant(t.Context(), claims, cid, call, true); e != nil {
		t.Fatal("current authorized refresh cannot reconnect", e)
	}
	financeOK(t, s, "POST", root+"/conversations/"+conv+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "member", "active": false}, c)
	if e := s.authorizeCallGrant(t.Context(), claims, cid, call, true); e == nil {
		t.Fatal("revoked refreshed token reconnects")
	}
}
