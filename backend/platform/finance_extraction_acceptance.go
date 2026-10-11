package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"time"
)

type FinanceExtractionAcceptance struct {
	ID                    string `gorm:"primaryKey"`
	CompanyID             string `gorm:"uniqueIndex:finance_result_acceptance"`
	ResultID              string `gorm:"uniqueIndex:finance_result_acceptance"`
	ActorID               string
	ReviewedHash          string
	ExpenseID             string
	ReceiptID             string
	ResultRevision        int64
	InternalSourceHash    string
	CleanGeneration       int64
	OriginalSourceVersion int64
	OriginalTargetVersion int64
	ResultingVersion      int64
	CreatedAt             time.Time
}
type ReceiptAcceptanceInput struct {
	ExpectedResultRevision  int64                      `json:"expectedResultRevision"`
	SourceKind              string                     `json:"sourceKind"`
	SourceID                string                     `json:"sourceId"`
	DestinationDepartmentID string                     `json:"destinationDepartmentId"`
	TargetExpenseID         string                     `json:"targetExpenseId,omitempty"`
	ExpectedTargetVersion   int64                      `json:"expectedTargetVersion,omitempty"`
	CopyEvidence            bool                       `json:"copyEvidence"`
	Fields                  map[string]json.RawMessage `json:"fields"`
	ConfirmedUncertainties  []string                   `json:"confirmedUncertainties"`
}

func parseReceiptAcceptance(f map[string]json.RawMessage) (ReceiptAcceptanceInput, error) {
	var input ReceiptAcceptanceInput
	raw, _ := json.Marshal(f)
	if e := strictJSON(raw, &input); e != nil {
		return input, e
	}
	if _, ok := f["copyEvidence"]; !ok {
		return input, invalid("Choose whether to publish independent receipt evidence.")
	}
	for field := range input.Fields {
		if !in(field, expenseFields...) {
			return input, invalid("Unknown or immutable reviewed expense field.")
		}
	}
	if input.ExpectedResultRevision != 1 || input.SourceID == "" || input.DestinationDepartmentID == "" || len(input.Fields) == 0 || ((input.TargetExpenseID == "") != (input.ExpectedTargetVersion == 0)) {
		return input, invalid("Inspect the result and explicitly confirm the draft destination and fields.")
	}
	var fields Expense
	if e := applyFields(input.Fields, &fields); e != nil {
		return input, e
	}
	if fields.DepartmentID != input.DestinationDepartmentID {
		return input, invalid("Reviewed department must match the destination.")
	}
	return input, nil
}
func validateReceiptReview(tx *gorm.DB, a *access, j FinanceAssistanceJob, result ReceiptExtractionResult, input ReceiptAcceptanceInput, first bool) (Expense, error) {
	var e Expense
	if j.SourceKind != input.SourceKind || j.SourceID != input.SourceID || j.DestinationDepartmentID != input.DestinationDepartmentID || j.TargetExpenseID != input.TargetExpenseID || j.TargetVersion != input.ExpectedTargetVersion || result.Revision != input.ExpectedResultRevision {
		return e, financeConflict()
	}
	known := map[string]bool{}
	for _, token := range result.Candidates.Unresolved {
		known[token] = true
	}
	seen := map[string]bool{}
	for _, token := range input.ConfirmedUncertainties {
		if !known[token] || seen[token] {
			return e, invalid("Confirm only the displayed unresolved fields.")
		}
		seen[token] = true
	}
	for token := range known {
		if !seen[token] {
			return e, invalid("Resolve and confirm every displayed uncertainty.")
		}
	}
	if input.CopyEvidence && j.SourceKind == "expense_receipt" {
		_, source, err := scopedFinanceReceipt(tx, a, j.SourceID)
		if err != nil {
			return e, err
		}
		if source.CreatedBy != a.User.ID && !financeAuthority(a.Member.Role) {
			return e, denied()
		}
	}
	if !first {
		return e, nil
	}
	if err := authorizeFinanceJobSource(tx, a, j, true); err != nil {
		return e, err
	}
	if j.Status != "ready" {
		return e, invalid("Wait for an available reviewed extraction result.")
	}
	if input.TargetExpenseID == "" {
		return prepareExpenseCreate(tx, a, input.Fields)
	}
	old, err := scopedExpense(tx, a, input.TargetExpenseID)
	if err != nil {
		return e, err
	}
	return prepareExpenseDraftPatch(tx, a, old, input.ExpectedTargetVersion, input.Fields, false)
}
func financeReceiptAudience(a *access, e Expense) []string {
	ids := []string{}
	for uid, m := range a.Members {
		user := a.Users[uid]
		if !m.Active || user.Suspended {
			continue
		}
		recipient := *a
		recipient.User = user
		recipient.Member = m
		if recipient.canReadExpense(e) {
			ids = append(ids, uid)
		}
	}
	sort.Strings(ids)
	return ids
}
func (s *Server) receiptAcceptanceRoutes() {
	base := "/api/companies/{cid}/finance/receipt-extractions/{id}"
	s.route("POST "+base+"/accept-preview", s.previewReceiptAcceptance)
	s.route("POST "+base+"/accept", s.acceptReceiptExtraction)
}
func (s *Server) previewReceiptAcceptance(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "expectedResultRevision", "sourceKind", "sourceId", "destinationDepartmentId", "targetExpenseId", "expectedTargetVersion", "copyEvidence", "fields", "confirmedUncertainties")
	if e != nil {
		return e
	}
	input, e := parseReceiptAcceptance(f)
	if e != nil {
		return e
	}
	var audience []string
	var actualSourceVersion int64
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		j, result, e := authorizeReceiptExtraction(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if result == nil {
			return invalid("Wait for extraction before reviewing.")
		}
		draft, e := validateReceiptReview(tx, a, j, *result, input, true)
		if e != nil {
			return e
		}
		actualSourceVersion = j.SourceVersion
		audience = financeReceiptAudience(a, draft)
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"fields": input.Fields, "sourceVersion": actualSourceVersion, "targetVersion": input.ExpectedTargetVersion, "audienceUserIds": audience, "evidenceNotice": "Selected evidence becomes an independently retained finance receipt. Future role and department changes can change its audience."})
}
func (s *Server) acceptReceiptExtraction(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedResultRevision", "sourceKind", "sourceId", "destinationDepartmentId", "targetExpenseId", "expectedTargetVersion", "copyEvidence", "fields", "confirmedUncertainties")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	input, e := parseReceiptAcceptance(f)
	if e != nil {
		return e
	}
	hash, e := businessHash(f)
	if e != nil {
		return e
	}
	var bytes []byte
	var sourceReceipt ExpenseReceipt
	var originalJob FinanceAssistanceJob
	// Source authorization happens before any private object is opened.
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var result *ReceiptExtractionResult
		var e error
		originalJob, result, e = authorizeReceiptExtraction(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if result == nil {
			return invalid("Wait for extraction before acceptance.")
		}
		if _, e = validateReceiptReview(tx, a, originalJob, *result, input, false); e != nil {
			return e
		}
		if input.CopyEvidence && originalJob.SourceKind == "expense_receipt" {
			sourceReceipt, _, e = scopedFinanceReceipt(tx, a, originalJob.SourceID)
			if e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	if input.CopyEvidence {
		if originalJob.SourceKind == "intake" {
			var intake FinanceAssistanceIntake
			if e = s.db.First(&intake, "id=? AND company_id=?", originalJob.SourceID, a.Company.ID).Error; e != nil {
				return missing()
			}
			bytes, e = s.readFinanceIntakeBytes(r.Context(), intake)
			sourceReceipt = ExpenseReceipt{FileName: intake.FileName, MimeType: intake.MimeType, Size: intake.Size}
		} else {
			bytes = sourceReceipt.Data
		}
		if e != nil || financeDigest(bytes) != originalJob.InternalHash {
			return missing()
		}
	}
	var canonical BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var j FinanceAssistanceJob
		var result *ReceiptExtractionResult
		auth := func() error {
			var e error
			j, result, e = authorizeReceiptExtraction(tx, a, r.PathValue("id"))
			if e != nil {
				return e
			}
			if result == nil {
				return invalid("Extraction result unavailable.")
			}
			_, e = validateReceiptReview(tx, a, j, *result, input, false)
			return e
		}
		replay := func(out BusinessResult) error {
			return authorizeExpenseResults(tx, a, BusinessResult{IDs: out.IDs[:1]})
		}
		var e error
		canonical, e = businessMutation(tx, a, "receipt_accept", key, map[string]any{"jobId": r.PathValue("id"), "fields": f}, auth, replay, func() (BusinessResult, error) {
			var claim FinanceExtractionAcceptance
			err := tx.First(&claim, "company_id=? AND result_id=?", a.Company.ID, result.ID).Error
			if err == nil {
				if claim.ActorID != a.User.ID || claim.ReviewedHash != hash {
					return BusinessResult{}, &apiError{409, "accepted_result_conflict", "This result already has a different accepted review.", nil}
				}
				if e := supersedeAttention(tx, a.Company.ID, "finance_extraction", j.ID, "receipt_review", ""); e != nil {
					return BusinessResult{}, e
				}
				out := BusinessResult{Kind: "receipt_acceptance", IDs: []string{claim.ExpenseID}, Versions: []int64{claim.ResultingVersion}}
				if claim.ReceiptID != "" {
					out.IDs = append(out.IDs, claim.ReceiptID)
				}
				return out, replay(out)
			}
			if err != gorm.ErrRecordNotFound {
				return BusinessResult{}, err
			}
			draft, e := validateReceiptReview(tx, a, j, *result, input, true)
			if e != nil {
				return BusinessResult{}, e
			}
			if input.TargetExpenseID == "" {
				if e = insertExpenseDraft(tx, a, &draft); e != nil {
					return BusinessResult{}, e
				}
			} else {
				old, e := scopedExpense(tx, a, input.TargetExpenseID)
				if e != nil {
					return BusinessResult{}, e
				}
				if e = commitExpenseDraftPatch(tx, a, old, draft, input.Fields); e != nil {
					return BusinessResult{}, e
				}
				draft.Version = old.Version + 1
			}
			receiptID := ""
			if input.CopyEvidence {
				if financeDigest(bytes) != j.InternalHash {
					return BusinessResult{}, missing()
				}
				receipt := ExpenseReceipt{ID: newID("rcp"), CompanyID: a.Company.ID, ExpenseID: draft.ID, FileName: sourceReceipt.FileName, MimeType: sourceReceipt.MimeType, Size: int64(len(bytes)), UploadedBy: a.User.ID, CreatedAt: nowString(), Data: bytes}
				if e = tx.Create(&receipt).Error; e != nil {
					return BusinessResult{}, e
				}
				if e = saveExpenseVersion(tx, &draft, draft.Version); e != nil {
					return BusinessResult{}, e
				}
				receiptID = receipt.ID
				if e = financeEvent(tx, a.Company.ID, draft.DepartmentID, "expense", draft.ID, a.User.ID, "receipt_uploaded", "Reviewed extraction evidence independently retained."); e != nil {
					return BusinessResult{}, e
				}
			}
			claim = FinanceExtractionAcceptance{ID: newID("facc"), CompanyID: a.Company.ID, ResultID: result.ID, ActorID: a.User.ID, ReviewedHash: hash, ExpenseID: draft.ID, ReceiptID: receiptID, ResultRevision: result.Revision, InternalSourceHash: j.InternalHash, CleanGeneration: j.CleanGeneration, OriginalSourceVersion: j.SourceVersion, OriginalTargetVersion: j.TargetVersion, ResultingVersion: draft.Version, CreatedAt: time.Now().UTC()}
			if e = tx.Create(&claim).Error; e != nil {
				return BusinessResult{}, e
			}
			if e = tx.Model(result).Update("acceptance_id", claim.ID).Error; e != nil {
				return BusinessResult{}, e
			}
			if e = tx.Model(&j).Update("status", "accepted").Error; e != nil {
				return BusinessResult{}, e
			}
			if e = syncExpenseAttention(tx, a, draft, draft); e != nil {
				return BusinessResult{}, e
			}
			if e := supersedeAttention(tx, a.Company.ID, "finance_extraction", j.ID, "receipt_review", ""); e != nil {
				return BusinessResult{}, e
			}
			out := BusinessResult{Kind: "receipt_acceptance", IDs: []string{draft.ID}, Versions: []int64{draft.Version}}
			if receiptID != "" {
				out.IDs = append(out.IDs, receiptID)
			}
			return out, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	receiptIDs := []string{}
	if len(canonical.IDs) > 1 {
		receiptIDs = canonical.IDs[1:]
	}
	return respond(w, 200, map[string]any{"ok": true, "id": canonical.IDs[0], "resultRevision": 1, "acceptedVersion": canonical.Versions[0], "receiptIds": receiptIDs})
}
