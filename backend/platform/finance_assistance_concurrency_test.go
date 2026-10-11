package platform

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestFinanceAssistanceConcurrentClaims(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("owned PostgreSQL required")
	}
	for _, kind := range []string{"receipt", "statement"} {
		t.Run(kind, func(t *testing.T) {
			f := newFinanceFixture(t)
			var path string
			var body map[string]any
			if kind == "receipt" {
				job := readyReceiptExtraction(t, f)
				m := financeOK(t, f.s, "GET", f.base()+"/finance/receipt-extractions/"+job, nil, f.cookie)
				source := m["job"].(map[string]any)["sourceId"]
				path = f.base() + "/finance/receipt-extractions/" + job + "/accept"
				body = map[string]any{"expectedResultRevision": 1, "sourceKind": "intake", "sourceId": source, "destinationDepartmentId": f.department, "copyEvidence": true, "fields": f.expense(130050), "confirmedUncertainties": []string{"title"}}
			} else {
				preview := readyStatementPreview(t, f)
				path = f.base() + "/finance/statement-previews/" + preview + "/import"
				body = map[string]any{"expectedPreviewRevision": 1}
			}
			var wg sync.WaitGroup
			ids := make(chan string, 4)
			for n := 0; n < 4; n++ {
				wg.Add(1)
				go func(n int) {
					defer wg.Done()
					input := map[string]any{}
					for k, v := range body {
						input[k] = v
					}
					input["retryKey"] = fmt.Sprintf("concurrent-%d", n)
					st, out, _ := req(t, f.s, "POST", path, input, f.cookie)
					if st != 200 {
						t.Errorf("claim status %d", st)
						return
					}
					ids <- out["id"].(string)
				}(n)
			}
			wg.Wait()
			close(ids)
			first := ""
			for id := range ids {
				if first == "" {
					first = id
				}
				if id != first {
					t.Fatal("duplicate canonical claims")
				}
			}
			var count int64
			if kind == "receipt" {
				f.db.Model(&Expense{}).Count(&count)
				if count != 1 {
					t.Fatal(count)
				}
				f.db.Model(&ExpenseReceipt{}).Count(&count)
				if count != 1 {
					t.Fatal(count)
				}
			} else {
				f.db.Model(&FinanceStatementImport{}).Count(&count)
				if count != 1 {
					t.Fatal(count)
				}
				f.db.Model(&FinanceStatementRow{}).Count(&count)
				if count != 2 {
					t.Fatal(count)
				}
			}
		})
	}
}
func TestFinanceAssistanceLeaseRecovery(t *testing.T) {
	f := newFinanceFixture(t)
	id := readyReceiptExtraction(t, f)
	f.db.Where("job_id=?", id).Delete(&ReceiptExtractionResult{})
	f.db.Model(&FinanceAssistanceJob{}).Where("id=?", id).Updates(map[string]any{"status": "running", "result_id": "", "attempts": 1, "lease_token": "abandoned", "lease_until": time.Now().Add(-time.Minute)})
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	var job FinanceAssistanceJob
	f.db.First(&job, "id=?", id)
	if job.Status != "ready" || job.Attempts != 2 || job.LeaseToken == "abandoned" {
		t.Fatal("lease did not recover", job.Status, job.Attempts)
	}
	f.db.Model(&FinanceAssistanceJob{}).Where("id=?", id).Updates(map[string]any{"status": "running", "attempts": 3, "lease_until": time.Now().Add(-time.Minute)})
	f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1)
	f.db.First(&job, "id=?", id)
	if job.Status != "failed" || job.ErrorCode != "retry_exhausted" {
		t.Fatal("exhausted lease resurrected", job.Status)
	}
}
func TestFinanceAssistanceNoSensitiveLogs(t *testing.T) {
	f := newFinanceFixture(t)
	f.s.opts.FinanceIntakeStore, _ = NewFileMediaStore(t.TempDir())
	var metrics []RequestMetric
	f.s.opts.MetricSink = func(m RequestMetric) { metrics = append(metrics, m) }
	input := map[string]any{"retryKey": "private-logging-fixture", "purpose": "receipt", "capture": true, "destinationDepartmentId": f.department}
	out := financeOK(t, f.s, "POST", f.base()+"/finance/intakes", input, f.cookie)
	data, _ := json.Marshal(metrics)
	for _, private := range []string{f.cid, f.uid, out["id"].(string), "private-logging-fixture", f.cookie.Value} {
		if strings.Contains(string(data), private) {
			t.Fatal("private HTTP metric field")
		}
	}
	if len(metrics) != 1 || !strings.Contains(metrics[0].Endpoint, "{cid}") || metrics[0].Queries == 0 {
		t.Fatal("no measured route-template evidence", metrics)
	}
}

func TestFinanceReconciliationConcurrentActiveExpense(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("owned PostgreSQL required")
	}
	f := newFinanceFixture(t)
	preview := readyStatementPreview(t, f)
	importID := financeOK(t, f.s, "POST", f.base()+"/finance/statement-previews/"+preview+"/import", map[string]any{"retryKey": "import", "expectedPreviewRevision": 1}, f.cookie)["id"].(string)
	rows := financeOK(t, f.s, "GET", f.base()+"/finance/statement-imports/"+importID+"/rows", nil, f.cookie)["items"].([]any)
	fields := f.expense(130050)
	fields["expenseDate"] = "2026-10-10"
	id := financeOK(t, f.s, "POST", f.base()+"/expenses", fields, f.cookie)["id"].(string)
	finance, _ := f.person(t, "owned-concurrency-payer@example.invalid", "finance", "")
	f.addBudget(t, 1000000, "active")
	path := f.base() + "/expenses/" + id
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 1, "action": "submit"}, f.cookie)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 2, "action": "approve"}, finance)
	financeOK(t, f.s, "POST", path+"/transition", map[string]any{"version": 3, "action": "pay", "paidDate": "2026-10-10", "paymentMethod": "bank_transfer", "paymentReference": "UTR-FICTIONAL"}, finance)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			st, _, _ := req(t, f.s, "POST", f.base()+"/finance/reconciliation/matches", map[string]any{"retryKey": fmt.Sprintf("competing-%d", n), "rowId": rows[n].(map[string]any)["id"], "expectedRowVersion": 1, "expenseId": id, "expectedExpenseVersion": 4, "reason": "Separate full accounting inspection"}, f.cookie)
			codes <- st
		}(n)
	}
	wg.Wait()
	close(codes)
	success := 0
	for status := range codes {
		if status == 200 {
			success++
		} else if status != 409 {
			t.Fatal(status)
		}
	}
	if success != 1 {
		t.Fatal("more than one active expense association", success)
	}
	var count int64
	f.db.Model(&FinanceReconciliationAllocation{}).Where("active=true").Count(&count)
	if count != 1 {
		t.Fatal(count)
	}
	var expense Expense
	f.db.First(&expense, "id=?", id)
	if expense.Status != "paid" || expense.Version != 4 || expense.AmountMinor != 130050 {
		t.Fatal("payment mutated")
	}
}
