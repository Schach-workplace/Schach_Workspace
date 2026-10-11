package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type LocalWhisper struct {
	Python, Script, Model string
	Identity              ProviderIdentity
}

func intelligenceCommand(ctx context.Context, path string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		return nil
	}
	cmd.WaitDelay = 2 * time.Second
	out := &financeBoundedOutput{Limit: 65536}
	cmd.Stdout = out
	cmd.Stderr = &financeBoundedOutput{Limit: 1024}
	cmd.Env = append(os.Environ(), "HF_HUB_OFFLINE=1", "TRANSFORMERS_OFFLINE=1", "HF_DATASETS_OFFLINE=1", "OMP_NUM_THREADS=4", "TOKENIZERS_PARALLELISM=false")
	if e := cmd.Run(); e != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, intelligenceError(503, "provider_failed")
	}
	return out.Bytes(), nil
}
func (p *LocalWhisper) Transcribe(ctx context.Context, in TranscriptionInput) (TranscriptionOutput, error) {
	out := TranscriptionOutput{}
	info, e := os.Lstat(in.Path)
	if e != nil || !info.Mode().IsRegular() || !filepath.IsAbs(in.Path) {
		return out, intelligenceError(422, "invalid_audio")
	}
	raw, e := intelligenceCommand(ctx, p.Python, p.Script, "--model", p.Model, "--audio", in.Path, "--source-key", in.SourceKey, "--language", in.Language)
	if e != nil {
		return out, e
	}
	var body struct {
		Language string                `json:"language"`
		Segments []IntelligenceSegment `json:"segments"`
	}
	if strictIntelligenceJSON(raw, &body) != nil {
		return out, intelligenceError(422, "invalid_output")
	}
	out.Segments = body.Segments
	out.Language = body.Language
	out.Identity = p.Identity
	return out, nil
}
func (s *Server) transcribeIntelligence(ctx context.Context, lease IntelligenceLease, m SourceManifest, facts DeterministicFacts) ([]byte, error) {
	if len(m.Sources) != 1 {
		return nil, intelligenceError(422, "invalid_audio")
	}
	media, ok := m.Sources[0].Value.(CommunicationMedia)
	if !ok || s.opts.MediaStore == nil {
		return nil, intelligenceError(422, "invalid_audio")
	}
	config := s.opts.Intelligence
	root := config.ScratchRoot
	if root == "" {
		root = os.TempDir()
	}
	real, e := filepath.EvalSymlinks(root)
	if e != nil || real != filepath.Clean(root) {
		return nil, intelligenceError(503, "provider_unavailable")
	}
	dir, e := os.MkdirTemp(root, "schach-intelligence-")
	if e != nil {
		return nil, e
	}
	defer os.RemoveAll(dir)
	if e = os.Chmod(dir, 0700); e != nil {
		return nil, e
	}
	path := filepath.Join(dir, "input")
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return nil, e
	}
	reader, e := s.opts.MediaStore.Open(ctx, media.ID)
	if e != nil {
		f.Close()
		return nil, intelligenceError(422, "invalid_audio")
	}
	done := make(chan struct{})
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		select {
		case <-ctx.Done():
			reader.Close()
		case <-done:
		}
	}()
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(f, h), io.LimitReader(reader, (25<<20)+1))
	reader.Close()
	close(done)
	<-closed
	closeErr := f.Close()
	if e != nil || closeErr != nil || n != media.Size || hex.EncodeToString(h.Sum(nil)) != media.SHA256 || ctx.Err() != nil {
		return nil, intelligenceError(422, "invalid_audio")
	}
	probeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	raw, e := intelligenceCommand(probeCtx, config.FFprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=format_name,duration:stream=codec_type,duration", "-of", "json", path)
	cancel()
	if e != nil {
		return nil, e
	}
	var probe struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			Duration  string `json:"duration"`
		} `json:"streams"`
		Format struct {
			Name     string `json:"format_name"`
			Duration string `json:"duration"`
		} `json:"format"`
		Programs     json.RawMessage `json:"programs,omitempty"`
		StreamGroups json.RawMessage `json:"stream_groups,omitempty"`
	}
	if json.Unmarshal(raw, &probe) != nil || len(probe.Streams) != 1 || probe.Streams[0].CodecType != "audio" {
		return nil, intelligenceError(422, "invalid_audio")
	}
	format := ""
	switch {
	case probe.Format.Name == "wav":
		format = "wav"
	case strings.Contains(probe.Format.Name, "mov"):
		format = "mov"
	case strings.Contains(probe.Format.Name, "webm"):
		format = "matroska"
	default:
		return nil, intelligenceError(422, "invalid_audio")
	}
	duration, e := strconv.ParseFloat(probe.Format.Duration, 64)
	if e != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || duration > 600 {
		return nil, intelligenceError(422, "invalid_audio")
	}
	decoded := filepath.Join(dir, "audio.wav")
	decodedFile, e := os.OpenFile(decoded, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return nil, e
	}
	if e = decodedFile.Close(); e != nil {
		return nil, e
	}
	decodeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	_, e = intelligenceCommand(decodeCtx, "/usr/bin/prlimit", "--fsize=19201024", "--cpu=30", "--", config.FFmpeg, "-y", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-f", format, "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", decoded)
	cancel()
	if e != nil {
		return nil, e
	}
	if e = os.Chmod(decoded, 0600); e != nil {
		return nil, e
	}
	stat, e := os.Stat(decoded)
	if e != nil || stat.Size() > 19201024 {
		return nil, intelligenceError(422, "invalid_audio")
	}
	facts["audioDurationMs"] = IntelligenceFact{Text: strconv.FormatInt(int64(math.Ceil(duration*1000)), 10)}
	out, e := config.Transcription.Transcribe(ctx, TranscriptionInput{Path: decoded, SourceKey: m.Sources[0].SourceKey, Language: lease.Job.Selection.Language, DurationMS: int64(math.Ceil(duration * 1000))})
	if e != nil {
		return nil, e
	}
	return json.Marshal(map[string]any{"language": out.Language, "segments": out.Segments})
}
