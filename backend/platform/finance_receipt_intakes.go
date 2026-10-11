package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"gorm.io/gorm"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var financeSHA256 = regexp.MustCompile(`^[0-9a-f]{64}$`)

func financeDigest(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func requiredFinanceKey(f map[string]json.RawMessage) (string, error) {
	key, e := optionalBusinessKey(f)
	if e != nil {
		return "", e
	}
	if key == "" {
		return "", invalid("A retry key is required.")
	}
	delete(f, "retryKey")
	return key, nil
}
func financeSessionRef(r *http.Request) (string, error) {
	token, e := sessionToken(r)
	if e != nil {
		return "", e
	}
	return hashToken(token), nil
}
func financeOriginalSession(tx *gorm.DB, cid, uid, ref string) error {
	var session SessionRecord
	if e := lockCommunicationRow(tx, "SHARE").Where("token_hash=? AND user_id=? AND expires_at>?", ref, uid, time.Now().UTC()).First(&session).Error; e != nil {
		return missing()
	}
	return nil
}
func authorizeFinanceIntake(tx *gorm.DB, a *access, id string) (FinanceAssistanceIntake, error) {
	return authorizeFinanceIntakeContext(tx, a, id, false)
}
func authorizeFinanceIntakeContext(tx *gorm.DB, a *access, id string, allowTombstone bool) (FinanceAssistanceIntake, error) {
	if !a.Member.Active || a.Users[a.User.ID].Suspended {
		return FinanceAssistanceIntake{}, missing()
	}
	var i FinanceAssistanceIntake
	if e := tx.First(&i, "company_id=? AND id=? AND owner_id=?", a.Company.ID, id, a.User.ID).Error; e != nil {
		return i, missing()
	}
	i.CreatedAt = i.CreatedAt.UTC()
	i.ExpiresAt = i.ExpiresAt.UTC()
	if !allowTombstone && (!time.Now().Before(i.ExpiresAt) || in(i.State, "cancelled", "expired", "purged", "rejected")) {
		return i, missing()
	}
	if e := financeOriginalSession(tx, i.CompanyID, i.OwnerID, i.SessionRef); e != nil {
		return i, e
	}
	if i.Purpose == "statement" {
		if !financeAuthority(a.Member.Role) {
			return i, missing()
		}
	} else if !a.canCreateExpense(i.DestinationDepartmentID) || !departmentExists(tx, a.Company.ID, i.DestinationDepartmentID) {
		return i, missing()
	}
	return i, nil
}
func (s *Server) financeIntakeRoutes() {
	base := "/api/companies/{cid}"
	s.route("POST "+base+"/finance/intakes", s.reserveFinanceIntake)
	s.route("GET "+base+"/finance/intakes", s.listFinanceIntakes)
	s.route("GET "+base+"/finance/intakes/{id}", s.getFinanceIntake)
	s.route("POST "+base+"/finance/intakes/{id}/bind-content", s.bindFinanceIntake)
	s.route("POST "+base+"/finance/intakes/{id}/upload", s.uploadFinanceIntake)
	s.route("POST "+base+"/finance/intakes/{id}/finalize", s.finalizeFinanceIntake)
	s.route("POST "+base+"/finance/intakes/{id}/cancel", s.cancelFinanceIntake)
	s.route("GET "+base+"/finance/intakes/{id}/download", s.downloadFinanceIntake)
	s.route("POST "+base+"/expense-receipts/{id}/assessment", s.assessFinanceReceipt)
}
func (s *Server) reserveFinanceIntake(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "purpose", "fileName", "size", "sha256", "destinationDepartmentId", "capture")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		Purpose                 string
		Capture                 bool
		FileName                string
		Size                    int64
		SHA256                  string
		DestinationDepartmentID string `json:"destinationDepartmentId"`
	}
	if e = applyFields(f, &input); e != nil {
		return e
	}
	if input.Capture {
		if input.Purpose != "receipt" {
			return invalid("Capture reservations are for receipts only.")
		}
		for _, field := range []string{"fileName", "size", "sha256"} {
			if _, present := f[field]; present {
				return invalid("Bind actual file identity after capture.")
			}
		}
	} else if !in(input.Purpose, "receipt", "statement") || !validFinanceContentIdentity(input.FileName, input.Size, input.SHA256, input.Purpose) {
		return invalid("Choose a bounded supported file and exact content identity.")
	}
	if input.Purpose == "statement" && input.DestinationDepartmentID != "" {
		return invalid("Statement intake has no destination department.")
	}
	ref, e := financeSessionRef(r)
	if e != nil {
		return e
	}
	var out FinanceAssistanceIntake
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		auth := func() error {
			if !a.Member.Active || a.Users[a.User.ID].Suspended {
				return denied()
			}
			if s.opts.FinanceIntakeStore == nil {
				return invalid("Private finance intake is unavailable; manual entry remains available.")
			}
			if input.Purpose == "statement" {
				if !financeAuthority(a.Member.Role) {
					return denied()
				}
			} else if !a.canCreateExpense(input.DestinationDepartmentID) || !departmentExists(tx, a.Company.ID, input.DestinationDepartmentID) {
				return denied()
			}
			return nil
		}
		result, e := financeBusinessMutation(tx, a, "finance_intake_reserve", key, f, auth, func(result BusinessResult) error {
			var e error
			out, e = authorizeFinanceIntake(tx, a, result.IDs[0])
			return e
		}, func() (BusinessResult, error) {
			var actor, company int64
			q := tx.Model(&FinanceAssistanceIntake{}).Where("company_id=? AND expires_at>? AND state NOT IN ?", a.Company.ID, time.Now(), []string{"cancelled", "expired", "purged", "rejected"})
			if e := q.Select("COALESCE(SUM(CASE WHEN state='capture_reserved' THEN 10485760 ELSE size END),0)").Scan(&company).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := q.Where("owner_id=?", a.User.ID).Select("COALESCE(SUM(CASE WHEN state='capture_reserved' THEN 10485760 ELSE size END),0)").Scan(&actor).Error; e != nil {
				return BusinessResult{}, e
			}
			charge := input.Size
			if input.Capture {
				charge = 10 << 20
			}
			if actor+charge > s.opts.FinanceActorQuotaBytes || company+charge > s.opts.FinanceCompanyQuotaBytes {
				return BusinessResult{}, invalid("Private finance intake capacity reached; cancel an unused intake.")
			}
			now := time.Now().UTC().Truncate(time.Microsecond)
			out = FinanceAssistanceIntake{ID: newID("fin"), CompanyID: a.Company.ID, OwnerID: a.User.ID, Purpose: input.Purpose, SessionRef: ref, StoreKey: newID("med"), FileName: input.FileName, Size: input.Size, InternalSHA256: input.SHA256, State: "reserved", Version: 1, ContentGeneration: 1, DestinationDepartmentID: input.DestinationDepartmentID, CreatedAt: now, ExpiresAt: now.Add(s.opts.FinanceIntakeTTL)}
			if input.Capture {
				out.State = "capture_reserved"
				out.ContentGeneration = 0
			}
			if e := tx.Create(&out).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "finance_intake", IDs: []string{out.ID}, Versions: []int64{out.Version}}, nil
		})
		_ = result
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, out)
}
func (s *Server) getFinanceIntake(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var i FinanceAssistanceIntake
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		i, e = authorizeFinanceIntake(tx, a, r.PathValue("id"))
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, i)
}
func financeIntakeMIME(i FinanceAssistanceIntake, data []byte) (string, error) {
	mime := http.DetectContentType(data)
	ext := strings.ToLower(filepath.Ext(i.FileName))
	if i.Purpose == "statement" {
		if ext != ".csv" || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			return "", invalid("Statements require a UTF-8 CSV file.")
		}
		return "text/csv", nil
	}
	if mime == "image/png" && ext == ".png" || mime == "image/jpeg" && in(ext, ".jpg", ".jpeg") || mime == "application/pdf" && ext == ".pdf" {
		return mime, nil
	}
	return "", invalid("Use a JPEG, PNG or PDF receipt. Other files remain available through manual receipt upload.")
}
func (s *Server) uploadFinanceIntake(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var i FinanceAssistanceIntake
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		i, e = authorizeFinanceIntake(tx, a, r.PathValue("id"))
		return e
	})
	if e != nil {
		return e
	}
	if i.State == "capture_reserved" || i.Size < 1 || i.InternalSHA256 == "" {
		return financeConflict()
	}
	data, e := io.ReadAll(io.LimitReader(r.Body, i.Size+1))
	if e != nil {
		return invalid("Unable to receive file.")
	}
	if int64(len(data)) != i.Size || financeDigest(data) != i.InternalSHA256 {
		return financeConflict()
	}
	mime, e := financeIntakeMIME(i, data)
	if e != nil {
		return e
	}
	if i.State != "reserved" {
		return respond(w, 200, i)
	}
	if s.opts.FinanceIntakeStore == nil {
		return invalid("Private finance intake is unavailable.")
	}
	if e = s.opts.FinanceIntakeStore.Put(r.Context(), i.StoreKey, bytes.NewReader(data)); e != nil {
		return invalid("Unable to stage file. Retry this same intake.")
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		current, e := authorizeFinanceIntake(tx, a, i.ID)
		if e != nil {
			return e
		}
		if current.ContentGeneration != i.ContentGeneration {
			return financeConflict()
		}
		if current.State != "reserved" {
			i = current
			return nil
		}
		current.State = "uploaded"
		current.MimeType = mime
		current.Version++
		if e := tx.Save(&current).Error; e != nil {
			return e
		}
		i = current
		return nil
	})
	if e != nil {
		if cleanupErr := s.opts.FinanceIntakeStore.Delete(r.Context(), i.StoreKey); cleanupErr != nil {
			s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
				if e := lockCompany(tx, i.CompanyID); e != nil {
					return e
				}
				return tx.Model(&FinanceAssistanceIntake{}).Where("id=? AND state='purged'", i.ID).Update("state", "expired").Error
			})
		}
		return e
	}
	return respond(w, 200, i)
}
func (s *Server) finalizeFinanceIntake(w http.ResponseWriter, r *http.Request) error {
	return s.mutateFinanceIntake(w, r, false)
}
func (s *Server) cancelFinanceIntake(w http.ResponseWriter, r *http.Request) error {
	return s.mutateFinanceIntake(w, r, true)
}
func (s *Server) mutateFinanceIntake(w http.ResponseWriter, r *http.Request, cancel bool) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedVersion", "reason")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		ExpectedVersion int64
		Reason          string
	}
	if e = applyFields(f, &input); e != nil {
		return e
	}
	var result BusinessResult
	op := "finance_intake_finalize"
	if cancel {
		op = "finance_intake_cancel"
	}
	intent := map[string]any{"id": r.PathValue("id"), "fields": f}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var i FinanceAssistanceIntake
		auth := func() error {
			var e error
			i, e = authorizeFinanceIntakeContext(tx, a, r.PathValue("id"), cancel)
			return e
		}
		var e error
		result, e = financeBusinessMutation(tx, a, op, key, intent, auth, func(out BusinessResult) error { return nil }, func() (BusinessResult, error) {
			if i.Version != input.ExpectedVersion {
				return BusinessResult{}, financeConflict()
			}
			if cancel {
				if in(i.State, "cancelled", "expired", "purged", "rejected") {
					return BusinessResult{}, financeConflict()
				}
				i.State = "cancelled"
				i.ContentGeneration++
				if e := tx.Model(&FinanceAssistanceJob{}).Where("company_id=? AND source_kind='intake' AND source_id=?", a.Company.ID, i.ID).Updates(map[string]any{"status": "cancelled", "updated_at": time.Now()}).Error; e != nil {
					return BusinessResult{}, e
				}
			} else {
				if i.State != "uploaded" {
					return BusinessResult{}, invalid("Upload the reserved file before requesting a clean assessment.")
				}
				i.State = "scanning"
				job := newFinanceScanJob(i)
				if e := tx.Create(&job).Error; e != nil {
					return BusinessResult{}, e
				}
			}
			i.Version++
			if e := tx.Save(&i).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "finance_intake", IDs: []string{i.ID}, Versions: []int64{i.Version}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": result.IDs[0], "version": result.Versions[0]})
}
func newFinanceScanJob(i FinanceAssistanceIntake) FinanceAssistanceJob {
	return FinanceAssistanceJob{ID: newID("fjob"), CompanyID: i.CompanyID, RequesterID: i.OwnerID, SessionRef: i.SessionRef, Operation: "scan_intake", SourceKind: "intake", SourceID: i.ID, SourceVersion: i.Version + 1, InternalHash: i.InternalSHA256, ContentGeneration: i.ContentGeneration, DestinationDepartmentID: i.DestinationDepartmentID, Status: "queued", Version: 1, AvailableAt: time.Now().UTC(), CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(), ExpiresAt: i.ExpiresAt}
}
func (s *Server) downloadFinanceIntake(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var i FinanceAssistanceIntake
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		i, e = authorizeFinanceIntake(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if i.State != "clean" || i.CleanGeneration != i.ContentGeneration {
			return missing()
		}
		return nil
	})
	if e != nil {
		return e
	}
	data, e := s.readFinanceIntakeBytes(r.Context(), i)
	if e != nil {
		return missing()
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		fresh, e := authorizeFinanceIntake(tx, a, i.ID)
		if e != nil {
			return e
		}
		if fresh.State != "clean" || fresh.ContentGeneration != i.ContentGeneration {
			return missing()
		}
		return nil
	})
	if e != nil {
		return e
	}
	w.Header().Set("Content-Type", i.MimeType)
	w.Header().Set("Content-Disposition", "attachment")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "no-store")
	_, e = w.Write(data)
	return e
}
func (s *Server) readFinanceIntakeBytes(ctx context.Context, i FinanceAssistanceIntake) ([]byte, error) {
	if i.State == "capture_reserved" || i.Size < 1 || !financeSHA256.MatchString(i.InternalSHA256) || s.opts.FinanceIntakeStore == nil {
		return nil, missing()
	}
	f, e := s.opts.FinanceIntakeStore.Open(ctx, i.StoreKey)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	data, e := io.ReadAll(io.LimitReader(f, i.Size+1))
	if e != nil {
		return nil, e
	}
	if int64(len(data)) != i.Size || financeDigest(data) != i.InternalSHA256 {
		return nil, missing()
	}
	return data, nil
}
