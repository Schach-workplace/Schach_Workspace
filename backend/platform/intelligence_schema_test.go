package platform

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestIntelligenceSchema(t *testing.T) {
	m := SourceManifest{SourceSetHash: "bound", Sources: []BoundIntelligenceSource{{SourceKey: "selected"}}}
	good := `{"claims":[{"text":"Uncertain selected fact","sourceKeys":["selected"],"confidence":"uncertain"}]}`
	if _, e := validateIntelligenceOutput("summary", []byte(good), m, nil); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []string{`{"claims":[],"claims":[]}`, good + ` {}`, `{"claims":[{"text":"x","sourceKeys":["other"],"confidence":"supported"}]}`, `{"claims":[{"text":"x","sourceKeys":["selected","selected"],"confidence":"supported"}]}`, `{"claims":[],"tools":[]}`, `{"claims":[{"text":"x","sourceKeys":[],"confidence":"supported"}]}`} {
		if _, e := validateIntelligenceOutput("summary", []byte(bad), m, nil); e == nil {
			t.Fatal("unsafe output", bad)
		}
	}
	candidate := IntelligenceCandidate{Kind: "task", Title: "Review", Description: "Review selected content", SourceKeys: []string{"selected"}, Unresolved: []string{"owner", "dueDate", "reviewer"}}
	owner := "guessed"
	candidate.OwnerID = &owner
	raw, _ := json.Marshal(map[string]any{"candidates": []IntelligenceCandidate{candidate}})
	if _, e := validateIntelligenceOutput("action_draft", raw, m, nil); e == nil {
		t.Fatal("model guessed owner")
	}
}

func TestIntelligenceSchemaNumericAndSizeBoundaries(t *testing.T) {
	m := SourceManifest{Sources: []BoundIntelligenceSource{{SourceKey: "s"}}}
	segment := `{"language":"en","segments":[{"startMs":0,"endMs":100,"text":"Selected","sourceKey":"s"}]}`
	for _, value := range []string{"-1", "1.5", "9007199254740992", "1e999", "NaN", "Infinity", "600001"} {
		raw := strings.Replace(segment, `"endMs":100`, `"endMs":`+value, 1)
		if _, e := validateIntelligenceOutput("transcript", []byte(raw), m, nil); e == nil {
			t.Fatal("unsafe timestamp", value)
		}
	}
	cases := [][]byte{[]byte(strings.Replace(segment, `"text":"Selected"`, `"text":"x","text":"y"`, 1)), append([]byte(segment), 0xff), []byte(strings.Replace(segment, "Selected", strings.Repeat("x", 16001), 1)), []byte(segment + ` null`)}
	for _, raw := range cases {
		if _, e := validateIntelligenceOutput("transcript", raw, m, nil); e == nil {
			t.Fatal("unsafe encoded output accepted")
		}
	}
	for _, field := range []string{`"ownerId":"guessed"`, `"dueDate":"2026-10-11"`, `"reviewerId":"guessed"`, `"amountMinor":130050`, `"amountMinor":1.5`, `"amountMinor":9007199254740992`, `"currency":"INR"`, `"tools":[]`} {
		raw := []byte(`{"candidates":[{"kind":"expense","title":"Review","description":"Selected suggestion","sourceKeys":["s"],"unresolved":["amount"],` + field + `}]}`)
		if _, e := validateIntelligenceOutput("action_draft", raw, m, nil); e == nil {
			t.Fatal("invented business input", field)
		}
	}
}
