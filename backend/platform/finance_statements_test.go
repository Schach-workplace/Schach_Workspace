package platform

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestFinanceStatementExactSignedMapping(t *testing.T) {
	company := Company{Currency: "INR", Timezone: "Asia/Kolkata"}
	m := FinanceStatementMapping{HeaderRow: true, Delimiter: "semicolon", DateColumn: 0, DateFormat: "DD/MM/YYYY", AmountMode: "signed", SignedAmountColumn: intPointer(1), DecimalSeparator: "comma", GroupingSeparator: "dot", DebitSign: "negative"}
	rows, totals, errs, e := parseFinanceStatement(context.Background(), []byte("date;amount\n10/10/2026;-1.300,50\n10/10/2026;-1.300,50\n10/10/2026;+10,00\n"), m, company)
	if e != nil || len(errs) != 0 || len(rows) != 3 || rows[0].SignedAmountMinor != -130050 || rows[0].RecordOrdinal == rows[1].RecordOrdinal || totals.Debit != "260100" || totals.Credit != "1000" || totals.Net != "-259100" {
		t.Fatal(rows, totals, errs, e)
	}
	for _, raw := range []string{"1.001", "1e3", "(100)", "1,00,000", "0"} {
		m.DecimalSeparator = "dot"
		m.GroupingSeparator = "none"
		_, _, errs, e := parseFinanceStatement(context.Background(), []byte("date;amount\n10/10/2026;"+raw), m, company)
		if e == nil && len(errs) == 0 {
			t.Fatal("accepted", raw)
		}
	}
}
func intPointer(n int) *int { return &n }
func TestFinanceStatementBoundsAndExactTotals(t *testing.T) {
	m := FinanceStatementMapping{Delimiter: "comma", DateColumn: 0, DateFormat: "YYYY-MM-DD", AmountMode: "signed", SignedAmountColumn: intPointer(1), DecimalSeparator: "dot", GroupingSeparator: "none", DebitSign: "negative"}
	c := Company{Currency: "INR", Timezone: "Asia/Kolkata"}
	raw := strings.Repeat("2026-10-10,-10000000000.00\n", 10000)
	rows, totals, errs, e := parseFinanceStatement(t.Context(), []byte(raw), m, c)
	if e != nil || len(errs) != 0 || len(rows) != 10000 || totals.Debit != "10000000000000000" {
		t.Fatal(totals, len(errs), e)
	}
	if _, _, _, e := parseFinanceStatement(t.Context(), []byte(raw+"2026-10-10,-1\n"), m, c); e == nil {
		t.Fatal("10001 rows")
	}
}
func readyStatementPreview(t *testing.T, f financeFixture) string {
	t.Helper()
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceIntakeStore = store
	f.s.opts.FinanceScanner = financeCleanScanner{}
	data := []byte("date,amount,reference\n2026-10-10,-1300.50,UTR-FICTIONAL\n2026-10-10,-1300.50,UTR-FICTIONAL\n")
	id := reserveFinanceIntake(t, f, data, "statement")
	if st := uploadFinanceIntake(t, f, id, data); st != 200 {
		t.Fatal(st)
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", map[string]any{"retryKey": "scan", "expectedVersion": 2}, f.cookie)
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	mapping := FinanceStatementMapping{HeaderRow: true, Delimiter: "comma", DateColumn: 0, DateFormat: "YYYY-MM-DD", ReferenceColumn: intPointer(2), AmountMode: "signed", SignedAmountColumn: intPointer(1), DebitSign: "negative", DecimalSeparator: "dot", GroupingSeparator: "none"}
	body := map[string]any{"retryKey": "preview", "intakeId": id, "expectedIntakeVersion": 4, "mapping": mapping}
	out := financeOK(t, f.s, "POST", f.base()+"/finance/statement-previews", body, f.cookie)
	if len(out["rows"].([]any)) != 2 {
		t.Fatal(out)
	}
	return out["preview"].(map[string]any)["id"].(string)
}
func TestFinanceStatementCanonicalImport(t *testing.T) {
	f := newFinanceFixture(t)
	preview := readyStatementPreview(t, f)
	path := f.base() + "/finance/statement-previews/" + preview + "/import"
	body := map[string]any{"retryKey": "import", "expectedPreviewRevision": 1}
	id := financeOK(t, f.s, "POST", path, body, f.cookie)["id"].(string)
	if got := financeOK(t, f.s, "POST", path, body, f.cookie)["id"]; got != id {
		t.Fatal("replayed import")
	}
	body["retryKey"] = "new-key"
	if got := financeOK(t, f.s, "POST", path, body, f.cookie)["id"]; got != id {
		t.Fatal("new key duplicate")
	}
	var n int64
	f.db.Model(&FinanceStatementRow{}).Count(&n)
	if n != 2 {
		t.Fatal("equal rows collapsed", n)
	}
	peer, _ := f.person(t, "bankmember@example.com", "member", f.department)
	if st, out, _ := req(t, f.s, "GET", f.base()+"/finance/statement-imports/"+id, nil, peer); st != 404 || out["totals"] != nil {
		t.Fatal(st, out)
	}
}
