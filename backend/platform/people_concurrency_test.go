package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type peopleBarrierContext struct{}

func waitPeopleLock(t *testing.T, db *gorm.DB, table string) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		var n int64
		if e := db.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ?", "%"+table+"%").Scan(&n).Error; e != nil {
			t.Fatal(e)
		}
		if n > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("expected real database lock wait was not observed")
}
func TestPeopleCallFKPostgres(t *testing.T) {
	for _, first := range []string{"missed", "revocation"} {
		t.Run(first, func(t *testing.T) {
			s, c, cid, owner, uid, mc := conversationFixture(t)
			db := s.db
			if db.Dialector.Name() != "postgres" {
				t.Skip("requires actual PostgreSQL row locks and call FK")
			}
			s.opts.LiveKitURL = "http://127.0.0.1:1"
			s.opts.LiveKitAPIKey = "fictional-key"
			s.opts.LiveKitAPISecret = strings.Repeat("f", 32)
			conv := newConversation(t, s, c, cid, []string{owner, uid}, "group")
			root := "/api/companies/" + cid
			call := financeOK(t, s, "POST", root+"/conversations/"+conv+"/calls", map[string]any{"kind": "audio", "retryKey": "m9-fk"}, mc)["id"].(string)
			device := financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "web", "name": "Fictional race device"}, mc)["id"].(string)
			financeOK(t, s, "POST", root+"/calls/"+call+"/token", map[string]any{"deviceId": device}, mc)
			if e := db.Model(&CommunicationCall{}).Where("id=?", call).Update("created_at", time.Now().Add(-2*time.Minute).UTC().Format(time.RFC3339Nano)).Error; e != nil {
				t.Fatal(e)
			}
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			name := "m9_call_barrier_" + first
			if e := db.Callback().Query().After("gorm:query").Register(name, func(tx *gorm.DB) {
				if tx.Statement.Context.Value(peopleBarrierContext{}) != first || tx.Statement.Table != "communication_calls" {
					return
				}
				lock, ok := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
				if !ok {
					return
				}
				if first == "missed" && lock.Strength != "UPDATE" || first == "revocation" && lock.Strength != "SHARE" {
					return
				}
				once.Do(func() { close(entered); <-release })
			}); e != nil {
				t.Fatal(e)
			}
			defer db.Callback().Query().Remove(name)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			marked := context.WithValue(ctx, peopleBarrierContext{}, first)
			missed := func(ctx context.Context) error { _, e := s.RunMissedCalls(ctx, time.Now().UTC()); return e }
			revoke := func(ctx context.Context) error {
				return ResetPassword(db.WithContext(ctx), "member@example.com", "A-race-reset-password!2026")
			}
			a, b := make(chan error, 1), make(chan error, 1)
			if first == "missed" {
				go func() { a <- missed(marked) }()
			} else {
				go func() { a <- revoke(marked) }()
			}
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("first path failed to acquire call fence")
			}
			if first == "missed" {
				go func() { b <- revoke(ctx) }()
			} else {
				go func() { b <- missed(ctx) }()
			}
			waitPeopleLock(t, db, "communication_calls")
			// The real FK path has no possibility to hold a grant while waiting on call.
			close(release)
			for _, done := range []chan error{a, b} {
				select {
				case e := <-done:
					if e != nil {
						t.Fatal(e)
					}
				case <-ctx.Done():
					t.Fatal("call/revocation paths did not complete")
				}
			}
			var active int64
			db.Model(&CommunicationCallGrant{}).Where("call_id=? AND active=?", call, true).Count(&active)
			if active != 0 {
				t.Fatal("active grant survived")
			}
			var jobs int64
			db.Model(&CommunicationCallJob{}).Where("call_id=? AND operation='RemoveParticipant'", call).Count(&jobs)
			if jobs > 1 {
				t.Fatal("duplicate immutable removal job")
			}
		})
	}
}

func TestFinanceDifferentSessionLockOrderPostgres(t *testing.T) {
	for _, first := range []string{"reader", "logout"} {
		t.Run(first, func(t *testing.T) {
			f := newFinanceFixture(t)
			db := f.db
			if db.Dialector.Name() != "postgres" {
				t.Skip("requires independent PostgreSQL connections")
			}
			expense := f.addExpense(t, 12345, f.cookie)
			job := readyReceiptExtraction(t, f)
			current := login(t, f.s, "founder@example.com")
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			name := "m9_different_session_" + first
			if e := db.Callback().Query().After("gorm:query").Register(name, func(tx *gorm.DB) {
				if tx.Statement.Context.Value(peopleBarrierContext{}) != first || tx.Statement.Table != "users" {
					return
				}
				lock, ok := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
				if !ok {
					return
				}
				if first == "reader" && lock.Strength != "SHARE" || first == "logout" && lock.Strength != "UPDATE" {
					return
				}
				once.Do(func() { close(entered); <-release })
			}); e != nil {
				t.Fatal(e)
			}
			defer db.Callback().Query().Remove(name)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			read := func(ctx context.Context) int {
				r := httptest.NewRequest("GET", f.base()+"/finance/receipt-extractions/"+job, nil).WithContext(ctx)
				r.AddCookie(current)
				w := httptest.NewRecorder()
				f.s.ServeHTTP(w, r)
				return w.Code
			}
			logout := func(ctx context.Context) int {
				r := httptest.NewRequest("POST", "/api/auth/logout", nil).WithContext(ctx)
				r.AddCookie(f.cookie)
				w := httptest.NewRecorder()
				f.s.ServeHTTP(w, r)
				return w.Code
			}
			marked := context.WithValue(ctx, peopleBarrierContext{}, first)
			a, b := make(chan int, 1), make(chan int, 1)
			if first == "reader" {
				go func() { a <- read(marked) }()
			} else {
				go func() { a <- logout(marked) }()
			}
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("first session path never acquired User fence")
			}
			if first == "reader" {
				go func() { b <- logout(ctx) }()
			} else {
				go func() { b <- read(ctx) }()
			}
			waitPeopleLock(t, db, "users")
			close(release)
			got := []int{}
			for _, done := range []chan int{a, b} {
				select {
				case status := <-done:
					got = append(got, status)
				case <-ctx.Done():
					t.Fatal("different-session deadlock")
				}
			}
			if got[0] != 200 || first == "reader" && got[1] != 200 || first == "logout" && got[1] != 404 {
				t.Fatalf("unexpected source linearization statuses: %v", got)
			}
			if st := read(ctx); st != 404 {
				t.Fatalf("ready old-session result survived logout: %d", st)
			}
			st, _, _ := req(t, f.s, "GET", f.base()+"/expenses/"+expense, nil, current)
			if st != 200 {
				t.Fatalf("independent retained expense was lost: %d", st)
			}
		})
	}
}

func TestSessionEpochConcurrentLogin(t *testing.T) {
	for _, barrier := range []string{"sessions", "users"} {
		t.Run(barrier, func(t *testing.T) {
			s, db := testServer(t)
			if db.Dialector.Name() != "postgres" {
				t.Skip("requires independent native PostgreSQL connections")
			}
			founder := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, founder)
			uid := addPerson(t, s, founder, cid, "people-login-race@example.com", "member")
			_ = login(t, s, "people-login-race@example.com")
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			name := "m9_login_union_" + barrier
			db.Callback().Query().After("gorm:query").Register(name, func(tx *gorm.DB) {
				if tx.Statement.Context.Value(peopleBarrierContext{}) != "admin" || tx.Statement.Table != barrier {
					return
				}
				lock, ok := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
				if !ok || lock.Strength != "UPDATE" {
					return
				}
				once.Do(func() { close(entered); <-release })
			})
			defer db.Callback().Query().Remove(name)
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			admin := make(chan int, 1)
			go func() {
				r := httptest.NewRequest("PATCH", "/api/companies/"+cid+"/people/"+uid, strings.NewReader(`{"role":"manager"}`)).WithContext(context.WithValue(ctx, peopleBarrierContext{}, "admin"))
				r.Header.Set("Content-Type", "application/json")
				r.AddCookie(founder)
				w := httptest.NewRecorder()
				s.ServeHTTP(w, r)
				admin <- w.Code
			}()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("administrative capture barrier missing")
			}
			result := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"email":"people-login-race@example.com","password":"A-strong-password!2026"}`)).WithContext(ctx)
				r.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				s.ServeHTTP(w, r)
				result <- w
			}()
			var response *httptest.ResponseRecorder
			if barrier == "sessions" {
				select {
				case response = <-result:
				case <-ctx.Done():
					t.Fatal("captured-union late login blocked before User fence")
				}
			} else {
				waitPeopleLock(t, db, "users")
			}
			close(release)
			select {
			case status := <-admin:
				if status != 200 {
					t.Fatalf("administration status: %d", status)
				}
			case <-ctx.Done():
				t.Fatal("administration did not finish")
			}
			if response == nil {
				select {
				case response = <-result:
				case <-ctx.Done():
					t.Fatal("post-fence login did not finish")
				}
			}
			if response.Code != 200 {
				t.Fatalf("login status: %d", response.Code)
			}
			cookies := response.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatal("login missing cookie")
			}
			want := 401
			if barrier == "users" {
				want = 200
			}
			if st, _, _ := req(t, s, "GET", "/api/auth/session", nil, cookies[0]); st != want {
				t.Fatalf("captured-union epoch status: got %d want %d", st, want)
			}
		})
	}
}

func TestDepartureSourceLockOrderPostgres(t *testing.T) {
	for _, first := range []string{"source", "departure"} {
		t.Run(first, func(t *testing.T) {
			s, db := testServer(t)
			if db.Dialector.Name() != "postgres" {
				t.Skip("independent PostgreSQL row lock schedules required")
			}
			c := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, c)
			base := "/api/companies/" + cid
			target := addPerson(t, s, c, cid, "source-race@example.invalid", "member")
			task := financeOK(t, s, "POST", base+"/tasks", map[string]any{"title": "Reviewed responsibility", "ownerId": target, "status": "todo", "priority": "medium"}, c)["id"].(string)
			p := financeOK(t, s, "POST", base+"/people/"+target+"/departure/preview", map[string]any{"retryKey": "race-preview", "reason": "Reviewed source lock ordering", "replacements": []any{DepartureReplacement{Kind: "task_owner", SourceID: task, ExpectedVersion: 1, Action: "transfer", NewUserID: me(t, s, c)}}}, c)
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			name := "m9_departure_source_" + first
			if e := db.Callback().Query().After("gorm:query").Register(name, func(tx *gorm.DB) {
				if tx.Statement.Context.Value(peopleBarrierContext{}) != first || tx.Statement.Table != "companies" {
					return
				}
				lock, ok := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
				if !ok || lock.Strength != "UPDATE" {
					return
				}
				once.Do(func() { close(entered); <-release })
			}); e != nil {
				t.Fatal(e)
			}
			defer db.Callback().Query().Remove(name)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			marked := context.WithValue(ctx, peopleBarrierContext{}, first)
			call := func(ctx context.Context, method, path string, body any) int {
				raw, _ := json.Marshal(body)
				r := httptest.NewRequest(method, path, bytes.NewReader(raw)).WithContext(ctx)
				r.Header.Set("Content-Type", "application/json")
				r.AddCookie(c)
				w := httptest.NewRecorder()
				s.ServeHTTP(w, r)
				return w.Code
			}
			source := func(ctx context.Context) int {
				return call(ctx, "PATCH", base+"/tasks/"+task, map[string]any{"version": 1, "title": "Separate authorized source edit"})
			}
			depart := func(ctx context.Context) int {
				return call(ctx, "POST", base+"/people/"+target+"/departure/apply", map[string]any{"retryKey": "race-apply", "previewId": p["id"], "expectedPreviewVersion": 1, "confirmCompanyDeparture": true})
			}
			a, b := make(chan int, 1), make(chan int, 1)
			if first == "source" {
				go func() { a <- source(marked) }()
			} else {
				go func() { a <- depart(marked) }()
			}
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("first Company fence not acquired")
			}
			if first == "source" {
				go func() { b <- depart(ctx) }()
			} else {
				go func() { b <- source(ctx) }()
			}
			waitPeopleLock(t, db, "companies")
			close(release)
			statuses := []int{}
			for _, done := range []chan int{a, b} {
				select {
				case status := <-done:
					statuses = append(statuses, status)
				case <-ctx.Done():
					t.Fatal("source/departure failed bounded lock schedule")
				}
			}
			if statuses[0] != 200 || statuses[1] != 409 {
				t.Fatalf("ordered source outcomes %v", statuses)
			}
			var m Membership
			db.First(&m, "company_id=? AND user_id=?", cid, target)
			if m.Active != (first == "source") {
				t.Fatal("partial departure crossed source winner")
			}
		})
	}
}

func TestPeopleTwoCompanyMutualAdministratorsPostgres(t *testing.T) {
	for _, first := range []int{0, 1} {
		t.Run(fmt.Sprint(first), func(t *testing.T) {
			s, db := testServer(t)
			if db.Dialector.Name() != "postgres" {
				t.Skip("native independent row locks")
			}
			founder := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, founder)
			other := financeOK(t, s, "POST", "/api/companies", map[string]any{"name": "Second independent company", "slug": "people-mutual", "timezone": "UTC"}, founder)["id"].(string)
			ids := []string{}
			emails := []string{"mutual-a@example.invalid", "mutual-b@example.invalid"}
			for _, email := range emails {
				ids = append(ids, addPerson(t, s, founder, cid, email, "admin"))
				addPerson(t, s, founder, other, email, "admin")
			}
			cookies := []*http.Cookie{login(t, s, emails[0]), login(t, s, emails[1])}
			companies := []string{cid, other}
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			name := "mutual-company-session-union"
			db.Callback().Query().After("gorm:query").Register(name, func(tx *gorm.DB) {
				if tx.Statement.Context.Value(peopleBarrierContext{}) != "first" || tx.Statement.Table != "sessions" {
					return
				}
				lock, ok := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
				if ok && lock.Strength == "UPDATE" {
					once.Do(func() { close(entered); <-release })
				}
			})
			defer db.Callback().Query().Remove(name)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			change := func(index int, ctx context.Context) int {
				raw, _ := json.Marshal(map[string]any{"role": "manager", "expectedVersion": 1})
				r := httptest.NewRequest("PATCH", "/api/companies/"+companies[index]+"/people/"+ids[1-index], bytes.NewReader(raw)).WithContext(ctx)
				r.Header.Set("Content-Type", "application/json")
				r.AddCookie(cookies[index])
				w := httptest.NewRecorder()
				s.ServeHTTP(w, r)
				return w.Code
			}
			a, b := make(chan int, 1), make(chan int, 1)
			go func() { a <- change(first, context.WithValue(ctx, peopleBarrierContext{}, "first")) }()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("first union not locked")
			}
			go func() { b <- change(1-first, ctx) }()
			waitPeopleLock(t, db, "sessions")
			close(release)
			for i, ch := range []chan int{a, b} {
				select {
				case status := <-ch:
					want := 200
					if i == 1 {
						want = 401
					}
					if status != want {
						t.Fatalf("schedule %d returned%d want%d", i, status, want)
					}
				case <-ctx.Done():
					t.Fatal("mutual company mutation deadlocked")
				}
			}
			var changed int64
			db.Model(&Membership{}).Where("user_id IN ? AND role='manager'", ids).Count(&changed)
			if changed != 1 {
				t.Fatal("revoked actor committed second mutation")
			}
		})
	}
}
