package platform

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFixedRecordAudienceDoesNotIncludeOtherConversationReaders(t *testing.T) {
	for _, kind := range []string{"ack", "poll", "event", "decision"} {
		t.Run(kind, func(t *testing.T) {
			s, c, cid, owner, uid, mc := conversationFixture(t)
			other := addPerson(t, s, c, cid, "unselected@example.com", "member")
			oc := login(t, s, "unselected@example.com")
			conv := newConversation(t, s, c, cid, []string{owner, uid, other}, "group")
			m := sendMessage(t, s, c, cid, conv, "audience-source", "Ordinary source everyone can read")
			root := "/api/companies/" + cid + "/conversations/" + conv + "/records"
			financeOK(t, s, "POST", root, map[string]any{"retryKey": "fixed-audience", "kind": kind, "anchorMessageId": m["id"], "sourceRevision": 1, "title": "Selected confidential record", "body": "For requester and selected recipient only", "recipientIds": []string{uid}, "reviewerId": uid, "options": []string{"Yes", "No"}}, c)
			for _, cookie := range []*http.Cookie{c, mc} {
				b := financeOK(t, s, "GET", root, nil, cookie)
				if len(b["records"].([]any)) != 1 {
					t.Fatal("fixed reader denied", b)
				}
			}
			b := financeOK(t, s, "GET", root, nil, oc)
			if len(b["records"].([]any)) != 0 || len(b["responses"].([]any)) != 0 {
				t.Fatal("unselected reader received record or responses", b)
			}
		})
	}
}

func TestDeviceReregistrationPreservesPushUnlessExplicitlyCleared(t *testing.T) {
	s, _, _, _, _, mc := conversationFixture(t)
	id := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "android", "name": "Push phone", "pushProvider": "fcm", "pushToken": "private-provider-registration"}, mc)["id"].(string)
	financeOK(t, s, "POST", "/api/devices", map[string]any{"deviceId": id, "platform": "android", "name": "Push phone"}, mc)
	var device CommunicationDevice
	s.db.First(&device, "id=?", id)
	if device.PushProvider != "fcm" || device.PushToken != "private-provider-registration" {
		t.Fatal("startup destroyed enabled push")
	}
	financeOK(t, s, "POST", "/api/devices", map[string]any{"deviceId": id, "platform": "android", "name": "Push phone", "pushProvider": "", "pushToken": ""}, mc)
	s.db.First(&device, "id=?", id)
	if device.PushProvider != "" || device.PushToken != "" {
		t.Fatal("explicit disable ignored")
	}
}

func TestExpiredMediaCannotBecomeTaskOrExpenseEvidence(t *testing.T) {
	f := newFinanceFixture(t)
	conv := newConversation(t, f.s, f.cookie, f.cid, []string{f.uid}, "group")
	allowPublication(t, f.s, f.cookie, f.cid, conv)
	m := sendMessage(t, f.s, f.cookie, f.cid, conv, "expired-publication", "Source with retained text")
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.MediaStore = store
	mid := newID("med")
	if e := store.Put(t.Context(), mid, bytes.NewReader([]byte("expired bytes"))); e != nil {
		t.Fatal(e)
	}
	row := CommunicationMedia{ID: mid, CompanyID: f.cid, ConversationID: conv, UserID: f.uid, MessageID: m["id"].(string), HistorySequence: 1, FileName: "expired.txt", Size: 13, SHA256: "0000000000000000000000000000000000000000000000000000000000000000", MimeType: "text/plain", State: "clean", CreatedAt: nowString(), ExpiresAt: time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)}
	if e := f.db.Create(&row).Error; e != nil {
		t.Fatal(e)
	}
	input := conversionInput(m, taskBody(f.uid), "expired-work")
	input["publication"] = map[string]any{"excerpt": "", "attachmentIds": []string{mid}}
	root := f.base() + "/conversations/" + conv
	for _, suffix := range []string{"/task-conversions/preview", "/task-conversions"} {
		if st, _, _ := req(t, f.s, "POST", root+suffix, input, f.cookie); st != 404 {
			t.Fatalf("expired task evidence %s %d", suffix, st)
		}
	}
	delete(input, "task")
	input["retryKey"] = "expired-expense"
	input["expense"] = f.expense(1200)
	for _, suffix := range []string{"/expense-conversions/preview", "/expense-conversions"} {
		if st, _, _ := req(t, f.s, "POST", root+suffix, input, f.cookie); st != 404 {
			t.Fatalf("expired receipt %s %d", suffix, st)
		}
	}
}

func TestCallCleanupIsolatedAcrossRejoinAndRepeatedRevocation(t *testing.T) {
	for _, delayed := range []bool{false, true} {
		t.Run(map[bool]string{false: "completed", true: "delayed"}[delayed], func(t *testing.T) {
			s, c, cid, owner, uid, mc := conversationFixture(t)
			removed := []string{}
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]string
				json.NewDecoder(r.Body).Decode(&body)
				removed = append(removed, body["identity"])
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte("{}"))
			}))
			defer provider.Close()
			s.opts.LiveKitURL = provider.URL
			s.opts.LiveKitAPIKey = "test-key"
			s.opts.LiveKitAPISecret = "01234567890123456789012345678901"
			conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
			root := "/api/companies/" + cid
			call := financeOK(t, s, "POST", root+"/conversations/"+conv+"/calls", map[string]any{"kind": "audio", "retryKey": "repeat-removal"}, c)["id"].(string)
			device := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "web", "name": "Rejoin browser"}, mc)["id"].(string)
			mint := func() liveKitClaims {
				token := financeOK(t, s, "POST", root+"/calls/"+call+"/token", map[string]any{"deviceId": device}, mc)["token"].(string)
				claims, e := parseCallToken(token, s.opts.LiveKitAPISecret, s.opts.LiveKitAPIKey)
				if e != nil {
					t.Fatal(e)
				}
				return claims
			}
			change := func(version int, active bool) {
				financeOK(t, s, "POST", root+"/conversations/"+conv+"/members", map[string]any{"expectedVersion": version, "userId": uid, "role": "member", "active": active}, c)
			}
			old := mint()
			change(1, false)
			if _, e := s.RunCallRevocations(t.Context()); e != nil {
				t.Fatal(e)
			}
			if !delayed {
				if _, e := s.RunCallCleanup(t.Context()); e != nil {
					t.Fatal(e)
				}
			}
			change(2, true)
			fresh := mint()
			if fresh.Subject == old.Subject {
				t.Fatal("provider identity reused across authorization grants")
			}
			if delayed {
				if _, e := s.RunCallCleanup(t.Context()); e != nil {
					t.Fatal(e)
				}
				if len(removed) != 1 || removed[0] == fresh.Subject {
					t.Fatal("old cleanup targets fresh join", removed)
				}
			}
			if e := s.authorizeCallGrant(t.Context(), fresh, cid, call, true); e != nil {
				t.Fatal("fresh current join denied", e)
			}
			change(3, false)
			if _, e := s.RunCallRevocations(t.Context()); e != nil {
				t.Fatal(e)
			}
			if _, e := s.RunCallCleanup(t.Context()); e != nil {
				t.Fatal(e)
			}
			if len(removed) != 2 || removed[0] != old.Subject || removed[1] != fresh.Subject {
				t.Fatal("second provider revocation suppressed", removed)
			}
		})
	}
}
