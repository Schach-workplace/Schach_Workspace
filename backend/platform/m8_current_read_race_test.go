package platform

import (
	"fmt"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func waitM8Lock(t *testing.T, db *gorm.DB, marker string) {
	t.Helper()
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		var n int64
		if e := db.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ?", "%"+marker+"%").Scan(&n).Error; e != nil {
			t.Fatal(e)
		}
		if n > 0 {
			var waits []struct {
				WaitEventType string
				WaitEvent     string
				Query         string
			}
			if e := db.Raw("SELECT wait_event_type,wait_event,query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ?", "%"+marker+"%").Scan(&waits).Error; e != nil {
				t.Fatal(e)
			}
			t.Logf("Observed actual application source fence wait: %+v", waits)
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("reader did not enter observed native lock wait")
}
func TestM8CurrentPlanningAfterCompanyLockWait(t *testing.T) {
	s, db := testServer(t)
	if db.Dialector.Name() != "postgres" {
		t.Skip("native independent connections")
	}
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := addPerson(t, s, c, cid, "m8waitingowner@example.com", "member")
	other := addPerson(t, s, c, cid, "m8waitingother@example.com", "member")
	mc := login(t, s, "m8waitingowner@example.com")
	body := taskBody(owner)
	body["estimatedHours"] = 8
	id := createTask(t, s, c, cid, body)
	tx := db.Begin()
	defer tx.Rollback()
	if e := lockCompany(tx, cid); e != nil {
		t.Fatal(e)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		_, _, w := req(t, s, "GET", "/api/companies/"+cid+"/planning/summary?from=2026-10-12&to=2026-10-25", nil, mc)
		done <- w
	}()
	waitM8Lock(t, db, "companies")
	if e := tx.Model(&Task{}).Where("id=?", id).Updates(map[string]any{"owner_id": other, "created_by": other, "version": 2}).Error; e != nil {
		t.Fatal(e)
	}
	if e := tx.Commit().Error; e != nil {
		t.Fatal(e)
	}
	select {
	case w := <-done:
		t.Logf("Post-fence actual HTTP planning response: %d %s", w.Code, w.Body)
		if w.Code != 200 || strings.Contains(w.Body.String(), "\"uniqueSelectedRemainingHours\":8") {
			t.Fatalf("actual HTTP stale authorized task after wait: %d %s", w.Code, w.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("read failed to finish")
	}
}
func TestM8CurrentPrivateEvidenceAfterMembershipLockWait(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	db := s.db
	if db.Dialector.Name() != "postgres" {
		t.Skip("native independent connections")
	}
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	message := sendMessage(t, s, mc, cid, conv, "m8-private-wait", "Private wait source")
	goal := createMeasuredGoal(t, s, c, cid, uid)
	tx := db.Begin()
	defer tx.Rollback()
	var members []Membership
	if e := lockCommunicationRow(tx, "SHARE").Where("company_id=? AND user_id=?", cid, uid).Find(&members).Error; e != nil {
		t.Fatal(e)
	}
	var conversation Conversation
	if e := lockCommunicationRow(tx, "UPDATE").First(&conversation, "id=?", conv).Error; e != nil {
		t.Fatal(e)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		_, _, w := req(t, s, "GET", "/api/companies/"+cid+"/goals/"+goal+"/evidence-preview?kind=message&parentId="+conv+"&sourceId="+message["id"].(string), nil, mc)
		done <- w
	}()
	waitM8Lock(t, db, "memberships")
	if e := tx.Model(&ConversationMember{}).Where("conversation_id=? AND user_id=?", conv, uid).Updates(map[string]any{"active": false, "epoch": 2}).Error; e != nil {
		t.Fatal(e)
	}
	if e := tx.Commit().Error; e != nil {
		t.Fatal(e)
	}
	select {
	case w := <-done:
		t.Logf("Post-fence actual HTTP private evidence response: %d %s", w.Code, w.Body)
		if w.Code != 404 || strings.Contains(w.Body.String(), "Private wait source") {
			t.Fatalf("actual HTTP stale private evidence after wait: %d %s", w.Code, w.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("read failed to finish")
	}
}
func TestM8GoalEvidenceMessageEpochAndEdit(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	message := sendMessage(t, s, mc, cid, conv, "epoch-source", "Original exact private source")
	goal := createMeasuredGoal(t, s, c, cid, uid)
	path := "/api/companies/" + cid + "/goals/" + goal
	st, b, _ := req(t, s, "GET", path+"/evidence-preview?kind=message&parentId="+conv+"&sourceId="+message["id"].(string), nil, mc)
	if st != 200 {
		t.Fatal(st, b)
	}
	input := map[string]any{"retryKey": "epoch-binding", "expectedVersion": 1, "value": 4, "effectiveAt": "2026-10-02T00:00:00Z", "reason": "Public outcome reason", "evidence": []any{map[string]any{"kind": "message", "parentId": conv, "sourceId": message["id"], "revision": message["revision"], "contentHash": b["contentHash"]}}}
	s.db.Model(&Message{}).Where("id=?", message["id"]).Updates(map[string]any{"body": "Edited exact source", "revision": 2})
	st, b, _ = req(t, s, "POST", path+"/measurements", input, mc)
	if st != 409 {
		t.Fatal(st, b)
	}
	s.db.Model(&Message{}).Where("id=?", message["id"]).Updates(map[string]any{"body": "Original exact private source", "revision": 1})
	st, b, _ = req(t, s, "POST", path+"/measurements", input, mc)
	if st != 200 {
		t.Fatal(st, b)
	}
	s.db.Model(&ConversationMember{}).Where("conversation_id=? AND user_id=?", conv, uid).Updates(map[string]any{"active": true, "epoch": 2})
	st, b, w := req(t, s, "GET", path+"/measurements", nil, mc)
	if st != 200 || !strings.Contains(w.Body.String(), "evidence_unavailable") || strings.Contains(w.Body.String(), conv) || strings.Contains(w.Body.String(), "Original exact private source") {
		t.Fatal(st, b)
	}
}
func TestM8GoalReminderClaimRollbackAndNativeRace(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	goal := createMeasuredGoal(t, s, c, cid, uid)
	now := time.Now().UTC().Truncate(time.Microsecond)
	pref := GoalReminderPreference{CompanyID: cid, GoalID: goal, UserID: uid, Version: 1, Enabled: true, Cadence: "weekly", Weekday: 1, MonthDay: 1, LocalTime: "00:00", CreatedAt: now.AddDate(0, 0, -14), UpdatedAt: now.AddDate(0, 0, -14)}
	if e := db.Create(&pref).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Callback().Create().Before("gorm:create").Register("m8-item-failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "attention_items" {
			tx.AddError(fmt.Errorf("Owned M8 item failure"))
		}
	}); e != nil {
		t.Fatal(e)
	}
	if e := s.generateGoalReminders(t.Context(), now, 100); e == nil {
		t.Fatal("failure not exercised")
	}
	db.Callback().Create().Remove("m8-item-failure")
	var n int64
	db.Model(&AutomationRecord{}).Where("company_id=? AND key LIKE ?", cid, "%goal-update:%").Count(&n)
	if n != 0 {
		t.Fatal("claim survived rollback", n)
	}
	errs := make(chan error, 2)
	run := func() { errs <- s.generateGoalReminders(t.Context(), now, 100) }
	if db.Dialector.Name() == "postgres" {
		go run()
		go run()
	} else {
		run()
		run()
	}
	for j := 0; j < 2; j++ {
		if e := <-errs; e != nil {
			t.Fatal(e)
		}
	}
	db.Model(&AttentionItem{}).Where("company_id=? AND source_kind='goal' AND source_id=?", cid, goal).Count(&n)
	if n != 1 {
		t.Fatal(n)
	}
}
func TestM8MultipleCompanyIsolationAndContextBound(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	st, b, _ := req(t, s, "POST", "/api/companies", map[string]any{"name": "Second owned company", "slug": "m8-second", "timezone": "Asia/Kolkata"}, c)
	if st != 200 {
		t.Fatal(st, b)
	}
	other := b["id"].(string)
	aTask := createTask(t, s, c, cid, taskBody(uid))
	bTask := createTask(t, s, c, other, taskBody(uid))
	goal := createMeasuredGoal(t, s, c, cid, uid)
	st, b, _ = req(t, s, "GET", "/api/companies/"+other+"/goals/"+goal, nil, c)
	if st != 404 {
		t.Fatal(st, b)
	}
	otherGoal := createMeasuredGoal(t, s, c, other, uid)
	now := time.Now().UTC().Truncate(time.Microsecond)
	for company, id := range map[string]string{cid: goal, other: otherGoal} {
		pref := GoalReminderPreference{CompanyID: company, GoalID: id, UserID: uid, Version: 1, Enabled: true, Cadence: "weekly", Weekday: 1, MonthDay: 1, LocalTime: "00:00", CreatedAt: now.AddDate(0, 0, -14), UpdatedAt: now.AddDate(0, 0, -14)}
		if e := db.Create(&pref).Error; e != nil {
			t.Fatal(e)
		}
	}
	if e := s.generateGoalReminders(t.Context(), now, 100); e != nil {
		t.Fatal(e)
	}
	var items []AttentionItem
	if e := db.Where("company_id IN ? AND source_kind='goal'", []string{cid, other}).Find(&items).Error; e != nil {
		t.Fatal(e)
	}
	if len(items) != 2 || items[0].CompanyID == items[1].CompanyID {
		t.Fatalf("Expected independent company reminders: %+v", items)
	}
	var records []AutomationRecord
	if e := db.Where("company_id IN ? AND key LIKE ?", []string{cid, other}, "%goal-update:%").Find(&records).Error; e != nil {
		t.Fatal(e)
	}
	if len(records) != 2 || records[0].Key == records[1].Key {
		t.Fatalf("Company-prefixed global claims collided: %+v", records)
	}
	input := scheduleBody(aTask, 1)
	input["context"].(map[string]any)["sources"] = []any{map[string]any{"id": bTask, "version": 1}}
	st, b, _ = req(t, s, "POST", "/api/companies/"+cid+"/task-schedule/preview", input, c)
	if st != 404 {
		t.Fatal(st, b)
	}
	sources := []any{}
	for i := 0; i < 1001; i++ {
		sources = append(sources, map[string]any{"id": fmt.Sprintf("source-%d", i), "version": 1})
	}
	input["context"].(map[string]any)["sources"] = sources
	st, b, _ = req(t, s, "POST", "/api/companies/"+cid+"/task-schedule/preview", input, c)
	if st != 422 {
		t.Fatal(st, b)
	}
}
func TestM8PlanningRoleScopeMatrix(t *testing.T) {
	for _, role := range []string{"founder", "head", "manager", "member", "finance", "viewer"} {
		t.Run(role, func(t *testing.T) {
			s, _ := testServer(t)
			founder := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, founder)
			cookie := founder
			actor := me(t, s, founder)
			if role != "founder" {
				actor = addPerson(t, s, founder, cid, role+"-matrix@example.com", role)
				cookie = login(t, s, role+"-matrix@example.com")
			}
			other := addPerson(t, s, founder, cid, "matrix-hidden@example.com", "member")
			for _, row := range []struct {
				owner  string
				effort float64
				title  string
			}{{actor, 8, "Visible own work"}, {other, 16, "Hidden other owner work"}} {
				body := taskBody(row.owner)
				body["estimatedHours"] = row.effort
				body["title"] = row.title
				createTask(t, s, founder, cid, body)
			}
			st, b, w := req(t, s, "GET", "/api/companies/"+cid+"/planning/summary?from=2026-10-12&to=2026-10-25", nil, cookie)
			expected := float64(8)
			if role == "founder" || role == "viewer" {
				expected = 24
			}
			if st != 200 || b["coverage"].(map[string]any)["uniqueSelectedRemainingHours"] != expected {
				t.Fatal(st, b)
			}
			if expected == 8 && strings.Contains(w.Body.String(), other) {
				t.Fatal("Hidden owner leaked", w.Body)
			}
		})
	}
}
