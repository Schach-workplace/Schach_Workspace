// Standalone Schach Workspace server. PostgreSQL is required in production;
// SQLite is provided for local evaluation and tests.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"schach.local/workspace/backend/platform"
)

func envBool(name string) bool {
	v := os.Getenv(name)
	if v == "" {
		return false
	}
	b, e := strconv.ParseBool(v)
	if e != nil {
		fatal(fmt.Errorf("%s must be true or false", name))
	}
	return b
}
func fatal(err error) { slog.Error("startup failed", "error", err); os.Exit(1) }
func main() {
	if err := run(); err != nil {
		fatal(err)
	}
}
func run() error {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	localDB := flag.String("db", "schach.db", "SQLite file for local development; DATABASE_URL selects PostgreSQL")
	demo := flag.Bool("demo", envBool("SEED_DEMO"), "Explicitly seed fictional evaluation data into an empty development database")
	frontend := flag.String("frontend", "../frontend/dist", "Built React frontend directory (SPA fallback)")
	migrate := flag.Bool("migrate", false, "Run GORM development migrations (PostgreSQL production uses versioned SQL)")
	flag.Parse()
	production := os.Getenv("ENVIRONMENT") == "production"
	secure := envBool("SECURE_COOKIES")
	origins := []string{}
	for _, v := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if v = strings.TrimSpace(v); v != "" {
			origins = append(origins, v)
		}
	}
	if production {
		if *demo {
			return errors.New("demo seeding is disabled in production")
		}
		if !secure {
			return errors.New("production requires SECURE_COOKIES=true and HTTPS at your reverse proxy")
		}
		if os.Getenv("DATABASE_URL") == "" {
			return errors.New("production requires a persistent PostgreSQL DATABASE_URL")
		}
		if *migrate {
			return errors.New("production requires the versioned SQL migrations; --migrate is a development option")
		}
		if len(origins) == 0 {
			return errors.New("production requires explicit HTTPS ALLOWED_ORIGINS")
		}
		for _, o := range origins {
			if !strings.HasPrefix(o, "https://") {
				return errors.New("production ALLOWED_ORIGINS must use HTTPS")
			}
		}
	}
	cfg := &gorm.Config{Logger: logger.Default.LogMode(logger.Error)}
	var db *gorm.DB
	var err error
	dsn := os.Getenv("DATABASE_URL")
	if dsn != "" {
		db, err = gorm.Open(postgres.Open(dsn), cfg)
	} else {
		if e := os.MkdirAll(filepath.Dir(*localDB), 0700); e != nil {
			return e
		}
		delimiter := "?"
		if strings.Contains(*localDB, "?") {
			delimiter = "&"
		}
		db, err = gorm.Open(sqlite.Open(*localDB+delimiter+"_foreign_keys=on&_busy_timeout=5000&_journal_mode=WAL"), cfg)
	}
	if err != nil {
		return err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	if dsn == "" {
		sqlDB.SetMaxOpenConns(1)
		_ = os.Chmod(*localDB, 0600)
	} else {
		sqlDB.SetMaxOpenConns(20)
		sqlDB.SetMaxIdleConns(5)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
	}
	if dsn == "" || *migrate {
		if err = platform.Migrate(db); err != nil {
			return err
		}
	}
	var count int64
	if err = db.Model(&platform.User{}).Count(&count).Error; err != nil {
		return fmt.Errorf("read schema (apply backend/migrations first): %w", err)
	}
	if count == 0 {
		if *demo {
			if err = platform.SeedDemo(db); err != nil {
				return err
			}
			slog.Warn("fictional local demo accounts enabled", "password", "See README demo credentials")
		} else {
			email, password, name := os.Getenv("BOOTSTRAP_EMAIL"), os.Getenv("BOOTSTRAP_PASSWORD"), os.Getenv("BOOTSTRAP_NAME")
			if email == "" || password == "" || name == "" {
				return errors.New("empty database: set BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD (12+ characters) and BOOTSTRAP_NAME; for local evaluation explicitly pass --demo")
			}
			if err = platform.Bootstrap(db, email, password, name); err != nil {
				return err
			}
			slog.Info("initial founder account and company created")
		}
	}
	hours := 72
	if v := os.Getenv("SESSION_HOURS"); v != "" {
		hours, err = strconv.Atoi(v)
		if err != nil {
			return errors.New("SESSION_HOURS must be an integer")
		}
	}
	options := platform.Options{AllowedOrigins: origins, SecureCookies: secure, SessionHours: hours}
	if err := platform.ConfigurePeopleCredentialRetry(&options); err != nil {
		return err
	}
	if err := platform.ConfigureCommunication(&options); err != nil {
		return err
	}
	reportRoot := ""
	if !production {
		reportRoot = filepath.Join(filepath.Dir(*localDB), "report-artifacts")
	}
	_ = platform.ConfigureIntelligence(&options)
	if err := platform.ConfigureFinanceAssistance(&options); err != nil {
		return err
	}
	if err := platform.ConfigureReports(&options, reportRoot); err != nil {
		return err
	}
	app, err := platform.New(db, options)
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", app)
	absFrontend, err := filepath.Abs(*frontend)
	if err != nil {
		return err
	}
	mux.Handle("/", spa(absFrontend))
	server := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 40 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	observation, observationCancel := context.WithTimeout(ctx, 10*time.Second)
	if _, _, err := app.InitializeReportHistory(observation, time.Now().UTC(), 100); err != nil {
		observationCancel()
		return err
	}
	observationCancel()
	workers := app.StartBackgroundWorkers(ctx)
	if !envBool("DISABLE_SCHEDULER") {
		go schedule(ctx, app)
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("Schach Workspace ready", "address", *addr, "frontend", absFrontend, "production", production)
	if err = server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	if ctx.Err() != nil {
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return workers.Stop(shutdown)
	}
	return nil
}
func schedule(ctx context.Context, app *platform.Server) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			job, cancel := context.WithTimeout(ctx, 2*time.Minute)
			n, r, e := app.RunAutomations(job)
			cancel()
			if e != nil {
				slog.Error("automation scan failed", "error", e)
			} else {
				slog.Info("automation scan complete", "created", n, "reminders", r)
			}
		}
	}
}
func spa(root string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		name := filepath.Clean("/" + r.URL.Path)
		path := filepath.Join(root, name)
		if !strings.HasPrefix(path, root+string(os.PathSeparator)) && path != root {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
		if info, e := os.Stat(path); e == nil && !info.IsDir() {
			http.ServeFile(w, r, path)
			return
		}
		if filepath.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		index := filepath.Join(root, "index.html")
		if _, e := os.Stat(index); e != nil {
			http.Error(w, "Frontend build not found. Run npm ci && npm run build in frontend, or use the Vite development server.", 503)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, index)
	})
}
