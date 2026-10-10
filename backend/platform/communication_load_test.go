package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"gorm.io/gorm"
)

// Opt-in TCP/gateway benchmark. This fixture measures one machine; it is not a
// production capacity certificate or a multi-instance fanout test.
func TestCommunicationGatewayLoadAndOverflow(t *testing.T) {
	if os.Getenv("TEST_COMMUNICATION_LOAD") != "1" {
		t.Skip("set TEST_COMMUNICATION_LOAD=1 for the owned gateway probe")
	}
	s, c, cid, owner, uid, _ := conversationFixture(t)
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	origin := httptest.NewServer(s)
	defer origin.Close()
	target, _ := url.Parse(origin.URL)
	gateway := httptest.NewServer(httputil.NewSingleHostReverseProxy(target))
	defer gateway.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	endpoint := "ws" + strings.TrimPrefix(gateway.URL, "http") + "/api/companies/" + cid + "/conversations/" + id + "/stream"
	const count = 100
	sockets := make([]*websocket.Conn, count)
	latencies := make([]time.Duration, count)
	errs := make(chan error, count)
	var wg sync.WaitGroup
	for i := range count {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			start := time.Now()
			ws, _, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {c.String()}}})
			if err != nil {
				errs <- err
				return
			}
			sockets[i] = ws
			_, body, err := ws.Read(ctx)
			if err == nil {
				var v map[string]any
				err = json.Unmarshal(body, &v)
				if v["kind"] != "ready" {
					t.Errorf("not ready %v", v)
				}
			}
			latencies[i] = time.Since(start)
			if err != nil {
				errs <- err
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	defer func() {
		for _, ws := range sockets {
			if ws != nil {
				ws.CloseNow()
			}
		}
	}()
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	t.Logf("100 TCP/proxy sockets ready p50=%s p95=%s max=%s", latencies[50], latencies[95], latencies[99])
	start := time.Now()
	e := s.db.Transaction(func(tx *gorm.DB) error {
		scope, e := conversationAccess(tx, owner, cid, id)
		if e != nil {
			return e
		}
		for range 51 {
			if e := appendCommunicationEvent(tx, scope, "load_probe", "", 0); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	for _, ws := range sockets {
		_, body, e := ws.Read(ctx)
		if e != nil {
			t.Fatal(e)
		}
		var v map[string]any
		if json.Unmarshal(body, &v) != nil || v["kind"] != "refetch_required" {
			t.Fatalf("overflow needs explicit refetch: %s", body)
		}
		_, _, e = ws.Read(ctx)
		if websocket.CloseStatus(e) != websocket.StatusPolicyViolation {
			t.Fatalf("overflow not closed: %v", e)
		}
	}
	t.Logf("51-event atomic burst: all 100 sockets requested refetch and closed in %s", time.Since(start))
}
