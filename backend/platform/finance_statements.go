package platform

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"gorm.io/gorm"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type FinanceStatementMapping struct {
	HeaderRow          bool   `json:"headerRow"`
	Delimiter          string `json:"delimiter"`
	DateColumn         int    `json:"dateColumn"`
	DateFormat         string `json:"dateFormat"`
	ReferenceColumn    *int   `json:"referenceColumn,omitempty"`
	DescriptionColumn  *int   `json:"descriptionColumn,omitempty"`
	CurrencyColumn     *int   `json:"currencyColumn,omitempty"`
	AmountMode         string `json:"amountMode"`
	SignedAmountColumn *int   `json:"signedAmountColumn,omitempty"`
	DebitColumn        *int   `json:"debitColumn,omitempty"`
	CreditColumn       *int   `json:"creditColumn,omitempty"`
	DebitSign          string `json:"debitSign"`
	DecimalSeparator   string `json:"decimalSeparator"`
	GroupingSeparator  string `json:"groupingSeparator"`
}
type FinanceStatementTotals struct {
	Debit  string `json:"debit"`
	Credit string `json:"credit"`
	Net    string `json:"net"`
}
type FinanceStatementRow struct {
	ID                string   `json:"id" gorm:"primaryKey"`
	CompanyID         string   `json:"-"`
	ImportID          string   `json:"importId" gorm:"uniqueIndex:finance_statement_ordinal"`
	RecordOrdinal     int      `json:"recordOrdinal" gorm:"uniqueIndex:finance_statement_ordinal"`
	BookedDate        string   `json:"bookedDate"`
	CompanyCurrency   string   `json:"currency"`
	SignedAmountMinor int64    `json:"signedAmountMinor"`
	Reference         string   `json:"reference"`
	Description       string   `json:"description"`
	ReviewedCells     []string `json:"reviewedCells" gorm:"serializer:json;type:jsonb"`
	Version           int64    `json:"version"`
}
type FinanceStatementPreview struct {
	ID            string                  `json:"id" gorm:"primaryKey"`
	CompanyID     string                  `json:"-"`
	ActorID       string                  `json:"-"`
	IntakeID      string                  `json:"intakeId"`
	IntakeVersion int64                   `json:"intakeVersion"`
	InternalHash  string                  `json:"-"`
	MappingHash   string                  `json:"-"`
	Mapping       FinanceStatementMapping `json:"mapping" gorm:"serializer:json;type:jsonb"`
	ParserVersion int                     `json:"parserVersion"`
	Revision      int64                   `json:"revision"`
	Rows          []FinanceStatementRow   `json:"-" gorm:"serializer:json;type:jsonb"`
	Totals        FinanceStatementTotals  `json:"totals" gorm:"serializer:json;type:jsonb"`
	Errors        []RowError              `json:"errors" gorm:"serializer:json;type:jsonb"`
	ImportID      string                  `json:"importId,omitempty"`
	CreatedAt     time.Time               `json:"createdAt"`
	ExpiresAt     time.Time               `json:"expiresAt"`
}
type FinanceStatementImport struct {
	ID              string                  `json:"id" gorm:"primaryKey"`
	CompanyID       string                  `json:"-"`
	CreatorID       string                  `json:"creatorId"`
	InternalHash    string                  `json:"-"`
	MappingHash     string                  `json:"-"`
	Mapping         FinanceStatementMapping `json:"mapping" gorm:"serializer:json;type:jsonb"`
	PreviewID       string                  `json:"previewId" gorm:"uniqueIndex"`
	Version         int64                   `json:"version"`
	RowCount        int                     `json:"rowCount"`
	Totals          FinanceStatementTotals  `json:"totals" gorm:"serializer:json;type:jsonb"`
	DuplicateReason string                  `json:"duplicateReason,omitempty"`
	CreatedAt       time.Time               `json:"createdAt"`
}
type FinanceStatementAudit struct {
	ID                                   string `gorm:"primaryKey"`
	CompanyID, ImportID, ActorID, Action string
	CreatedAt                            time.Time
}

func (m FinanceStatementMapping) validate(columns int) error {
	if !in(m.Delimiter, "comma", "semicolon", "tab") || !in(m.DateFormat, "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY") || !in(m.DecimalSeparator, "dot", "comma") || !in(m.GroupingSeparator, "none", "comma", "dot", "space") || m.DecimalSeparator == m.GroupingSeparator || m.DebitSign != "negative" {
		return invalid("Choose every separator, full-year date format and negative debit sign explicitly.")
	}
	roles := []int{m.DateColumn}
	for _, p := range []*int{m.ReferenceColumn, m.DescriptionColumn, m.CurrencyColumn} {
		if p != nil {
			roles = append(roles, *p)
		}
	}
	if m.AmountMode == "signed" {
		if m.SignedAmountColumn == nil || m.DebitColumn != nil || m.CreditColumn != nil {
			return invalid("Signed mapping requires only one amount column.")
		}
		roles = append(roles, *m.SignedAmountColumn)
	} else if m.AmountMode == "debit_credit" {
		if m.SignedAmountColumn != nil || m.DebitColumn == nil || m.CreditColumn == nil {
			return invalid("Debit/credit mapping requires separate debit and credit columns.")
		}
		roles = append(roles, *m.DebitColumn, *m.CreditColumn)
	} else {
		return invalid("Choose signed or debit/credit amounts.")
	}
	seen := map[int]bool{}
	for _, index := range roles {
		if index < 0 || index >= columns || seen[index] {
			return invalid("Each mapped role needs its own existing column index.")
		}
		seen[index] = true
	}
	return nil
}
func normalizeStatementMoney(raw string, m FinanceStatementMapping, currency string, signed, zero bool) (int64, error) {
	raw = strings.TrimSpace(raw)
	if zero && raw == "" {
		return 0, nil
	}
	sign := ""
	if len(raw) > 0 && (raw[0] == '-' || raw[0] == '+') {
		if !signed {
			return 0, invalid("Debit/credit columns require nonnegative values.")
		}
		sign = raw[:1]
		raw = raw[1:]
	}
	decimal := "."
	if m.DecimalSeparator == "comma" {
		decimal = ","
	}
	parts := strings.Split(raw, decimal)
	if len(parts) > 2 {
		return 0, invalid("Invalid selected decimal separator.")
	}
	major := parts[0]
	if m.GroupingSeparator != "none" {
		separator := map[string]string{"comma": ",", "dot": ".", "space": " "}[m.GroupingSeparator]
		if strings.Contains(major, separator) {
			pattern := `^[0-9]{1,3}(?:` + regexp.QuoteMeta(separator) + `[0-9]{3})+$`
			if !regexp.MustCompile(pattern).MatchString(major) {
				return 0, invalid("Grouping must use groups of three digits.")
			}
			major = strings.ReplaceAll(major, separator, "")
		}
	}
	value := major
	if len(parts) == 2 {
		value += "." + parts[1]
	}
	if zero && financeDecimal.MatchString(value) {
		digits := strings.ReplaceAll(value, ".", "")
		if strings.Trim(digits, "0") == "" {
			return 0, nil
		}
	}
	return parseFinanceDecimal(sign+value, currency, signed)
}
func parseFinanceStatement(ctx context.Context, data []byte, m FinanceStatementMapping, c Company) ([]FinanceStatementRow, FinanceStatementTotals, []RowError, error) {
	rows := []FinanceStatementRow{}
	totals := FinanceStatementTotals{"0", "0", "0"}
	errs := []RowError{}
	if len(data) == 0 || len(data) > 8<<20 || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return rows, totals, errs, invalid("Use a bounded UTF-8 CSV file.")
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	reader := csv.NewReader(bytes.NewReader(data))
	reader.Comma = map[string]rune{"comma": ',', "semicolon": ';', "tab": '\t'}[m.Delimiter]
	if reader.Comma == 0 {
		return rows, totals, errs, invalid("Select a CSV delimiter.")
	}
	reader.FieldsPerRecord = 0
	ordinal := 0
	count := 0
	var debit, credit, net int64
	for {
		if e := ctx.Err(); e != nil {
			return rows, totals, errs, e
		}
		record, e := reader.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return rows, totals, errs, invalid("Malformed CSV quoting or inconsistent columns; no partial import is allowed.")
		}
		ordinal++
		if len(record) > 32 {
			return rows, totals, errs, invalid("CSV supports at most 32 columns.")
		}
		logical := 0
		for _, cell := range record {
			logical += len(cell)
			if len(cell) > 4096 {
				return rows, totals, errs, invalid("A CSV cell exceeds 4 KiB.")
			}
		}
		if logical > 32<<10 {
			return rows, totals, errs, invalid("A CSV logical record exceeds 32 KiB.")
		}
		if ordinal == 1 {
			if e = m.validate(len(record)); e != nil {
				return rows, totals, errs, e
			}
			if m.HeaderRow {
				continue
			}
		}
		count++
		if count > 10000 {
			return rows, totals, errs, invalid("CSV supports at most 10,000 data records.")
		}
		row := FinanceStatementRow{RecordOrdinal: ordinal, CompanyCurrency: c.Currency, ReviewedCells: record, Version: 1}
		layout := map[string]string{"YYYY-MM-DD": "2006-01-02", "DD/MM/YYYY": "02/01/2006", "MM/DD/YYYY": "01/02/2006"}[m.DateFormat]
		date := strings.TrimSpace(record[m.DateColumn])
		parsed, e := time.Parse(layout, date)
		if e != nil || parsed.Format(layout) != date {
			errs = append(errs, RowError{ordinal, "Date does not match the selected full-year format."})
			continue
		}
		row.BookedDate = parsed.Format("2006-01-02")
		if e = validateExpenseDate(c, row.BookedDate); e != nil {
			errs = append(errs, RowError{ordinal, "Choose a real incurred date in the company timezone."})
			continue
		}
		if m.CurrencyColumn != nil && strings.TrimSpace(record[*m.CurrencyColumn]) != c.Currency {
			errs = append(errs, RowError{ordinal, "Currency must match the company currency; conversion is unavailable."})
			continue
		}
		if m.ReferenceColumn != nil {
			row.Reference = strings.TrimSpace(record[*m.ReferenceColumn])
		}
		if m.DescriptionColumn != nil {
			row.Description = strings.TrimSpace(record[*m.DescriptionColumn])
		}
		if utf8.RuneCountInString(row.Reference) > 240 || utf8.RuneCountInString(row.Description) > 1000 {
			errs = append(errs, RowError{ordinal, "Reference or description exceeds review bounds."})
			continue
		}
		if m.AmountMode == "signed" {
			row.SignedAmountMinor, e = normalizeStatementMoney(record[*m.SignedAmountColumn], m, c.Currency, true, false)
		} else {
			d, ed := normalizeStatementMoney(record[*m.DebitColumn], m, c.Currency, false, true)
			cr, ec := normalizeStatementMoney(record[*m.CreditColumn], m, c.Currency, false, true)
			if ed != nil || ec != nil || ((d == 0) == (cr == 0)) {
				e = invalid("Exactly one nonzero debit or credit is required.")
			} else if d != 0 {
				row.SignedAmountMinor = -d
			} else {
				row.SignedAmountMinor = cr
			}
		}
		if e != nil {
			errs = append(errs, RowError{ordinal, "Amount does not match the selected exact mapping or supported bounds."})
			continue
		}
		net, e = checkedMinorSum(net, row.SignedAmountMinor)
		if e != nil {
			return rows, totals, errs, e
		}
		if row.SignedAmountMinor < 0 {
			debit, e = checkedMinorSum(debit, -row.SignedAmountMinor)
		} else {
			credit, e = checkedMinorSum(credit, row.SignedAmountMinor)
		}
		if e != nil {
			return rows, totals, errs, e
		}
		rows = append(rows, row)
	}
	if count == 0 {
		return rows, totals, errs, invalid("The statement has no data records.")
	}
	totals = FinanceStatementTotals{strconv.FormatInt(debit, 10), strconv.FormatInt(credit, 10), strconv.FormatInt(net, 10)}
	return rows, totals, errs, nil
}
func authorizeFinanceStatementPreview(tx *gorm.DB, a *access, id string) (FinanceStatementPreview, error) {
	var p FinanceStatementPreview
	if !financeAuthority(a.Member.Role) {
		return p, missing()
	}
	if e := tx.First(&p, "id=? AND company_id=? AND actor_id=? AND expires_at>?", id, a.Company.ID, a.User.ID, time.Now()).Error; e != nil {
		return p, missing()
	}
	intake, e := authorizeFinanceIntake(tx, a, p.IntakeID)
	if e != nil || intake.Purpose != "statement" || intake.State != "clean" || intake.InternalSHA256 != p.InternalHash {
		return p, missing()
	}
	return p, nil
}
func (s *Server) financeStatementRoutes() {
	base := "/api/companies/{cid}/finance"
	s.route("POST "+base+"/statement-previews", s.createFinanceStatementPreview)
	s.route("GET "+base+"/statement-previews/{id}", s.getFinanceStatementPreview)
	s.route("POST "+base+"/statement-previews/{id}/import", s.importFinanceStatement)
	s.route("GET "+base+"/statement-imports", s.listFinanceStatementImports)
	s.route("GET "+base+"/statement-imports/{id}", s.getFinanceStatementImport)
	s.route("GET "+base+"/statement-imports/{id}/rows", s.financeStatementRows)
	s.route("GET "+base+"/statement-imports/{id}/export", s.exportFinanceStatement)
}
func (s *Server) createFinanceStatementPreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "intakeId", "expectedIntakeVersion", "mapping")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		IntakeID              string                  `json:"intakeId"`
		ExpectedIntakeVersion int64                   `json:"expectedIntakeVersion"`
		Mapping               FinanceStatementMapping `json:"mapping"`
	}
	var mappingFields map[string]json.RawMessage
	if e := json.Unmarshal(f["mapping"], &mappingFields); e != nil {
		return invalid("Choose an explicit statement mapping.")
	}
	for _, name := range []string{"headerRow", "delimiter", "dateColumn", "dateFormat", "amountMode", "debitSign", "decimalSeparator", "groupingSeparator"} {
		if value, ok := mappingFields[name]; !ok || string(value) == "null" {
			return invalid("Choose every statement mapping explicitly.")
		}
	}
	raw, _ := json.Marshal(f)
	if e = strictJSON(raw, &input); e != nil {
		return e
	}
	var intake FinanceAssistanceIntake
	var existing *FinanceStatementPreview
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !financeAuthority(a.Member.Role) {
			return denied()
		}
		var e error
		intake, e = authorizeFinanceIntake(tx, a, input.IntakeID)
		if e != nil {
			return e
		}
		if intake.Purpose != "statement" || intake.State != "clean" {
			return invalid("Use a clean statement intake.")
		}
		var retry BusinessMutationRetry
		if tx.First(&retry, "company_id=? AND actor_id=? AND operation='statement_preview' AND retry_key=?", a.Company.ID, a.User.ID, key).Error == nil {
			hash, e := businessHash(f)
			if e != nil {
				return e
			}
			if retry.RequestHash != hash {
				return financeConflict()
			}
			p, e := authorizeFinanceStatementPreview(tx, a, retry.ResultIDs[0])
			if e != nil {
				return e
			}
			existing = &p
		}
		return nil
	})
	if e != nil {
		return e
	}
	if existing != nil {
		return respond(w, 200, financePreviewPage(*existing, 0, 100, a))
	}
	data, e := s.readFinanceIntakeBytes(r.Context(), intake)
	if e != nil {
		return missing()
	}
	parsedCurrency := a.Company.Currency
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	rows, totals, errs, e := parseFinanceStatement(ctx, data, input.Mapping, a.Company)
	cancel()
	if e != nil {
		return e
	}
	var preview FinanceStatementPreview
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		auth := func() error {
			fresh, e := authorizeFinanceIntake(tx, a, intake.ID)
			if e != nil {
				return e
			}
			if !financeAuthority(a.Member.Role) || fresh.State != "clean" || fresh.Purpose != "statement" || fresh.InternalSHA256 != intake.InternalSHA256 || fresh.ContentGeneration != intake.ContentGeneration || a.Company.Currency != parsedCurrency {
				return missing()
			}
			intake = fresh
			return nil
		}
		_, e := financeBusinessMutation(tx, a, "statement_preview", key, f, auth, func(out BusinessResult) error {
			var e error
			preview, e = authorizeFinanceStatementPreview(tx, a, out.IDs[0])
			return e
		}, func() (BusinessResult, error) {
			if intake.Version != input.ExpectedIntakeVersion {
				return BusinessResult{}, financeConflict()
			}
			mappingHash, _ := businessHash(input.Mapping)
			preview = FinanceStatementPreview{ID: newID("fsp"), CompanyID: a.Company.ID, ActorID: a.User.ID, IntakeID: intake.ID, IntakeVersion: intake.Version, InternalHash: intake.InternalSHA256, MappingHash: mappingHash, Mapping: input.Mapping, ParserVersion: 1, Revision: 1, Rows: rows, Totals: totals, Errors: errs, CreatedAt: time.Now().UTC(), ExpiresAt: intake.ExpiresAt}
			if e := tx.Create(&preview).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "statement_preview", IDs: []string{preview.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, financePreviewPage(preview, 0, 100, a))
}
func financePreviewPage(p FinanceStatementPreview, offset, limit int, a *access) map[string]any {
	end := min(offset+limit, len(p.Rows))
	offset = min(offset, end)
	nextCursor := ""
	if end < len(p.Rows) {
		nextCursor = encodeReadCursor(readCursor{financePreviewBasis(a, p), "", strconv.Itoa(end)})
	}
	return map[string]any{"nextPageCursor": nextCursor, "preview": p, "rows": p.Rows[offset:end], "rowCount": len(p.Rows), "hasMore": end < len(p.Rows), "nextOffset": end}
}
func financePreviewBasis(a *access, p FinanceStatementPreview) string {
	return payloadHash([]string{accessBasis(a), "statement-preview", p.ID, strconv.FormatInt(p.Revision, 10), p.MappingHash, p.InternalHash})
}
func (s *Server) getFinanceStatementPreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	offset := 0
	if r.URL.Query().Has("offset") {
		return invalid("Use the current preview page cursor.")
	}
	var p FinanceStatementPreview
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		p, e = authorizeFinanceStatementPreview(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			c, err := decodeReadCursor(raw, financePreviewBasis(a, p))
			if err != nil {
				return err
			}
			offset, err = strconv.Atoi(c.ID)
			if err != nil || offset < 1 || offset > len(p.Rows) {
				return invalid("Invalid preview cursor.")
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, financePreviewPage(p, offset, limit, a))
}
func (s *Server) importFinanceStatement(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedPreviewRevision", "duplicateReason")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		ExpectedPreviewRevision int64
		DuplicateReason         string
	}
	if e = applyFields(f, &input); e != nil {
		return e
	}
	var canonical BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var p FinanceStatementPreview
		auth := func() error { var e error; p, e = authorizeFinanceStatementPreview(tx, a, r.PathValue("id")); return e }
		replay := func(out BusinessResult) error { _, e := authorizeFinanceStatementImport(tx, a, out.IDs[0]); return e }
		var e error
		canonical, e = financeBusinessMutation(tx, a, "statement_import", key, map[string]any{"previewId": r.PathValue("id"), "fields": f}, auth, replay, func() (BusinessResult, error) {
			if p.Revision != input.ExpectedPreviewRevision || len(p.Errors) > 0 {
				return BusinessResult{}, invalid("Resolve every row error and review the complete preview before import.")
			}
			if p.ImportID != "" {
				var accepted FinanceStatementImport
				if e := tx.First(&accepted, "id=? AND company_id=?", p.ImportID, a.Company.ID).Error; e != nil {
					return BusinessResult{}, missing()
				}
				if accepted.DuplicateReason != input.DuplicateReason || input.ExpectedPreviewRevision != p.Revision {
					return BusinessResult{}, financeConflict()
				}
				return BusinessResult{Kind: "statement_import", IDs: []string{p.ImportID}, Versions: []int64{1}}, nil
			}
			var prior int64
			if e := tx.Model(&FinanceStatementImport{}).Where("company_id=? AND internal_hash=?", a.Company.ID, p.InternalHash).Count(&prior).Error; e != nil {
				return BusinessResult{}, e
			}
			if prior > 0 && !meaningfulReason(input.DuplicateReason) {
				return BusinessResult{}, invalid("This file was previously imported. Explain a deliberate duplicate import before continuing.")
			}
			imported := FinanceStatementImport{ID: newID("fsi"), CompanyID: a.Company.ID, CreatorID: a.User.ID, InternalHash: p.InternalHash, MappingHash: p.MappingHash, Mapping: p.Mapping, PreviewID: p.ID, Version: 1, RowCount: len(p.Rows), Totals: p.Totals, DuplicateReason: input.DuplicateReason, CreatedAt: time.Now().UTC()}
			if e := tx.Create(&imported).Error; e != nil {
				return BusinessResult{}, e
			}
			importRows := []FinanceStatementRow{}
			for _, row := range p.Rows {
				row.ID = newID("fsr")
				row.CompanyID = a.Company.ID
				row.ImportID = imported.ID
				importRows = append(importRows, row)
			}
			if e := tx.CreateInBatches(importRows, 100).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := initialFinanceStatementAttention(tx, a, importRows); e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Model(&p).Update("import_id", imported.ID).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Create(&FinanceStatementAudit{ID: newID("fsa"), CompanyID: a.Company.ID, ImportID: imported.ID, ActorID: a.User.ID, Action: "statement_imported", CreatedAt: time.Now().UTC()}).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "statement_import", IDs: []string{imported.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": canonical.IDs[0], "version": canonical.Versions[0]})
}
func authorizeFinanceStatementImport(tx *gorm.DB, a *access, id string) (FinanceStatementImport, error) {
	var imported FinanceStatementImport
	if !financeAuthority(a.Member.Role) || a.Users[a.User.ID].Suspended {
		return imported, missing()
	}
	if e := tx.First(&imported, "company_id=? AND id=?", a.Company.ID, id).Error; e != nil {
		return imported, missing()
	}
	return imported, nil
}
func (s *Server) getFinanceStatementImport(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var imported FinanceStatementImport
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var e error
		imported, e = authorizeFinanceStatementImport(tx, a, r.PathValue("id"))
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, imported)
}
func (s *Server) listFinanceStatementImports(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	items := []FinanceStatementImport{}
	cursor := ""
	more := false
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if !financeAuthority(a.Member.Role) {
			return denied()
		}
		basis := payloadHash([]string{accessBasis(a), "statement_imports"})
		q := tx.Where("company_id=?", a.Company.ID)
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
func (s *Server) financeStatementRows(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	items := []FinanceStatementRow{}
	cursor := ""
	more := false
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if _, e := authorizeFinanceStatementImport(tx, a, r.PathValue("id")); e != nil {
			return e
		}
		basis := payloadHash([]string{accessBasis(a), "statement_rows", r.PathValue("id")})
		q := tx.Where("company_id=? AND import_id=?", a.Company.ID, r.PathValue("id"))
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			c, e := decodeReadCursor(raw, basis)
			if e != nil {
				return e
			}
			ordinal, e := strconv.Atoi(c.Created)
			if e != nil {
				return invalid("Invalid statement row cursor.")
			}
			q = q.Where("record_ordinal>?", ordinal)
		}
		if e := q.Order("record_ordinal").Limit(limit + 1).Find(&items).Error; e != nil {
			return e
		}
		more = len(items) > limit
		if more {
			items = items[:limit]
			last := items[len(items)-1]
			cursor = encodeReadCursor(readCursor{basis, strconv.Itoa(last.RecordOrdinal), last.ID})
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"items": items, "cursor": cursor, "hasMore": more})
}
func financeCSVSafe(value string) string {
	trimmed := strings.TrimLeftFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) })
	if len(trimmed) > 0 && strings.ContainsRune("=+-@", rune(trimmed[0])) {
		return "'" + value
	}
	return value
}
func (s *Server) exportFinanceStatement(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var rows []FinanceStatementRow
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if _, e := authorizeFinanceStatementImport(tx, a, r.PathValue("id")); e != nil {
			return e
		}
		return tx.Where("company_id=? AND import_id=?", a.Company.ID, r.PathValue("id")).Order("record_ordinal").Limit(10000).Find(&rows).Error
	})
	if e != nil {
		return e
	}
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	writer.Write([]string{"recordOrdinal", "bookedDate", "currency", "signedAmountMinor", "reference", "description"})
	for _, row := range rows {
		writer.Write([]string{strconv.Itoa(row.RecordOrdinal), row.BookedDate, row.CompanyCurrency, strconv.FormatInt(row.SignedAmountMinor, 10), financeCSVSafe(row.Reference), financeCSVSafe(row.Description)})
		if buffer.Len() > 16<<20 {
			return invalid("Statement export exceeds 16 MiB.")
		}
	}
	writer.Flush()
	if e = writer.Error(); e != nil {
		return e
	}
	data := buffer.Bytes()
	if len(data) > 16<<20 {
		return invalid("Statement export exceeds 16 MiB.")
	}
	for offset := 0; offset < len(data); offset += 16384 {
		e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error { _, e := authorizeFinanceStatementImport(tx, a, r.PathValue("id")); return e })
		if e != nil {
			return e
		}
		if offset == 0 {
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			w.Header().Set("Content-Length", strconv.Itoa(len(data)))
			w.Header().Set("Content-Disposition", "attachment; filename=statement.csv")
			w.Header().Set("Cache-Control", "no-store")
		}
		end := min(offset+16384, len(data))
		if _, e = w.Write(data[offset:end]); e != nil {
			return e
		}
	}
	return nil
}
