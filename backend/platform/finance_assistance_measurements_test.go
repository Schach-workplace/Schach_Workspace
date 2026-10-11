package platform

import (
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"
)

// Opt-in fictional, random-schema actual PostgreSQL handler/query measurement.
// The separate TCP/browser proof exercises the real scanner/Tesseract provider.
func TestFinanceAssistanceMeasuredReads(t *testing.T) {
	output := os.Getenv("FINANCE_MEASURE_OUTPUT")
	if output == "" {
		t.Skip("set owned FINANCE_MEASURE_OUTPUT")
	}
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Fatal("owned PostgreSQL required")
	}
	f := newFinanceFixture(t)
	job := readyReceiptExtraction(t, f)
	preview := readyStatementPreview(t, f)
	financeOK(t, f.s, "POST", f.base()+"/finance/statement-previews/"+preview+"/import", map[string]any{"retryKey": "measurement-import", "expectedPreviewRevision": 1}, f.cookie)
	paths := []struct{ name, path string }{{"intakeMetadata", "/finance/intakes"}, {"selectedExtractionDetail", "/finance/receipt-extractions/" + job}, {"reconciliation", "/finance/reconciliation?state=all"}}
	evidence := map[string]any{"cohort": map[string]any{"actors": 1, "concurrency": 1, "intakes": 2, "extractionResults": 1, "statementRows": 2, "activeAllocations": 0, "samplesPerEndpoint": 5, "transport": "actual shared HTTP handler/httptest with native PostgreSQL queries", "provider": "bounded fixture only; real provider qualified by separate TCP/browser proof"}}
	for _, endpoint := range paths {
		samples := []RequestMetric{}
		f.s.opts.MetricSink = func(m RequestMetric) { samples = append(samples, m) }
		for n := 0; n < 5; n++ {
			financeOK(t, f.s, "GET", f.base()+endpoint.path, nil, f.cookie)
		}
		milliseconds := []float64{}
		for _, m := range samples {
			if m.Queries == 0 || m.Status != 200 {
				t.Fatal("missing successful measured queries", m.Endpoint)
			}
			milliseconds = append(milliseconds, float64(m.Duration.Microseconds())/1000)
		}
		sort.Float64s(milliseconds)
		evidence[endpoint.name] = map[string]any{"requests": len(samples), "responseBytes": samples[0].Bytes, "queries": samples[0].Queries, "queryRows": samples[0].QueryRows, "p50Ms": milliseconds[2], "p95Ms": milliseconds[4]}
	}
	f.s.opts.MetricSink = nil
	data, e := json.MarshalIndent(evidence, "", "  ")
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(output, append(data, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
	t.Log(string(data))
}

func TestFinanceStatementImportBatchedCurrentAttention(t *testing.T) {
	f := newFinanceFixture(t)
	preview := readyStatementPreview(t, f, []byte("date,amount,reference\n"+strings.Repeat("2026-10-10,-1300.50,FICTIONAL-EQUAL\n", 101)))
	var metric RequestMetric
	f.s.opts.MetricSink = func(m RequestMetric) { metric = m }
	id := financeOK(t, f.s, "POST", f.base()+"/finance/statement-previews/"+preview+"/import", map[string]any{"retryKey": "batch-attention-import", "expectedPreviewRevision": 1}, f.cookie)["id"].(string)
	f.s.opts.MetricSink = nil
	if metric.Queries > 80 {
		t.Fatalf("101 identical-valued records require bounded batch query work, actualqueries=%d", metric.Queries)
	}
	var rows int64
	f.db.Model(&FinanceStatementRow{}).Where("import_id=?", id).Count(&rows)
	var episodes int64
	f.db.Model(&AttentionItem{}).Where("company_id=? AND source_kind='finance_reconciliation' AND recipient_id=?", f.cid, f.uid).Count(&episodes)
	if rows != 101 || episodes != 101 {
		t.Fatal("row occurrences or current finance attention collapsed", rows, episodes)
	}
	t.Logf("101 records/101 current finance episodes: queries=%d responseBytes=%d duration=%s", metric.Queries, metric.Bytes, metric.Duration)
}
