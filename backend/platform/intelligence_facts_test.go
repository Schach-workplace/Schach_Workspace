package platform

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestIntelligenceDeterministicFacts(t *testing.T) {
	m := SourceManifest{Sources: []BoundIntelligenceSource{{SourceKey: "money", Value: Expense{AmountMinor: 130050, Currency: "INR", ExpenseDate: "2026-10-11", Status: "draft"}}}}
	facts, e := buildIntelligenceFacts(m)
	if e != nil || !strings.Contains(facts["money:amount"].Text, "INR 1300.50") {
		t.Fatal(facts, e)
	}
	raw, _ := json.Marshal(map[string]any{"items": []any{map[string]any{"factKey": "money:amount", "relation": "value", "explanationCode": "selected_fact_v1", "sourceKeys": []string{"money"}}}})
	out, e := validateIntelligenceOutput("report_explanation", raw, m, facts)
	if e != nil || out.Items[0].Text != facts["money:amount"].Text {
		t.Fatal(e)
	}
	bad := strings.Replace(string(raw), `"relation":"value"`, `"relation":"comparison"`, 1)
	if _, e = validateIntelligenceOutput("report_explanation", []byte(bad), m, facts); e == nil {
		t.Fatal("unsupported causal comparison")
	}
	bad = strings.Replace(string(raw), `"factKey":"money:amount"`, `"text":"INR 99999","factKey":"money:amount"`, 1)
	if _, e = validateIntelligenceOutput("report_explanation", []byte(bad), m, facts); e == nil {
		t.Fatal("model money prose")
	}
}
