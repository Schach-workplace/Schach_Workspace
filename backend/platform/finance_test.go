package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
)

type financeFixture struct {
	s                                                 *Server
	db                                                *gorm.DB
	cookie                                            *http.Cookie
	cid, uid, department, category, start, end, today string
}

func financeOK(t *testing.T, s *Server, method, path string, body any, c *http.Cookie) map[string]any {
	t.Helper()
	st, result, w := req(t, s, method, path, body, c)
	if st != 200 {
		t.Fatalf("%s %s: %d %s", method, path, st, w.Body.String())
	}
	return result
}

func newFinanceFixture(t *testing.T) financeFixture {
	t.Helper()
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid, uid := firstCompany(t, s, c), me(t, s, c)
	base := "/api/companies/" + cid
	d := financeOK(t, s, "POST", base+"/departments", map[string]any{"name": "Engineering", "headId": "", "color": "#6366F1", "description": ""}, c)["id"].(string)
	cat := financeOK(t, s, "POST", base+"/expense-categories", map[string]any{"name": "Test materials", "color": "#F97316", "receiptRequired": false}, c)["id"].(string)
	today := time.Now().UTC()
	year := today.Year()
	if today.Month() < 4 {
		year--
	}
	start := time.Date(year, 4, 1, 0, 0, 0, 0, time.UTC)
	return financeFixture{s, db, c, cid, uid, d, cat, start.Format("2006-01-02"), start.AddDate(1, 0, -1).Format("2006-01-02"), today.Format("2006-01-02")}
}
func (f financeFixture) base() string { return "/api/companies/" + f.cid }
func (f financeFixture) expense(amount int64) map[string]any {
	return map[string]any{"departmentId": f.department, "categoryId": f.category, "title": "Project materials", "description": "Purchased for approved delivery", "vendor": "Example supplier", "invoiceNumber": "", "expenseDate": f.today, "amountMinor": amount, "taskId": "", "projectId": "", "receiptExceptionReason": ""}
}
func (f financeFixture) addExpense(t *testing.T, amount int64, c *http.Cookie) string {
	t.Helper()
	return financeOK(t, f.s, "POST", f.base()+"/expenses", f.expense(amount), c)["id"].(string)
}
func (f financeFixture) addBudget(t *testing.T, amount int64, status string) string {
	t.Helper()
	return financeOK(t, f.s, "POST", f.base()+"/budgets", map[string]any{"departmentId": f.department, "name": "Annual engineering", "startDate": f.start, "endDate": f.end, "amountMinor": amount, "status": status, "notes": ""}, f.cookie)["id"].(string)
}
func (f financeFixture) person(t *testing.T, email, role, department string) (*http.Cookie, string) {
	t.Helper()
	id := addPerson(t, f.s, f.cookie, f.cid, email, role)
	financeOK(t, f.s, "PATCH", f.base()+"/people/"+id, map[string]any{"departmentId": department}, f.cookie)
	return login(t, f.s, email), id
}
func (f financeFixture) state(t *testing.T, id string, c *http.Cookie) map[string]any {
	t.Helper()
	w := financeOK(t, f.s, "GET", f.base()+"/workspace", nil, c)
	for _, v := range w["expenses"].([]any) {
		e := v.(map[string]any)
		if e["id"] == id {
			return e
		}
	}
	t.Fatalf("expense %s absent from workspace", id)
	return nil
}

func TestFinanceCompanySettingsFreezeAndDefaultCategories(t *testing.T) {
	f := newFinanceFixture(t)
	w := financeOK(t, f.s, "GET", f.base()+"/workspace", nil, f.cookie)
	company := w["company"].(map[string]any)
	if company["currency"] != "INR" || company["fiscalYearStartMonth"] != float64(4) || len(w["expenseCategories"].([]any)) < 8 {
		t.Fatalf("missing finance defaults: %v", company)
	}
	financeOK(t, f.s, "PATCH", f.base(), map[string]any{"currency": "USD", "fiscalYearStartMonth": 4}, f.cookie)
	f.addBudget(t, 10000, "draft")
	for _, b := range []map[string]any{{"currency": "EUR"}, {"fiscalYearStartMonth": 1}} {
		if st, _, _ := req(t, f.s, "PATCH", f.base(), b, f.cookie); st != 422 {
			t.Fatalf("financial setting mutation after first budget accepted: %d", st)
		}
	}
}

func TestFinanceBudgetFiscalOverlapAndControlledRevisions(t *testing.T) {
	f := newFinanceFixture(t)
	id := f.addBudget(t, 10000, "draft")
	path := f.base() + "/budgets/" + id
	if st, _, _ := req(t, f.s, "POST", f.base()+"/budgets", map[string]any{"departmentId": f.department, "name": "Overlap", "startDate": f.start, "endDate": f.end, "amountMinor": 1, "status": "active"}, f.cookie); st != 422 {
		t.Fatalf("overlapping draft ignored: %d", st)
	}
	financeOK(t, f.s, "PATCH", path, map[string]any{"version": 1, "status": "active"}, f.cookie)
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 2, "amountMinor": 15000}, f.cookie); st != 422 {
		t.Fatalf("active amount revised without reason: %d", st)
	}
	financeOK(t, f.s, "PATCH", path, map[string]any{"version": 2, "amountMinor": 15000, "reason": "Additional approved delivery scope"}, f.cookie)
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 2, "notes": "stale"}, f.cookie); st != 409 {
		t.Fatalf("stale budget overwrite: %d", st)
	}
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 3, "status": "draft", "reason": "Revert allocation to draft state"}, f.cookie); st != 422 {
		t.Fatalf("active reverted to draft: %d", st)
	}
	financeOK(t, f.s, "PATCH", path, map[string]any{"version": 3, "status": "closed", "reason": "Financial period has been reviewed"}, f.cookie)
	financeOK(t, f.s, "PATCH", path, map[string]any{"version": 4, "status": "active", "reason": "Reopen for a documented correction"}, f.cookie)
	start, _ := time.Parse("2006-01-02", f.start)
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 5, "endDate": start.AddDate(1, 0, 0).Format("2006-01-02"), "reason": "Attempt to span two financial years"}, f.cookie); st != 422 {
		t.Fatalf("cross fiscal year accepted: %d", st)
	}
}

func TestFinanceAmountsCategoriesAndDuplicateInvoices(t *testing.T) {
	f := newFinanceFixture(t)
	for _, amount := range []any{0, -1, 1.5, int64(1000000000001)} {
		b := f.expense(1)
		b["amountMinor"] = amount
		if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", b, f.cookie); st != 422 {
			t.Fatalf("invalid amount %v accepted: %d", amount, st)
		}
	}
	b := f.expense(1000000000000)
	b["vendor"] = " ACME   Tools "
	b["invoiceNumber"] = " Inv  100 "
	id := financeOK(t, f.s, "POST", f.base()+"/expenses", b, f.cookie)["id"].(string)
	b["vendor"], b["invoiceNumber"] = "acme tools", "inv 100"
	if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", b, f.cookie); st != 422 {
		t.Fatalf("normalized invoice duplicated: %d", st)
	}
	financeOK(t, f.s, "POST", f.base()+"/expenses/"+id+"/transition", map[string]any{"version": 1, "action": "void", "note": "Entered against the wrong vendor"}, f.cookie)
	financeOK(t, f.s, "POST", f.base()+"/expenses", b, f.cookie)
	financeOK(t, f.s, "PATCH", f.base()+"/expense-categories/"+f.category, map[string]any{"version": 1, "active": false}, f.cookie)
	if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", f.expense(100), f.cookie); st != 422 {
		t.Fatalf("archived category accepted: %d", st)
	}
}

func TestFinanceIndependentApprovalPaymentAndFinalFields(t *testing.T) {
	f := newFinanceFixture(t)
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	f.addBudget(t, 10000, "active")
	id := f.addExpense(t, 1200, f.cookie)
	path := f.base() + "/expenses/" + id
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 1, "title": "Not my draft"}, finance); st != 403 {
		t.Fatalf("noncreator edited draft: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "approve"}, f.cookie); st != 403 {
		t.Fatalf("creator approved own expense: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "approve"}, finance)
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "reject", "note": "Invoice detail needs correcting"}, finance); st != 409 {
		t.Fatalf("stale decision accepted: %d", st)
	}
	payment := map[string]any{"version": 3, "action": "pay", "paidDate": f.today, "paymentMethod": "bank_transfer", "paymentReference": "BANK-0042"}
	if st, _, _ := req(t, f.s, "POST", path+"/transition", payment, f.cookie); st != 403 {
		t.Fatalf("creator recorded own payment: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", payment, finance)
	state := f.state(t, id, f.cookie)
	if state["status"] != "paid" || state["amountMinor"] != float64(1200) || state["paidBy"] == f.uid {
		t.Fatalf("bad paid state: %v", state)
	}
	for _, body := range []map[string]any{{"version": 4, "amountMinor": 1}, {"version": 4, "status": "draft"}, {"version": 4, "createdBy": "another-user"}} {
		if st, _, _ := req(t, f.s, "PATCH", path, body, f.cookie); st == 200 {
			t.Fatal("final/immutable expense fields changed")
		}
	}
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 4, "action": "void", "note": "Attempting to reverse final payment"}, finance); st != 422 {
		t.Fatalf("paid voided: %d", st)
	}
}

func TestFinanceReceiptExceptionAndPolicyRecheck(t *testing.T) {
	f := newFinanceFixture(t)
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	f.addBudget(t, 10000, "active")
	financeOK(t, f.s, "PATCH", f.base()+"/expense-categories/"+f.category, map[string]any{"version": 1, "receiptRequired": true}, f.cookie)
	id := f.addExpense(t, 1200, f.cookie)
	path := f.base() + "/expenses/" + id
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie); st != 422 {
		t.Fatalf("required receipt bypassed: %d", st)
	}
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 1, "receiptExceptionReason": "十二三四"}, f.cookie); st != 422 {
		t.Fatalf("Unicode reason counted as bytes: %d", st)
	}
	financeOK(t, f.s, "PATCH", path, map[string]any{"version": 1, "receiptExceptionReason": "Original invoice destroyed in transit"}, f.cookie)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "submit"}, f.cookie)
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 3, "action": "approve"}, finance); st != 422 {
		t.Fatalf("exception approved without independent note: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 3, "action": "approve", "note": "I verified the supplier replacement record"}, finance)
	financeOK(t, f.s, "PATCH", f.base()+"/expense-categories/"+f.category, map[string]any{"version": 2, "receiptRequired": false}, f.cookie)
	second := f.addExpense(t, 100, f.cookie)
	other := f.base() + "/expenses/" + second
	financeOK(t, f.s, "POST", other+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	financeOK(t, f.s, "PATCH", f.base()+"/expense-categories/"+f.category, map[string]any{"version": 3, "receiptRequired": true}, f.cookie)
	if st, _, _ := req(t, f.s, "POST", other+"/transition", map[string]any{"version": 2, "action": "approve"}, finance); st != 422 {
		t.Fatalf("changed receipt requirement ignored at approval: %d", st)
	}
}

func TestFinanceCapacityConcurrencyAndExplicitOverride(t *testing.T) {
	f := newFinanceFixture(t)
	head, _ := f.person(t, "head@example.com", "head", f.department)
	f.addBudget(t, 10000, "active")
	ids := []string{f.addExpense(t, 6000, f.cookie), f.addExpense(t, 6000, f.cookie)}
	for _, id := range ids {
		financeOK(t, f.s, "POST", f.base()+"/expenses/"+id+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	}
	results := make(chan int, 2)
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			st, _, _ := req(t, f.s, "POST", f.base()+"/expenses/"+id+"/transition", map[string]any{"version": 2, "action": "approve"}, head)
			results <- st
		}(id)
	}
	wg.Wait()
	close(results)
	successes, deniedCount := 0, 0
	for st := range results {
		if st == 200 {
			successes++
		} else if st == 422 {
			deniedCount++
		} else {
			t.Fatalf("unexpected concurrent approval status %d", st)
		}
	}
	if successes != 1 || deniedCount != 1 {
		t.Fatalf("budget capacity overcommitted: success %d rejected %d", successes, deniedCount)
	}
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	for _, id := range ids {
		if f.state(t, id, f.cookie)["status"] == "submitted" {
			if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses/"+id+"/transition", map[string]any{"version": 2, "action": "approve", "overrideReason": "Leadership authorised an additional allocation"}, head); st != 403 {
				t.Fatalf("head budget override accepted: %d", st)
			}
			financeOK(t, f.s, "POST", f.base()+"/expenses/"+id+"/transition", map[string]any{"version": 2, "action": "approve", "overrideReason": "Urgent approved work exceeds current allocation"}, finance)
		}
	}
}

func TestFinanceScopeAndHiddenWorkReferences(t *testing.T) {
	f := newFinanceFixture(t)
	member, memberID := f.person(t, "member@example.com", "member", f.department)
	head, _ := f.person(t, "head@example.com", "head", f.department)
	viewer, _ := f.person(t, "viewer@example.com", "viewer", "")
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	f.addBudget(t, 10000, "active")
	own := f.addExpense(t, 100, member)
	f.addExpense(t, 200, f.cookie)
	for _, test := range []struct {
		c                 *http.Cookie
		scope             string
		expenses, budgets int
	}{{member, "personal", 1, 0}, {head, "department", 2, 1}, {finance, "company", 2, 1}, {viewer, "none", 0, 0}} {
		w := financeOK(t, f.s, "GET", f.base()+"/workspace", nil, test.c)
		if w["financeScope"] != test.scope || len(w["expenses"].([]any)) != test.expenses || len(w["budgets"].([]any)) != test.budgets {
			t.Fatalf("incorrect %s finance scope", test.scope)
		}
		if test.scope == "none" && (len(w["expenseCategories"].([]any)) > 0 || len(w["financeEvents"].([]any)) > 0) {
			t.Fatal("viewer received finance data")
		}
		if test.scope == "personal" {
			for _, raw := range w["financeEvents"].([]any) {
				ev := raw.(map[string]any)
				if ev["entityType"] != "expense" || ev["entityId"] != own {
					t.Fatalf("personal audit scope leaked: %v", ev)
				}
			}
		}
	}
	if st, _, _ := req(t, f.s, "POST", f.base()+"/departments", map[string]any{"name": "unauthorized"}, finance); st != 403 {
		t.Fatalf("finance acquired company admin: %d", st)
	}
	task := taskBody(f.uid)
	task["departmentId"] = f.department
	hidden := createTask(t, f.s, f.cookie, f.cid, task)
	b := f.expense(100)
	b["taskId"] = hidden
	if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", b, member); st != 422 {
		t.Fatalf("expense manufactured access to hidden task: %d", st)
	}
	// A link written while visible must be removed after task visibility changes.
	b["taskId"] = ""
	b["title"] = "Linked materials"
	task["ownerId"] = memberID
	visible := createTask(t, f.s, f.cookie, f.cid, task)
	b["taskId"] = visible
	id := financeOK(t, f.s, "POST", f.base()+"/expenses", b, member)["id"].(string)
	financeOK(t, f.s, "PATCH", f.base()+"/tasks/"+visible, map[string]any{"version": 1, "ownerId": f.uid}, f.cookie)
	if f.state(t, id, member)["taskId"] != "" {
		t.Fatal("hidden task reference leaked through owned expense")
	}
}

func TestFinanceTenantReferencesAndCreatorImmutability(t *testing.T) {
	f := newFinanceFixture(t)
	other := financeOK(t, f.s, "POST", "/api/companies", map[string]any{"name": "Other company", "slug": "other-company", "timezone": "UTC", "color": "#6366F1"}, f.cookie)["id"].(string)
	base := "/api/companies/" + other
	dep := financeOK(t, f.s, "POST", base+"/departments", map[string]any{"name": "Foreign", "color": "#6366F1"}, f.cookie)["id"].(string)
	cat := financeOK(t, f.s, "POST", base+"/expense-categories", map[string]any{"name": "Foreign", "color": "#6366F1"}, f.cookie)["id"].(string)
	for key, value := range map[string]string{"departmentId": dep, "categoryId": cat, "createdBy": f.uid, "status": "paid", "currency": "USD"} {
		b := f.expense(100)
		b[key] = value
		if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", b, f.cookie); st != 422 {
			t.Fatalf("invalid %s accepted: %d", key, st)
		}
	}
	id := f.addExpense(t, 100, f.cookie)
	if st, _, _ := req(t, f.s, "PATCH", base+"/expenses/"+id, map[string]any{"version": 1, "title": "cross tenant"}, f.cookie); st != 404 {
		t.Fatalf("cross tenant expense found: %d", st)
	}
}

func TestFinanceAuditDoesNotLeakHiddenWorkLinks(t *testing.T) {
	f := newFinanceFixture(t)
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	project := financeOK(t, f.s, "POST", f.base()+"/projects", map[string]any{"name": "Private project", "ownerId": f.uid, "departmentId": f.department, "color": "#6366F1", "status": "active"}, f.cookie)["id"].(string)
	body := taskBody(f.uid)
	body["departmentId"] = f.department
	body["projectId"] = project
	task := createTask(t, f.s, f.cookie, f.cid, body)
	id := f.addExpense(t, 100, f.cookie)
	financeOK(t, f.s, "PATCH", f.base()+"/expenses/"+id, map[string]any{"version": 1, "taskId": task, "projectId": project}, f.cookie)
	w := financeOK(t, f.s, "GET", f.base()+"/workspace", nil, finance)
	for _, raw := range w["financeEvents"].([]any) {
		detail := raw.(map[string]any)["detail"].(string)
		if strings.Contains(detail, task) || strings.Contains(detail, project) {
			t.Fatalf("private work identifier in finance event: %s", detail)
		}
	}
}

func financeUpload(t *testing.T, s *Server, path, name, content string, c *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	f, e := m.CreateFormFile("file", name)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.Write([]byte(content)); e != nil {
		t.Fatal(e)
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest("POST", path, &b)
	r.Header.Set("Content-Type", m.FormDataContentType())
	r.AddCookie(c)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestFinanceReceiptsAuthorizationAndStaleDecision(t *testing.T) {
	f := newFinanceFixture(t)
	member, _ := f.person(t, "member@example.com", "member", f.department)
	stranger, _ := f.person(t, "stranger@example.com", "member", f.department)
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	f.addBudget(t, 10000, "active")
	id := f.addExpense(t, 100, member)
	path := f.base() + "/expenses/" + id
	if w := financeUpload(t, f.s, path+"/receipts", "invoice.txt", "Invoice evidence", stranger); w.Code != 404 {
		t.Fatalf("unrelated member uploaded receipt: %d", w.Code)
	}
	if w := financeUpload(t, f.s, path+"/receipts", "invoice.html", "<html>unsafe</html>", member); w.Code != 422 {
		t.Fatalf("unsafe receipt accepted: %d", w.Code)
	}
	if w := financeUpload(t, f.s, path+"/receipts", "invoice.txt", "Invoice evidence", member); w.Code != 200 {
		t.Fatalf("receipt upload failed: %d %s", w.Code, w.Body.String())
	}
	state := f.state(t, id, member)
	if state["version"] != float64(2) {
		t.Fatal("receipt failed to advance version")
	}
	receipt := state["receipts"].([]any)[0].(map[string]any)["id"].(string)
	if st, _, _ := req(t, f.s, "GET", f.base()+"/expense-receipts/"+receipt, nil, stranger); st != 404 {
		t.Fatalf("private receipt leaked: %d", st)
	}
	if st, _, w := req(t, f.s, "GET", f.base()+"/expense-receipts/"+receipt, nil, finance); st != 200 || w.Body.String() != "Invoice evidence" || !strings.Contains(w.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("receipt download invalid: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "submit"}, member)
	if w := financeUpload(t, f.s, path+"/receipts", "extra.txt", "Additional evidence", finance); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 3, "action": "approve"}, finance); st != 409 {
		t.Fatalf("approval ignored later evidence: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 4, "action": "approve"}, finance)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 5, "action": "pay", "paidDate": f.today, "paymentMethod": "cash", "paymentReference": "VOUCHER-11"}, finance)
	if w := financeUpload(t, f.s, path+"/receipts", "late.txt", "Late payment evidence", member); w.Code != 200 {
		t.Fatalf("late append-only evidence failed: %d", w.Code)
	}
	if state = f.state(t, id, member); state["status"] != "paid" || state["amountMinor"] != float64(100) || state["version"] != float64(7) {
		t.Fatalf("late receipt changed final financial state: %v", state)
	}
}

func TestFinanceRejectedWithdrawalVoidingAndPaymentDates(t *testing.T) {
	f := newFinanceFixture(t)
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	f.addBudget(t, 10000, "active")
	id := f.addExpense(t, 100, f.cookie)
	path := f.base() + "/expenses/" + id
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 2, "amountMinor": 1}, f.cookie); st != 422 {
		t.Fatalf("submitted amount mutable: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "withdraw"}, f.cookie)
	financeOK(t, f.s, "PATCH", path, map[string]any{"version": 3, "amountMinor": 150}, f.cookie)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 4, "action": "submit"}, f.cookie)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 5, "action": "reject", "note": "Supplier details need correction"}, finance)
	financeOK(t, f.s, "PATCH", path, map[string]any{"version": 6, "vendor": "Correct supplier"}, f.cookie)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 7, "action": "submit"}, f.cookie)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 8, "action": "approve"}, finance)
	today, _ := time.Parse("2006-01-02", f.today)
	for _, date := range []string{today.AddDate(0, 0, -1).Format("2006-01-02"), today.AddDate(0, 0, 1).Format("2006-01-02"), "2026-02-30", ""} {
		if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 9, "action": "pay", "paidDate": date, "paymentMethod": "card", "paymentReference": "CARD-1"}, finance); st != 422 {
			t.Fatalf("invalid payment date %s accepted: %d", date, st)
		}
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 9, "action": "void", "note": "Order cancelled before any payment"}, finance)
	if state := f.state(t, id, f.cookie); state["status"] != "void" || state["amountMinor"] != float64(150) {
		t.Fatalf("void failed to preserve historical amount: %v", state)
	}
}

func TestRecurrenceSkipsReviewerWhoBecameViewer(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := me(t, s, c)
	reviewerID := addPerson(t, s, c, cid, "reviewer@example.com", "member")
	reviewer := login(t, s, "reviewer@example.com")
	b := taskBody(owner)
	b["reviewerId"] = reviewerID
	b["requiresApproval"] = true
	b["recurrence"] = "daily"
	b["dueDate"] = time.Now().UTC().Format("2006-01-02")
	id := createTask(t, s, c, cid, b)
	path := "/api/companies/" + cid + "/tasks/" + id
	financeOK(t, s, "PATCH", path, map[string]any{"version": 1, "status": "in_review"}, c)
	financeOK(t, s, "POST", path+"/review", map[string]any{"version": 2, "decision": "approve"}, reviewer)
	financeOK(t, s, "PATCH", "/api/companies/"+cid+"/people/"+reviewerID, map[string]any{"role": "viewer"}, c)
	for i := 0; i < 2; i++ {
		created, _, err := s.RunAutomations(context.Background())
		if err != nil || created != 0 {
			t.Fatalf("invalid reviewer recurrence cloned: %d %v", created, err)
		}
	}
	var events int64
	if e := db.Model(&Activity{}).Where("company_id = ? AND task_id = ? AND action = ?", cid, id, "recurrence_blocked").Count(&events).Error; e != nil {
		t.Fatal(e)
	}
	if events != 1 {
		t.Fatalf("expected one actionable blocked-recurrence audit event, got %d", events)
	}
	var notifications []Notification
	if e := db.Where("company_id = ? AND task_id = ? AND kind = ?", cid, id, "automation").Find(&notifications).Error; e != nil {
		t.Fatal(e)
	}
	if len(notifications) == 0 || !strings.Contains(strings.ToLower(fmt.Sprint(notifications)), "reviewer") {
		t.Fatal("missing actionable recurrence reviewer notification")
	}
}

func TestFinanceConcurrentBudgetsCannotOverlap(t *testing.T) {
	f := newFinanceFixture(t)
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			st, _, _ := req(t, f.s, "POST", f.base()+"/budgets", map[string]any{"departmentId": f.department, "name": fmt.Sprintf("Concurrent %d", i), "startDate": f.start, "endDate": f.end, "amountMinor": 100, "status": "draft"}, f.cookie)
			statuses <- st
		}(i)
	}
	wg.Wait()
	close(statuses)
	successes, overlaps := 0, 0
	for status := range statuses {
		if status == 200 {
			successes++
		} else if status == 422 {
			overlaps++
		} else {
			t.Fatalf("unexpected concurrent budget status %d", status)
		}
	}
	if successes != 1 || overlaps != 1 {
		t.Fatalf("overlapping envelopes committed: %d successes, %d overlap rejections", successes, overlaps)
	}
}

func TestFinancePaidExpenseConsumesBudgetExactlyOnce(t *testing.T) {
	f := newFinanceFixture(t)
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	head, _ := f.person(t, "head@example.com", "head", f.department)
	f.addBudget(t, 10000, "active")
	first := f.addExpense(t, 6000, f.cookie)
	path := f.base() + "/expenses/" + first + "/transition"
	financeOK(t, f.s, "POST", path, map[string]any{"version": 1, "action": "submit"}, f.cookie)
	financeOK(t, f.s, "POST", path, map[string]any{"version": 2, "action": "approve"}, head)
	financeOK(t, f.s, "POST", path, map[string]any{"version": 3, "action": "pay", "paidDate": f.today, "paymentMethod": "bank_transfer", "paymentReference": "BANK-1"}, finance)
	second := f.addExpense(t, 4000, f.cookie)
	path = f.base() + "/expenses/" + second + "/transition"
	financeOK(t, f.s, "POST", path, map[string]any{"version": 1, "action": "submit"}, f.cookie)
	financeOK(t, f.s, "POST", path, map[string]any{"version": 2, "action": "approve"}, head)
	third := f.addExpense(t, 1, f.cookie)
	path = f.base() + "/expenses/" + third + "/transition"
	financeOK(t, f.s, "POST", path, map[string]any{"version": 1, "action": "submit"}, f.cookie)
	if st, _, _ := req(t, f.s, "POST", path, map[string]any{"version": 2, "action": "approve"}, head); st != 422 {
		t.Fatalf("paid expense released budget allocation: %d", st)
	}
}

func TestFinanceRevokedAuthorityCannotApproveWithStaleSnapshot(t *testing.T) {
	f := newFinanceFixture(t)
	finance, uid := f.person(t, "finance@example.com", "finance", "")
	f.addBudget(t, 10000, "active")
	id := f.addExpense(t, 100, f.cookie)
	path := f.base() + "/expenses/" + id + "/transition"
	financeOK(t, f.s, "POST", path, map[string]any{"version": 1, "action": "submit"}, f.cookie)
	snapshot, resume := make(chan struct{}), make(chan struct{})
	var signal sync.Once
	if err := f.db.Callback().Query().After("gorm:query").Register("test:finance_snapshot", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*[]User); ok {
			signal.Do(func() { close(snapshot); <-resume })
		}
	}); err != nil {
		t.Fatal(err)
	}
	result := make(chan int, 1)
	go func() {
		st, _, _ := req(t, f.s, "POST", path, map[string]any{"version": 2, "action": "approve"}, finance)
		result <- st
	}()
	<-snapshot
	if err := f.db.Model(&Membership{}).Where("company_id = ? AND user_id = ?", f.cid, uid).Update("role", "member").Error; err != nil {
		t.Fatal(err)
	}
	close(resume)
	st := <-result
	_ = f.db.Callback().Query().Remove("test:finance_snapshot")
	if st != 403 && st != 404 {
		t.Fatalf("revoked finance authority approved: %d", st)
	}
	if state := f.state(t, id, f.cookie); state["status"] != "submitted" || state["version"] != float64(2) {
		t.Fatal("revoked decision changed expense")
	}
}

func TestFinanceAndTaskHistoriesScopeBeforeRecentLimit(t *testing.T) {
	f := newFinanceFixture(t)
	member, uid := f.person(t, "member@example.com", "member", f.department)
	own := f.addExpense(t, 100, member)
	other := f.addExpense(t, 200, f.cookie)
	body := taskBody(uid)
	body["departmentId"] = f.department
	task := createTask(t, f.s, f.cookie, f.cid, body)
	privateTask := createTask(t, f.s, f.cookie, f.cid, taskBody(f.uid))
	events := make([]FinanceEvent, 1001)
	activities := make([]Activity, 1001)
	for i := range events {
		events[i] = FinanceEvent{ID: fmt.Sprintf("other-finance-%04d", i), CompanyID: f.cid, DepartmentID: f.department, EntityType: "expense", EntityID: other, UserID: f.uid, Action: "fixture", CreatedAt: "2200-01-01T00:00:00Z"}
		activities[i] = Activity{ID: fmt.Sprintf("other-task-%04d", i), CompanyID: f.cid, TaskID: privateTask, UserID: f.uid, Action: "fixture", CreatedAt: "2200-01-01T00:00:00Z"}
	}
	if err := f.db.CreateInBatches(events, 100).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.CreateInBatches(activities, 100).Error; err != nil {
		t.Fatal(err)
	}
	w := financeOK(t, f.s, "GET", f.base()+"/workspace", nil, member)
	financeFound, taskFound := false, false
	for _, raw := range w["financeEvents"].([]any) {
		if raw.(map[string]any)["entityId"] == own {
			financeFound = true
		}
	}
	for _, raw := range w["activities"].([]any) {
		if raw.(map[string]any)["taskId"] == task {
			taskFound = true
		}
	}
	if !financeFound || !taskFound {
		t.Fatalf("unrelated events hid accessible history: finance=%v task=%v", financeFound, taskFound)
	}
}

func TestDemoFinancePersistsRealReceiptBytesAndValidBudgetPeriods(t *testing.T) {
	db := testDatabase(t)
	if err := SeedDemo(db); err != nil {
		t.Fatal(err)
	}
	var budgets []Budget
	if err := db.Find(&budgets).Error; err != nil {
		t.Fatal(err)
	}
	var expenses []Expense
	if err := db.Find(&expenses).Error; err != nil {
		t.Fatal(err)
	}
	var receipts []ExpenseReceipt
	if err := db.Find(&receipts).Error; err != nil {
		t.Fatal(err)
	}
	if len(budgets) == 0 || len(expenses) == 0 || len(receipts) == 0 {
		t.Fatal("demo finance budgets, expenses and real receipt bytes are missing")
	}
	fixtureBytes, err := fixtures.ReadFile("sample.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		ReceiptContents map[string]string `json:"receiptContents"`
	}
	if err = json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(receipts) != len(fixture.ReceiptContents) {
		t.Fatal("demo receipt count does not match supplied byte records")
	}
	for _, receipt := range receipts {
		if len(receipt.Data) == 0 || receipt.Size != int64(len(receipt.Data)) || string(receipt.Data) != fixture.ReceiptContents[receipt.ID] {
			t.Fatalf("receipt %s has no matching bytes", receipt.ID)
		}
	}
	for _, budget := range budgets {
		var c Company
		if err := db.First(&c, "id = ?", budget.CompanyID).Error; err != nil {
			t.Fatal(err)
		}
		if fiscalYear(budget.StartDate, c.FiscalYearStartMonth) != fiscalYear(budget.EndDate, c.FiscalYearStartMonth) {
			t.Fatalf("shifted demo budget spans two financial years: %+v", budget)
		}
	}
}

func TestSeedBudgetPeriodsFollowCompanyFinancialYears(t *testing.T) {
	anchor, _ := time.Parse("2006-01-02", "2026-10-10")
	for _, test := range []struct{ today, start, end string }{
		{"2027-03-31T12:00:00Z", "2026-04-01", "2027-03-31"},
		{"2027-04-01T12:00:00Z", "2027-04-01", "2028-03-31"},
		{"2030-02-01T12:00:00Z", "2029-04-01", "2030-03-31"},
		// India is already in the next financial year at this UTC instant.
		{"2027-03-31T20:00:00Z", "2027-04-01", "2028-03-31"},
	} {
		t.Run(test.today, func(t *testing.T) {
			budget := map[string]any{"startDate": "2026-04-01", "endDate": "2027-03-31"}
			fixture := map[string]any{"workspaces": []any{map[string]any{"company": map[string]any{"timezone": "Asia/Kolkata", "fiscalYearStartMonth": float64(4)}, "budgets": []any{budget}}}}
			today, err := time.Parse(time.RFC3339, test.today)
			if err != nil {
				t.Fatal(err)
			}
			if err = shiftSeedBudgetPeriods(fixture, anchor, today); err != nil {
				t.Fatal(err)
			}
			if budget["startDate"] != test.start || budget["endDate"] != test.end {
				t.Fatalf("budget shifted outside whole fiscal year: %v", budget)
			}
		})
	}
}

func TestFinanceRejectsFutureExpenseDatesAtEveryDecisionBoundary(t *testing.T) {
	f := newFinanceFixture(t)
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	f.addBudget(t, 10000, "active")
	today, _ := time.Parse("2006-01-02", f.today)
	future := today.AddDate(0, 0, 1).Format("2006-01-02")
	body := f.expense(100)
	body["expenseDate"] = future
	if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", body, f.cookie); st != 422 {
		t.Fatalf("future expense created: %d", st)
	}
	id := f.addExpense(t, 100, f.cookie)
	path := f.base() + "/expenses/" + id
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 1, "expenseDate": future}, f.cookie); st != 422 {
		t.Fatalf("expense moved into future: %d", st)
	}
	// Simulate historical data whose date is future under the current company
	// timezone, proving both workflow boundaries revalidate persisted values.
	if err := f.db.Model(&Expense{}).Where("id = ?", id).UpdateColumn("expense_date", future).Error; err != nil {
		t.Fatal(err)
	}
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie); st != 422 {
		t.Fatalf("future persisted expense submitted: %d", st)
	}
	if err := f.db.Model(&Expense{}).Where("id = ?", id).UpdateColumn("expense_date", f.today).Error; err != nil {
		t.Fatal(err)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	if err := f.db.Model(&Expense{}).Where("id = ?", id).UpdateColumn("expense_date", future).Error; err != nil {
		t.Fatal(err)
	}
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "approve"}, finance); st != 422 {
		t.Fatalf("future persisted expense approved: %d", st)
	}
}

func TestFinanceTextLimitsCountUnicodeCharacters(t *testing.T) {
	f := newFinanceFixture(t)
	finance, _ := f.person(t, "finance@example.com", "finance", "")
	category := financeOK(t, f.s, "POST", f.base()+"/expense-categories", map[string]any{"name": strings.Repeat("क", 120), "color": "#6366F1", "receiptRequired": false}, f.cookie)["id"].(string)
	budget := f.addBudget(t, 10000, "active")
	reason := strings.Repeat("क", 4000)
	financeOK(t, f.s, "PATCH", f.base()+"/budgets/"+budget, map[string]any{"version": 1, "name": strings.Repeat("क", 160), "notes": reason, "amountMinor": 11000, "reason": reason}, f.cookie)
	body := f.expense(100)
	body["categoryId"] = category
	body["title"] = strings.Repeat("क", 240)
	body["description"] = strings.Repeat("क", 8000)
	body["vendor"] = strings.Repeat("क", 240)
	body["invoiceNumber"] = strings.Repeat("क", 160)
	body["receiptExceptionReason"] = reason
	id := financeOK(t, f.s, "POST", f.base()+"/expenses", body, f.cookie)["id"].(string)
	path := f.base() + "/expenses/" + id
	if st, _, _ := req(t, f.s, "PATCH", path, map[string]any{"version": 1, "title": strings.Repeat("क", 241)}, f.cookie); st != 422 {
		t.Fatalf("overlong Unicode title accepted: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	if st, _, _ := req(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "approve", "note": strings.Repeat("क", 4001)}, finance); st != 422 {
		t.Fatalf("overlong Unicode note accepted: %d", st)
	}
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "approve", "note": reason}, finance)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 3, "action": "pay", "paidDate": f.today, "paymentMethod": "other", "paymentReference": strings.Repeat("क", 240)}, finance)
}
