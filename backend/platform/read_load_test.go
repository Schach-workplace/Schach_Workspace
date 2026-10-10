package platform

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"
)

// Opt-in repeatable fixture: owns a random isolated PostgreSQL schema, never a
// running application's rows. HTTP requests exercise the real shared server.
func TestReadEfficiencyLoadFixture(t *testing.T) {
	output := os.Getenv("READ_LOAD_OUTPUT")
	if output == "" {
		t.Skip("set READ_LOAD_OUTPUT and TEST_DATABASE_URL for the owned fixture")
	}
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Fatal("native PostgreSQL is required")
	}
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	tasks := []Task{}
	comments := []Comment{}
	for company := 0; company < 10; company++ {
		companyID := cid
		if company > 0 {
			companyID = fmt.Sprintf("load_company_%d", company)
			if e := db.Create(&Company{ID: companyID, Name: companyID, Slug: companyID, Timezone: "UTC", Currency: "INR", FiscalYearStartMonth: 4}).Error; e != nil {
				t.Fatal(e)
			}
			if e := db.Create(&Membership{ID: newID("load_m"), CompanyID: companyID, UserID: uid, Role: "founder", Active: true, CapacityHours: 40}).Error; e != nil {
				t.Fatal(e)
			}
		}
		for i := 0; i < 500; i++ {
			id := fmt.Sprintf("load_task_%d_%04d", company, i)
			tasks = append(tasks, Task{ID: id, Code: fmt.Sprintf("L-%d", i), CompanyID: companyID, OwnerID: uid, CreatedBy: uid, Title: "Representative load task", Description: "Current work description", Status: "todo", Priority: "medium", Recurrence: "none", DueDate: "2026-10-10", OriginalDueDate: "2026-10-10", DeadlineMode: "all_day", OriginalDeadlineMode: "all_day", CreatedAt: time.Date(2026, 10, 1, 0, 0, i, 0, time.UTC).Format(time.RFC3339Nano), Version: 1, Tags: []string{}, Checklist: []ChecklistItem{}, Dependencies: []string{}, Collaborators: []string{}})
			if company == 0 {
				for j := 0; j < 10; j++ {
					comments = append(comments, Comment{ID: fmt.Sprintf("load_comment_%d_%d", i, j), CompanyID: cid, TaskID: id, UserID: uid, Body: "Representative evidence conversation containing enough text to model routine work notes and review discussion.", CreatedAt: "2026-10-02T00:00:00Z"})
				}
			}
		}
	}
	if e := db.CreateInBatches(tasks, 100).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.CreateInBatches(comments, 100).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Exec("ANALYZE tasks").Error; e != nil {
		t.Fatal(e)
	}
	type measurement struct {
		P50MS     float64 `json:"p50Ms"`
		P95MS     float64 `json:"p95Ms"`
		Bytes     int64   `json:"bytes"`
		Queries   int     `json:"queries"`
		QueryRows int64   `json:"queryRows"`
	}
	run := func(paths func() []string) measurement {
		selectedPaths := paths()
		durations := []float64{}
		var result measurement
		for iteration := 0; iteration < 30; iteration++ {
			var metrics []RequestMetric
			s.opts.MetricSink = func(m RequestMetric) { metrics = append(metrics, m) }
			begin := time.Now()
			for _, path := range selectedPaths {
				status, _, _ := req(t, s, "GET", path, nil, c)
				if status != 200 {
					t.Fatal(status, path)
				}
			}
			durations = append(durations, float64(time.Since(begin).Microseconds())/1000)
			if iteration == 0 {
				for _, m := range metrics {
					result.Bytes += m.Bytes
					result.Queries += m.Queries
					result.QueryRows += m.QueryRows
				}
			}
		}
		sort.Float64s(durations)
		result.P50MS = durations[14]
		result.P95MS = durations[28]
		return result
	}
	base := "/api/companies/" + cid
	legacy := run(func() []string { return []string{base + "/workspace"} })
	bootstrap := run(func() []string { return []string{base + "/bootstrap"} })
	// Exhaust the same 500-task selection for a fair initial-load comparison.
	initial := run(func() []string {
		paths := []string{base + "/bootstrap", base + "/expenses?limit=100", base + "/finance/events"}
		cursor := ""
		for {
			path := base + "/tasks?limit=100"
			if cursor != "" {
				path += "&cursor=" + cursor
			}
			paths = append(paths, path)
			s.opts.MetricSink = nil
			status, b, _ := req(t, s, "GET", path, nil, c)
			if status != 200 {
				t.Fatal(status)
			}
			if !b["hasMore"].(bool) {
				break
			}
			cursor = b["cursor"].(string)
		}
		return paths
	})
	filter := "from=2026-10-01&to=2026-10-31"
	legacyReport := run(func() []string { return []string{base + "/reports/tasks?" + filter} })
	summary := run(func() []string { return []string{base + "/reports/tasks/summary?" + filter} })
	// Own candidate index experiment; no changes escape the test schema.
	if e := db.Exec("DROP INDEX IF EXISTS tasks_company_created_page").Error; e != nil {
		t.Fatal(e)
	}
	explain := func() []string {
		var lines []string
		rows, e := db.Raw("EXPLAIN (ANALYZE, BUFFERS) SELECT id, created_at FROM tasks WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT 101", cid).Rows()
		if e != nil {
			t.Fatal(e)
		}
		defer rows.Close()
		for rows.Next() {
			var line string
			if e = rows.Scan(&line); e != nil {
				t.Fatal(e)
			}
			lines = append(lines, line)
		}
		return lines
	}
	before := explain()
	taskPage := run(func() []string { return []string{base + "/tasks?limit=100"} })
	if e := db.Exec("CREATE INDEX tasks_company_created_page ON tasks(company_id,created_at DESC,id DESC)").Error; e != nil {
		t.Fatal(e)
	}
	after := explain()
	indexedPage := run(func() []string { return []string{base + "/tasks?limit=100"} })
	result := map[string]any{"fixture": map[string]any{"companies": 10, "tasks": 5000, "selectedTasks": 500, "selectedComments": 5000, "iterations": 30, "transport": "httptest shared HTTP handler; PostgreSQL native"}, "legacyWorkspace": legacy, "bootstrap": bootstrap, "taskPage": taskPage, "initialSameSelection": initial, "legacyReport": legacyReport, "reportSummary": summary, "indexedTaskPage": indexedPage, "taskPlanBefore": before, "taskPlanAfter": after}
	b, _ := json.MarshalIndent(result, "", "  ")
	if e := os.WriteFile(output, append(b, '\n'), 0644); e != nil {
		t.Fatal(e)
	}
	t.Log(string(b))
}
