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
	emptyText := strings.Replace(string(raw), `"factKey":"money:amount"`, `"text":"","factKey":"money:amount"`, 1)
	if _, e = validateIntelligenceOutput("report_explanation", []byte(emptyText), m, facts); e == nil {
		t.Fatal("unknown empty text field accepted")
	}
	bad = strings.Replace(string(raw), `"factKey":"money:amount"`, `"text":"INR 99999","factKey":"money:amount"`, 1)
	if _, e = validateIntelligenceOutput("report_explanation", []byte(bad), m, facts); e == nil {
		t.Fatal("model money prose")
	}
}

func TestIntelligenceDeterministicProducerSemantics(t *testing.T) {
	n, d := 2, 3
	rate := float64(200) / 3
	snapshot := HistoricalReportSnapshot{SchemaVersion: 1, MetricVersion: 1, Basis: "period-end", Period: ResolvedReportPeriod{From: "2026-10-01", To: "2026-10-10", Zone: "Asia/Kolkata"}, Summary: HistoricalReportSummary{Metrics: map[string]HistoricalReportMetric{"original_deadline": {Value: 2, Unit: "tasks", Numerator: &n, Denominator: &d, Rate: &rate, Coverage: []string{"unknown-before coverage"}}, "current_deadline": {Unit: "tasks", Coverage: []string{"gap"}}}, Coverage: []string{"unknown-before", "gap"}}}
	manifest := SourceManifest{Sources: []BoundIntelligenceSource{
		{SourceKey: "history", Value: snapshot},
		{SourceKey: "goal", Value: Goal{Current: 200, Baseline: 0, Target: 100, Unit: "units"}},
		{SourceKey: "missing", Value: Goal{Current: 5, Baseline: 5, Target: 5}},
		{SourceKey: "planning", Value: PlanningView{Method: "recorded-overlap-v1", Timezone: "Asia/Kolkata", Coverage: PlanningCoverage{VisibleTasks: 3, UniqueSelectedRemainingHours: 10, WeeklyExposureHours: 20, Undated: 1, RecordedZeroEstimate: 1}, Weeks: []PlanningWeek{{From: "2026-10-05", To: "2026-10-11", Partial: true, RemainingHours: 10, PositiveCapacityHours: 0}}}},
	}}
	facts, e := buildIntelligenceFacts(manifest)
	if e != nil {
		t.Fatal(e)
	}
	for key, wants := range map[string][]string{
		"history:original_deadline":   {"Numerator 2; denominator 3.", "Rate 66.66666666666667%", "Asia/Kolkata", "unknown-before"},
		"history:current_deadline":    {"Rate unavailable.", "gap"},
		"history:deadline_definition": {"exact instants including equality", "company calendar", "Acceptance episodes and unique task counts"},
		"goal:attainment":             {"100%", "clamped"}, "missing:attainment": {"unavailable"},
		"planning:coverage": {"unique remaining effort 10 hours", "weekly overlapping exposure 20 hours", "undated 1", "zero estimates 1"},
		"planning:week_0":   {"utilization unavailable", "recorded positive capacity 0 hours", "Partial week: true"},
	} {
		for _, want := range wants {
			if !strings.Contains(facts[key].Text, want) {
				t.Fatal(key, want, facts[key].Text)
			}
		}
	}
	if manifest.Sources[1].Value.(Goal).Current != 200 {
		t.Fatal("explanation mutated goal")
	}
}
