package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type checkedVoice struct {
	t       *testing.T
	calls   int
	blocked bool
}

func (p *checkedVoice) Transcribe(ctx context.Context, in TranscriptionInput) (TranscriptionOutput, error) {
	p.calls++
	st, e := os.Stat(in.Path)
	if e != nil || st.Mode().Perm() != 0600 {
		p.t.Fatal("decoded file not owner-only", e)
	}
	if p.blocked {
		<-ctx.Done()
		return TranscriptionOutput{}, ctx.Err()
	}
	return TranscriptionOutput{Language: "en", Segments: []IntelligenceSegment{{StartMS: 0, EndMS: 1000, Text: "Fictional audio", SourceKey: in.SourceKey}}}, nil
}
func ownedWave() []byte {
	var b bytes.Buffer
	b.WriteString("RIFF")
	binary.Write(&b, binary.LittleEndian, uint32(32036))
	b.WriteString("WAVEfmt ")
	binary.Write(&b, binary.LittleEndian, uint32(16))
	binary.Write(&b, binary.LittleEndian, uint16(1))
	binary.Write(&b, binary.LittleEndian, uint16(1))
	binary.Write(&b, binary.LittleEndian, uint32(16000))
	binary.Write(&b, binary.LittleEndian, uint32(32000))
	binary.Write(&b, binary.LittleEndian, uint16(2))
	binary.Write(&b, binary.LittleEndian, uint16(16))
	b.WriteString("data")
	binary.Write(&b, binary.LittleEndian, uint32(32000))
	b.Write(make([]byte, 32000))
	return b.Bytes()
}
func TestIntelligenceVoiceBoundsAndCleanup(t *testing.T) {
	for _, tc := range []string{"success", "byte_mismatch", "corrupt", "video", "too_long", "cancel"} {
		t.Run(tc, func(t *testing.T) {
			s, _ := testServer(t)
			root := t.TempDir()
			store, e := NewFileMediaStore(t.TempDir())
			if e != nil {
				t.Fatal(e)
			}
			s.opts.MediaStore = store
			p := &checkedVoice{t: t, blocked: tc == "cancel"}
			s.opts.Intelligence = &IntelligenceConfig{ScratchRoot: root, FFprobe: "/usr/bin/ffprobe", FFmpeg: "/usr/bin/ffmpeg", Transcription: p}
			wave := ownedWave()
			if tc == "corrupt" {
				wave = []byte("not audio")
			}
			sum := sha256.Sum256(wave)
			media := CommunicationMedia{ID: newID("med"), Size: int64(len(wave)), SHA256: hex.EncodeToString(sum[:])}
			if e = store.Put(t.Context(), media.ID, bytes.NewReader(wave)); e != nil {
				t.Fatal(e)
			}
			if tc == "byte_mismatch" {
				media.SHA256 = "wrong"
			}
			if tc == "video" || tc == "too_long" {
				script := filepath.Join(t.TempDir(), "probe")
				body := `{"streams":[{"codec_type":"video"}],"format":{"format_name":"wav","duration":"1"}}`
				if tc == "too_long" {
					body = `{"streams":[{"codec_type":"audio"}],"format":{"format_name":"wav","duration":"601"}}`
				}
				os.WriteFile(script, []byte("#!/bin/sh\nprintf '%s' '"+body+"'\n"), 0700)
				s.opts.Intelligence.FFprobe = script
			}
			ctx, cancel := context.WithTimeout(t.Context(), 500*time.Millisecond)
			defer cancel()
			raw, e := s.transcribeIntelligence(ctx, IntelligenceLease{}, SourceManifest{Sources: []BoundIntelligenceSource{{SourceKey: "selected", Value: media}}}, DeterministicFacts{})
			if tc == "success" {
				if e != nil || len(raw) == 0 || p.calls != 1 {
					t.Fatal(e)
				}
			} else if e == nil {
				t.Fatal("unsafe audio succeeded")
			}
			if tc != "success" && tc != "cancel" && p.calls != 0 {
				t.Fatal("invalid audio reached model")
			}
			entries, e := os.ReadDir(root)
			if e != nil || len(entries) != 0 {
				t.Fatal("temporary bytes survived", e)
			}
		})
	}
}
func TestIntelligenceLocalProcessCancellationAndPath(t *testing.T) {
	root := t.TempDir()
	script := filepath.Join(root, "blocked")
	os.WriteFile(script, []byte("#!/bin/sh\nsleep 60 &\nwait\n"), 0700)
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, e := intelligenceCommand(ctx, script)
	if !errors.Is(e, context.DeadlineExceeded) || time.Since(start) > 3*time.Second {
		t.Fatal("process group not joined", e)
	}
	path := filepath.Join(root, "audio.wav")
	os.WriteFile(path, ownedWave(), 0600)
	link := filepath.Join(root, "symlink")
	os.Symlink(path, link)
	p := LocalWhisper{Python: script}
	if _, e = p.Transcribe(t.Context(), TranscriptionInput{Path: link}); e == nil {
		t.Fatal("symlink accepted")
	}
}

func TestIntelligenceTempSweepOwnsOnlyExpiredLeases(t *testing.T) {
	s, _, _, id := intelligenceQueuedFixture(t, fakeIntelligenceProvider{})
	lease, e := s.claimIntelligence(t.Context())
	if e != nil || lease == nil {
		t.Fatal(e)
	}
	root := t.TempDir()
	os.Chmod(root, 0700)
	s.opts.Intelligence.ScratchRoot = root
	old := time.Now().UTC().Add(-time.Hour)
	makeDir := func(name, token string, aged bool) string {
		p := filepath.Join(root, name)
		if e := os.Mkdir(p, 0700); e != nil {
			t.Fatal(e)
		}
		raw, _ := json.Marshal(map[string]string{"jobId": id, "leaseToken": token})
		os.WriteFile(filepath.Join(p, "lease.json"), raw, 0600)
		os.WriteFile(filepath.Join(p, "audio.wav"), ownedWave(), 0600)
		if aged {
			os.Chtimes(p, old, old)
		}
		return p
	}
	stale := makeDir("schach-intelligence-stale", "old", true)
	active := makeDir("schach-intelligence-active", lease.Token, true)
	recent := makeDir("schach-intelligence-recent", "old", false)
	foreign := makeDir("foreign-directory", "old", true)
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "keep"), []byte("owned external fixture"), 0600)
	os.Symlink(outside, filepath.Join(root, "schach-intelligence-link"))
	if e = s.sweepIntelligenceScratch(t.Context(), time.Now().UTC()); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(stale); !os.IsNotExist(e) {
		t.Fatal("stale scratch survived", e)
	}
	for _, p := range []string{active, recent, foreign, filepath.Join(outside, "keep")} {
		if _, e = os.Stat(p); e != nil {
			t.Fatal("sweep crossed ownership", e)
		}
	}
}
