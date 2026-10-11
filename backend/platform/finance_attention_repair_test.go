package platform

import (
	"gorm.io/gorm"
	"net/http"
	"os"
	"testing"
	"time"
)

func financeAttentionPaid(t *testing.T, f financeFixture) (string, *http.Cookie) {
	t.Helper()
	fields := f.expense(130050)
	fields["expenseDate"] = "2026-10-10"
	id := financeOK(t, f.s, "POST", f.base()+"/expenses", fields, f.cookie)["id"].(string)
	payer, _ := f.person(t, "repair-payer@example.invalid", "finance", "")
	f.addBudget(t, 1000000, "active")
	path := f.base() + "/expenses/" + id
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "approve"}, payer)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 3, "action": "pay", "paidDate": "2026-10-10", "paymentMethod": "bank_transfer", "paymentReference": "UTR-FICTIONAL"}, payer)
	return id, payer
}
func financeAttentionRows(t *testing.T, f financeFixture) []FinanceStatementRow {
	t.Helper()
	preview := readyStatementPreview(t, f)
	id := financeOK(t, f.s, "POST", f.base()+"/finance/statement-previews/"+preview+"/import", map[string]any{"retryKey": "repair-import", "expectedPreviewRevision": 1}, f.cookie)["id"].(string)
	var rows []FinanceStatementRow
	if e := f.db.Where("import_id=?", id).Order("record_ordinal").Find(&rows).Error; e != nil {
		t.Fatal(e)
	}
	return rows
}
func currentFinanceRowEpisode(t *testing.T, f financeFixture, row string) AttentionItem {
	t.Helper()
	var items []AttentionItem
	if e := f.db.Where("company_id=? AND recipient_id=? AND source_kind='finance_reconciliation' AND source_id=? AND state='open'", f.cid, f.uid, row).Find(&items).Error; e != nil {
		t.Fatal(e)
	}
	found := []AttentionItem{}
	for _, item := range items {
		if st, _, _ := req(t, f.s, "GET", f.base()+"/attention/"+item.ID, nil, f.cookie); st == 200 {
			found = append(found, item)
		}
	}
	if len(found) != 1 {
		t.Fatalf("outstanding row %s has %d current episodes (storedopen=%d)", row, len(found), len(items))
	}
	return found[0]
}
func TestFinanceAttentionRepairsCandidateChanges(t *testing.T) {
	for _, change := range []string{"allocation", "later_payment", "paid_receipt"} {
		t.Run(change, func(t *testing.T) {
			f := newFinanceFixture(t)
			paid := ""
			var payer *http.Cookie
			if change != "later_payment" {
				paid, payer = financeAttentionPaid(t, f)
			}
			rows := financeAttentionRows(t, f)
			before := currentFinanceRowEpisode(t, f, rows[1].ID)
			if change == "later_payment" {
				paid, payer = financeAttentionPaid(t, f)
			} else if change == "paid_receipt" {
				w := financeUpload(t, f.s, f.base()+"/expenses/"+paid+"/receipts", "fictional.txt", "independent evidence", payer)
				if w.Code != 200 {
					t.Fatal(w.Code, w.Body.String())
				}
			} else {
				body := map[string]any{"retryKey": "repair-match", "rowId": rows[0].ID, "expectedRowVersion": 1, "expenseId": paid, "expectedExpenseVersion": 4, "reason": "Reviewed full fictional payment"}
				financeOK(t, f.s, "POST", f.base()+"/finance/reconciliation/matches", body, f.cookie)
				financeOK(t, f.s, "POST", f.base()+"/finance/reconciliation/matches", body, f.cookie)
			}
			if _, e := f.s.RunAttention(t.Context(), time.Now(), 100); e != nil {
				t.Fatal(e)
			}
			after := currentFinanceRowEpisode(t, f, rows[1].ID)
			if before.OccurrenceKey == after.OccurrenceKey {
				t.Fatal("changed candidate basis did not produce fresh episode")
			}
			if _, e := f.s.RunAttention(t.Context(), time.Now(), 100); e != nil {
				t.Fatal(e)
			}
			if next := currentFinanceRowEpisode(t, f, rows[1].ID); next.ID != after.ID {
				t.Fatal("repeated worker duplicated episode")
			}
		})
	}
}

func TestFinanceAttentionRepairFairnessAndRevisionFence(t *testing.T) {
	f := newFinanceFixture(t)
	rows := financeAttentionRows(t, f)
	var company Company
	f.db.First(&company, "id=?", f.cid)
	company.ID = "second-repair-company"
	company.Slug = "second-repair-company"
	if e := f.db.Create(&company).Error; e != nil {
		t.Fatal(e)
	}
	member := Membership{ID: newID("member"), CompanyID: company.ID, UserID: f.uid, Role: "founder", Active: true}
	if e := f.db.Create(&member).Error; e != nil {
		t.Fatal(e)
	}
	var imp FinanceStatementImport
	f.db.First(&imp, "id=?", rows[0].ImportID)
	imp.ID = newID("imp")
	imp.PreviewID = newID("preview")
	imp.CompanyID = company.ID
	imp.RowCount = 1
	if e := f.db.Create(&imp).Error; e != nil {
		t.Fatal(e)
	}
	second := rows[0]
	second.ID = "second-repair-row"
	second.CompanyID = company.ID
	second.ImportID = imp.ID
	if e := f.db.Create(&second).Error; e != nil {
		t.Fatal(e)
	}
	for n := 4; n <= 61; n++ {
		r := rows[0]
		r.ID = newID("fair-row")
		r.RecordOrdinal = n
		if e := f.db.Create(&r).Error; e != nil {
			t.Fatal(e)
		}
	}
	if e := markFinanceReconciliationDirty(f.db, f.cid); e != nil {
		t.Fatal(e)
	}
	if e := markFinanceReconciliationDirty(f.db, company.ID); e != nil {
		t.Fatal(e)
	}
	if e := f.s.repairFinanceReconciliationAttention(t.Context(), 25); e != nil {
		t.Fatal(e)
	}
	var first, other FinanceReconciliationAttentionWork
	f.db.First(&first, "company_id=?", f.cid)
	f.db.First(&other, "company_id=?", company.ID)
	if first.Cursor == "" || first.ProcessedRevision == first.Revision || other.ProcessedRevision != 0 {
		t.Fatal("first bounded page did not preserve progress", first, other)
	}
	if e := f.s.repairFinanceReconciliationAttention(t.Context(), 25); e != nil {
		t.Fatal(e)
	}
	f.db.First(&other, "company_id=?", company.ID)
	if other.ProcessedRevision != other.Revision {
		t.Fatal("large company starved next company", other)
	}
	if e := markFinanceReconciliationDirty(f.db, f.cid); e != nil {
		t.Fatal(e)
	}
	if e := finishFinanceAttentionPage(f.db, first, "", true); e != nil {
		t.Fatal(e)
	}
	f.db.First(&first, "company_id=?", f.cid)
	if first.Revision != 2 || first.ProcessedRevision == 2 || first.Cursor != "" {
		t.Fatal("old page cleared newer dirty event", first)
	}
	for n := 0; n < 4; n++ {
		if e := f.s.repairFinanceReconciliationAttention(t.Context(), 25); e != nil {
			t.Fatal(e)
		}
	}
	f.db.First(&first, "company_id=?", f.cid)
	if first.ProcessedRevision != 2 {
		t.Fatal("resumable pass did not complete", first)
	}
}
func TestFinanceAttentionDismissedBasisAndCurrentRecipients(t *testing.T) {
	f := newFinanceFixture(t)
	inactive, inactiveID := f.person(t, "inactive-repair@example.invalid", "finance", "")
	_, suspendedID := f.person(t, "suspended-repair@example.invalid", "finance", "")
	revoked, revokedID := f.person(t, "revoked-repair@example.invalid", "finance", "")
	rows := financeAttentionRows(t, f)
	before := currentFinanceRowEpisode(t, f, rows[1].ID)
	q := financeOK(t, f.s, "GET", f.base()+"/finance/reconciliation?state=all", nil, f.cookie)
	basis := ""
	for _, raw := range q["items"].([]any) {
		item := raw.(map[string]any)
		if item["row"].(map[string]any)["id"] == rows[1].ID {
			basis = item["suggestionBasis"].(string)
		}
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/reconciliation/rows/"+rows[1].ID+"/dismiss", map[string]any{"retryKey": "exact-dismiss", "expectedRowVersion": 1, "suggestionBasis": basis, "reason": "Reviewed original empty payment candidates"}, f.cookie)
	if e := markFinanceReconciliationDirty(f.db, f.cid); e != nil {
		t.Fatal(e)
	}
	if _, e := f.s.RunAttention(t.Context(), time.Now(), 100); e != nil {
		t.Fatal(e)
	}
	var count int64
	f.db.Model(&AttentionItem{}).Where("source_id=? AND recipient_id=? AND state='open'", rows[1].ID, f.uid).Count(&count)
	if count != 0 {
		t.Fatal("unchanged dismissed basis recreated", count)
	}
	f.db.Model(&Membership{}).Where("company_id=? AND user_id=?", f.cid, inactiveID).Update("active", false)
	f.db.Model(&Membership{}).Where("company_id=? AND user_id=?", f.cid, revokedID).Update("role", "member")
	f.db.Model(&User{}).Where("id=?", suspendedID).Update("suspended", true)
	financeAttentionPaid(t, f)
	if _, e := f.s.RunAttention(t.Context(), time.Now(), 100); e != nil {
		t.Fatal(e)
	}
	after := currentFinanceRowEpisode(t, f, rows[1].ID)
	if before.OccurrenceKey == after.OccurrenceKey {
		t.Fatal("later payment must create new undismissed basis")
	}
	f.db.Model(&AttentionItem{}).Where("source_id=? AND occurrence_key=? AND recipient_id IN ?", rows[1].ID, after.OccurrenceKey, []string{inactiveID, suspendedID, revokedID}).Count(&count)
	if count != 0 {
		t.Fatal("produced revoked recipient", count)
	}
	for _, cookie := range []*http.Cookie{inactive, revoked} {
		if st, _, _ := req(t, f.s, "GET", f.base()+"/attention/"+after.ID, nil, cookie); st == 200 {
			t.Fatal("revoked audience disclosed current obligation")
		}
	}
}
func TestFinanceAttentionRepairLegacySQLiteBackfill(t *testing.T) {
	f := newFinanceFixture(t)
	if f.db.Dialector.Name() != "sqlite" {
		t.Skip("development SQLite upgrade")
	}
	financeAttentionRows(t, f)
	if e := f.db.Migrator().DropTable(&FinanceReconciliationAttentionWork{}); e != nil {
		t.Fatal(e)
	}
	if e := Migrate(f.db); e != nil {
		t.Fatal(e)
	}
	var work FinanceReconciliationAttentionWork
	if e := f.db.First(&work, "company_id=?", f.cid).Error; e != nil {
		t.Fatal("existing rows have no repair work after upgrade", e)
	}
}

func TestFinanceAttentionRepairConcurrentDirtyProgress(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("owned PostgreSQL concurrent connections")
	}
	f := newFinanceFixture(t)
	financeAttentionRows(t, f)
	if e := markFinanceReconciliationDirty(f.db, f.cid); e != nil {
		t.Fatal(e)
	}
	errors := make(chan error, 2)
	go func() {
		for n := 0; n < 10; n++ {
			if e := f.db.Transaction(func(tx *gorm.DB) error {
				if e := lockCompany(tx, f.cid); e != nil {
					return e
				}
				return markFinanceReconciliationDirty(tx, f.cid)
			}); e != nil {
				errors <- e
				return
			}
		}
		errors <- nil
	}()
	go func() {
		for n := 0; n < 10; n++ {
			if e := f.s.repairFinanceReconciliationAttention(t.Context(), 1); e != nil {
				errors <- e
				return
			}
		}
		errors <- nil
	}()
	for n := 0; n < 2; n++ {
		if e := <-errors; e != nil {
			t.Fatal(e)
		}
	}
	for n := 0; n < 4; n++ {
		if e := f.s.repairFinanceReconciliationAttention(t.Context(), 100); e != nil {
			t.Fatal(e)
		}
	}
	var work FinanceReconciliationAttentionWork
	f.db.First(&work, "company_id=?", f.cid)
	if work.Revision != 11 || work.ProcessedRevision != 11 {
		t.Fatal("lost dirty revision/progress", work)
	}
}
