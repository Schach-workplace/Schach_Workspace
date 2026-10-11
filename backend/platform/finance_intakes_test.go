package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type financeCleanScanner struct{}

func (financeCleanScanner) Scan(ctx context.Context, r io.Reader) error {
	_, e := io.Copy(io.Discard, r)
	return e
}
func reserveFinanceIntake(t *testing.T, f financeFixture, data []byte, purpose string) string {
	t.Helper()
	h := sha256.Sum256(data)
	b := map[string]any{"retryKey": "reserve-" + purpose, "purpose": purpose, "fileName": "fictional.png", "size": len(data), "sha256": hex.EncodeToString(h[:])}
	if purpose == "statement" {
		b["fileName"] = "fictional.csv"
	}
	if purpose == "receipt" {
		b["destinationDepartmentId"] = f.department
	}
	return financeOK(t, f.s, "POST", f.base()+"/finance/intakes", b, f.cookie)["id"].(string)
}
func uploadFinanceIntake(t *testing.T, f financeFixture, id string, data []byte) int {
	t.Helper()
	r := httptest.NewRequest("POST", f.base()+"/finance/intakes/"+id+"/upload", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/octet-stream")
	r.Header.Set("Origin", "http://localhost:5173")
	r.AddCookie(f.cookie)
	w := httptest.NewRecorder()
	f.s.ServeHTTP(w, r)
	return w.Code
}
func TestFinanceIntakeScopesIntegrity(t *testing.T) {
	f := newFinanceFixture(t)
	data := []byte("\x89PNG\r\n\x1a\nfictional")
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceIntakeStore = store
	f.s.opts.FinanceScanner = financeCleanScanner{}
	id := reserveFinanceIntake(t, f, data, "receipt")
	if st := uploadFinanceIntake(t, f, id, data); st != 200 {
		t.Fatal(st)
	}
	if st := uploadFinanceIntake(t, f, id, data); st != 200 {
		t.Fatal("same upload", st)
	}
	if st := uploadFinanceIntake(t, f, id, []byte("different")); st != 409 {
		t.Fatal("replacement", st)
	}
	peer, _ := f.person(t, "peer@example.com", "finance", "")
	if st, _, _ := req(t, f.s, http.MethodGet, f.base()+"/finance/intakes/"+id, nil, peer); st != 404 {
		t.Fatal("foreign private intake", st)
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", map[string]any{"retryKey": "finalize", "expectedVersion": 2}, f.cookie)
}
func TestFinanceIntakeQuarantineAndCancellation(t *testing.T) {
	f := newFinanceFixture(t)
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceIntakeStore = store
	f.s.opts.FinanceScanner = financeCleanScanner{}
	data := []byte("\x89PNG\r\n\x1a\nfictional")
	id := reserveFinanceIntake(t, f, data, "receipt")
	if uploadFinanceIntake(t, f, id, data) != 200 {
		t.Fatal("upload")
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/finalize", map[string]any{"retryKey": "scan", "expectedVersion": 2}, f.cookie)
	if st, _, _ := req(t, f.s, "GET", f.base()+"/finance/intakes/"+id+"/download", nil, f.cookie); st != 404 {
		t.Fatal("quarantine download", st)
	}
	if _, e := f.s.RunFinanceAssistanceJobs(t.Context(), time.Now(), 1); e != nil {
		t.Fatal(e)
	}
	meta := financeOK(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie)
	if meta["state"] != "clean" {
		t.Fatal(meta)
	}
	financeOK(t, f.s, "POST", f.base()+"/finance/intakes/"+id+"/cancel", map[string]any{"retryKey": "cancel", "expectedVersion": 4}, f.cookie)
	if st, _, _ := req(t, f.s, "GET", f.base()+"/finance/intakes/"+id, nil, f.cookie); st != 404 {
		t.Fatal("cancel disclosed", st)
	}
}
