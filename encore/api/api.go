// Service api hosts the same platform used by the standalone server.
package api

import (
	"context"
	"encore.dev/shutdown"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"encore.dev"
	"encore.dev/beta/errs"
	"encore.dev/config"
	"encore.dev/cron"
	"encore.dev/storage/sqldb"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"schach.local/workspace/backend/platform"
)

var database = sqldb.NewDatabase("workspace", sqldb.DatabaseConfig{Migrations: "./migrations"})

type Config struct {
	AllowedOrigins []string
	SecureCookies  bool
	SessionHours   int
	SeedDemo       bool
	BootstrapEmail string
	BootstrapName  string
}

var cfg = config.Load[*Config]()
var secrets struct{ BootstrapPassword string }

//encore:service
type Service struct {
	app     *platform.Server
	workers *platform.WorkerLifecycle
}

var _ shutdown.Handler = (*Service)(nil)

func (s *Service) Shutdown(progress shutdown.Progress) error {
	slog.Info("background worker shutdown started")
	bounded, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if progress.ForceShutdown != nil {
		go func() {
			select {
			case <-progress.ForceShutdown.Done():
				cancel()
			case <-bounded.Done():
			}
		}()
	}
	e := s.workers.Stop(bounded)
	if e == nil {
		slog.Info("background workers stopped")
	}
	return e
}

func initService() (*Service, error) {
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: database.Stdlib()}), &gorm.Config{Logger: logger.Default.LogMode(logger.Error)})
	if err != nil {
		return nil, err
	}
	meta := encore.Meta()
	production := meta.Environment.Type == encore.EnvProduction || os.Getenv("ENVIRONMENT") == "production"
	seed := cfg.SeedDemo || os.Getenv("SEED_DEMO") == "true"
	if production {
		if seed {
			return nil, errors.New("demo seeding is disabled in production")
		}
		if !cfg.SecureCookies || len(cfg.AllowedOrigins) == 0 {
			return nil, errors.New("production requires SecureCookies and explicit HTTPS AllowedOrigins in api/config.cue")
		}
		for _, o := range cfg.AllowedOrigins {
			if !strings.HasPrefix(o, "https://") {
				return nil, errors.New("production AllowedOrigins must use HTTPS")
			}
		}
	}
	if seed && meta.Environment.Cloud != encore.CloudLocal {
		return nil, errors.New("fictional demo seeding is restricted to explicit local evaluation")
	}
	var count int64
	if err = db.Model(&platform.User{}).Count(&count).Error; err != nil {
		return nil, err
	}
	if count == 0 {
		if seed {
			err = platform.SeedDemo(db)
		} else {
			if cfg.BootstrapEmail == "" || cfg.BootstrapName == "" {
				return nil, errors.New("empty database: set BootstrapEmail and BootstrapName in api/config.cue and BootstrapPassword with encore secret set; alternatively explicitly enable local SEED_DEMO=true")
			}
			err = platform.Bootstrap(db, cfg.BootstrapEmail, secrets.BootstrapPassword, cfg.BootstrapName)
		}
		if err != nil {
			return nil, err
		}
	}
	options := platform.Options{AllowedOrigins: cfg.AllowedOrigins, SecureCookies: cfg.SecureCookies, SessionHours: cfg.SessionHours}
	if err := platform.ConfigurePeopleCredentialRetry(&options); err != nil {
		return nil, err
	}
	if err := platform.ConfigureCommunication(&options); err != nil {
		return nil, err
	}
	reportRoot := ""
	if meta.Environment.Cloud == encore.CloudLocal {
		reportRoot = ".encore/report-artifacts"
	}
	_ = platform.ConfigureIntelligence(&options)
	if err := platform.ConfigureFinanceAssistance(&options); err != nil {
		return nil, err
	}
	if err := platform.ConfigureReports(&options, reportRoot); err != nil {
		return nil, err
	}
	app, err := platform.New(db, options)
	if err != nil {
		return nil, err
	}
	observation, observationCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if _, _, err := app.InitializeReportHistory(observation, time.Now().UTC(), 100); err != nil {
		observationCancel()
		return nil, err
	}
	observationCancel()
	return &Service{app: app, workers: app.StartBackgroundWorkers(context.Background())}, nil
}

// HTTP forwards every /api route to the shared authenticated, company-scoped handler.
//
//encore:api public raw method=GET,POST,PATCH,OPTIONS,HEAD path=/api/*path
func (s *Service) HTTP(w http.ResponseWriter, r *http.Request) { s.app.ServeHTTP(w, r) }

var _ = cron.NewJob("workspace-automations", cron.JobConfig{Title: "Create recurring work and deadline reminders", Every: 5 * cron.Minute, Endpoint: RunScheduled})

// RunScheduled is private and only accepts authenticated Encore cron dispatch.
// Local and self-hosted operators use the cookie-authenticated company admin
// /api/companies/:cid/automations/run route, or the standalone scheduler.
// The self-host infra example configures incoming service authentication.
//
//encore:api private
func (s *Service) RunScheduled(ctx context.Context) error {
	request := encore.CurrentRequest()
	// Local Encore synthesizes cron metadata from caller headers. It is not
	// platform-authenticated dispatch, so local scheduling must fail closed.
	if encore.Meta().Environment.Cloud == encore.CloudLocal || request == nil || request.CronIdempotencyKey == "" {
		return errs.B().Code(errs.PermissionDenied).Msg("Use the authenticated company automation action for manual runs.").Err()
	}
	_, _, err := s.app.RunAutomations(ctx)
	return err
}
