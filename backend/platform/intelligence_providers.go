package platform

import (
	"context"
	"encoding/json"
	"time"
)

type GroundedInput struct {
	Operation IntelligenceOperation
	Sources   []GroundedSource
	Language  string
	Facts     DeterministicFacts
}
type GroundedSource struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}
type ProviderOutput struct {
	Raw          json.RawMessage
	Identity     ProviderIdentity
	InputTokens  int
	OutputTokens int
}
type TranscriptionInput struct {
	Path       string
	SourceKey  string
	Language   string
	DurationMS int64
}
type TranscriptionOutput struct {
	Segments []IntelligenceSegment
	Language string
	Identity ProviderIdentity
}
type SummaryProvider interface {
	Generate(context.Context, GroundedInput) (ProviderOutput, error)
}
type TranscriptionProvider interface {
	Transcribe(context.Context, TranscriptionInput) (TranscriptionOutput, error)
}
type IntelligenceConfig struct {
	Identity       ProviderIdentity
	Summary        SummaryProvider
	Transcription  TranscriptionProvider
	ScratchRoot    string
	FFprobe        string
	FFmpeg         string
	SummaryTimeout time.Duration
	VoiceTimeout   time.Duration
	DisabledReason string
}
type DeterministicFacts map[string]IntelligenceFact
type IntelligenceFact struct {
	Key        string
	Text       string
	SourceKeys []string
	Relations  []string
}
