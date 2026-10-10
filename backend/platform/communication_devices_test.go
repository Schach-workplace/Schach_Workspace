package platform

import (
	"testing"
)

func TestLostDeviceRevokesItsSessionWithoutDisclosingOthers(t *testing.T) {
	s, ownerCookie, cid, _, _, first := conversationFixture(t)
	second := login(t, s, "member@example.com")
	device := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "android", "name": "Lost phone"}, first)["id"].(string)
	foreign := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "web", "name": "Other account"}, ownerCookie)["id"].(string)
	st, body, _ := req(t, s, "GET", "/api/devices", nil, second)
	if st != 200 || len(body["devices"].([]any)) != 1 {
		t.Fatalf("owned listing %d %v", st, body)
	}
	st, _, _ = req(t, s, "POST", "/api/devices/"+foreign+"/revoke", map[string]any{}, second)
	if st != 404 {
		t.Fatalf("foreign device %d", st)
	}
	financeOK(t, s, "POST", "/api/devices/"+device+"/revoke", map[string]any{}, second)
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/workspace", nil, first)
	if st != 401 {
		t.Fatalf("lost session still authorized %d", st)
	}
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/workspace", nil, second)
	if st != 200 {
		t.Fatalf("other session revoked %d", st)
	}
	financeOK(t, s, "POST", "/api/devices/"+device+"/revoke", map[string]any{}, second)
}

func TestDeviceSessionAndCompanyRevocation(t *testing.T) {
	s, c, cid, _, uid, mc := conversationFixture(t)
	st, b, w := req(t, s, "POST", "/api/devices", map[string]any{"platform": "android", "name": "Work phone"}, mc)
	if st != 200 {
		t.Fatalf("register %d %s", st, w.Body.String())
	}
	id := b["id"].(string)
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/devices/"+id+"/preferences", map[string]any{"muted": true, "timezone": "Asia/Kolkata", "quietStart": "18:00", "quietEnd": "09:00"}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": false}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/communication/inbox", nil, mc)
	if st != 404 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "POST", "/api/auth/logout", map[string]any{}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	var device CommunicationDevice
	if e := s.db.First(&device, "id=?", id).Error; e != nil {
		t.Fatal(e)
	}
	if device.Active {
		t.Fatal("device survived logout")
	}
}
