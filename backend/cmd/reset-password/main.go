// reset-password is an explicit operator recovery command requiring database access.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"schach.local/workspace/backend/platform"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, "Password reset failed:", e)
		os.Exit(1)
	}
}
func run() error {
	file := flag.String("db", "schach.db", "Existing SQLite database; DATABASE_URL selects PostgreSQL")
	resetMFA := flag.Bool("reset-mfa", false, "Explicitly reset lost MFA after independent identity verification; requires RESET_REASON")
	flag.Parse()
	email, password := os.Getenv("RESET_EMAIL"), os.Getenv("RESET_PASSWORD")
	if email == "" || password == "" {
		return errors.New("set RESET_EMAIL and RESET_PASSWORD through your secure environment or secret manager; passwords are not accepted as command-line arguments")
	}
	dsn := os.Getenv("DATABASE_URL")
	if os.Getenv("ENVIRONMENT") == "production" && dsn == "" {
		return errors.New("production recovery requires PostgreSQL DATABASE_URL")
	}
	var db *gorm.DB
	var e error
	cfg := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	if dsn != "" {
		db, e = gorm.Open(postgres.Open(dsn), cfg)
	} else {
		if _, e = os.Stat(*file); e != nil {
			return fmt.Errorf("open existing SQLite database: %w", e)
		}
		join := "?"
		if strings.Contains(*file, "?") {
			join = "&"
		}
		db, e = gorm.Open(sqlite.Open(*file+join+"_foreign_keys=on&_busy_timeout=5000"), cfg)
	}
	if e != nil {
		return e
	}
	sqlDB, e := db.DB()
	if e != nil {
		return e
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	if e = platform.RecoverAccount(db, email, password, *resetMFA, os.Getenv("RESET_REASON")); e != nil {
		return e
	}
	fmt.Println("Password reset completed. All sessions for the account were revoked and the action was audited.")
	return nil
}
