// Explicit operator tool: one bounded transaction, no worker, migration or scan loop.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"os"
	"schach.local/workspace/backend/platform"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	cid := flag.String("company", "", "Required company ID")
	cursor := flag.String("cursor", "", "Cursor returned by previous committed batch")
	limit := flag.Int("limit", 100, "Maximum source IDs this batch (1–100)")
	file := flag.String("db", "", "Explicit existing SQLite evaluation file; DATABASE_URL selects PostgreSQL")
	flag.Parse()
	if *cid == "" || *limit < 1 || *limit > 100 {
		return errors.New("company is required and limit must be 1–100")
	}
	var dialector gorm.Dialector
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		if *file != "" {
			return errors.New("select DATABASE_URL or --db, not both")
		}
		dialector = postgres.Open(dsn)
	} else {
		if *file == "" {
			return errors.New("DATABASE_URL or explicit --db is required")
		}
		if _, err := os.Stat(*file); err != nil {
			return err
		}
		dialector = sqlite.Open(*file)
	}
	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return errors.New("cannot open selected database")
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	s, err := platform.New(db, platform.Options{})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	next, err := s.ReconcileAttention(ctx, *cid, *cursor, *limit)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(struct {
		NextCursor string `json:"nextCursor"`
		Complete   bool   `json:"complete"`
	}{next, next == ""})
}
