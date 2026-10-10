package platform

import (
	"os"
	"schach.local/workspace/backend/migrations"
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
