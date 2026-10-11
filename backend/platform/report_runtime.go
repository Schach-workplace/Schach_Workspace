package platform

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// ConfigureReports enables dedicated private storage only when explicitly
// configured or when the adapter supplies an owned development data root.
func ConfigureReports(options *Options, defaultRoot string) error {
	root := os.Getenv("REPORT_ARTIFACT_ROOT")
	if root == "" {
		root = defaultRoot
	}
	if root != "" {
		store, e := NewFileReportArtifactStore(root)
		if e != nil {
			return e
		}
		options.ReportArtifactStore = store
	}
	if value := os.Getenv("REPORT_ARTIFACT_TTL_HOURS"); value != "" {
		hours, e := strconv.Atoi(value)
		if e != nil || hours < 1 || hours > 8760 {
			return errors.New("REPORT_ARTIFACT_TTL_HOURS must be1–8760")
		}
		options.ReportArtifactTTL = time.Duration(hours) * time.Hour
	}
	return nil
}
func (s *Server) RunReportDelivery(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	var intents []ReportDeliveryIntent
	if e := s.db.WithContext(ctx).Where("state='pending'").Order("created_at,id").Limit(limit).Find(&intents).Error; e != nil {
		return 0, e
	}
	delivered := 0
	for _, intent := range intents {
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, intent.CompanyID); e != nil {
				return e
			}
			a, e := currentAttentionActorLocked(tx, intent.CompanyID, intent.RecipientID)
			if e != nil {
				return tx.Model(&intent).Update("state", "cancelled").Error
			}
			job, e := authorizeReportExportJob(tx, a, intent.JobID)
			if e != nil || job.State != "ready" {
				return tx.Model(&intent).Update("state", "cancelled").Error
			}
			var artifact ReportArtifact
			if e := tx.First(&artifact, "id=? AND company_id=?", job.ArtifactID, intent.CompanyID).Error; e != nil {
				return e
			}
			if artifact.State != "ready" || !now.Before(artifact.ExpiresAt) {
				return tx.Model(&intent).Update("state", "cancelled").Error
			}
			var fresh ReportDeliveryIntent
			if e := lockCommunicationRow(tx, "UPDATE").First(&fresh, "id=?", intent.ID).Error; e != nil {
				return e
			}
			if fresh.State != "pending" {
				return nil
			}
			item := AttentionItem{CompanyID: intent.CompanyID, RecipientID: intent.RecipientID, SourceKind: "report_export", SourceID: job.ID, SourceRevision: 1, Kind: "report_ready", OccurrenceKey: "report:" + job.ID, CreatedAt: now, UpdatedAt: now}
			if e := ensureAttentionItem(tx, item); e != nil {
				return e
			}
			if e := tx.First(&item, "company_id=? AND recipient_id=? AND source_kind=? AND source_id=? AND kind=? AND occurrence_key=?", intent.CompanyID, intent.RecipientID, "report_export", job.ID, "report_ready", "report:"+job.ID).Error; e != nil {
				return e
			}
			if e := tx.Model(&fresh).Updates(map[string]any{"state": "delivered", "attention_item_id": item.ID, "updated_at": now}).Error; e != nil {
				return e
			}
			delivered++
			return nil
		})
		if e != nil {
			return delivered, e
		}
	}
	return delivered, nil
}
func (s *Server) RunReportCleanup(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	var artifacts []ReportArtifact
	jobs := s.db.WithContext(ctx).Model(&ReportExportJob{}).Select("id").Where("state IN ?", []string{"cancelled", "failed", "expired"})
	if e := s.db.WithContext(ctx).Where("state<>'deleted' AND (expires_at<=? OR state='expired' OR job_id IN (?))", now, jobs).Order("expires_at,id").Limit(limit).Find(&artifacts).Error; e != nil {
		return 0, e
	}
	cleaned := 0
	for _, artifact := range artifacts {
		if e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, artifact.CompanyID); e != nil {
				return e
			}
			if e := tx.Model(&ReportArtifact{}).Where("id=?", artifact.ID).Update("state", "expired").Error; e != nil {
				return e
			}
			if e := tx.Model(&ReportExportJob{}).Where("id=? AND state='ready'", artifact.JobID).Updates(map[string]any{"state": "expired", "updated_at": now}).Error; e != nil {
				return e
			}
			return tx.Model(&ReportDeliveryIntent{}).Where("job_id=?", artifact.JobID).Update("state", "cancelled").Error
		}); e != nil {
			return cleaned, e
		}
		if s.opts.ReportArtifactStore == nil {
			return cleaned, nil
		}
		if e := s.opts.ReportArtifactStore.Delete(ctx, artifact.StoreKey); e != nil {
			return cleaned, e
		}
		if e := s.db.WithContext(ctx).Model(&ReportArtifact{}).Where("id=?", artifact.ID).Update("state", "deleted").Error; e != nil {
			return cleaned, e
		}
		cleaned++
	}
	if store, ok := s.opts.ReportArtifactStore.(*FileReportArtifactStore); ok {
		if _, e := store.sweepReportOrphans(ctx, s.db, now, limit); e != nil {
			return cleaned, e
		}
	}
	return cleaned, nil
}

var reportSweepMu sync.Mutex

// A persistent directory handle provides a bounded continuation over filesystem
// entries without loading or restarting a full directory listing each pass.
func (store *FileReportArtifactStore) sweepReportOrphans(ctx context.Context, db *gorm.DB, now time.Time, limit int) (int, error) {
	reportSweepMu.Lock()
	defer reportSweepMu.Unlock()
	if store.sweep == nil {
		f, e := os.Open(store.root)
		if e != nil {
			return 0, e
		}
		store.sweep = f
	}
	entries, e := store.sweep.ReadDir(limit)
	if e != nil && e != io.EOF {
		return 0, e
	}
	if e == io.EOF || len(entries) < limit {
		store.sweep.Close()
		store.sweep = nil
	}
	removed := 0
	for _, entry := range entries {
		if e := ctx.Err(); e != nil {
			return removed, e
		}
		name := entry.Name()
		if !reportArtifactKey.MatchString(name) && !(len(name) > 12 && name[:12] == ".report-tmp-") {
			continue
		}
		info, e := entry.Info()
		if e != nil {
			return removed, e
		}
		if !info.Mode().IsRegular() || info.ModTime().After(now.Add(-5*time.Minute)) {
			continue
		}
		if reportArtifactKey.MatchString(name) {
			var count int64
			if e := db.WithContext(ctx).Model(&ReportArtifact{}).Where("store_key=? AND state<>'deleted'", name).Count(&count).Error; e != nil {
				return removed, e
			}
			if count > 0 {
				continue
			}
		}
		if e := os.Remove(filepath.Join(store.root, name)); e != nil && !os.IsNotExist(e) {
			return removed, e
		}
		removed++
	}
	return removed, nil
}

// Report generation owns this loop; it never enters RunCommunicationWorker.
// Maintenance is a separate short loop so long storage work cannot stall it.
func (s *Server) RunReportWorker(ctx context.Context) {
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			short, cancel := context.WithTimeout(ctx, 10*time.Second)
			now := time.Now().UTC()
			_, _, _ = s.InitializeReportHistory(short, now, 100)
			if _, e := s.RunReportSchedules(short, now, 100); e != nil && ctx.Err() == nil {
				log.Print("report schedules maintenance failed; inspect schedule failure diagnostics")
			}
			_, _ = s.RunReportDelivery(short, now, 100)
			_, _ = s.RunReportCleanup(short, now, 100)
			cancel()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer wg.Wait()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		if s.opts.ReportArtifactStore != nil {
			short, cancel := context.WithTimeout(ctx, 10*time.Second)
			job, token, e := s.claimReportExport(short, time.Now().UTC())
			cancel()
			if e == nil {
				e = s.generateReportExport(ctx, job, token)
				if e != nil && ctx.Err() == nil {
					short, cancel := context.WithTimeout(ctx, 10*time.Second)
					_ = s.failReportExport(short, job, token, e)
					cancel()
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// WorkerLifecycle keeps runtime synchronization outside Encore's endpoint schema
// parser while both adapters own exactly the same cancellable worker set.
type WorkerLifecycle struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func (s *Server) StartBackgroundWorkers(parent context.Context) *WorkerLifecycle {
	ctx, cancel := context.WithCancel(parent)
	lifecycle := &WorkerLifecycle{cancel: cancel, done: make(chan struct{})}
	var workers sync.WaitGroup
	workers.Add(2)
	go func() { defer workers.Done(); s.RunCommunicationWorker(ctx) }()
	go func() { defer workers.Done(); s.RunReportWorker(ctx) }()
	go func() { workers.Wait(); close(lifecycle.done) }()
	return lifecycle
}
func (lifecycle *WorkerLifecycle) Stop(ctx context.Context) error {
	lifecycle.cancel()
	select {
	case <-lifecycle.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
