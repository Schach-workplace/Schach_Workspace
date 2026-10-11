package platform

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

func buildIntelligenceFacts(manifest SourceManifest) (DeterministicFacts, error) {
	out := DeterministicFacts{}
	add := func(b BoundIntelligenceSource, key, text string, relations ...string) {
		key = b.SourceKey + ":" + key
		out[key] = IntelligenceFact{Key: key, Text: text, SourceKeys: []string{b.SourceKey}, Relations: relations}
	}
	number := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
	goal := func(b BoundIntelligenceSource, value, baseline, target float64, unit, at string) {
		add(b, "measurement", fmt.Sprintf("Recorded value %s %s; baseline %s and target %s. Observation: %s.", number(value), unit, number(baseline), number(target), at), "value")
		if target == baseline || math.IsNaN(value) {
			add(b, "attainment", "Attainment is unavailable because the denominator is unavailable or zero.", "coverage")
		} else {
			rate := math.Max(0, math.Min(100, (value-baseline)/(target-baseline)*100))
			add(b, "attainment", fmt.Sprintf("Attainment is %s%%, clamped to 0–100 using the recorded baseline and target.", number(rate)), "value")
		}
	}
	for _, b := range manifest.Sources {
		switch v := b.Value.(type) {
		case Expense:
			n := v.AmountMinor
			sign := ""
			if n < 0 {
				sign = "-"
				n = -n
			}
			add(b, "amount", fmt.Sprintf("Recorded expense amount is %s %s%d.%02d on %s; status %s. This explanation makes no approval or payment.", v.Currency, sign, n/100, n%100, v.ExpenseDate, v.Status), "value")
		case Goal:
			goal(b, v.Current, v.Baseline, v.Target, v.Unit, "current selected goal state")
			add(b, "coverage", fmt.Sprintf("Measurement coverage begins %v. Legacy observed values are not fabricated measurements.", v.MeasurementCoverageFrom), "coverage")
		case GoalMeasurement:
			goal(b, v.Value, v.Baseline, v.Target, v.Unit, v.EffectiveAt.UTC().Format("2006-01-02T15:04:05.999999Z07:00"))
			if v.CorrectsID != "" {
				add(b, "correction", "This immutable entry corrects an earlier observation and preserves its original observation instant.", "limitation")
			}
		case HistoricalReportSnapshot:
			if v.SchemaVersion != 1 || v.MetricVersion != 1 {
				return nil, intelligenceError(422, "unsupported_facts")
			}
			keys := []string{}
			for key := range v.Summary.Metrics {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				m := v.Summary.Metrics[key]
				text := fmt.Sprintf("Historical %s: %s %s. Period %s through %s in %s; basis %s.", key, number(m.Value), m.Unit, v.Period.From, v.Period.To, v.Period.Zone, v.Basis)
				if m.Numerator != nil && m.Denominator != nil {
					text += fmt.Sprintf(" Numerator %d; denominator %d.", *m.Numerator, *m.Denominator)
				}
				if m.Rate == nil {
					text += " Rate unavailable."
				} else {
					text += " Rate " + number(*m.Rate) + "%."
				}
				text += " Coverage: " + strings.Join(m.Coverage, "; ")
				add(b, key, text, "value", "coverage")
			}
			add(b, "deadline_definition", "Original and current deadlines have separate denominators. Timed deadlines compare exact instants including equality; all-day deadlines use the report company calendar. Acceptance episodes and unique task counts are different measures.", "deadline_definition")
			add(b, "coverage", "Coverage: "+strings.Join(v.Summary.Coverage, "; "), "coverage")
		case *reportSnapshot:
			if v.MetricVersion != 0 && v.MetricVersion != 1 {
				return nil, intelligenceError(422, "unsupported_facts")
			}
			period := "Selected period unavailable for this legacy snapshot."
			if v.Period != nil && validDate(v.Period.From) && validDate(v.Period.To) && v.Period.Zone == v.Timezone {
				period = fmt.Sprintf("Selected period %s through %s in %s.", v.Period.From, v.Period.To, v.Period.Zone)
			}
			prefix := "Current-state report. " + period + " Generated " + v.Generated.UTC().Format("2006-01-02T15:04:05Z") + ". "
			count := func(key string) (int64, bool) {
				switch n := v.Summary[key].(type) {
				case int:
					return int64(n), n >= 0
				case int64:
					return n, n >= 0
				case float64:
					return int64(n), n >= 0 && n <= 9007199254740991 && math.Trunc(n) == n
				}
				return 0, false
			}
			for key, label := range map[string]string{"rows": "Visible selected tasks", "cohort": "Tasks with current due dates in the selected period", "accepted": "Currently accepted tasks with acceptance dates in the selected period", "done": "Currently accepted tasks in the due-date cohort", "needsAttention": "Due-date cohort tasks needing attention", "overdue": "Currently overdue cohort tasks", "changed": "Cohort tasks with changed deadlines", "blocked": "Currently blocked cohort tasks", "pending": "Cohort tasks awaiting review"} {
				n, ok := count(key)
				text := label + ": unavailable."
				if ok {
					text = fmt.Sprintf("%s: %d tasks.", label, n)
				}
				add(b, key, prefix+text, "value")
			}
			for _, metric := range []struct{ key, num, den, label string }{{"original_deadline", "ontime", "originals", "Original deadline punctuality"}, {"current_deadline", "currentOnTime", "currents", "Current deadline punctuality"}} {
				n, nok := count(metric.num)
				d, dok := count(metric.den)
				text := metric.label + ". Numerator or denominator unavailable. Rate unavailable."
				if nok && dok && n <= d {
					rate := "Rate unavailable because denominator is zero."
					if d > 0 {
						rate = "Rate " + number(float64(n)*100/float64(d)) + "%."
					}
					text = fmt.Sprintf("%s. Numerator %d; denominator %d. %s", metric.label, n, d, rate)
				}
				add(b, metric.key, prefix+text, "value", "coverage")
			}
			add(b, "deadline_definition", prefix+"Original and current deadline punctuality use separate denominators: currently accepted tasks in the selected period with each respective valid deadline. Timed deadlines compare exact instants including equality; all-day deadlines use the company calendar. Counts describe current task state and are not historical acceptance episodes.", "deadline_definition")
			add(b, "coverage", prefix+"Coverage is current state of authorized selected tasks, not historical observations. Missing valid deadlines are excluded from their respective punctuality denominators. Zero denominators have unavailable rates; absent data never implies 100%. Current accepted-task counts do not reconstruct deleted or earlier acceptance episodes.", "coverage")
		case PlanningView:
			add(b, "method", v.MethodDescription+" Method: "+v.Method+". Company timezone: "+v.Timezone+".", "limitation")
			add(b, "coverage", fmt.Sprintf("Visible tasks %d; unique remaining effort %s hours; weekly overlapping exposure %s hours; undated %d; invalid intervals %d; zero estimates %d. Missing or zero recorded capacity does not imply available time.", v.Coverage.VisibleTasks, number(v.Coverage.UniqueSelectedRemainingHours), number(v.Coverage.WeeklyExposureHours), v.Coverage.Undated, v.Coverage.InvalidInterval, v.Coverage.RecordedZeroEstimate), "coverage")
			for i, w := range v.Weeks {
				u := "unavailable"
				if w.Utilization != nil {
					u = number(*w.Utilization) + "%"
				}
				add(b, fmt.Sprintf("week_%d", i), fmt.Sprintf("Week %s through %s: remaining effort %s hours; recorded positive capacity %s hours; utilization %s. Partial week: %t.", w.From, w.To, number(w.RemainingHours), number(w.PositiveCapacityHours), u, w.Partial), "value")
			}
		default:
			return nil, intelligenceError(422, "unsupported_facts")
		}
	}
	if len(out) == 0 || len(out) > 100 {
		return nil, intelligenceError(422, "source_too_large")
	}
	return out, nil
}
