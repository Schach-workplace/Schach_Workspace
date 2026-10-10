package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestActualClamAV(t *testing.T) {
	address := os.Getenv("TEST_CLAMAV_ADDRESS")
	if address == "" {
		t.Skip("opt in to a private real scanner")
	}
	scanner := ClamAVScanner{Address: address}
	if e := scanner.Scan(t.Context(), strings.NewReader("ordinary clean communication evidence")); e != nil {
		t.Fatal("real clean scan", e)
	}
	// EICAR is a harmless standard scanner test signature, never an executable.
	eicar := `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`
	if e := scanner.Scan(t.Context(), strings.NewReader(eicar)); e == nil {
		t.Fatal("EICAR accepted")
	}
	if e := (ClamAVScanner{Address: "127.0.0.1:1"}).Scan(t.Context(), strings.NewReader("clean")); e == nil {
		t.Fatal("scanner outage accepted")
	}
}
func TestActualLiveKitAudioAndRevocation(t *testing.T) {
	configPath := os.Getenv("TEST_LIVEKIT_CONFIG")
	if configPath == "" {
		t.Skip("opt in to a private real provider")
	}
	data, e := os.ReadFile(configPath)
	if e != nil {
		t.Fatal(e)
	}
	var config struct{ URL, Key, Secret string }
	if e = json.Unmarshal(data, &config); e != nil {
		t.Fatal(e)
	}
	s, c, cid, owner, uid, mc := conversationFixture(t)
	s.opts.LiveKitURL = config.URL
	s.opts.LiveKitAPIKey = config.Key
	s.opts.LiveKitAPISecret = config.Secret
	conversation := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	call := financeOK(t, s, "POST", "/api/companies/"+cid+"/conversations/"+conversation+"/calls", map[string]any{"kind": "audio", "retryKey": "actual-provider"}, c)["id"].(string)
	mux := http.NewServeMux()
	mux.Handle("/api/", s)
	mux.HandleFunc("/call-harness", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<script src="/call-sdk.js"></script>`))
	})
	mux.HandleFunc("/call-sdk.js", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../../frontend/node_modules/livekit-client/dist/livekit-client.umd.js")
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	s.opts.AllowedOrigins = []string{server.URL}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(100 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				if _, e := s.RunCallRevocations(ctx); e != nil && ctx.Err() == nil {
					t.Error(e)
				}
				if _, e := s.RunCallCleanup(ctx); e != nil && ctx.Err() == nil {
					t.Error(e)
				}
			}
		}
	}()
	defer func() { cancel(); <-done }()
	input, _ := json.Marshal(map[string]any{"base": server.URL, "company": cid, "conversation": conversation, "call": call, "member": uid, "ownerCookie": map[string]string{"name": c.Name, "value": c.Value}, "memberCookie": map[string]string{"name": mc.Name, "value": mc.Value}})
	command := exec.CommandContext(ctx, "node", filepath.Join("..", "..", "verification", "runtime", "livekit-browser.mjs"))
	command.Stdin = bytes.NewReader(input)
	output, e := command.CombinedOutput()
	if e != nil {
		t.Fatalf("real provider scenario: %v\n%s", e, output)
	}
	t.Log(string(output))
}
