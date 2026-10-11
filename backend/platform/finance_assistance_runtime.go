package platform

import (
	"context"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

func ConfigureFinanceAssistance(o *Options) error {
	if root := os.Getenv("FINANCE_INTAKE_ROOT"); root != "" {
		store, e := NewFileMediaStore(root)
		if e != nil {
			return e
		}
		o.FinanceIntakeStore = store
	}
	if value := os.Getenv("FINANCE_INTAKE_TTL_DAYS"); value != "" {
		days, e := strconv.Atoi(value)
		if e != nil || days < 1 || days > 30 {
			return errors.New("FINANCE_INTAKE_TTL_DAYS must be 1–30")
		}
		o.FinanceIntakeTTL = time.Duration(days) * 24 * time.Hour
	}
	for name, target := range map[string]*int64{"FINANCE_ACTOR_QUOTA_BYTES": &o.FinanceActorQuotaBytes, "FINANCE_COMPANY_QUOTA_BYTES": &o.FinanceCompanyQuotaBytes} {
		if value := os.Getenv(name); value != "" {
			n, e := strconv.ParseInt(value, 10, 64)
			if e != nil || n < 10<<20 || n > 500<<20 {
				return errors.New("Invalid finance quota")
			}
			*target = n
		}
	}
	enabled := false
	if value := os.Getenv("FINANCE_OCR_ENABLED"); value != "" {
		var e error
		enabled, e = strconv.ParseBool(value)
		if e != nil {
			return errors.New("Invalid FINANCE_OCR_ENABLED")
		}
	}
	if pdf := os.Getenv("FINANCE_PDF_ENABLED"); pdf != "" && pdf != "false" {
		return errors.New("PDF extraction is unavailable; use manual entry")
	}
	if address := os.Getenv("FINANCE_SCANNER_ADDRESS"); address != "" {
		o.FinanceScanner = ClamAVScanner{Address: address}
	}
	if !enabled {
		return nil
	}
	path := os.Getenv("FINANCE_OCR_EXECUTABLE")
	if path == "" {
		path = "/usr/bin/tesseract"
	}
	if !filepath.IsAbs(path) {
		return errors.New("FINANCE_OCR_EXECUTABLE requires a fixed absolute path")
	}
	language := os.Getenv("FINANCE_OCR_LANGUAGE")
	if language == "" {
		language = "eng"
	}
	if language != "eng" {
		return errors.New("Only explicitly verified English OCR is supported")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	versionOutput := &financeBoundedOutput{Limit: 8192}
	cmd.Stdout = versionOutput
	cmd.Stderr = &financeBoundedOutput{Limit: 1024}
	e := cmd.Run()
	version := versionOutput.Bytes()
	if e != nil {
		return errors.New("Configured OCR executable is unavailable")
	}
	trained, e := os.ReadFile("/usr/share/tessdata/eng.traineddata")
	if e != nil {
		return errors.New("Configured English traineddata unavailable")
	}
	binary, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	limiter, e := os.ReadFile("/usr/bin/prlimit")
	if e != nil {
		return errors.New("Configured OCR resource limiter unavailable")
	}
	identity := financeDigest(binary) + ":" + financeDigest(trained) + ":" + financeDigest(limiter) + ":eng:psm6:omp1:memory512MiB:cpu45s"
	o.FinanceOCRFingerprint = financeDigest([]byte(identity))
	o.ReceiptOCRProvider = &TesseractReceiptOCR{Executable: path, Language: language, Version: strings.SplitN(string(version), "\n", 2)[0], Fingerprint: o.FinanceOCRFingerprint}
	return nil
}
func (s *Server) RunFinanceAssistanceWorker(ctx context.Context) {
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				short, cancel := context.WithTimeout(ctx, 30*time.Second)
				s.RunFinanceAssistanceCleanup(short, now, 100)
				cancel()
			}
		}
	}()
	defer wg.Wait()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			s.RunFinanceAssistanceJobs(ctx, now, 1)
		}
	}
}
func (s *Server) RunFinanceAssistanceCleanup(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	n := 0
	// Erase expired private review text before any fallible file deletion.
	// Each processed scratch record consumes the shared pass budget.
	var results []ReceiptExtractionResult
	if e := s.db.WithContext(ctx).Where("expires_at<=? AND candidates<>?", now, "{\"fields\":{},\"unresolved\":[]}").Order("expires_at,id").Limit(limit - n).Find(&results).Error; e != nil {
		return n, e
	}
	for _, result := range results {
		empty, _ := json.Marshal(ReceiptCandidates{Fields: map[string][]string{}, Unresolved: []string{}})
		if e := s.db.WithContext(ctx).Model(&result).Update("candidates", string(empty)).Error; e != nil {
			return n, e
		}
		n++
	}
	if n == limit {
		return n, nil
	}
	var previews []string
	if e := s.db.WithContext(ctx).Model(&FinanceStatementPreview{}).Where("expires_at<=? AND (rows<>? OR errors<>?)", now, "[]", "[]").Order("expires_at,id").Limit(limit-n).Pluck("id", &previews).Error; e != nil {
		return n, e
	}
	if len(previews) > 0 {
		if e := s.db.WithContext(ctx).Model(&FinanceStatementPreview{}).Where("id IN ?", previews).Updates(map[string]any{"rows": "[]", "errors": "[]"}).Error; e != nil {
			return n, e
		}
		n += len(previews)
	}
	if n == limit {
		return n, nil
	}
	var deleteError error
	var rows []FinanceAssistanceIntake
	if e := s.db.WithContext(ctx).Where("state<>'purged' AND (expires_at<=? OR state IN ?)", now, []string{"cancelled", "expired", "rejected"}).Order("expires_at,id").Limit(limit - n).Find(&rows).Error; e != nil {
		return n, e
	}
	for _, i := range rows {
		e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if e := lockCompany(tx, i.CompanyID); e != nil {
				return e
			}
			if e := tx.Model(&FinanceAssistanceIntake{}).Where("id=? AND state NOT IN ?", i.ID, []string{"expired", "purged"}).Updates(map[string]any{"state": "expired", "content_generation": gorm.Expr("content_generation+1")}).Error; e != nil {
				return e
			}
			return tx.Model(&FinanceAssistanceJob{}).Where("source_kind='intake' AND source_id=? AND status<>'accepted'", i.ID).Update("status", "cancelled").Error
		})
		if e != nil {
			return n, e
		}
		n++
		if s.opts.FinanceIntakeStore == nil {
			return n, nil
		}
		if e := s.opts.FinanceIntakeStore.Delete(ctx, i.StoreKey); e != nil {
			deleteError = errors.Join(deleteError, e)
			continue
		}
		if e := s.db.WithContext(ctx).Model(&FinanceAssistanceIntake{}).Where("id=?", i.ID).Update("state", "purged").Error; e != nil {
			return n, e
		}
	}

	return n, deleteError
}
