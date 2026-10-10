package platform

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
)

func reportTasks(t *testing.T, s *Server, c *http.Cookie, cid string, filters string) (int, map[string]any) {
	t.Helper()
	status, b, _ := req(t, s, "GET", "/api/companies/"+cid+"/reports/tasks?"+filters, nil, c)
	return status, b
}
func TestTaskReportScopeAndProjection(t *testing.T) {
	s, db := testServer(t)
	founder := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, founder)
	uid := addPerson(t, s, founder, cid, "report-member@example.com", "member")
	member := login(t, s, "report-member@example.com")
	hidden := createTask(t, s, founder, cid, taskBody(me(t, s, founder)))
	own := createTask(t, s, founder, cid, taskBody(uid))
	shared := createTask(t, s, founder, cid, taskBody(me(t, s, founder)))
	collaborators, _ := json.Marshal([]string{uid})
	if e := db.Model(&Task{}).Where("id=?", shared).Update("collaborators", string(collaborators)).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Model(&Task{}).Where("id=?", own).Update("parent_id", hidden).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Create(&Comment{ID: newID("comment"), TaskID: own, CompanyID: cid, UserID: uid, Body: "Private nested payload"}).Error; e != nil {
		t.Fatal(e)
	}
	status, b := reportTasks(t, s, member, cid, "from=2026-10-01&to=2026-10-31")
	if status != 200 {
		t.Fatalf("report %d: %#v", status, b)
	}
	rows := b["tasks"].([]any)
	if len(rows) != 2 {
		t.Fatalf("member scope %#v", rows)
	}
	for _, v := range rows {
		r := v.(map[string]any)
		if r["id"] == hidden || r["companyId"] != cid {
			t.Fatal("scope leaked", r)
		}
		if r["parentId"] != "" {
			t.Fatal("hidden reference leaked", r)
		}
		for _, key := range []string{"comments", "attachments", "timeEntries"} {
			if len(r[key].([]any)) != 0 {
				t.Fatal("nested report payload", r)
			}
		}
	}
	for _, key := range []string{"expenses", "financeEvents", "messages", "conversations"} {
		if _, ok := b[key]; ok {
			t.Fatal("unrelated data exposed", key)
		}
	}
	if status, _ = reportTasks(t, s, nil, cid, "from=2026-10-01&to=2026-10-31"); status != 401 {
		t.Fatal(status)
	}
	if e := db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, uid).Update("active", false).Error; e != nil {
		t.Fatal(e)
	}
	if status, _ = reportTasks(t, s, member, cid, "from=2026-10-01&to=2026-10-31"); status != 403 {
		t.Fatal("revocation", status)
	}
}
func TestTaskReportFiltersAndCompanyBoundary(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	_, p, w := req(t, s, "POST", "/api/companies/"+cid+"/projects", map[string]any{"name": "Report project", "ownerId": uid, "departmentId": "", "description": "", "color": "#F97316", "status": "active", "dueDate": ""}, c)
	pid, ok := p["id"].(string)
	if !ok {
		t.Fatal(w.Body.String())
	}
	body := taskBody(uid)
	body["projectId"] = pid
	selected := createTask(t, s, c, cid, body)
	createTask(t, s, c, cid, taskBody(uid))
	_, other, _ := req(t, s, "POST", "/api/companies", map[string]any{"name": "Other report company", "slug": "other-report", "timezone": "UTC", "color": "#F97316"}, c)
	otherID := other["id"].(string)
	createTask(t, s, c, otherID, taskBody(uid))
	filters := "from=2026-10-01&to=2026-10-31&ownerId=" + url.QueryEscape(uid) + "&projectId=" + url.QueryEscape(pid)
	status, b := reportTasks(t, s, c, cid, filters)
	if status != 200 {
		t.Fatal(status, b)
	}
	rows := b["tasks"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["id"] != selected {
		t.Fatal("filters", rows)
	}
	if status, b = reportTasks(t, s, c, cid, filters+"&departmentId=unknown"); status != 200 || len(b["tasks"].([]any)) != 0 {
		t.Fatal("intersection", status, b)
	}
	uid2 := addPerson(t, s, c, cid, "report-outsider@example.com", "member")
	_ = uid2
	outsider := login(t, s, "report-outsider@example.com")
	if status, _ = reportTasks(t, s, outsider, otherID, "from=2026-10-01&to=2026-10-31"); status != 403 {
		t.Fatal("foreign company", status)
	}
}
func TestTaskReportCalendarAndValidation(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	if e := db.Model(&Company{}).Where("id=?", cid).Update("timezone", "Asia/Kolkata").Error; e != nil {
		t.Fatal(e)
	}
	body := taskBody(me(t, s, c))
	body["dueDate"] = "2026-10-10"
	id := createTask(t, s, c, cid, body)
	if e := db.Model(&Task{}).Where("id=?", id).Updates(map[string]any{"status": "done", "completed_at": "2026-10-10T20:00:00Z"}).Error; e != nil {
		t.Fatal(e)
	}
	status, b := reportTasks(t, s, c, cid, "from=2026-10-11&to=2026-10-11")
	if status != 200 || len(b["tasks"].([]any)) != 1 || b["timezone"] != "Asia/Kolkata" || b["basis"] != "current_state" {
		t.Fatal(status, b)
	}
	for _, f := range []string{"", "from=2026-02-30&to=2026-10-11", "from=2026-10-12&to=2026-10-11"} {
		if status, _ = reportTasks(t, s, c, cid, f); status != 422 {
			t.Fatal("date validation", f, status)
		}
	}
	if e := db.Model(&Task{}).Where("id=?", id).Update("status", "cancelled").Error; e != nil {
		t.Fatal(e)
	}
	if status, b = reportTasks(t, s, c, cid, "from=2026-10-01&to=2026-10-31"); status != 200 || len(b["tasks"].([]any)) != 0 {
		t.Fatal("cancelled", status, b)
	}
}
