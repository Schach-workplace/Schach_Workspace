package platform

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"schach.local/workspace/backend/migrations"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestNativeVersionedUpgradeRunner(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("native PostgreSQL DDL")
	}
	db := testDatabase(t)
	// The fixture is an explicitly owned schema with the exact legacy + current SQL.
	if e := migrations.Apply(t.Context(), db, 2); e == nil {
		t.Fatal("adoption should reject already-present communication tables and roll back")
	}
	var n int64
	db.Raw("SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='schach_schema_migrations'").Scan(&n)
	if n != 0 {
		t.Fatal("failed upgrade leaked ledger")
	}
	// Clear only this randomly named test schema and exercise a complete new install.
	var schema string
	db.Raw("SELECT current_schema()").Scan(&schema)
	if e := db.Exec("DROP SCHEMA " + schema + " CASCADE").Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Exec("CREATE SCHEMA " + schema).Error; e != nil {
		t.Fatal(e)
	}
	if e := migrations.Apply(t.Context(), db, 0); e != nil {
		t.Fatal(e)
	}
	if e := migrations.Apply(t.Context(), db, 0); e != nil {
		t.Fatal("replay", e)
	}
	db.Table("schach_schema_migrations").Count(&n)
	if n < 22 {
		t.Fatal("missing upgrades", n)
	}
	db.Exec("UPDATE schach_schema_migrations SET sha256='tampered' WHERE version=1")
	if e := migrations.Apply(t.Context(), db, 0); e == nil {
		t.Fatal("checksum tampering accepted")
	}
}

func TestMilestone5NumberedUpgradeFrom27(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("owned PostgreSQL numbered SQL upgrade")
	}
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	id := createTask(t, s, c, cid, taskBody(me(t, s, c)))
	files, e := filepath.Glob("../migrations/*.up.sql")
	if e != nil {
		t.Fatal(e)
	}
	sort.Slice(files, func(i, j int) bool { return migrationNumber(files[i]) < migrationNumber(files[j]) })
	for i := len(files) - 1; i >= 0; i-- {
		if migrationNumber(files[i]) > 27 {
			down, e := os.ReadFile(strings.Replace(files[i], ".up.sql", ".down.sql", 1))
			if e != nil {
				t.Fatal(e)
			}
			if e = db.Exec(string(down)).Error; e != nil {
				t.Fatal(e)
			}
		}
	}
	if e = db.Exec("CREATE TABLE schach_schema_migrations(version integer PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())").Error; e != nil {
		t.Fatal(e)
	}
	for _, file := range files {
		n := migrationNumber(file)
		if n > 27 {
			continue
		}
		raw, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		sum := sha256.Sum256(raw)
		if e = db.Exec("INSERT INTO schach_schema_migrations(version,sha256) VALUES (?,?)", n, fmt.Sprintf("%x", sum)).Error; e != nil {
			t.Fatal(e)
		}
	}
	if e = migrations.Apply(t.Context(), db, 0); e != nil {
		t.Fatal(e)
	}
	var count int64
	db.Table("schach_schema_migrations").Count(&count)
	if count != int64(len(files)) {
		t.Fatal("expected actual numbered SQL ledger through current head", count)
	}
	var task Task
	if e = db.First(&task, "id = ?", id).Error; e != nil || task.Version != 1 || task.OriginalDueDate != "2026-10-20" {
		t.Fatal("existing commitment changed", e, task)
	}
	for _, table := range []string{"business_mutation_retries", "task_templates", "project_milestones", "task_schedule_proposals"} {
		if !db.Migrator().HasTable(table) {
			t.Fatal(table)
		}
	}
	if e = migrations.Apply(t.Context(), db, 0); e != nil {
		t.Fatal("upgrade replay", e)
	}
}
func migrationNumber(file string) int {
	n, _ := strconv.Atoi(strings.Split(filepath.Base(file), "_")[0])
	return n
}

func TestMilestone5SubmissionHistoryUpgradeFrom31(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("owned PostgreSQL31-to32 numbered runner")
	}
	s, cid, project, task, reviewer := milestoneFixture(t)
	db := s.db
	c := login(t, s, "founder@example.com")
	base := "/api/companies/" + cid
	_, created, _ := req(t, s, "POST", base+"/projects/"+project+"/milestones", map[string]any{"retryKey": "upgrade-create", "expectedProjectVersion": 1, "title": "Legacy in review", "ownerId": me(t, s, c), "reviewerId": reviewer, "criteria": []any{map[string]any{"id": "criterion", "text": "Inspect"}}, "taskIds": []string{task}}, c)
	id := created["id"].(string)
	path := base + "/project-milestones/" + id + "/transition"
	if st, _, w := req(t, s, "POST", path, map[string]any{"retryKey": "upgrade-submit", "version": 1, "expectedProjectVersion": 1, "action": "submit", "criteriaVersion": 1, "tasks": []any{map[string]any{"taskId": task, "version": 1}}, "assertions": []any{map[string]any{"criterionId": "criterion", "statement": "Legacy assertion"}}}, c); st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var before ProjectMilestone
	db.First(&before, "id = ?", id)
	// Remove only newer M6 tables in this owned fixture before replaying the
	// accepted 31-to32 provenance upgrade through the current migration head.
	newer, e := filepath.Glob("../migrations/*.up.sql")
	if e != nil {
		t.Fatal(e)
	}
	sort.Slice(newer, func(i, j int) bool { return migrationNumber(newer[i]) > migrationNumber(newer[j]) })
	for _, file := range newer {
		if migrationNumber(file) > 32 {
			raw, e := os.ReadFile(strings.Replace(file, ".up.sql", ".down.sql", 1))
			if e != nil {
				t.Fatal(e)
			}
			if e = db.Exec(string(raw)).Error; e != nil {
				t.Fatal(e)
			}
		}
	}
	down, e := os.ReadFile("../migrations/32_milestone_submission_history.down.sql")
	if e != nil {
		t.Fatal(e)
	}
	if e = db.Exec(string(down)).Error; e != nil {
		t.Fatal(e)
	}
	if e = db.Exec("CREATE TABLE schach_schema_migrations(version integer PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())").Error; e != nil {
		t.Fatal(e)
	}
	files, e := filepath.Glob("../migrations/*.up.sql")
	if e != nil {
		t.Fatal(e)
	}
	for _, file := range files {
		n := migrationNumber(file)
		if n > 31 {
			continue
		}
		raw, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		sum := sha256.Sum256(raw)
		if e = db.Exec("INSERT INTO schach_schema_migrations(version,sha256) VALUES (?,?)", n, fmt.Sprintf("%x", sum)).Error; e != nil {
			t.Fatal(e)
		}
	}
	if e = migrations.Apply(t.Context(), db, 0); e != nil {
		t.Fatal(e)
	}
	var after ProjectMilestone
	db.First(&after, "id = ?", id)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("existing submitted basis altered", before, after)
	}
	var count int64
	db.Table("schach_schema_migrations").Count(&count)
	if count != int64(len(files)) {
		t.Fatal(count)
	}
	var row Task
	db.First(&row, "id = ?", task)
	if row.Version != 1 || row.OriginalDueDate != "2026-10-20" {
		t.Fatal("task changed", row)
	}
	rc := login(t, s, "milestone-reviewer@example.com")
	reset := map[string]any{"retryKey": "upgrade-reset", "version": 2, "expectedProjectVersion": 1, "action": "request_changes", "reason": "Reinspect legacy work"}
	for i := 0; i < 2; i++ {
		if st, _, w := req(t, s, "POST", path, reset, rc); st != 200 {
			t.Fatal(st, w.Body.String())
		}
	}
	var events []MilestoneEvent
	db.Where("milestone_id = ? AND action = ?", id, "request_changes").Find(&events)
	if len(events) != 1 || len(events[0].Tasks) != 1 || len(events[0].Assertions) != 1 || events[0].ProjectVersion != 1 {
		t.Fatal("new immutable recovery snapshot", events)
	}
	if e = migrations.Apply(t.Context(), db, 0); e != nil {
		t.Fatal("upgrade replay", e)
	}
}

func TestMilestone6NumberedUpgradeFrom32(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("owned PostgreSQL numbered SQL upgrade")
	}
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	body := taskBody(me(t, s, c))
	body["status"] = "done"
	id := createTask(t, s, c, cid, body)
	files, e := filepath.Glob("../migrations/*.up.sql")
	if e != nil {
		t.Fatal(e)
	}
	sort.Slice(files, func(i, j int) bool { return migrationNumber(files[i]) < migrationNumber(files[j]) })
	for i := len(files) - 1; i >= 0; i-- {
		if migrationNumber(files[i]) > 32 {
			down, e := os.ReadFile(strings.Replace(files[i], ".up.sql", ".down.sql", 1))
			if e != nil {
				t.Fatal(e)
			}
			if e = db.Exec(string(down)).Error; e != nil {
				t.Fatal(e)
			}
		}
	}
	if e = db.Exec("CREATE TABLE schach_schema_migrations(version integer PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())").Error; e != nil {
		t.Fatal(e)
	}
	for _, file := range files {
		n := migrationNumber(file)
		if n > 32 {
			continue
		}
		raw, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		sum := sha256.Sum256(raw)
		if e = db.Exec("INSERT INTO schach_schema_migrations(version,sha256) VALUES (?,?)", n, fmt.Sprintf("%x", sum)).Error; e != nil {
			t.Fatal(e)
		}
	}
	if e = migrations.Apply(t.Context(), db, 0); e != nil {
		t.Fatal(e)
	}
	var count int64
	db.Table("schach_schema_migrations").Count(&count)
	if count != int64(len(files)) {
		t.Fatal("expected actual numbered SQL ledger through current head", count)
	}
	var task Task
	if e = db.First(&task, "id = ?", id).Error; e != nil || task.Version != 1 || task.OriginalDueDate != "2026-10-20" {
		t.Fatal("existing commitment changed", e, task)
	}
	for _, table := range []string{"task_facts", "task_history_coverages", "task_acceptance_facts", "task_time_facts", "historical_report_snapshots", "report_export_jobs"} {
		if !db.Migrator().HasTable(table) {
			t.Fatal(table)
		}
	}
	if e = migrations.Apply(t.Context(), db, 0); e != nil {
		t.Fatal("upgrade replay", e)
	}
	if _, _, e = s.InitializeReportHistory(t.Context(), time.Now().UTC(), 100); e != nil {
		t.Fatal(e)
	}
	var coverage TaskHistoryCoverage
	if e = db.First(&coverage, "task_id=?", id).Error; e != nil || !coverage.UnknownBefore {
		t.Fatal("legacy boundary invented", coverage, e)
	}
	var accepted int64
	db.Model(&TaskAcceptanceFact{}).Where("task_id=?", id).Count(&accepted)
	if accepted != 0 {
		t.Fatal("legacy done invented acceptance", accepted)
	}
}
