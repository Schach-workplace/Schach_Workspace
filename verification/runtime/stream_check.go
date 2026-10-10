// Run against an explicitly disposable server. Cookie credentials enter via stdin.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, "Realtime check failed:", e)
		os.Exit(1)
	}
}
func run() error {
	var input struct{ Base, Company, Conversation, Member, OwnerCookie, MemberCookie string }
	if e := json.NewDecoder(os.Stdin).Decode(&input); e != nil {
		return e
	}
	target, e := url.Parse(input.Base)
	if e != nil {
		return e
	}
	proxy := httptest.NewServer(httputil.NewSingleHostReverseProxy(target))
	defer proxy.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	root := "/api/companies/" + input.Company + "/conversations/" + input.Conversation
	path := "ws" + strings.TrimPrefix(proxy.URL, "http") + root + "/stream"
	headers := http.Header{"Cookie": {input.MemberCookie}, "Origin": {"https://hostile.invalid"}}
	conn, response, e := websocket.Dial(ctx, path, &websocket.DialOptions{HTTPHeader: headers})
	if e == nil {
		conn.CloseNow()
		return fmt.Errorf("hostile origin accepted")
	}
	if response == nil || response.StatusCode != 403 {
		return fmt.Errorf("hostile origin response unavailable")
	}
	headers.Set("Origin", proxy.URL)
	conn, _, e = websocket.Dial(ctx, path, &websocket.DialOptions{HTTPHeader: headers})
	if e != nil {
		return fmt.Errorf("proxy socket upgrade: %w", e)
	}
	defer conn.CloseNow()
	if _, _, e = conn.Read(ctx); e != nil {
		return e
	}
	post := func(path, body string) error {
		r, e := http.NewRequestWithContext(ctx, "POST", proxy.URL+path, strings.NewReader(body))
		if e != nil {
			return e
		}
		r.Header.Set("Cookie", input.OwnerCookie)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", proxy.URL)
		res, e := http.DefaultClient.Do(r)
		if e != nil {
			return e
		}
		defer res.Body.Close()
		io.Copy(io.Discard, res.Body)
		if res.StatusCode != 200 {
			return fmt.Errorf("command status %d", res.StatusCode)
		}
		return nil
	}
	if e = post(root+"/messages", `{"clientMessageId":"runtime-persisted","body":"Runtime private marker"}`); e != nil {
		return e
	}
	_, hint, e := conn.Read(ctx)
	if e != nil {
		return e
	}
	if strings.Contains(string(hint), "Runtime private marker") || !strings.Contains(string(hint), "eventId") {
		return fmt.Errorf("hint disclosed content or lacks identifier")
	}
	if e = post(root+"/members", `{"expectedVersion":1,"role":"member","active":false,"userId":"`+input.Member+`"}`); e != nil {
		return e
	}
	for {
		_, _, e = conn.Read(ctx)
		if e != nil {
			break
		}
	}
	if websocket.CloseStatus(e) != websocket.StatusPolicyViolation {
		return fmt.Errorf("removed socket did not close with policy status")
	}
	fmt.Println("PASS proxy upgrade, exact origin, scoped content-free hint and revocation close")
	return nil
}
