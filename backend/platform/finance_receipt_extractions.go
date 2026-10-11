package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type ReceiptCandidates struct {
	Fields     map[string][]string `json:"fields"`
	Unresolved []string            `json:"unresolved"`
}

var receiptLabel = regexp.MustCompile(`(?i)^(vendor|invoice(?: number)?|date|total|grand total)\s*:?[ \t]+(.+)$`)
var receiptTotal = regexp.MustCompile(`^([A-Z]{3})[ \t]+([0-9]+(?:\.[0-9]{1,2})?)$`)

func parseReceiptCandidates(text, currency string) (ReceiptCandidates, error) {
	c := ReceiptCandidates{Fields: map[string][]string{}, Unresolved: []string{}}
	if len(text) > 64<<10 || !utf8.ValidString(text) || strings.IndexByte(text, 0) >= 0 {
		return c, invalid("Receipt output exceeds review bounds.")
	}
	add := func(field, value string) error {
		if utf8.RuneCountInString(value) > 1000 {
			return invalid("Receipt field exceeds review bounds.")
		}
		for _, old := range c.Fields[field] {
			if old == value {
				return nil
			}
		}
		if len(c.Fields[field]) >= 8 {
			return invalid("Receipt has too many alternatives; use manual entry.")
		}
		c.Fields[field] = append(c.Fields[field], value)
		return nil
	}
	for _, line := range strings.Split(text, "\n") {
		m := receiptLabel.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		field := ""
		switch strings.ToLower(m[1]) {
		case "vendor":
			field = "vendor"
		case "invoice", "invoice number":
			field = "invoiceNumber"
		case "date":
			field = "expenseDate"
		case "total", "grand total":
			total := receiptTotal.FindStringSubmatch(strings.TrimSpace(m[2]))
			if total != nil {
				if e := add("currencyText", total[1]); e != nil {
					return c, e
				}
				if e := add("amountText", total[2]); e != nil {
					return c, e
				}
			}
			continue
		}
		if e := add(field, strings.TrimSpace(m[2])); e != nil {
			return c, e
		}
	}
	for _, field := range []string{"title", "vendor", "invoiceNumber", "expenseDate", "amountText", "currencyText"} {
		if len(c.Fields[field]) != 1 {
			c.Unresolved = append(c.Unresolved, field)
		}
	}
	if len(c.Fields["currencyText"]) == 1 && c.Fields["currencyText"][0] != currency {
		c.Unresolved = append(c.Unresolved, "currencyMismatch")
	}
	b, _ := json.Marshal(c)
	if len(b) > 64<<10 {
		return c, invalid("Receipt review exceeds bounds.")
	}
	return c, nil
}

type ReceiptExtractionResult struct {
	ID            string            `json:"id" gorm:"primaryKey"`
	CompanyID     string            `json:"-"`
	JobID         string            `json:"jobId" gorm:"uniqueIndex"`
	RequesterID   string            `json:"-"`
	Revision      int64             `json:"revision"`
	Engine        string            `json:"engine"`
	EngineVersion string            `json:"engineVersion"`
	Language      string            `json:"language"`
	Candidates    ReceiptCandidates `json:"candidates" gorm:"serializer:json;type:jsonb"`
	AcceptanceID  string            `json:"acceptanceId,omitempty"`
	CreatedAt     time.Time         `json:"createdAt"`
	ExpiresAt     time.Time         `json:"expiresAt"`
}
type ReceiptExtractionInput struct {
	OptIn  bool `json:"optIn"`
	Source struct {
		Kind            string `json:"kind"`
		ID              string `json:"id"`
		ExpectedVersion int64  `json:"expectedVersion"`
	} `json:"source"`
	DestinationDepartmentID string `json:"destinationDepartmentId"`
	TargetExpenseID         string `json:"targetExpenseId,omitempty"`
	ExpectedTargetVersion   int64  `json:"expectedTargetVersion,omitempty"`
}

func (s *Server) financeExtractionRoutes() {
	base := "/api/companies/{cid}/finance/receipt-extractions"
	s.route("POST "+base, s.createReceiptExtraction)
	s.route("GET "+base, s.listReceiptExtractions)
	s.route("GET "+base+"/{id}", s.getReceiptExtraction)
	s.route("POST "+base+"/{id}/cancel", s.cancelReceiptExtraction)
}
func (s *Server) createReceiptExtraction(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "optIn", "source", "destinationDepartmentId", "targetExpenseId", "expectedTargetVersion")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	raw, _ := json.Marshal(f)
	var input ReceiptExtractionInput
	if e = strictJSON(raw, &input); e != nil {
		return e
	}
	if !input.OptIn || !in(input.Source.Kind, "intake", "expense_receipt") || input.Source.ID == "" || input.Source.ExpectedVersion < 1 || ((input.TargetExpenseID == "") != (input.ExpectedTargetVersion == 0)) {
		return invalid("Explicitly opt in and inspect the current receipt and destination draft.")
	}
	ref, e := financeSessionRef(r)
	if e != nil {
		return e
	}
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		now := time.Now().UTC()
		job := FinanceAssistanceJob{CompanyID: a.Company.ID, RequesterID: a.User.ID, SessionRef: ref, Operation: "extract_receipt", SourceKind: input.Source.Kind, SourceID: input.Source.ID, SourceVersion: input.Source.ExpectedVersion, DestinationDepartmentID: input.DestinationDepartmentID, TargetExpenseID: input.TargetExpenseID, TargetVersion: input.ExpectedTargetVersion, CompanyCurrency: a.Company.Currency, ProviderFingerprint: s.opts.FinanceOCRFingerprint, Status: "queued", Version: 1, AvailableAt: now, CreatedAt: now, UpdatedAt: now, ExpiresAt: now.Add(s.opts.FinanceIntakeTTL)}
		auth := func() error {
			if s.opts.ReceiptOCRProvider == nil {
				return invalid("Receipt extraction is unavailable. Manual entry remains available.")
			}
			if input.Source.Kind == "intake" {
				i, e := authorizeFinanceIntake(tx, a, input.Source.ID)
				if e != nil {
					return e
				}
				job.InternalHash = i.InternalSHA256
				job.ContentGeneration = i.ContentGeneration
				job.CleanGeneration = i.CleanGeneration
				job.ExpiresAt = i.ExpiresAt
				if !inMIME(i.MimeType) {
					return invalid("This receipt requires manual entry.")
				}
			} else {
				receipt, parent, e := scopedFinanceReceipt(tx, a, input.Source.ID)
				if e != nil {
					return e
				}
				job.InternalHash = financeDigest(receipt.Data)
				job.SourceParentID = parent.ID
				job.ContentGeneration = 1
				var fingerprint ReceiptEvidenceFingerprint
				if e := tx.First(&fingerprint, "company_id=? AND receipt_id=? AND sha256=? AND state='clean'", a.Company.ID, receipt.ID, job.InternalHash).Error; e != nil {
					return invalid("Request a clean receipt assessment before extraction.")
				}
				job.CleanGeneration = fingerprint.Generation
				if !inMIME(receipt.MimeType) {
					return invalid("This receipt requires manual entry.")
				}
			}
			return authorizeFinanceJobSource(tx, a, job, false)
		}
		var e error
		result, e = financeBusinessMutation(tx, a, "receipt_extract", key, f, auth, func(out BusinessResult) error {
			var old FinanceAssistanceJob
			if e := tx.First(&old, "company_id=? AND id=?", a.Company.ID, out.IDs[0]).Error; e != nil {
				return missing()
			}
			return authorizeFinanceJobSource(tx, a, old, false)
		}, func() (BusinessResult, error) {
			if e := authorizeFinanceJobSource(tx, a, job, true); e != nil {
				return BusinessResult{}, e
			}
			job.ID = newID("fjob")
			if e := tx.Create(&job).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "finance_job", IDs: []string{job.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": result.IDs[0], "version": result.Versions[0]})
}
func authorizeReceiptExtraction(tx *gorm.DB, a *access, id string) (FinanceAssistanceJob, *ReceiptExtractionResult, error) {
	var j FinanceAssistanceJob
	if e := tx.First(&j, "company_id=? AND id=? AND requester_id=? AND operation='extract_receipt'", a.Company.ID, id, a.User.ID).Error; e != nil {
		return j, nil, missing()
	}
	if e := authorizeFinanceJobSource(tx, a, j, false); e != nil {
		return j, nil, e
	}
	if j.ResultID == "" {
		return j, nil, nil
	}
	var result ReceiptExtractionResult
	if e := tx.First(&result, "company_id=? AND id=? AND requester_id=? AND expires_at>?", a.Company.ID, j.ResultID, a.User.ID, time.Now()).Error; e != nil {
		return j, nil, missing()
	}
	return j, &result, nil
}
func (s *Server) getReceiptExtraction(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var j FinanceAssistanceJob
	var result *ReceiptExtractionResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		j, result, e = authorizeReceiptExtraction(tx, a, r.PathValue("id"))
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"job": j, "result": result})
}
func (s *Server) listReceiptExtractions(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	out := []FinanceAssistanceJob{}
	cursor := ""
	more := false
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		basis := payloadHash([]string{accessBasis(a), "receipt_extractions"})
		query := financeExtractionReadQuery(tx, a)
		if v := r.URL.Query().Get("cursor"); v != "" {
			c, e := decodeReadCursor(v, basis)
			if e != nil {
				return e
			}
			query = query.Where("created_at<? OR (created_at=? AND id<?)", c.Created, c.Created, c.ID)
		}
		if e := query.Order("created_at DESC,id DESC").Limit(limit + 1).Find(&out).Error; e != nil {
			return e
		}
		more = len(out) > limit
		if more {
			out = out[:limit]
			last := out[len(out)-1]
			cursor = encodeReadCursor(readCursor{basis, last.CreatedAt.Format(time.RFC3339Nano), last.ID})
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"items": out, "cursor": cursor, "hasMore": more})
}
func (s *Server) cancelReceiptExtraction(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedVersion")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct{ ExpectedVersion int64 }
	if e = applyFields(f, &input); e != nil {
		return e
	}
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var j FinanceAssistanceJob
		auth := func() error { var e error; j, _, e = authorizeReceiptExtraction(tx, a, r.PathValue("id")); return e }
		var e error
		result, e = financeBusinessMutation(tx, a, "receipt_extract_cancel", key, map[string]any{"id": r.PathValue("id"), "fields": f}, auth, func(out BusinessResult) error { return nil }, func() (BusinessResult, error) {
			if j.Version != input.ExpectedVersion || j.Status == "accepted" {
				return BusinessResult{}, financeConflict()
			}
			j.Status = "cancelled"
			j.Version++
			if e := tx.Save(&j).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "finance_job", IDs: []string{j.ID}, Versions: []int64{j.Version}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, result)
}
func financeExtractionReadQuery(tx *gorm.DB, a *access) *gorm.DB {
	now := time.Now().UTC()
	sessions := tx.Model(&SessionRecord{}).Select("token_hash").Where("user_id=? AND expires_at>?", a.User.ID, now)
	departments := []string{}
	var ds []Department
	if e := tx.Where("company_id=?", a.Company.ID).Find(&ds).Error; e != nil {
		q := tx.Model(&FinanceAssistanceJob{})
		q.AddError(e)
		return q
	}
	for _, d := range ds {
		if a.canCreateExpense(d.ID) {
			departments = append(departments, d.ID)
		}
	}
	intakes := tx.Model(&FinanceAssistanceIntake{}).Select("id").Where("company_id=? AND owner_id=? AND purpose='receipt' AND state='clean' AND expires_at>? AND session_ref IN (?) AND destination_department_id IN ?", a.Company.ID, a.User.ID, now, sessions, departments)
	parents := expenseReadQuery(tx, a).Select("id")
	receipts := tx.Model(&ExpenseReceipt{}).Select("id").Where("company_id=? AND expense_id IN (?)", a.Company.ID, parents)
	targets := expenseReadQuery(tx, a).Select("id").Where("created_by=? AND department_id IN ?", a.User.ID, departments)
	return tx.Model(&FinanceAssistanceJob{}).
		Where("(target_expense_id='' OR EXISTS(SELECT 1 FROM expenses target WHERE target.id=finance_assistance_jobs.target_expense_id AND target.company_id=finance_assistance_jobs.company_id AND target.created_by=finance_assistance_jobs.requester_id AND target.department_id=finance_assistance_jobs.destination_department_id))").
		Where("((source_kind='intake' AND EXISTS(SELECT 1 FROM finance_assistance_intakes source WHERE source.id=finance_assistance_jobs.source_id AND source.company_id=finance_assistance_jobs.company_id AND source.internal_sha256=finance_assistance_jobs.internal_hash AND source.content_generation=finance_assistance_jobs.content_generation AND source.clean_generation=finance_assistance_jobs.clean_generation)) OR (source_kind='expense_receipt' AND EXISTS(SELECT 1 FROM expense_receipts receipt JOIN receipt_evidence_fingerprints fingerprint ON fingerprint.receipt_id=receipt.id AND fingerprint.company_id=receipt.company_id WHERE receipt.id=finance_assistance_jobs.source_id AND receipt.company_id=finance_assistance_jobs.company_id AND receipt.expense_id=finance_assistance_jobs.source_parent_id AND fingerprint.state='clean' AND fingerprint.sha256=finance_assistance_jobs.internal_hash AND fingerprint.generation=finance_assistance_jobs.clean_generation)))").Where("company_id=? AND requester_id=? AND operation='extract_receipt' AND expires_at>? AND session_ref IN (?) AND status NOT IN ? AND destination_department_id IN ? AND company_currency=? AND (target_expense_id='' OR target_expense_id IN (?)) AND ((source_kind='intake' AND source_id IN (?)) OR (source_kind='expense_receipt' AND source_id IN (?) AND source_parent_id IN (?)))", a.Company.ID, a.User.ID, now, sessions, []string{"cancelled", "stale"}, departments, a.Company.Currency, targets, intakes, receipts, parents)
}
