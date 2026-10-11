package platform

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"strconv"
	"testing"
	"time"
)

func TestMemberLegacyConsequences(t *testing.T) {
	s, db := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	uid := addPerson(t, s, founder, cid, "people-scope@example.com", "member")
	target := login(t, s, "people-scope@example.com")
	base := "/api/companies/" + cid
	task := createTask(t, s, founder, cid, taskBody(uid))
	st, _, w := req(t, s, "PATCH", base+"/people/"+uid, map[string]any{"role": "manager"}, founder)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	st, _, _ = req(t, s, "GET", "/api/auth/session", nil, target)
	if st != 401 {
		t.Fatalf("scope change must invalidate old account session: got %d", st)
	}
	var current Task
	if err := db.First(&current, "id=?", task).Error; err != nil {
		t.Fatal(err)
	}
	if current.OwnerID != uid || current.Version != 1 {
		t.Fatal("direct membership edit changed retained task")
	}
}
func TestMemberCapturedVersion(t *testing.T) {
	s, _ := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	uid := addPerson(t, s, founder, cid, "people-version@example.com", "member")
	base := "/api/companies/" + cid + "/people/" + uid
	st, _, w := req(t, s, "PATCH", base, map[string]any{"expectedVersion": 1, "title": "Reviewed title"}, founder)
	if st != 200 {
		t.Fatalf("captured version edit: %d %s", st, w.Body.String())
	}
	st, _, _ = req(t, s, "PATCH", base, map[string]any{"expectedVersion": 1, "title": "Stale overwrite"}, founder)
	if st != 409 {
		t.Fatalf("stale captured version: %d", st)
	}
}
func TestMemberTitleAndNoopPreserveSession(t *testing.T) {
	s, _ := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	uid := addPerson(t, s, founder, cid, "people-title@example.com", "member")
	target := login(t, s, "people-title@example.com")
	for _, fields := range []map[string]any{{"title": "Current title"}, {"role": "member"}, {"capacityHours": 32}} {
		st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, fields, founder)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
		st, _, _ = req(t, s, "GET", "/api/auth/session", nil, target)
		if st != 200 {
			t.Fatalf("metadata/no-op must preserve session: %d", st)
		}
	}
}

func TestSessionEpochCurrentTransaction(t *testing.T) {
	s, db := testServer(t)
	cookie := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, cookie)
	r := requestForAccess("/api/companies/"+cid+"/tasks", cookie, cid)
	a, e := s.access(r)
	if e != nil {
		t.Fatal(e)
	}
	if e = db.Model(&User{}).Where("id=?", a.User.ID).Update("session_epoch", a.User.SessionEpoch+1).Error; e != nil {
		t.Fatal(e)
	}
	called := false
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error { called = true; return nil })
	if e == nil || called {
		t.Fatal("preauthenticated stale epoch entered source callback")
	}
	st, _, _ := req(t, s, "GET", "/api/auth/session", nil, cookie)
	if st != 401 {
		t.Fatalf("retained old epoch session accepted: %d", st)
	}
}
func TestMemberRejoinCannotRestoreSession(t *testing.T) {
	s, db := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	uid := addPerson(t, s, founder, cid, "people-rejoin@example.com", "member")
	old := login(t, s, "people-rejoin@example.com")
	base := "/api/companies/" + cid + "/people/" + uid
	for _, active := range []bool{false, true} {
		st, _, w := req(t, s, "PATCH", base, map[string]any{"active": active}, founder)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	st, _, _ := req(t, s, "GET", "/api/auth/session", nil, old)
	if st != 401 {
		t.Fatal("rejoin revived old session")
	}
	var m Membership
	if e := db.First(&m, "company_id=? AND user_id=?", cid, uid).Error; e != nil {
		t.Fatal(e)
	}
	if m.Version != 3 || m.AccessEpoch != 3 {
		t.Fatalf("each membership mutation must bump once: %+v", m)
	}
	_ = login(t, s, "people-rejoin@example.com")
}

func TestPeopleAccountWriterEpoch(t *testing.T) {
	s, db := testServer(t)
	cookie := login(t, s, "founder@example.com")
	uid := me(t, s, cookie)
	var before User
	db.First(&before, "id=?", uid)
	st, _, w := req(t, s, "POST", "/api/auth/password", map[string]any{"currentPassword": "A-strong-password!2026", "newPassword": "A-different-password!2026"}, cookie)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var after User
	db.First(&after, "id=?", uid)
	if after.SessionEpoch != before.SessionEpoch+1 {
		t.Fatal("credential mutation did not advance account epoch")
	}
	st, _, _ = req(t, s, "GET", "/api/auth/session", nil, cookie)
	if st != 200 {
		t.Fatal("preserved session epoch not coherent")
	}
}
func TestFinanceOriginalSessionEpoch(t *testing.T) {
	s, db := testServer(t)
	cookie := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, cookie)
	uid := me(t, s, cookie)
	var u User
	db.First(&u, "id=?", uid)
	db.Model(&User{}).Where("id=?", uid).Update("session_epoch", u.SessionEpoch+1)
	if e := financeOriginalSession(db, cid, uid, hashToken(cookie.Value)); e == nil {
		t.Fatal("raw finance handle accepted stale original session epoch")
	}
}

func TestPeopleProducerRetirement(t *testing.T) {
	s, db := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	uid := addPerson(t, s, founder, cid, "people-output@example.com", "member")
	body := taskBody(uid)
	id := createTask(t, s, founder, cid, body)
	st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "status": "blocked", "blockerReason": "Awaiting information"}, founder)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var old AttentionItem
	if e := db.First(&old, "company_id=? AND source_id=? AND recipient_id=? AND kind='blocker'", cid, id, uid).Error; e != nil {
		t.Fatal(e)
	}
	for _, active := range []bool{false, true} {
		st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": active}, founder)
		if st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	var retired AttentionItem
	db.First(&retired, "id=?", old.ID)
	if retired.State != "superseded" {
		t.Fatal("departure did not retire old attention episode")
	}
	target := login(t, s, "people-output@example.com")
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/attention/"+old.ID, nil, target)
	if st != 404 {
		t.Fatalf("old attention resurrected after rejoin: %d", st)
	}
	r := requestForAccess("/api/companies/"+cid+"/tasks", founder, cid)
	a, e := s.access(r)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var task Task
		if e := tx.First(&task, "id=?", id).Error; e != nil {
			return e
		}
		return syncTaskAttention(tx, a, &task, task)
	}); e != nil {
		t.Fatal(e)
	}
	var count int64
	db.Model(&AttentionItem{}).Where("source_id=? AND recipient_id=? AND kind='blocker' AND state='open'", id, uid).Count(&count)
	if count != 0 {
		t.Fatal("repair recreated a retired old-source episode")
	}
	st, _, w = req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 2, "description": "Deliberate fresh source revision"}, founder)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	db.Model(&AttentionItem{}).Where("source_id=? AND recipient_id=? AND kind='blocker' AND state='open'", id, uid).Count(&count)
	if count != 1 {
		t.Fatal("fresh currently authorized source revision did not create a fresh episode")
	}
}

func TestRevokedReviewerSourceLifecycle(t *testing.T) {
	s, c, cid, owner, uid, _ := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	m := sendMessage(t, s, c, cid, conv, "people-review-source", "Review source")
	root := "/api/companies/" + cid + "/conversations/" + conv + "/records"
	st, out, w := req(t, s, "POST", root, map[string]any{"retryKey": "people-decision", "kind": "decision", "anchorMessageId": m["id"], "sourceRevision": 1, "title": "Independent decision", "body": "Review", "reviewerId": uid, "recipientIds": []string{uid}}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := out["id"].(string)
	st, _, w = req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": false}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	st, _, _ = req(t, s, "PATCH", root+"/"+id, map[string]any{"expectedRevision": 1, "title": "Changed decision", "body": "Revision", "options": []string{}, "dueAt": "", "reason": "Reviewed new text"}, c)
	if st != 422 {
		t.Fatalf("revoked reviewer accepted new private revision: %d", st)
	}
	var record CommunicationRecord
	s.db.First(&record, "id=?", id)
	if record.Revision != 1 || record.State != "open" {
		t.Fatal("rejected revision altered original decision")
	}
}
func TestDepartmentCapturedVersion(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	root := "/api/companies/" + cid + "/departments"
	st, out, w := req(t, s, "POST", root, map[string]any{"name": "People", "headId": me(t, s, c), "color": "#123456", "description": ""}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := out["id"].(string)
	st, _, w = req(t, s, "PATCH", root+"/"+id, map[string]any{"expectedVersion": 1, "name": "People Operations"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	st, _, _ = req(t, s, "PATCH", root+"/"+id, map[string]any{"expectedVersion": 1, "name": "Stale"}, c)
	if st != 409 {
		t.Fatal("department stale write", st)
	}
}

func TestPeopleQueuedCommunicationCannotCrossRejoin(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "channel")
	if e := s.db.Model(&Conversation{}).Where("id=?", id).Update("public", true).Error; e != nil {
		t.Fatal(e)
	}
	sendMessage(t, s, mc, cid, id, "before-departure", "An ordinary public source")
	for _, active := range []bool{false, true} {
		st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": active}, c)
		if st != 200 {
			t.Fatal(st)
		}
	}
	if _, e := s.RunCommunicationOutbox(t.Context(), 100); e != nil {
		t.Fatal(e)
	}
	var count int64
	s.db.Model(&CommunicationInbox{}).Where("user_id=?", uid).Count(&count)
	if count != 0 {
		t.Fatalf("prior membership event minted after rejoin: %d", count)
	}
	sendMessage(t, s, c, cid, id, "after-departure", "A deliberate new public source")
	if _, e := s.RunCommunicationOutbox(t.Context(), 100); e != nil {
		t.Fatal(e)
	}
	s.db.Model(&CommunicationInbox{}).Where("user_id=?", uid).Count(&count)
	if count != 1 {
		t.Fatalf("fresh public source episode missing: %d", count)
	}
}

func TestRevocationAtomic(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := addPerson(t, s, c, cid, "people-atomic@example.com", "member")
	old := login(t, s, "people-atomic@example.com")
	var member Membership
	var company Company
	var user User
	db.First(&member, "company_id=? AND user_id=?", cid, uid)
	db.First(&company, "id=?", cid)
	db.First(&user, "id=?", uid)
	name := "people_injected_audit_failure"
	db.Callback().Create().Before("gorm:create").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table == "activities" {
			tx.AddError(fmt.Errorf("injected audit failure"))
		}
	})
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+uid, map[string]any{"active": false}, c)
	db.Callback().Create().Remove(name)
	if st != 500 {
		t.Fatalf("failure injection: %d", st)
	}
	var after Membership
	var ac Company
	var au User
	db.First(&after, "id=?", member.ID)
	db.First(&ac, "id=?", cid)
	db.First(&au, "id=?", uid)
	if after != member || ac.PermissionEpoch != company.PermissionEpoch || au.SessionEpoch != user.SessionEpoch {
		t.Fatal("partial permission changes survived rollback")
	}
	if st, _, _ := req(t, s, "GET", "/api/auth/session", nil, old); st != 200 {
		t.Fatal("rolled-back revocation invalidated session")
	}
}

func TestMemberResultingGraph(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	first := addPerson(t, s, c, cid, "people-graph-a@example.com", "manager")
	second := addPerson(t, s, c, cid, "people-graph-b@example.com", "manager")
	r := requestForAccess("/api/companies/"+cid+"/people", c, cid)
	a, e := s.access(r)
	if e != nil {
		t.Fatal(e)
	}
	for _, order := range [][]string{{first, second}, {second, first}} {
		e = s.withPeopleAccessTransaction(r, a, order, func(tx *gorm.DB) error {
			graph := cloneMembers(a.Members)
			one, two := graph[first], graph[second]
			one.ManagerID = second
			two.ManagerID = first
			graph[first], graph[second] = one, two
			for _, id := range order {
				_, e := prepareMemberPatch(tx, a, a.Members[id], MemberPatch{ExpectedVersion: 1, Fields: map[string]json.RawMessage{"managerId": json.RawMessage(strconv.Quote(graph[id].ManagerID))}}, graph)
				if e != nil {
					return e
				}
			}
			return nil
		})
		if e == nil {
			t.Fatal("complete resulting cycle accepted")
		}
	}
	var rows []Membership
	db.Where("user_id IN ?", []string{first, second}).Find(&rows)
	for _, row := range rows {
		if row.ManagerID != "" || row.Version != 1 {
			t.Fatal("graph validation mutated membership")
		}
	}
}

func TestPeopleExpiredSessionCleanup(t *testing.T) {
	s, db := testServer(t)
	old := login(t, s, "founder@example.com")
	current := login(t, s, "founder@example.com")
	hash := hashToken(old.Value)
	if e := db.Model(&SessionRecord{}).Where("token_hash=?", hash).Update("expires_at", time.Now().UTC().Add(-time.Hour)).Error; e != nil {
		t.Fatal(e)
	}
	if _, _, e := s.RunAutomations(t.Context()); e != nil {
		t.Fatal(e)
	}
	var count int64
	db.Model(&SessionRecord{}).Where("token_hash=?", hash).Count(&count)
	if count != 0 {
		t.Fatal("expired captured session was not cleaned")
	}
	if st, _, _ := req(t, s, "GET", "/api/auth/session", nil, current); st != 200 {
		t.Fatalf("expiry cleanup revoked independent current session: %d", st)
	}
}
