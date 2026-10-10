package platform

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"schach.local/workspace/backend/migrations"
	"sort"
	"strconv"
	"strings"
	"testing"
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
	if count != 31 {
		t.Fatal("expected actual numbered SQL ledger31", count)
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
