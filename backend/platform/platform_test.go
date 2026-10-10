package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TEST_DATABASE_URL opts into the same integration suite against PostgreSQL.
// Each test owns and removes a random schema; existing schemas are not modified.
func testDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	configuration := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		parsed, e := url.Parse(dsn)
		if e != nil || parsed.Host == "" || !in(parsed.Scheme, "postgres", "postgresql") {
			t.Fatal("TEST_DATABASE_URL must be a postgres:// or postgresql:// URL")
		}
		admin, e := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), configuration)
		if e != nil {
			t.Fatal(e)
		}
		schema := newID("schach_test")
		if e = admin.Exec("CREATE SCHEMA " + schema).Error; e != nil {
			t.Fatal(e)
		}
		var db *gorm.DB
		t.Cleanup(func() {
			if db != nil {
				raw, _ := db.DB()
				_ = raw.Close()
			}
			if e := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; e != nil {
				t.Errorf("remove owned test schema: %v", e)
			}
			raw, _ := admin.DB()
			_ = raw.Close()
		})
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, e = gorm.Open(postgres.New(postgres.Config{DSN: parsed.String(), PreferSimpleProtocol: true}), configuration)
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := db.DB()
		raw.SetMaxOpenConns(8)
		migrations, e := filepath.Glob("../migrations/*.up.sql")
		if e != nil || len(migrations) == 0 {
			t.Fatalf("find migrations: %v", e)
		}
		sort.Slice(migrations, func(i, j int) bool {
			left, _ := strconv.Atoi(strings.Split(filepath.Base(migrations[i]), "_")[0])
			right, _ := strconv.Atoi(strings.Split(filepath.Base(migrations[j]), "_")[0])
			return left < right
		})
		for _, path := range migrations {
			migration, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = db.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(migration)).Error }); err != nil {
				t.Fatalf("migration %s: %v", path, err)
			}
		}
		return db
	}
	db, e := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared&_busy_timeout=5000"), configuration)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := db.DB()
	raw.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = raw.Close() })
	if e = Migrate(db); e != nil {
		t.Fatal(e)
	}
	return db
}
func testServer(t *testing.T) (*Server, *gorm.DB) {
	t.Helper()
	db := testDatabase(t)
	if err := Bootstrap(db, "founder@example.com", "A-strong-password!2026", "Founder"); err != nil {
		t.Fatal(err)
	}
	s, err := New(db, Options{AllowedOrigins: []string{"http://localhost:5173"}})
	if err != nil {
		t.Fatal(err)
	}
	return s, db
}
func req(t *testing.T, s *Server, method, path string, body any, cookie *http.Cookie) (int, map[string]any, *httptest.ResponseRecorder) {
	t.Helper()
	var b bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&b).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, path, &b)
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	out := map[string]any{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out, w
}
func login(t *testing.T, s *Server, email string) *http.Cookie {
	t.Helper()
	status, _, w := req(t, s, "POST", "/api/auth/login", map[string]any{"email": email, "password": "A-strong-password!2026"}, nil)
	if status != 200 {
		t.Fatalf("login %d: %s", status, w.Body.String())
	}
	return w.Result().Cookies()[0]
}
func firstCompany(t *testing.T, s *Server, c *http.Cookie) string {
	t.Helper()
	status, b, _ := req(t, s, "GET", "/api/companies", nil, c)
	if status != 200 {
		t.Fatal(b)
	}
	return b["companies"].([]any)[0].(map[string]any)["id"].(string)
}
func me(t *testing.T, s *Server, c *http.Cookie) string {
	t.Helper()
	_, b, _ := req(t, s, "GET", "/api/auth/session", nil, c)
	return b["user"].(map[string]any)["id"].(string)
}
func addPerson(t *testing.T, s *Server, c *http.Cookie, cid, email, role string) string {
	t.Helper()
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/people", map[string]any{"name": role, "email": email, "password": "A-strong-password!2026", "role": role, "departmentId": "", "managerId": "", "title": "", "capacityHours": 40}, c)
	if st != 200 {
		t.Fatalf("add person %d %s", st, w.Body.String())
	}
	return b["id"].(string)
}
func taskBody(owner string) map[string]any {
	return map[string]any{"title": "A concrete delivery", "description": "Acceptance criteria", "ownerId": owner, "reviewerId": "", "departmentId": "", "projectId": "", "parentId": "", "priority": "high", "status": "todo", "dueDate": "2026-10-20", "startDate": "2026-10-10", "estimatedHours": 4, "tags": []string{}, "checklist": []any{}, "dependencies": []string{}, "collaborators": []string{}, "recurrence": "none", "requiresApproval": false}
}
func createTask(t *testing.T, s *Server, c *http.Cookie, cid string, b map[string]any) string {
	t.Helper()
	st, v, w := req(t, s, "POST", "/api/companies/"+cid+"/tasks", b, c)
	if st != 200 {
		t.Fatalf("create task %d %s", st, w.Body.String())
	}
	return v["id"].(string)
}
func taskState(t *testing.T, s *Server, c *http.Cookie, cid, id string) map[string]any {
	t.Helper()
	_, w, _ := req(t, s, "GET", "/api/companies/"+cid+"/workspace", nil, c)
	for _, v := range w["tasks"].([]any) {
		m := v.(map[string]any)
		if m["id"] == id {
			return m
		}
	}
	t.Fatalf("task not found %s", id)
	return nil
}

func TestAuthenticationCookieAndCompanyBoundary(t *testing.T) {
	s, db := testServer(t)
	st, _, _ := req(t, s, "GET", "/api/companies", nil, nil)
	if st != 401 {
		t.Fatalf("anonymous=%d", st)
	}
	c := login(t, s, "founder@example.com")
	if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe cookie")
	}
	cid := firstCompany(t, s, c)
	addPerson(t, s, c, cid, "member@example.com", "member")
	member := login(t, s, "member@example.com")
	st, b, _ := req(t, s, "POST", "/api/companies", map[string]any{"name": "Second company", "slug": "second", "timezone": "UTC", "color": "#F97316", "industry": "Operations"}, c)
	if st != 200 {
		t.Fatal(b)
	}
	other := b["id"].(string)
	st, _, _ = req(t, s, "GET", "/api/companies/"+other+"/workspace", nil, member)
	if st != 403 {
		t.Fatalf("cross-company status %d", st)
	}
	var stored int64
	db.Table("sessions").Where("token_hash = ?", c.Value).Count(&stored)
	if stored != 0 {
		t.Fatal("session token stored in plaintext")
	}
	st, _, _ = req(t, s, "POST", "/api/auth/logout", nil, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "GET", "/api/auth/session", nil, c)
	if st != 401 {
		t.Fatal("logout did not revoke")
	}
}
func TestMemberVisibilityAndViewerWriteDenial(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := addPerson(t, s, c, cid, "member@example.com", "member")
	addPerson(t, s, c, cid, "viewer@example.com", "viewer")
	hidden := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	createTask(t, s, c, cid, taskBody(owner))
	mc := login(t, s, "member@example.com")
	st, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/workspace", nil, mc)
	if st != 200 || len(b["tasks"].([]any)) != 1 {
		t.Fatalf("visible tasks: %+v", b)
	}
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/tasks/"+hidden+"/comments", map[string]any{"body": "cross-scope"}, mc)
	if st != 404 {
		t.Fatalf("hidden task comment=%d", st)
	}
	vc := login(t, s, "viewer@example.com")
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/tasks", taskBody(me(t, s, c)), vc)
	if st != 403 {
		t.Fatalf("viewer create=%d", st)
	}
}
func TestApprovalSeparationAndStaleVersions(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := addPerson(t, s, c, cid, "member@example.com", "member")
	b := taskBody(owner)
	b["reviewerId"] = me(t, s, c)
	b["requiresApproval"] = true
	id := createTask(t, s, c, cid, b)
	path := "/api/companies/" + cid + "/tasks/" + id
	mc := login(t, s, "member@example.com")
	st, _, _ := req(t, s, "PATCH", path, map[string]any{"version": 1, "status": "done"}, mc)
	if st != 422 {
		t.Fatalf("owner done=%d", st)
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"version": 1, "requiresApproval": false}, mc)
	if st != 403 {
		t.Fatalf("owner approval bypass=%d", st)
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"version": 1, "status": "in_review"}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "POST", path+"/review", map[string]any{"version": 2, "decision": "approve", "comment": "approved by owner"}, mc)
	if st != 403 {
		t.Fatalf("owner review=%d", st)
	}
	st, _, _ = req(t, s, "POST", path+"/review", map[string]any{"version": 2, "decision": "approve", "comment": "Evidence checked"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"version": 2, "title": "Stale overwrite"}, c)
	if st != 409 {
		t.Fatalf("stale status %d", st)
	}
	ts := taskState(t, s, c, cid, id)
	if ts["status"] != "done" || ts["completedAt"] == "" {
		t.Fatal(ts)
	}
}
func TestDeadlineReasonAndImmutableBaseline(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	p := "/api/companies/" + cid + "/tasks/" + id
	st, _, _ := req(t, s, "PATCH", p, map[string]any{"version": 1, "dueDate": "2026-10-25"}, c)
	if st != 422 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", p, map[string]any{"version": 1, "dueDate": "2026-10-25", "deadlineChangeReason": "Supplier lead time confirmed"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	ts := taskState(t, s, c, cid, id)
	if ts["originalDueDate"] != "2026-10-20" || ts["dueDate"] != "2026-10-25" {
		t.Fatal(ts)
	}
	_, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/workspace", nil, c)
	if !strings.Contains(fmt.Sprint(b["activities"]), "Supplier lead time confirmed") {
		t.Fatal("missing deadline audit")
	}
}
func TestDependencyAndParentCyclesAndForeignReferences(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	b := taskBody(me(t, s, c))
	a := createTask(t, s, c, cid, b)
	b["dependencies"] = []string{a}
	z := createTask(t, s, c, cid, b)
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+a, map[string]any{"version": 1, "dependencies": []string{z}}, c)
	if st != 422 {
		t.Fatalf("dependency cycle %d", st)
	}
	st, _, _ = req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+z, map[string]any{"version": 1, "parentId": a}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+a, map[string]any{"version": 1, "parentId": z}, c)
	if st != 422 {
		t.Fatalf("parent cycle %d", st)
	}
	b["ownerId"] = "user-from-other-company"
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/tasks", b, c)
	if st != 422 {
		t.Fatalf("foreign owner %d", st)
	}
}
func TestImportIsAtomicAndReportsEveryBadRow(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	a := taskBody(me(t, s, c))
	bad := taskBody("outside")
	empty := taskBody(me(t, s, c))
	empty["title"] = ""
	st, b, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks/import", map[string]any{"rows": []any{a, bad, empty}}, c)
	if st != 422 {
		t.Fatal(st, b)
	}
	errText := fmt.Sprint(b)
	if !strings.Contains(errText, "2") || !strings.Contains(errText, "3") {
		t.Fatalf("missing row errors %v", b)
	}
	var n int64
	db.Model(&Task{}).Count(&n)
	if n != 0 {
		t.Fatalf("partial import: %d", n)
	}
}
func TestConcurrentUpdatesHaveOneWinner(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "title": fmt.Sprintf("Writer %d", i)}, c)
			statuses <- st
		}(i)
	}
	wg.Wait()
	close(statuses)
	sum := 0
	for st := range statuses {
		if st != 200 && st != 409 {
			t.Fatalf("unexpected %d", st)
		}
		sum += st
	}
	if sum != 609 {
		t.Fatalf("both edits accepted: %d", sum)
	}
}
func TestRecurringTasksAndRemindersAreIdempotent(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	b := taskBody(me(t, s, c))
	b["dueDate"] = time.Now().UTC().AddDate(0, 0, -2).Format("2006-01-02")
	b["startDate"] = ""
	b["recurrence"] = "weekly"
	id := createTask(t, s, c, cid, b)
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "status": "done"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	n, _, err := s.RunAutomations(t.Context())
	if err != nil || n != 1 {
		t.Fatalf("first automation %d %v", n, err)
	}
	n, _, err = s.RunAutomations(t.Context())
	if err != nil || n != 0 {
		t.Fatalf("duplicate recurrence %d %v", n, err)
	}
	var count int64
	db.Model(&Task{}).Count(&count)
	if count != 2 {
		t.Fatal(count)
	}
	overdue := taskBody(me(t, s, c))
	overdue["dueDate"] = time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	overdue["startDate"] = ""
	createTask(t, s, c, cid, overdue)
	_, r, err := s.RunAutomations(t.Context())
	if err != nil || r != 1 {
		t.Fatalf("reminder=%d %v", r, err)
	}
	_, r, err = s.RunAutomations(t.Context())
	if err != nil || r != 0 {
		t.Fatalf("duplicate reminder=%d %v", r, err)
	}
}
func TestCrossSiteMutationRejected(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	r := httptest.NewRequest("POST", "/api/auth/logout", nil)
	r.AddCookie(c)
	r.Header.Set("Origin", "https://attacker.invalid")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("CSRF status %d", w.Code)
	}
}

func TestFounderOwnerCannotRemoveRequiredReview(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	reviewer := addPerson(t, s, c, cid, "reviewer@example.com", "admin")
	b := taskBody(me(t, s, c))
	b["reviewerId"] = reviewer
	b["requiresApproval"] = true
	id := createTask(t, s, c, cid, b)
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "requiresApproval": false, "status": "done"}, c)
	if st != 403 {
		t.Fatalf("founder owner bypassed required review: %d", st)
	}
}
func TestHiddenProjectCannotBeExposedByCreatingTask(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := addPerson(t, s, c, cid, "member@example.com", "member")
	st, b, w := req(t, s, "POST", "/api/companies/"+cid+"/projects", map[string]any{"name": "Confidential project", "ownerId": me(t, s, c), "departmentId": "", "description": "Leadership planning", "color": "#F97316", "status": "active", "dueDate": ""}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	body := taskBody(owner)
	body["projectId"] = b["id"]
	mc := login(t, s, "member@example.com")
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/tasks", body, mc)
	if st != 422 {
		t.Fatalf("hidden project reference accepted: %d", st)
	}
}
func TestNewRecurringTaskReminderCreatedInSameRun(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	b := taskBody(me(t, s, c))
	b["recurrence"] = "daily"
	b["dueDate"] = time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	b["startDate"] = ""
	id := createTask(t, s, c, cid, b)
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "status": "done"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	n, r, e := s.RunAutomations(t.Context())
	if e != nil || n != 1 || r != 1 {
		t.Fatalf("first=%d,%d,%v", n, r, e)
	}
	n, r, e = s.RunAutomations(t.Context())
	if e != nil || n != 0 || r != 0 {
		t.Fatalf("second=%d,%d,%v", n, r, e)
	}
}

func TestConcurrentReportingUpdatesCannotCreateCycle(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	a := addPerson(t, s, c, cid, "manager-a@example.com", "manager")
	b := addPerson(t, s, c, cid, "manager-b@example.com", "manager")
	var mu sync.Mutex
	count := 0
	barrier := make(chan struct{})
	err := db.Callback().Query().After("gorm:query").Register("test:reporting_snapshot", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*[]User); ok {
			mu.Lock()
			count++
			if count == 2 {
				close(barrier)
			}
			mu.Unlock()
			select {
			case <-barrier:
			case <-time.After(5 * time.Second):
				panic("snapshot barrier timed out")
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for _, pair := range [][2]string{{a, b}, {b, a}} {
		wg.Add(1)
		go func(p [2]string) {
			defer wg.Done()
			st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+p[0], map[string]any{"managerId": p[1]}, c)
			statuses <- st
		}(pair)
	}
	wg.Wait()
	_ = db.Callback().Query().Remove("test:reporting_snapshot")
	close(statuses)
	sum := 0
	for st := range statuses {
		sum += st
	}
	if sum != 622 {
		t.Fatalf("expected 200 and 422, status sum %d", sum)
	}
}
func TestStaleAdminCannotOverwritePromotedFounder(t *testing.T) {
	s, db := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	target := addPerson(t, s, founder, cid, "target@example.com", "member")
	addPerson(t, s, founder, cid, "admin@example.com", "admin")
	admin := login(t, s, "admin@example.com")
	var mu sync.Mutex
	count := 0
	first := make(chan struct{})
	second := make(chan struct{})
	promoted := make(chan struct{})
	err := db.Callback().Query().After("gorm:query").Register("test:role_snapshot", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*[]User); ok {
			mu.Lock()
			count++
			n := count
			mu.Unlock()
			if n == 1 {
				close(first)
				<-second
			} else if n == 2 {
				close(second)
				<-promoted
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	statuses := make(chan int, 2)
	go func() {
		st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+target, map[string]any{"role": "founder"}, founder)
		statuses <- st
		close(promoted)
	}()
	<-first
	go func() {
		st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+target, map[string]any{"active": false}, admin)
		statuses <- st
	}()
	st1, st2 := <-statuses, <-statuses
	_ = db.Callback().Query().Remove("test:role_snapshot")
	if st1+st2 != 603 {
		t.Fatalf("expected 200 and 403, got %d and %d", st1, st2)
	}
	var m Membership
	if err = db.Where("company_id = ? AND user_id = ?", cid, target).First(&m).Error; err != nil {
		t.Fatal(err)
	}
	if m.Role != "founder" || !m.Active {
		t.Fatalf("stale overwrite: %+v", m)
	}
}

func TestAttachmentsRequireTaskAccessAndSafeContent(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	addPerson(t, s, c, cid, "member@example.com", "member")
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	mc := login(t, s, "member@example.com")
	uploadFile := func(name, contents string) (int, map[string]any) {
		var buf bytes.Buffer
		m := multipart.NewWriter(&buf)
		f, e := m.CreateFormFile("file", name)
		if e != nil {
			t.Fatal(e)
		}
		_, _ = f.Write([]byte(contents))
		_ = m.Close()
		r := httptest.NewRequest("POST", "/api/companies/"+cid+"/tasks/"+id+"/attachments", &buf)
		r.Header.Set("Content-Type", m.FormDataContentType())
		r.AddCookie(c)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		return w.Code, body
	}
	st, _ := uploadFile("danger.html", "<html><script>alert(1)</script></html>")
	if st != 422 {
		t.Fatalf("HTML upload=%d", st)
	}
	st, _ = uploadFile("image.png", "<html>Fake image</html>")
	if st != 422 {
		t.Fatalf("spoofed type=%d", st)
	}
	st, b := uploadFile("../../evidence.txt", "Verified delivery evidence.\n")
	if st != 200 {
		t.Fatal(st, b)
	}
	att := b["id"].(string)
	st, _, w := req(t, s, "GET", "/api/companies/"+cid+"/attachments/"+att, nil, c)
	if st != 200 || w.Body.String() != "Verified delivery evidence.\n" || !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("download %d %s", st, w.Body.String())
	}
	if strings.Contains(w.Header().Get("Content-Disposition"), "../") {
		t.Fatal("unsafe filename")
	}
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/attachments/"+att, nil, mc)
	if st != 404 {
		t.Fatalf("hidden evidence=%d", st)
	}
}
func TestPasswordChangeRevokesOtherSessions(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	other := login(t, s, "founder@example.com")
	st, _, _ := req(t, s, "POST", "/api/auth/password", map[string]any{"currentPassword": "A-strong-password!2026", "newPassword": "New-strong-password!2026"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "GET", "/api/auth/session", nil, other)
	if st != 401 {
		t.Fatalf("other session=%d", st)
	}
	st, _, _ = req(t, s, "GET", "/api/auth/session", nil, c)
	if st != 200 {
		t.Fatalf("current session=%d", st)
	}
	st, _, _ = req(t, s, "POST", "/api/auth/login", map[string]any{"email": "founder@example.com", "password": "A-strong-password!2026"}, nil)
	if st != 401 {
		t.Fatal("old password accepted")
	}
	st, _, _ = req(t, s, "POST", "/api/auth/login", map[string]any{"email": "founder@example.com", "password": "New-strong-password!2026"}, nil)
	if st != 200 {
		t.Fatal("new password rejected")
	}
	var u User
	db.First(&u)
	if u.PasswordHash == "New-strong-password!2026" || !strings.HasPrefix(u.PasswordHash, "pbkdf2-sha256$600000$") {
		t.Fatal("password hash not stored correctly")
	}
}
func TestLoggingTimeAtomicallyIncrementsHoursAndVersion(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	p := "/api/companies/" + cid + "/tasks/" + id
	st, _, _ := req(t, s, "POST", p+"/time", map[string]any{"hours": 25, "date": "2026-10-10", "note": "invalid"}, c)
	if st != 422 {
		t.Fatal(st)
	}
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, _, _ := req(t, s, "POST", p+"/time", map[string]any{"hours": 2.5, "date": "2026-10-10", "note": "Delivery work"}, c)
			statuses <- st
		}()
	}
	wg.Wait()
	close(statuses)
	for st := range statuses {
		if st != 200 {
			t.Fatal(st)
		}
	}
	state := taskState(t, s, c, cid, id)
	if state["actualHours"] != float64(5) || state["version"] != float64(3) || len(state["timeEntries"].([]any)) != 2 {
		t.Fatal(state)
	}
}
func TestRequiredChecklistAndDependenciesGateSubmission(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	reviewer := addPerson(t, s, c, cid, "reviewer@example.com", "admin")
	dep := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	b := taskBody(me(t, s, c))
	b["reviewerId"] = reviewer
	b["requiresApproval"] = true
	b["dependencies"] = []string{dep}
	b["checklist"] = []ChecklistItem{{ID: "check-1", Text: "Verified delivery", Done: false}}
	id := createTask(t, s, c, cid, b)
	path := "/api/companies/" + cid + "/tasks/" + id
	st, _, _ := req(t, s, "PATCH", path, map[string]any{"version": 1, "status": "in_review"}, c)
	if st != 422 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"version": 1, "checklist": []ChecklistItem{{ID: "check-1", Text: "Verified delivery", Done: true}}, "status": "in_review"}, c)
	if st != 422 {
		t.Fatal("unaccepted dependency permitted")
	}
	st, _, _ = req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+dep, map[string]any{"version": 1, "status": "done"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"version": 1, "checklist": []ChecklistItem{{ID: "check-1", Text: "Verified delivery", Done: true}}, "status": "in_review"}, c)
	if st != 200 {
		t.Fatal(st)
	}
}
func TestLastFounderAndExistingAccountPasswordGuards(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/people/"+me(t, s, c), map[string]any{"role": "admin"}, c)
	if st != 422 {
		t.Fatalf("last founder=%d", st)
	}
	uid := addPerson(t, s, c, cid, "member@example.com", "member")
	st, b, _ := req(t, s, "POST", "/api/companies", map[string]any{"name": "Another company", "slug": "another", "timezone": "UTC", "color": "#F97316"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	cid2 := b["id"].(string)
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid2+"/people", map[string]any{"name": "Member", "email": "member@example.com", "password": "Ignored-new-password!2026", "role": "member", "departmentId": "", "managerId": "", "capacityHours": 32}, c)
	if st != 200 {
		t.Fatal(st)
	}
	mc := login(t, s, "member@example.com")
	_, session, _ := req(t, s, "GET", "/api/auth/session", nil, mc)
	if len(session["companies"].([]any)) != 2 {
		t.Fatal(session)
	}
	body := taskBody(uid)
	body["reviewerId"] = uid
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/tasks", body, c)
	if st != 422 {
		t.Fatal("self-reviewer accepted")
	}
}
func TestExplicitDemoFixtureIsConsistentAndIdempotent(t *testing.T) {
	db := testDatabase(t)
	var e error
	if e = SeedDemo(db); e != nil {
		t.Fatal(e)
	}
	if e = SeedDemo(db); e != nil {
		t.Fatal(e)
	}
	var tasks []Task
	if e = db.Preload("TimeEntries").Find(&tasks).Error; e != nil {
		t.Fatal(e)
	}
	if len(tasks) != 44 {
		t.Fatalf("demo task count %d", len(tasks))
	}
	for _, task := range tasks {
		var hours float64
		for _, entry := range task.TimeEntries {
			hours += entry.Hours
		}
		if hours != task.ActualHours {
			t.Fatalf("%s actual hours do not match evidence", task.ID)
		}
	}
	s, e := New(db, Options{})
	if e != nil {
		t.Fatal(e)
	}
	for _, email := range []string{"founder@schach.demo", "ceo@schach.demo", "head@schach.demo", "member@schach.demo"} {
		st, _, w := req(t, s, "POST", "/api/auth/login", map[string]any{"email": email, "password": "SchachDemo!2026"}, nil)
		if st != 200 {
			t.Fatalf("demo login %s: %s", email, w.Body.String())
		}
		cookie := w.Result().Cookies()[0]
		cid := firstCompany(t, s, cookie)
		st, body, _ := req(t, s, "GET", "/api/companies/"+cid+"/workspace", nil, cookie)
		if st != 200 || len(body["tasks"].([]any)) == 0 {
			t.Fatalf("empty demo workspace %s", email)
		}
	}
}

func TestOperatorResetRevokesAllSessionsAndDoesNotCreateUsers(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	if e := ResetPassword(db, "founder@example.com", "Recovered-password!2026"); e != nil {
		t.Fatal(e)
	}
	st, _, _ := req(t, s, "GET", "/api/auth/session", nil, c)
	if st != 401 {
		t.Fatal("reset did not revoke current session")
	}
	st, _, _ = req(t, s, "POST", "/api/auth/login", map[string]any{"email": "founder@example.com", "password": "Recovered-password!2026"}, nil)
	if st != 200 {
		t.Fatal("recovered password rejected")
	}
	if e := ResetPassword(db, "missing@example.com", "Another-password!2026"); e == nil {
		t.Fatal("missing account accepted")
	}
	var count int64
	db.Model(&User{}).Count(&count)
	if count != 1 {
		t.Fatal("reset created a user")
	}
	if e := ResetPassword(db, "founder@example.com", "short"); e == nil {
		t.Fatal("weak reset accepted")
	}
}

func TestAcceptedTaskContentRequiresExplicitReopen(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	path := "/api/companies/" + cid + "/tasks/" + id
	st, _, _ := req(t, s, "PATCH", path, map[string]any{"version": 1, "status": "done"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"version": 2, "title": "Changed after acceptance"}, c)
	if st != 422 {
		t.Fatalf("accepted content mutable: %d", st)
	}
	state := taskState(t, s, c, cid, id)
	if state["title"] != "A concrete delivery" || state["version"] != float64(2) {
		t.Fatal("rejected edit mutated task")
	}
	st, _, _ = req(t, s, "PATCH", path, map[string]any{"version": 2, "status": "in_progress", "title": "Explicitly reopened delivery"}, c)
	if st != 200 {
		t.Fatal("reopen rejected", st)
	}
	state = taskState(t, s, c, cid, id)
	if state["completedAt"] != "" || state["status"] != "in_progress" {
		t.Fatal(state)
	}
}

func TestReadOnlyViewerCannotBeAssignedRequiredReview(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	viewer := addPerson(t, s, c, cid, "reviewer-viewer@example.com", "viewer")
	body := taskBody(me(t, s, c))
	body["reviewerId"] = viewer
	body["requiresApproval"] = true
	st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/tasks", body, c)
	if st != 422 {
		t.Fatalf("read-only reviewer accepted: %d", st)
	}
}

func TestPasswordMinimumCountsUnicodeCharacters(t *testing.T) {
	if e := validatePassword("éééééé"); e == nil {
		t.Fatal("six Unicode characters were accepted as twelve bytes")
	}
	if e := validatePassword("éééééééééééé"); e != nil {
		t.Fatal(e)
	}
}

func TestRevokedAdminCannotRunAutomationWithStaleSnapshot(t *testing.T) {
	s, db := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	adminID := addPerson(t, s, founder, cid, "automation-admin@example.com", "admin")
	admin := login(t, s, "automation-admin@example.com")
	snapshot := make(chan struct{})
	resume := make(chan struct{})
	if e := db.Callback().Query().After("gorm:query").Register("test:automation_snapshot", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*[]User); ok {
			close(snapshot)
			<-resume
		}
	}); e != nil {
		t.Fatal(e)
	}
	result := make(chan int, 1)
	go func() {
		st, _, _ := req(t, s, "POST", "/api/companies/"+cid+"/automations/run", nil, admin)
		result <- st
	}()
	<-snapshot
	if e := db.Model(&Membership{}).Where("company_id = ? AND user_id = ?", cid, adminID).Update("role", "member").Error; e != nil {
		t.Fatal(e)
	}
	close(resume)
	st := <-result
	_ = db.Callback().Query().Remove("test:automation_snapshot")
	if st != 403 {
		t.Fatalf("revoked administrator ran automations: %d", st)
	}
}
