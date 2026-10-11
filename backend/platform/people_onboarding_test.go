package platform

import (
	"bytes"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestPresetScopeAndVersion(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/people/presets"
	input := map[string]any{"retryKey": "preset-create", "name": "Engineering starter", "membership": map[string]any{"role": "member", "capacityHours": 40}, "templateIds": []any{}}
	st, out, w := req(t, s, "POST", base, input, c)
	if st != 200 {
		t.Fatalf("preset create: %d %s", st, w.Body.String())
	}
	id := out["id"].(string)
	st, _, _ = req(t, s, "PATCH", base+"/"+id, map[string]any{"retryKey": "preset-edit", "expectedVersion": 1, "name": "Reviewed starter"}, c)
	if st != 200 {
		t.Fatalf("preset edit: %d", st)
	}
	st, _, _ = req(t, s, "PATCH", base+"/"+id, map[string]any{"retryKey": "preset-stale", "expectedVersion": 1, "name": "Stale"}, c)
	if st != 409 {
		t.Fatalf("preset CAS: %d", st)
	}
}
func TestOnboardingAccountSemantics(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/people/onboarding"
	input := map[string]any{"retryKey": "manual-preview", "name": "Fictional Person", "email": "fictional-onboard@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{}}
	st, out, w := req(t, s, "POST", base+"/preview", input, c)
	if st != 200 {
		t.Fatalf("onboarding preview: %d %s", st, w.Body.String())
	}
	if out["accountMode"] != "new_account" {
		t.Fatal("new account mode missing")
	}
	var count int64
	db.Model(&User{}).Where("email=?", input["email"]).Count(&count)
	if count != 0 {
		t.Fatal("preview created account")
	}
	st, _, _ = req(t, s, "POST", base+"/apply", map[string]any{"retryKey": "manual-apply", "previewId": out["id"], "expectedPreviewVersion": out["version"], "password": "FictionalOnly!2026"}, c)
	if st != 503 {
		t.Fatalf("missing credential keyring must fail closed: %d", st)
	}
}

func enableFictionalCredentialKey(t *testing.T, s *Server) {
	t.Helper()
	s.opts.CredentialRetryActiveKeyID = "fictional-v1"
	s.opts.CredentialRetryKeys = map[string][]byte{"fictional-v1": bytes.Repeat([]byte{0x42}, 32)}
	if e := validateCredentialOptions(&s.opts); e != nil {
		t.Fatal(e)
	}
	s.credentialAdmission = newCredentialAdmission(s.opts)
}
func TestOnboardingCanonicalRetry(t *testing.T) {
	s, db := testServer(t)
	enableFictionalCredentialKey(t, s)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	owner := me(t, s, c)
	template := financeOK(t, s, "POST", base+"/task-templates", templateBody(owner, "task"), c)["id"].(string)
	preview := financeOK(t, s, "POST", base+"/people/onboarding/preview", map[string]any{"retryKey": "review-person", "name": "Fictional Onboard", "email": "canonical-onboard@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{map[string]any{"templateId": template, "expectedTemplateVersion": 1, "anchorDate": "2026-10-11", "fields": map[string]any{}}}}, c)
	body := map[string]any{"retryKey": "apply-person", "previewId": preview["id"], "expectedPreviewVersion": 1, "password": "FictionalOnly!2026"}
	result := financeOK(t, s, "POST", base+"/people/onboarding/apply", body, c)
	uid := result["userId"].(string)
	var user User
	db.First(&user, "id=?", uid)
	originalHash := user.PasswordHash
	var stored BusinessMutationRetry
	db.First(&stored, "operation='onboarding_apply' AND retry_key='apply-person'")
	if stored.CredentialBinding == nil || len(stored.CredentialBinding.Verifier) != 32 {
		t.Fatal("durable credential binding missing")
	}
	metadata, _ := json.Marshal(stored)
	if bytes.Contains(metadata, []byte("FictionalOnly")) || bytes.Contains(metadata, []byte(originalHash)) {
		t.Fatal("credential material leaked in serialized retry")
	}
	if e := ResetPassword(db, "canonical-onboard@example.invalid", "FictionalReset!2026"); e != nil {
		t.Fatal(e)
	}
	db.Model(&PeoplePreview{}).Where("id=?", preview["id"]).Update("expires_at", time.Now().UTC().Add(-time.Hour))
	taskID := result["taskIds"].([]any)[0].(string)
	financeOK(t, s, "PATCH", base+"/tasks/"+taskID, map[string]any{"version": 1, "title": "Changed after onboarding"}, c)
	// Restart and rotate active key; old durable key remains available for replay.
	opts := s.opts
	opts.CredentialRetryActiveKeyID = "fictional-v2"
	opts.CredentialRetryKeys["fictional-v2"] = bytes.Repeat([]byte{0x43}, 32)
	restarted, e := New(db, opts)
	if e != nil {
		t.Fatal(e)
	}
	replay := financeOK(t, restarted, "POST", base+"/people/onboarding/apply", body, c)
	if replay["id"] != result["id"] {
		t.Fatal("canonical application changed")
	}
	body["password"] = "DifferentInput!2026"
	st, _, _ := req(t, restarted, "POST", base+"/people/onboarding/apply", body, c)
	if st != 409 {
		t.Fatalf("changed password retry: %d", st)
	}
	var apps, tasks int64
	db.Model(&OnboardingApplication{}).Count(&apps)
	db.Model(&Task{}).Count(&tasks)
	if apps != 1 || tasks != 1 {
		t.Fatal("replay duplicated application or task")
	}
	var after User
	db.First(&after, "id=?", uid)
	if after.PasswordHash == originalHash || !passwordMatches(after.PasswordHash, "FictionalReset!2026") {
		t.Fatal("historical replay changed current credentials")
	}
	assertNativeTaskFacts(t, s)
}
func TestOnboardingStalePreview(t *testing.T) {
	s, db := testServer(t)
	enableFictionalCredentialKey(t, s)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	other := addPerson(t, s, c, cid, "onboarding-graph@example.invalid", "member")
	preview := financeOK(t, s, "POST", base+"/people/onboarding/preview", map[string]any{"retryKey": "stale-review", "name": "Fictional Person", "email": "stale-onboard@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{}}, c)
	financeOK(t, s, "PATCH", base+"/people/"+other, map[string]any{"title": "Changed unrelated graph"}, c)
	st, _, _ := req(t, s, "POST", base+"/people/onboarding/apply", map[string]any{"retryKey": "stale-apply", "previewId": preview["id"], "expectedPreviewVersion": 1, "password": "FictionalOnly!2026"}, c)
	if st != 409 {
		t.Fatalf("stale preview applied: %d", st)
	}
	var count int64
	db.Model(&User{}).Where("email=?", "stale-onboard@example.invalid").Count(&count)
	if count != 0 {
		t.Fatal("stale preview created user")
	}
	db.Model(&BusinessMutationRetry{}).Where("operation='onboarding_apply'").Count(&count)
	if count != 0 {
		t.Fatal("stale apply left retry result")
	}
}

func TestOnboardingSameKeyConcurrentWinner(t *testing.T) {
	s, db := testServer(t)
	if db.Dialector.Name() != "postgres" {
		t.Skip("actual independent PostgreSQL transactions required")
	}
	enableFictionalCredentialKey(t, s)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/people/onboarding"
	p := financeOK(t, s, "POST", base+"/preview", map[string]any{"retryKey": "concurrent-preview", "name": "Fictional Concurrent Person", "email": "same-key@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{}}, c)
	body := map[string]any{"retryKey": "concurrent-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "password": "FictionalOnly!2026"}
	type response struct {
		status int
		id     string
	}
	done := make(chan response, 2)
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			status, out, _ := req(t, s, "POST", base+"/apply", body, c)
			result, _ := out["id"].(string)
			done <- response{status, result}
		}()
	}
	close(start)
	a, b := <-done, <-done
	if a.status != 200 || b.status != 200 || a.id == "" || a.id != b.id {
		t.Fatalf("concurrent canonical outcomes: %d %d equal=%t", a.status, b.status, a.id == b.id)
	}
	var n int64
	db.Model(&OnboardingApplication{}).Count(&n)
	if n != 1 {
		t.Fatal("duplicate application")
	}
}
func TestOnboardingQueuedKDFDoesNotHoldMutationLocksAndRechecksActor(t *testing.T) {
	s, db := testServer(t)
	if db.Dialector.Name() != "postgres" {
		t.Skip("actual independent PostgreSQL transactions required")
	}
	enableFictionalCredentialKey(t, s)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	uid := addPerson(t, s, founder, cid, "queued-admin@example.invalid", "admin")
	actor := login(t, s, "queued-admin@example.invalid")
	base := "/api/companies/" + cid
	p := financeOK(t, s, "POST", base+"/people/onboarding/preview", map[string]any{"retryKey": "queued-preview", "name": "Fictional Queued Person", "email": "queued-person@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{}}, actor)
	for i := 0; i < cap(s.credentialAdmission.active); i++ {
		s.credentialAdmission.active <- struct{}{}
	}
	done := make(chan int, 1)
	go func() {
		st, _, _ := req(t, s, "POST", base+"/people/onboarding/apply", map[string]any{"retryKey": "queued-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "password": "FictionalOnly!2026"}, actor)
		done <- st
	}()
	deadline := time.Now().Add(2 * time.Second)
	for len(s.credentialAdmission.waiting) != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(s.credentialAdmission.waiting) != 1 {
		t.Fatal("credential request did not reach bounded pre-lock queue")
	}
	financeOK(t, s, "PATCH", base+"/people/"+uid, map[string]any{"role": "member"}, founder)
	for i := 0; i < cap(s.credentialAdmission.active); i++ {
		<-s.credentialAdmission.active
	}
	select {
	case status := <-done:
		if status != 401 && status != 403 {
			t.Fatalf("revoked queued actor outcome: %d", status)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("queued credential request failed to release")
	}
	var n int64
	db.Model(&User{}).Where("email=?", "queued-person@example.invalid").Count(&n)
	if n != 0 {
		t.Fatal("revoked queued actor created account")
	}
}

func TestOnboardingAtomicRollback(t *testing.T) {
	s, db := testServer(t)
	enableFictionalCredentialKey(t, s)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid
	one := financeOK(t, s, "POST", base+"/task-templates", templateBody(me(t, s, c), "task"), c)["id"].(string)
	twoBody := templateBody(me(t, s, c), "task")
	twoBody["retryKey"] = "second-template"
	twoBody["name"] = "Second template"
	two := financeOK(t, s, "POST", base+"/task-templates", twoBody, c)["id"].(string)
	p := financeOK(t, s, "POST", base+"/people/onboarding/preview", map[string]any{"retryKey": "rollback-preview", "name": "Fictional Rollback Person", "email": "onboarding-rollback@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{map[string]any{"templateId": one, "expectedTemplateVersion": 1, "anchorDate": "2026-10-11", "fields": map[string]any{}}, map[string]any{"templateId": two, "expectedTemplateVersion": 1, "anchorDate": "2026-10-11", "fields": map[string]any{}}}}, c)
	var before Company
	db.First(&before, "id=?", cid)
	writes := 0
	const hook = "m9_onboarding_second_task_failure"
	db.Callback().Create().Before("gorm:create").Register(hook, func(tx *gorm.DB) {
		if tx.Statement.Table == "tasks" {
			writes++
			if writes == 2 {
				tx.AddError(errors.New("injected second task failure"))
			}
		}
	})
	defer db.Callback().Create().Remove(hook)
	body := map[string]any{"retryKey": "rollback-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "password": "FictionalOnly!2026"}
	st, _, _ := req(t, s, "POST", base+"/people/onboarding/apply", body, c)
	if st != 500 || writes != 2 {
		t.Fatalf("second-task injection status=%d reached=%d", st, writes)
	}
	var n int64
	db.Model(&User{}).Where("email=?", "onboarding-rollback@example.invalid").Count(&n)
	if n != 0 {
		t.Fatal("new account escaped rollback")
	}
	db.Model(&Task{}).Count(&n)
	if n != 0 {
		t.Fatal("partial starting task escaped rollback")
	}
	var after Company
	db.First(&after, "id=?", cid)
	if after.NextTaskNumber != before.NextTaskNumber || after.PermissionEpoch != before.PermissionEpoch {
		t.Fatal("failed onboarding consumed sequence or epoch")
	}
	db.Callback().Create().Remove(hook)
	financeOK(t, s, "POST", base+"/people/onboarding/apply", body, c)
}
func TestOnboardingConcurrentAccountIdentity(t *testing.T) {
	s, db := testServer(t)
	if db.Dialector.Name() != "postgres" {
		t.Skip("actual independent PostgreSQL transactions required")
	}
	enableFictionalCredentialKey(t, s)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	other := financeOK(t, s, "POST", "/api/companies", map[string]any{"name": "Fictional Other", "slug": "m9-other", "timezone": "UTC", "color": "#F97316"}, c)["id"].(string)
	type onboardingRaceInput struct {
		path string
		body map[string]any
	}
	inputs := []onboardingRaceInput{}
	for i, company := range []string{cid, other} {
		base := "/api/companies/" + company + "/people/onboarding"
		p := financeOK(t, s, "POST", base+"/preview", map[string]any{"retryKey": "identity-preview", "name": "Fictional Same Email", "email": "identity-race@example.invalid", "membership": map[string]any{"role": "member", "capacityHours": 40}, "tasks": []any{}}, c)
		password := []string{"FictionalFirst!2026", "FictionalSecond!2026"}[i]
		inputs = append(inputs, onboardingRaceInput{base + "/apply", map[string]any{"retryKey": "identity-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "password": password}})
	}
	type outcome struct{ index, status int }
	done := make(chan outcome, 2)
	start := make(chan struct{})
	for i, input := range inputs {
		go func(i int, input onboardingRaceInput) {
			<-start
			status, _, _ := req(t, s, "POST", input.path, input.body, c)
			done <- outcome{i, status}
		}(i, input)
	}
	close(start)
	a, b := <-done, <-done
	if a.status != 200 {
		a, b = b, a
	}
	if a.status != 200 || b.status != 409 {
		t.Fatalf("cross-company identity outcomes: %d %d", a.status, b.status)
	}
	var users []User
	db.Where("email=?", "identity-race@example.invalid").Find(&users)
	if len(users) != 1 || !passwordMatches(users[0].PasswordHash, inputs[a.index].body["password"].(string)) {
		t.Fatal("loser changed winning account credentials")
	}
	var n int64
	db.Model(&Membership{}).Where("user_id=?", users[0].ID).Count(&n)
	if n != 1 {
		t.Fatal("loser adopted membership implicitly")
	}
}
