package platform

import (
	"os"
	"sync"
	"testing"
)

func TestTaskCreateCanonicalRetry(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["retryKey"] = "create-one"
	id := createTask(t, s, c, cid, body)
	st, _, w := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "title": "Later edit"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	if got := createTask(t, s, c, cid, body); got != id {
		t.Fatal("replay created a second task")
	}
	var count int64
	db.Model(&Task{}).Count(&count)
	if count != 1 {
		t.Fatal(count)
	}
	var task Task
	db.First(&task, "id = ?", id)
	if task.Version != 2 || task.Title != "Later edit" {
		t.Fatal(task)
	}
}
func TestTaskImportCanonicalRetry(t *testing.T) {
	s, db := testServer(t)
	t.Cleanup(func() { assertNativeTaskFacts(t, s) })
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	rows := []any{taskBody(me(t, s, c)), taskBody(me(t, s, c))}
	input := map[string]any{"retryKey": "import-one", "rows": rows}
	st, a, w := req(t, s, "POST", "/api/companies/"+cid+"/tasks/import", input, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/tasks/import", input, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	if a["created"] != float64(2) || b["created"] != a["created"] {
		t.Fatal(a, b)
	}
	var n int64
	db.Model(&Task{}).Count(&n)
	if n != 2 {
		t.Fatal("duplicate import", n)
	}
}
func TestTaskRetryIdentity(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["retryKey"] = "identity"
	createTask(t, s, c, cid, body)
	body["title"] = "changed"
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks", body, c)
	if st != 409 {
		t.Fatalf("changed intent = %d", st)
	}
	for _, key := range []any{"", nil, 100} {
		body["retryKey"] = key
		st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks", body, c)
		if st != 422 {
			t.Fatal(key, st)
		}
	}
	delete(body, "retryKey")
	if a, b := createTask(t, s, c, cid, body), createTask(t, s, c, cid, body); a == b {
		t.Fatal("legacy calls should remain unsafe to repeat")
	}
}
func TestTaskRetryCurrentAuthorization(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	body := taskBody(uid)
	body["retryKey"] = "authorization"
	createTask(t, s, c, cid, body)
	db.Model(&Membership{}).Where("company_id = ? AND user_id = ?", cid, uid).Update("role", "viewer")
	st, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks", body, c)
	if st != 403 || b["id"] != nil {
		t.Fatal(st, b)
	}
}
func TestTaskRetryRollback(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	bad := taskBody(me(t, s, c))
	bad["title"] = ""
	st, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks/import", map[string]any{"retryKey": "rollback", "rows": []any{bad, bad}}, c)
	if st != 422 || len(b["error"].(map[string]any)["rows"].([]any)) != 2 {
		t.Fatal(st, b)
	}
	var n int64
	db.Model(&Task{}).Count(&n)
	if n != 0 {
		t.Fatal(n)
	}
}
func TestTaskRetryConcurrent(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("PostgreSQL race fixture")
	}
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["retryKey"] = "race"
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks", body, c)
			codes <- st
		}()
	}
	wg.Wait()
	close(codes)
	for st := range codes {
		if st != 200 {
			t.Fatal(st)
		}
	}
	var n int64
	db.Model(&Task{}).Count(&n)
	if n != 1 {
		t.Fatal(n)
	}
}
