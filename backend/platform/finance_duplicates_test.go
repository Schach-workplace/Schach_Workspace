package platform

import (
	"testing"
	"time"
)

func TestFinanceDuplicateSuggestionsDismissal(t *testing.T) {
	f := newFinanceFixture(t)
	a := f.addExpense(t, 100, f.cookie)
	b := f.addExpense(t, 100, f.cookie)
	path := f.base() + "/finance/duplicate-candidates"
	review := map[string]any{"retryKey": "review", "sourceKind": "expense", "sourceId": a, "expectedVersion": 1}
	out := financeOK(t, f.s, "POST", path+"/review", review, f.cookie)
	items := out["items"].([]any)
	if len(items) != 1 {
		t.Fatal(out)
	}
	candidate := items[0].(map[string]any)
	if candidate["reason"] != "same_vendor_amount_date" || !((candidate["comparedExpenseId"] == b && candidate["sourceId"] == a) || (candidate["comparedExpenseId"] == a && candidate["sourceId"] == b)) {
		t.Fatal(candidate)
	}
	id := candidate["id"].(string)
	body := map[string]any{"retryKey": "dismiss", "expectedVersion": 1, "reason": "These are separate legitimate purchases"}
	financeOK(t, f.s, "POST", path+"/"+id+"/dismiss", body, f.cookie)
	financeOK(t, f.s, "POST", path+"/"+id+"/dismiss", body, f.cookie)
	financeOK(t, f.s, "PATCH", f.base()+"/expenses/"+a, map[string]any{"version": 1, "amountMinor": 101}, f.cookie)
	if st, _, _ := req(t, f.s, "GET", path+"/"+id, nil, f.cookie); st != 404 {
		t.Fatal("old basis", st)
	}
}

func TestFinanceDuplicateExactReviewedPreview(t *testing.T) {
	f := newFinanceFixture(t)
	fields := f.expense(100)
	fields["invoiceNumber"] = "EXACT-FICTIONAL"
	peer := financeOK(t, f.s, "POST", f.base()+"/expenses", fields, f.cookie)["id"]
	job := readyReceiptExtraction(t, f)
	out := financeOK(t, f.s, "POST", f.base()+"/finance/duplicates/preview", map[string]any{"sourceExtractionId": job, "expectedResultRevision": 1, "fields": fields}, f.cookie)
	items := out["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["comparedExpenseId"] != peer || items[0].(map[string]any)["reason"] != "exact_vendor_invoice" {
		t.Fatal(out)
	}
	if st, _, _ := req(t, f.s, "POST", f.base()+"/expenses", fields, f.cookie); st != 422 {
		t.Fatal("preview waived exact create validator", st)
	}
	var n int64
	f.db.Model(&FinanceDuplicateCandidate{}).Count(&n)
	if n != 0 {
		t.Fatal("preview persisted suggestion")
	}
}

func TestFinanceDuplicateReviewedCleanContent(t *testing.T) {
	f := newFinanceFixture(t)
	peer := f.addExpense(t, 2000, f.cookie)
	job := readyReceiptExtraction(t, f)
	bytes := []byte("\x89PNG\r\n\x1a\nfictional")
	receipt := ExpenseReceipt{ID: newID("rcp"), CompanyID: f.cid, ExpenseID: peer, FileName: "fictional.png", MimeType: "image/png", Size: int64(len(bytes)), Data: bytes, UploadedBy: f.uid, CreatedAt: nowString()}
	if e := f.db.Create(&receipt).Error; e != nil {
		t.Fatal(e)
	}
	financeOK(t, f.s, "POST", f.base()+"/expense-receipts/"+receipt.ID+"/assessment", map[string]any{"retryKey": "assess-content", "expectedExpenseVersion": 1}, f.cookie)
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	out := financeOK(t, f.s, "POST", f.base()+"/finance/duplicates/preview", map[string]any{"sourceExtractionId": job, "expectedResultRevision": 1, "fields": f.expense(100)}, f.cookie)
	items := out["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["reason"] != "same_receipt_content" {
		t.Fatal("authorized clean extraction content comparison missing", out)
	}
	reviewed := financeOK(t, f.s, "POST", f.base()+"/finance/duplicate-candidates/review", map[string]any{"retryKey": "current-content-review", "sourceKind": "extraction", "sourceId": job, "expectedVersion": 1, "fields": f.expense(100)}, f.cookie)
	id := reviewed["items"].([]any)[0].(map[string]any)["id"].(string)
	meta := financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+job, nil, f.cookie)
	source := meta["job"].(map[string]any)["sourceId"]
	financeOK(t, f.s, "POST", f.base()+"/finance/receipt-extractions/"+job+"/accept", map[string]any{"retryKey": "accept-content", "sourceKind": "intake", "sourceId": source, "expectedResultRevision": 1, "destinationDepartmentId": f.department, "fields": f.expense(100), "copyEvidence": true, "confirmedUncertainties": []string{"title"}}, f.cookie)
	if st, _, _ := req(t, f.s, "GET", f.base()+"/finance/duplicate-candidates/"+id, nil, f.cookie); st != 404 {
		t.Fatal("accepted extraction retained old suggestion", st)
	}
	current := financeOK(t, f.s, "GET", f.base()+"/finance/duplicate-candidates", nil, f.cookie)
	if len(current["items"].([]any)) != 0 {
		t.Fatal("accepted result before paging", current)
	}
}
