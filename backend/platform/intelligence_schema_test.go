package platform

import (
	"encoding/json"
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
