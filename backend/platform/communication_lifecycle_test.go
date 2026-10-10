package platform

import (
	"strings"
	"testing"
)

func TestCompanyOwnerDepartureRequiresHandover(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, mc, cid, []string{owner, uid}, "group")
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": false}, c)
	if st != 422 {
		t.Fatal("active group orphaned", st)
	}
	financeOK(t, s, "POST", "/api/companies/"+cid+"/conversations/"+conv+"/members", map[string]any{"expectedVersion": 1, "userId": owner, "role": "owner", "active": true}, mc)
	financeOK(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": false}, c)
}
func TestPasswordRecoveryRevokesDeviceAndRetainsMFA(t *testing.T) {
	s, c, _, owner, _, _ := conversationFixture(t)
	financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "web", "name": "Recovery test"}, c)
	s.db.Create(&UserMFA{UserID: owner, Enabled: true, SecretCipher: []byte("encrypted")})
	if e := ResetPassword(s.db, "founder@example.com", "Recovered-password!2026"); e != nil {
		t.Fatal(e)
	}
	var active int64
	s.db.Model(&CommunicationDevice{}).Where("user_id=? AND active=?", owner, true).Count(&active)
	if active != 0 {
		t.Fatal("recovery left device active")
	}
	var mfa UserMFA
	if e := s.db.First(&mfa, "user_id=?", owner).Error; e != nil || !mfa.Enabled {
		t.Fatal("password recovery bypassed MFA")
	}
}
func TestConversationRosterPaginationFiltersBeforeLimit(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	newConversation(t, s, c, cid, []string{owner}, "group")
	for i := 0; i < 102; i++ {
		row := Conversation{ID: newID("con"), CompanyID: cid, Kind: "channel", Public: true, Title: "Visible", Forwarding: "deny", Version: 1, CreatedBy: uid, CreatedAt: nowString()}
		if e := s.db.Create(&row).Error; e != nil {
			t.Fatal(e)
		}
	}
	path := "/api/companies/" + cid + "/conversations"
	first := financeOK(t, s, "GET", path, nil, mc)
	if len(first["conversations"].([]any)) != 100 || first["hasMore"] != true {
		t.Fatal("first page", len(first["conversations"].([]any)), first["hasMore"])
	}
	cursor, ok := first["cursor"].(string)
	if !ok || cursor == "" {
		t.Fatal("no cursor")
	}
	next := financeOK(t, s, "GET", path+"?cursor="+cursor, nil, mc)
	if len(next["conversations"].([]any)) != 2 || next["hasMore"] != false {
		t.Fatal("next page")
	}
	for _, row := range first["conversations"].([]any) {
		if strings.Contains(row.(map[string]any)["title"].(string), "Private") {
			t.Fatal("hidden group consumed page")
		}
	}
	st, _, _ := req(t, s, "GET", path+"?cursor="+cursor, nil, c)
	if st != 409 {
		t.Fatal("cursor crossed actor", st)
	}
}
