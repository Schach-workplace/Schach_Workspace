package platform

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"time"
	"unicode/utf8"
)

type FinanceDuplicateCandidate struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	CompanyID         string    `json:"-"`
	SourceKind        string    `json:"sourceKind" gorm:"uniqueIndex:finance_duplicate_pair"`
	SourceID          string    `json:"sourceId" gorm:"uniqueIndex:finance_duplicate_pair"`
	SourceVersion     int64     `json:"sourceVersion"`
	SourceBasisHash   string    `json:"-" gorm:"uniqueIndex:finance_duplicate_pair"`
	ComparedExpenseID string    `json:"comparedExpenseId" gorm:"uniqueIndex:finance_duplicate_pair"`
	ComparedVersion   int64     `json:"comparedVersion"`
	AlgorithmVersion  int       `json:"algorithmVersion" gorm:"uniqueIndex:finance_duplicate_pair"`
	Reason            string    `json:"reason"`
	State             string    `json:"state"`
	Version           int64     `json:"version"`
	CreatedAt         time.Time `json:"createdAt"`
}
type FinanceDuplicateDecision struct {
	ID                                                string `gorm:"primaryKey"`
	CompanyID, CandidateID, ActorID, Reason, RetryKey string
	CandidateVersion                                  int64
	CreatedAt                                         time.Time
}
type FinanceDuplicateBasis struct {
	CompanyID, SourceKind, SourceID        string
	SourceVersion                          int64
	ReviewedFields                         map[string]json.RawMessage
	InternalSourceHash, ReviewedFieldsHash string
	ComparisonCursor                       string
}

func duplicateSource(tx *gorm.DB, a *access, b FinanceDuplicateBasis) (Expense, error) {
	if b.CompanyID != a.Company.ID {
		return Expense{}, missing()
	}
	if b.SourceKind == "expense" {
		e, err := scopedExpense(tx, a, b.SourceID)
		if err != nil {
			return e, err
		}
		if e.Version != b.SourceVersion {
			return e, financeConflict()
		}
		return e, nil
	}
	if b.SourceKind != "extraction" {
		return Expense{}, invalid("Choose an expense or reviewed extraction.")
	}
	_, result, e := authorizeReceiptExtraction(tx, a, b.SourceID)
	if e != nil {
		return Expense{}, e
	}
	if result == nil || result.Revision != b.SourceVersion {
		return Expense{}, financeConflict()
	}
	return prepareExpenseReviewedFields(tx, a, b.ReviewedFields, false)
}
func duplicateDateDistance(a, b string) int {
	da, e := time.Parse("2006-01-02", a)
	if e != nil {
		return 999
	}
	db, e := time.Parse("2006-01-02", b)
	if e != nil {
		return 999
	}
	d := int(da.Sub(db).Hours() / 24)
	if d < 0 {
		d = -d
	}
	return d
}
func nearInvoice(a, b string) bool {
	aa, bb := []rune(a), []rune(b)
	if len(aa) < 4 || len(bb) < 4 || len(aa) > 160 || len(bb) > 160 {
		return false
	}
	if len(aa)-len(bb) > 1 || len(bb)-len(aa) > 1 {
		return false
	}
	previous := make([]int, len(bb)+1)
	for i := range previous {
		previous[i] = i
	}
	for i, x := range aa {
		next := make([]int, len(bb)+1)
		next[0] = i + 1
		for j, y := range bb {
			cost := 0
			if x != y {
				cost = 1
			}
			next[j+1] = min(next[j]+1, previous[j+1]+1, previous[j]+cost)
		}
		previous = next
	}
	return previous[len(bb)] <= 1
}
func expenseCleanHashes(tx *gorm.DB, cid, id string) ([]string, error) {
	var receipts []ExpenseReceipt
	if e := tx.Select("id").Where("company_id=? AND expense_id=?", cid, id).Find(&receipts).Error; e != nil {
		return nil, e
	}
	ids := []string{}
	for _, r := range receipts {
		ids = append(ids, r.ID)
	}
	hashes := []string{}
	e := tx.Model(&ReceiptEvidenceFingerprint{}).Where("company_id=? AND receipt_id IN ? AND state='clean'", cid, ids).Pluck("sha256", &hashes).Error
	return hashes, e
}
func computeFinanceDuplicateCandidates(tx *gorm.DB, a *access, b FinanceDuplicateBasis) ([]FinanceDuplicateCandidate, error) {
	items, _, e := computeFinanceDuplicatePage(tx, a, b)
	return items, e
}
func computeFinanceDuplicatePage(tx *gorm.DB, a *access, b FinanceDuplicateBasis) ([]FinanceDuplicateCandidate, string, error) {
	source, e := duplicateSource(tx, a, b)
	if e != nil {
		return nil, "", e
	}
	if b.SourceKind == "extraction" {
		job, _, err := authorizeReceiptExtraction(tx, a, b.SourceID)
		if err != nil {
			return nil, "", err
		}
		b.InternalSourceHash = job.InternalHash
	}
	sourceHash, e := businessHash([]any{b.SourceKind, b.SourceID, b.SourceVersion, b.ReviewedFieldsHash, b.InternalSourceHash})
	if e != nil {
		return nil, "", e
	}
	var peers []Expense
	q := expenseReadQuery(tx, a).Where("status<>'void'")
	if b.SourceKind == "expense" {
		q = q.Where("id<>?", source.ID)
	}
	basis := payloadHash([]string{accessBasis(a), "duplicate-comparison", b.SourceKind, b.SourceID, fmt.Sprint(b.SourceVersion), sourceHash})
	if b.ComparisonCursor != "" {
		c, err := decodeReadCursor(b.ComparisonCursor, basis)
		if err != nil {
			return nil, "", err
		}
		q = q.Where("id>?", c.ID)
	}
	if e = q.Order("id").Limit(101).Find(&peers).Error; e != nil {
		return nil, "", e
	}
	nextCursor := ""
	if len(peers) > 100 {
		peers = peers[:100]
		nextCursor = encodeReadCursor(readCursor{basis, "", peers[len(peers)-1].ID})
	}
	sourceHashes, e := expenseCleanHashes(tx, a.Company.ID, source.ID)
	if e != nil {
		return nil, "", e
	}
	if b.InternalSourceHash != "" {
		sourceHashes = append(sourceHashes, b.InternalSourceHash)
	}
	out := []FinanceDuplicateCandidate{}
	for _, peer := range peers {
		reason := ""
		if source.VendorKey == peer.VendorKey && source.InvoiceKey != "" && source.InvoiceKey == peer.InvoiceKey {
			reason = "exact_vendor_invoice"
		}
		if reason == "" {
			hashes, e := expenseCleanHashes(tx, a.Company.ID, peer.ID)
			if e != nil {
				return nil, "", e
			}
			for _, h := range hashes {
				if in(h, sourceHashes...) {
					reason = "same_receipt_content"
					break
				}
			}
		}
		if reason == "" && source.VendorKey == peer.VendorKey && source.AmountMinor == peer.AmountMinor && source.Currency == peer.Currency {
			days := duplicateDateDistance(source.ExpenseDate, peer.ExpenseDate)
			if days <= 7 && nearInvoice(source.InvoiceKey, peer.InvoiceKey) {
				reason = "near_invoice"
			} else if days <= 3 {
				reason = "same_vendor_amount_date"
			}
		}
		if reason == "" {
			continue
		}
		kind, id, version := b.SourceKind, b.SourceID, b.SourceVersion
		other := peer.ID
		otherVersion := peer.Version
		if kind == "expense" && id > other {
			id, other = other, id
			version, otherVersion = otherVersion, version
		}
		basisIntent := []any{sourceHash, peer.ID, peer.Version, reason}
		if kind == "expense" {
			basisIntent = []any{kind, id, version, other, otherVersion}
		}
		basis, e := businessHash(basisIntent)
		if e != nil {
			return nil, "", e
		}
		out = append(out, FinanceDuplicateCandidate{ID: newID("fdup"), CompanyID: a.Company.ID, SourceKind: kind, SourceID: id, SourceVersion: version, SourceBasisHash: basis, ComparedExpenseID: other, ComparedVersion: otherVersion, AlgorithmVersion: 1, Reason: reason, State: "open", Version: 1, CreatedAt: time.Now().UTC()})
	}
	return out, nextCursor, nil
}
func persistFinanceDuplicateCandidates(tx *gorm.DB, a *access, items []FinanceDuplicateCandidate) error {
	for index := range items {
		item := &items[index]
		if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(item).Error; e != nil {
			return e
		}
		if e := tx.First(item, "company_id=? AND source_kind=? AND source_id=? AND source_basis_hash=? AND compared_expense_id=? AND algorithm_version=?", a.Company.ID, item.SourceKind, item.SourceID, item.SourceBasisHash, item.ComparedExpenseID, item.AlgorithmVersion).Error; e != nil {
			return e
		}
		if e := syncFinanceDuplicateAttention(tx, a, *item); e != nil {
			return e
		}
	}
	return nil
}
func authorizeFinanceDuplicate(tx *gorm.DB, a *access, id string) (FinanceDuplicateCandidate, error) {
	var c FinanceDuplicateCandidate
	if e := tx.First(&c, "company_id=? AND id=?", a.Company.ID, id).Error; e != nil {
		return c, missing()
	}
	peer, e := scopedExpense(tx, a, c.ComparedExpenseID)
	if e != nil || peer.Version != c.ComparedVersion || c.State == "stale" {
		return c, missing()
	}
	if c.SourceKind == "expense" {
		source, e := scopedExpense(tx, a, c.SourceID)
		if e != nil || source.Version != c.SourceVersion {
			return c, missing()
		}
	} else {
		_, result, e := authorizeReceiptExtraction(tx, a, c.SourceID)
		if e != nil || result == nil || result.Revision != c.SourceVersion || result.AcceptanceID != "" {
			return c, missing()
		}
	}
	return c, nil
}
func (s *Server) financeDuplicateRoutes() {
	base := "/api/companies/{cid}/finance"
	s.route("GET "+base+"/duplicate-candidates", s.listFinanceDuplicates)
	s.route("GET "+base+"/duplicate-candidates/{id}", s.getFinanceDuplicate)
	s.route("POST "+base+"/duplicate-candidates/review", s.reviewFinanceDuplicates)
	s.route("POST "+base+"/duplicates/preview", s.previewFinanceDuplicates)
	s.route("POST "+base+"/duplicate-candidates/{id}/dismiss", s.dismissFinanceDuplicate)
}
func (s *Server) reviewFinanceDuplicates(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "sourceKind", "sourceId", "expectedVersion", "fields", "comparisonCursor")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		SourceKind, SourceID string
		ComparisonCursor     string
		ExpectedVersion      int64
		Fields               map[string]json.RawMessage
	}
	raw, _ := json.Marshal(f)
	if e = strictJSON(raw, &input); e != nil {
		return e
	}
	if input.SourceKind == "expense" && input.Fields != nil || input.SourceKind == "extraction" && len(input.Fields) == 0 {
		return invalid("Reviewed fields apply only to extraction.")
	}
	for k := range input.Fields {
		if !in(k, expenseFields...) {
			return invalid("Unknown reviewed field.")
		}
	}
	b := FinanceDuplicateBasis{CompanyID: a.Company.ID, SourceKind: input.SourceKind, SourceID: input.SourceID, SourceVersion: input.ExpectedVersion, ReviewedFields: input.Fields, ComparisonCursor: input.ComparisonCursor}
	b.ReviewedFieldsHash, _ = businessHash(input.Fields)
	var items []FinanceDuplicateCandidate
	nextCursor := ""
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		prepared, next, err := computeFinanceDuplicatePage(tx, a, b)
		if err != nil {
			return err
		}
		nextCursor = next
		auth := func() error { _, e := duplicateSource(tx, a, b); return e }
		result, e := financeBusinessMutation(tx, a, "duplicate_review", key, f, auth, func(out BusinessResult) error {
			for _, id := range out.IDs {
				c, e := authorizeFinanceDuplicate(tx, a, id)
				if e != nil {
					return e
				}
				items = append(items, c)
			}
			return nil
		}, func() (BusinessResult, error) {
			items = prepared
			if e := persistFinanceDuplicateCandidates(tx, a, items); e != nil {
				return BusinessResult{}, e
			}
			out := BusinessResult{Kind: "finance_duplicates", IDs: []string{}, Versions: []int64{}}
			for _, item := range items {
				out.IDs = append(out.IDs, item.ID)
				out.Versions = append(out.Versions, item.Version)
			}
			return out, nil
		})
		_ = result
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"items": items, "nextComparisonCursor": nextCursor, "hasMoreComparisons": nextCursor != ""})
}
func (s *Server) previewFinanceDuplicates(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "sourceExtractionId", "expectedResultRevision", "fields", "comparisonCursor")
	if e != nil {
		return e
	}
	var input struct {
		SourceExtractionID     string
		ComparisonCursor       string
		ExpectedResultRevision int64
		Fields                 map[string]json.RawMessage
	}
	if e = applyFields(f, &input); e != nil {
		return e
	}
	for k := range input.Fields {
		if !in(k, expenseFields...) {
			return invalid("Unknown reviewed field.")
		}
	}
	b := FinanceDuplicateBasis{CompanyID: a.Company.ID, SourceKind: "extraction", SourceID: input.SourceExtractionID, SourceVersion: input.ExpectedResultRevision, ReviewedFields: input.Fields, ComparisonCursor: input.ComparisonCursor}
	b.ReviewedFieldsHash, _ = businessHash(input.Fields)
	var items []FinanceDuplicateCandidate
	nextCursor := ""
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		items, nextCursor, e = computeFinanceDuplicatePage(tx, a, b)
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"items": items, "nextComparisonCursor": nextCursor, "hasMoreComparisons": nextCursor != ""})
}
func (s *Server) getFinanceDuplicate(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var item FinanceDuplicateCandidate
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		item, e = authorizeFinanceDuplicate(tx, a, r.PathValue("id"))
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, item)
}
func (s *Server) listFinanceDuplicates(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	items := []FinanceDuplicateCandidate{}
	cursor := ""
	more := false
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		state := r.URL.Query().Get("state")
		if state == "" {
			state = "open"
		}
		if !in(state, "open", "dismissed") {
			return invalid("Choose open or dismissed suggestions.")
		}
		basis := payloadHash([]string{accessBasis(a), "finance_duplicates", state})
		q := financeDuplicateReadQuery(tx, a).Where("state=?", state)
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			c, e := decodeReadCursor(raw, basis)
			if e != nil {
				return e
			}
			q = q.Where("created_at<? OR(created_at=? AND id<?)", c.Created, c.Created, c.ID)
		}
		if e := q.Order("created_at DESC,id DESC").Limit(limit + 1).Find(&items).Error; e != nil {
			return e
		}
		more = len(items) > limit
		if more {
			items = items[:limit]
			last := items[len(items)-1]
			cursor = encodeReadCursor(readCursor{basis, last.CreatedAt.Format(time.RFC3339Nano), last.ID})
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"items": items, "cursor": cursor, "hasMore": more})
}
func (s *Server) dismissFinanceDuplicate(w http.ResponseWriter, r *http.Request) error {
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
	if !meaningfulReason(input.Reason) || utf8.RuneCountInString(input.Reason) > 4000 {
		return invalid("Explain the dismissal in 12–4,000 Unicode characters.")
	}
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var item FinanceDuplicateCandidate
		auth := func() error { var e error; item, e = authorizeFinanceDuplicate(tx, a, r.PathValue("id")); return e }
		var e error
		result, e = financeBusinessMutation(tx, a, "duplicate_dismiss", key, map[string]any{"id": r.PathValue("id"), "fields": f}, auth, func(out BusinessResult) error { return nil }, func() (BusinessResult, error) {
			if item.Version != input.ExpectedVersion || item.State != "open" {
				return BusinessResult{}, financeConflict()
			}
			item.State = "dismissed"
			item.Version++
			if e := tx.Save(&item).Error; e != nil {
				return BusinessResult{}, e
			}
			decision := FinanceDuplicateDecision{ID: newID("fdd"), CompanyID: a.Company.ID, CandidateID: item.ID, ActorID: a.User.ID, Reason: input.Reason, RetryKey: key, CandidateVersion: input.ExpectedVersion, CreatedAt: time.Now().UTC()}
			if e := tx.Create(&decision).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := syncFinanceDuplicateAttention(tx, a, item); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "finance_duplicate", IDs: []string{item.ID}, Versions: []int64{item.Version}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, result)
}

func staleFinanceDuplicates(tx *gorm.DB, cid, id string) error {
	return tx.Model(&FinanceDuplicateCandidate{}).Where("company_id=? AND (compared_expense_id=? OR (source_kind='expense' AND source_id=?)) AND state<>'stale'", cid, id, id).Update("state", "stale").Error
}
