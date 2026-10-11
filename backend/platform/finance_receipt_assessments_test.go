package platform

import (
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestReceiptAssessmentActualParent(t *testing.T) {
	f := newFinanceFixture(t)
	actor, uid := f.person(t, "headscan@example.com", "head", f.department)
	id := f.addExpense(t, 100, f.cookie)
	receipt := ExpenseReceipt{ID: newID("rcp"), CompanyID: f.cid, ExpenseID: id, FileName: "fictional.png", MimeType: "image/png", Size: 8, UploadedBy: f.uid, CreatedAt: nowString(), Data: []byte("fictional")}
	if e := f.db.Create(&receipt).Error; e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceScanner = financeCleanScanner{}
	financeOK(t, f.s, "POST", f.base()+"/expense-receipts/"+receipt.ID+"/assessment", map[string]any{"retryKey": "scan", "expectedExpenseVersion": 1}, actor)
	f.db.Model(&Expense{}).Where("id=?", id).Update("department_id", "")
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	var n int64
	f.db.Model(&ReceiptEvidenceFingerprint{}).Count(&n)
	if n != 0 {
		t.Fatal("hidden parent assessed")
	}
	var j FinanceAssistanceJob
	f.db.First(&j, "requester_id=?", uid)
	if j.Status != "stale" {
		t.Fatal(j.Status)
	}
	var retained ExpenseReceipt
	if e := f.db.First(&retained, "id=?", receipt.ID).Error; e != nil || string(retained.Data) != "fictional" {
		t.Fatal("legacy receipt changed", e)
	}
	_ = gorm.ErrRecordNotFound
}
