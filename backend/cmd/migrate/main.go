// migrate uses a schema-owner credential; the application need not have DDL rights.
package main

import (
	"context"
	"flag"
	"fmt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"os"
	"schach.local/workspace/backend/migrations"
	"time"
)

func main() {
	adopt := flag.Int("adopt-through", 0, "Explicitly adopt verified legacy schema 1 or 2, then upgrade; take a backup first")
	flag.Parse()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(1)
	}
	db, e := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if e == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		e = migrations.Apply(ctx, db, *adopt)
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, "Migration failed:", e)
		os.Exit(1)
	}
	fmt.Println("Versioned SQL upgrade completed; checksums verified.")
}
