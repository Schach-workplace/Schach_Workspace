package platform

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// A token walk rejects duplicate keys before typed decoding (which otherwise
// silently chooses the last value). It also bounds nesting and JSON numbers.
func strictIntelligenceJSON(raw []byte, out any) error {
	if len(raw) == 0 || len(raw) > 65536 || !utf8.Valid(raw) || utf8.RuneCount(raw) > 20000 {
		return intelligenceError(422, "invalid_output")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 32 {
			return intelligenceError(422, "invalid_output")
		}
		tok, e := d.Token()
		if e != nil {
			return e
		}
		switch v := tok.(type) {
		case json.Delim:
			switch v {
			case '{':
				seen := map[string]bool{}
				for d.More() {
					key, e := d.Token()
					if e != nil {
						return e
					}
					s, ok := key.(string)
					if !ok || seen[s] {
						return intelligenceError(422, "invalid_output")
					}
					seen[s] = true
					if e = walk(depth + 1); e != nil {
						return e
					}
				}
			case '[':
				for d.More() {
					if e = walk(depth + 1); e != nil {
						return e
					}
				}
			default:
				return intelligenceError(422, "invalid_output")
			}
			_, e = d.Token()
			return e
		case json.Number:
			f, e := strconv.ParseFloat(string(v), 64)
			if e != nil || math.IsInf(f, 0) || math.IsNaN(f) || math.Abs(f) > 9007199254740991 {
				return intelligenceError(422, "invalid_output")
			}
		}
		return nil
	}
	if e := walk(0); e != nil {
		return intelligenceError(422, "invalid_output")
	}
	if _, e := d.Token(); e != io.EOF {
		return intelligenceError(422, "invalid_output")
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		return intelligenceError(422, "invalid_output")
	}
	return nil
}
func validateIntelligenceOutput(operation IntelligenceOperation, raw []byte, manifest SourceManifest, facts DeterministicFacts) (IntelligenceResult, error) {
	result := IntelligenceResult{SchemaVersion: 1, Operation: operation, SourceSetHash: manifest.SourceSetHash, Limitations: []string{"Generated content can be wrong. Citations identify provenance and do not prove a claim."}}
	fail := func() (IntelligenceResult, error) {
		return IntelligenceResult{}, intelligenceError(422, "invalid_output")
	}
	keys := map[string]bool{}
	for _, b := range manifest.Sources {
		keys[b.SourceKey] = true
	}
	citations := func(ids []string) bool {
		if len(ids) == 0 || len(ids) > 50 {
			return false
		}
		seen := map[string]bool{}
		for _, id := range ids {
			if !keys[id] || seen[id] {
				return false
			}
			seen[id] = true
		}
		return true
	}
	text := func(s string) bool {
		return strings.TrimSpace(s) != "" && len(s) <= 16000 && !strings.ContainsAny(s, "\x00")
	}
	switch operation {
	case "summary":
		var body struct {
			Claims []IntelligenceClaim `json:"claims"`
		}
		if strictIntelligenceJSON(raw, &body) != nil || len(body.Claims) == 0 || len(body.Claims) > 100 {
			return fail()
		}
		for _, c := range body.Claims {
			if !text(c.Text) || !citations(c.SourceKeys) || !inString(c.Confidence, "supported", "uncertain") {
				return fail()
			}
		}
		result.Claims = body.Claims
	case "action_draft":
		var body struct {
			Candidates []IntelligenceCandidate `json:"candidates"`
		}
		if strictIntelligenceJSON(raw, &body) != nil || len(body.Candidates) == 0 || len(body.Candidates) > 10 {
			return fail()
		}
		for _, c := range body.Candidates {
			if !inString(c.Kind, "task", "expense", "intake") || !text(c.Title) || len(c.Title) > 240 || !text(c.Description) || !citations(c.SourceKeys) || c.OwnerID != nil || c.DueDate != nil || c.ReviewerID != nil || c.AmountMinor != nil || c.Currency != nil || len(c.Unresolved) == 0 || len(c.Unresolved) > 10 {
				return fail()
			}
			for _, u := range c.Unresolved {
				if !inString(u, "owner", "dueDate", "reviewer", "amount", "currency", "department", "category", "purpose") {
					return fail()
				}
			}
		}
		result.Candidates = body.Candidates
	case "transcript":
		var body struct {
			Language string                `json:"language"`
			Segments []IntelligenceSegment `json:"segments"`
		}
		if strictIntelligenceJSON(raw, &body) != nil || len(body.Segments) == 0 || len(body.Segments) > 2000 || len(body.Language) > 16 {
			return fail()
		}
		duration := int64(600000)
		if f, ok := facts["audioDurationMs"]; ok {
			n, e := strconv.ParseInt(f.Text, 10, 64)
			if e != nil {
				return fail()
			}
			duration = n
		}
		last := int64(0)
		for _, seg := range body.Segments {
			if seg.StartMS < last || seg.EndMS < seg.StartMS || seg.EndMS > duration || !text(seg.Text) || !keys[seg.SourceKey] {
				return fail()
			}
			last = seg.EndMS
		}
		result.Language = body.Language
		result.Segments = body.Segments
		result.Uncertain = true
	case "report_explanation":
		var body struct {
			Items []IntelligenceExplanation `json:"items"`
		}
		if strictIntelligenceJSON(raw, &body) != nil || len(body.Items) == 0 || len(body.Items) > 100 {
			return fail()
		}
		for i, item := range body.Items {
			fact, ok := facts[item.FactKey]
			if !ok || item.Text != "" || item.ExplanationCode != "selected_fact_v1" || !containsString(fact.Relations, item.Relation) || !citations(item.SourceKeys) || !sameStringSet(item.SourceKeys, fact.SourceKeys) {
				return fail()
			}
			body.Items[i].Text = fact.Text
		}
		result.Items = body.Items
	default:
		return fail()
	}
	encoded, e := json.Marshal(result)
	if e != nil || len(encoded) > 65536 || utf8.RuneCount(encoded) > 20000 {
		return fail()
	}
	return result, nil
}
func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for _, x := range a {
		if !containsString(b, x) {
			return false
		}
	}
	return true
}
