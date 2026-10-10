// Package migrations owns the standalone, checksummed PostgreSQL upgrade path.
package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"fmt"
	"gorm.io/gorm"
	"sort"
	"strconv"
	"strings"
)

//go:embed *.up.sql
var scripts embed.FS

func Apply(ctx context.Context, db *gorm.DB, adoptThrough int) error {
	if db.Dialector.Name() != "postgres" {
		return fmt.Errorf("versioned upgrades require PostgreSQL")
	}
	if adoptThrough < 0 || adoptThrough > 2 {
		return fmt.Errorf("adopt-through may only identify a verified legacy schema 1 or 2")
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(current_schema()), 19487211)").Error; e != nil {
			return e
		}
		if e := tx.Exec("CREATE TABLE IF NOT EXISTS schach_schema_migrations(version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())").Error; e != nil {
			return e
		}
		entries, e := scripts.ReadDir(".")
		if e != nil {
			return e
		}
		names := []string{}
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".up.sql") {
				names = append(names, entry.Name())
			}
		}
		version := func(n string) int { v, _ := strconv.Atoi(strings.SplitN(n, "_", 2)[0]); return v }
		sort.Slice(names, func(i, j int) bool { return version(names[i]) < version(names[j]) })
		var count int64
		if e := tx.Table("schach_schema_migrations").Count(&count).Error; e != nil {
			return e
		}
		if adoptThrough > 0 && count > 0 {
			return fmt.Errorf("adoption is only allowed with an empty migration ledger")
		}
		if adoptThrough > 0 {
			// Adoption is explicit; refuse a schema missing the legacy release surface.
			if e := tx.Exec("SELECT id,original_due_date,version FROM tasks LIMIT 0").Error; e != nil {
				return fmt.Errorf("legacy schema 1 not present: %w", e)
			}
			if adoptThrough == 2 {
				if e := tx.Exec("SELECT id,amount_minor,currency,version FROM expenses LIMIT 0").Error; e != nil {
					return fmt.Errorf("legacy schema 2 not present: %w", e)
				}
			}
		}
		for i, name := range names {
			v := version(name)
			if v != i+1 {
				return fmt.Errorf("noncontiguous migration version %d", v)
			}
			data, e := scripts.ReadFile(name)
			if e != nil {
				return e
			}
			sum := fmt.Sprintf("%x", sha256.Sum256(data))
			var stored struct{ SHA256 string }
			result := tx.Table("schach_schema_migrations").Where("version=?", v).Find(&stored)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected > 0 {
				if stored.SHA256 != sum {
					return fmt.Errorf("migration %d checksum changed; never rewrite an applied version", v)
				}
				continue
			}
			if v > adoptThrough {
				if e := tx.Exec(string(data)).Error; e != nil {
					return fmt.Errorf("migration %s: %w", name, e)
				}
			}
			if e := tx.Exec("INSERT INTO schach_schema_migrations(version,sha256) VALUES (?,?)", v, sum).Error; e != nil {
				return e
			}
		}
		return nil
	})
}
