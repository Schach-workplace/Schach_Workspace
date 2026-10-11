package platform

import (
	"context"
	"encoding/json"
)

type fakeIntelligenceProvider struct{}

func (fakeIntelligenceProvider) Generate(_ context.Context, in GroundedInput) (ProviderOutput, error) {
	raw, _ := json.Marshal(map[string]any{"claims": []any{map[string]any{"text": "Selected source summary", "sourceKeys": []string{in.Sources[0].Key}, "confidence": "uncertain"}}})
	return ProviderOutput{Raw: raw}, nil
}
