package platform

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
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

// Optional providers fail closed without preventing ordinary application startup.
func ConfigureIntelligence(o *Options) error {
	if os.Getenv("INTELLIGENCE_ENABLED") != "true" {
		return nil
	}
	config := &IntelligenceConfig{DisabledReason: "provider_unavailable"}
	o.Intelligence = config
	root := os.Getenv("INTELLIGENCE_SCRATCH_ROOT")
	python := os.Getenv("INTELLIGENCE_PYTHON")
	script := os.Getenv("INTELLIGENCE_WHISPER_SCRIPT")
	model := os.Getenv("INTELLIGENCE_WHISPER_MODEL")
	if root == "" || python == "" || script == "" || model == "" {
		return nil
	}
	for _, path := range []string{root, python, script, model} {
		if !filepath.IsAbs(path) {
			return nil
		}
		if _, e := filepath.EvalSymlinks(path); e != nil {
			return nil
		}
	}
	info, e := os.Lstat(root)
	if e != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 || info.Mode()&os.ModeSymlink != 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, e = intelligenceCommand(ctx, python, script, "--model", model, "--verify"); e != nil {
		return nil
	}
	address := os.Getenv("INTELLIGENCE_OLLAMA_URL")
	ollama, e := NewLocalOllama(address)
	if e != nil {
		return nil
	}
	if e = ollama.Verify(ctx); e != nil {
		return nil
	}
	probe, e := exec.LookPath("ffprobe")
	if e != nil {
		return nil
	}
	ffmpeg, e := exec.LookPath("ffmpeg")
	if e != nil {
		return nil
	}
	config.Identity = ollama.Identity
	config.Identity.Name = "local-whisper-tiny+" + intelligenceOllamaModel
	config.Identity.Digest = intelligenceOllamaDigest + ":dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1"
	config.Summary = ollama
	config.Transcription = &LocalWhisper{Python: python, Script: script, Model: model, Identity: config.Identity}
	config.ScratchRoot = root
	config.FFprobe = probe
	config.FFmpeg = ffmpeg
	config.DisabledReason = ""
	return nil
}
