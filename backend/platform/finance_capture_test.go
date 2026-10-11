package platform

import (
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

func TestFinanceCaptureReservationAndCanonicalBinding(t *testing.T) {
	f := newFinanceFixture(t)
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	f.s.opts.FinanceIntakeStore = store
	root := f.base() + "/finance/intakes"
	reserve := map[string]any{"retryKey": "camera-reserve", "capture": true, "purpose": "receipt", "destinationDepartmentId": f.department}
	out := financeOK(t, f.s, "POST", root, reserve, f.cookie)
	id := out["id"].(string)
	var original FinanceAssistanceIntake
	f.db.First(&original, "id=?", id)
	if original.State != "capture_reserved" || original.Size != 0 || original.FileName != "" || original.InternalSHA256 != "" || original.ContentGeneration != 0 || original.CleanGeneration != 0 {
		t.Fatal(original)
	}
	if st := uploadFinanceIntake(t, f, id, []byte("bytes")); st != 409 {
		t.Fatal("unbound upload", st)
	}
	if st, _, _ := req(t, f.s, "POST", root+"/"+id+"/finalize", map[string]any{"retryKey": "unbound-finalize", "expectedVersion": 1}, f.cookie); st != 422 {
		t.Fatal(st)
	}
	data := []byte("\x89PNG\r\n\x1a\nfictional")
	bind := map[string]any{"retryKey": "bind-lost-ack", "expectedVersion": 1, "fileName": "captured.png", "size": len(data), "sha256": financeDigest(data)}
	for n := 0; n < 2; n++ {
		got := financeOK(t, f.s, "POST", root+"/"+id+"/bind-content", bind, f.cookie)
		if got["version"] != float64(2) || got["state"] != "reserved" || got["expiresAt"] != out["expiresAt"] {
			t.Fatal(got)
		}
	}
	var bound FinanceAssistanceIntake
	f.db.First(&bound, "id=?", id)
	if !bound.ExpiresAt.Equal(original.ExpiresAt) || bound.SessionRef != original.SessionRef || bound.ContentGeneration != 1 {
		t.Fatal("binding renewed source", bound)
	}
	bind["retryKey"] = "changed-binding"
	bind["size"] = 1
	bind["sha256"] = financeDigest([]byte("x"))
	if st, _, _ := req(t, f.s, "POST", root+"/"+id+"/bind-content", bind, f.cookie); st != 409 {
		t.Fatal(st)
	}
	if uploadFinanceIntake(t, f, id, data) != 200 {
		t.Fatal("bound exact upload")
	}
	reserve["retryKey"] = "another-camera"
	reserve["fileName"] = "invented.png"
	if st, _, _ := req(t, f.s, "POST", root, reserve, f.cookie); st != 422 {
		t.Fatal("capture file identity", st)
	}
	delete(reserve, "fileName")
	reserve["purpose"] = "statement"
	if st, _, _ := req(t, f.s, "POST", root, reserve, f.cookie); st != 422 {
		t.Fatal("capture statement", st)
	}
}
func TestFinanceCaptureQuotaCancellationExpiry(t *testing.T) {
	f := newFinanceFixture(t)
	store, _ := NewFileMediaStore(t.TempDir())
	f.s.opts.FinanceIntakeStore = store
	f.s.opts.FinanceActorQuotaBytes = 10 << 20
	root := f.base() + "/finance/intakes"
	reserve := map[string]any{"retryKey": "one-camera", "capture": true, "purpose": "receipt", "destinationDepartmentId": f.department}
	id := financeOK(t, f.s, "POST", root, reserve, f.cookie)["id"].(string)
	reserve["retryKey"] = "over-quota"
	if st, _, _ := req(t, f.s, "POST", root, reserve, f.cookie); st != 422 {
		t.Fatal("unbound charge", st)
	}
	financeOK(t, f.s, "POST", root+"/"+id+"/cancel", map[string]any{"retryKey": "camera-cancel", "expectedVersion": 1}, f.cookie)
	next := financeOK(t, f.s, "POST", root, reserve, f.cookie)["id"].(string)
	f.db.Model(&FinanceAssistanceIntake{}).Where("id=?", next).Update("expires_at", time.Now().Add(-time.Minute))
	bind := map[string]any{"retryKey": "expired-bind", "expectedVersion": 1, "fileName": "real.png", "size": 1, "sha256": financeDigest([]byte("x"))}
	if st, _, _ := req(t, f.s, "POST", root+"/"+next+"/bind-content", bind, f.cookie); st != 404 {
		t.Fatal("expiry bind", st)
	}
}

func TestFinanceCaptureQuotaConcurrent(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("owned PG fixture")
	}
	f := newFinanceFixture(t)
	store, _ := NewFileMediaStore(t.TempDir())
	f.s.opts.FinanceIntakeStore = store
	f.s.opts.FinanceActorQuotaBytes = 10 << 20
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			st, _, _ := req(t, f.s, "POST", f.base()+"/finance/intakes", map[string]any{"retryKey": fmt.Sprintf("camera-%d", n), "capture": true, "purpose": "receipt", "destinationDepartmentId": f.department}, f.cookie)
			codes <- st
		}(n)
	}
	wg.Wait()
	close(codes)
	successes := 0
	for st := range codes {
		if st == 200 {
			successes++
		} else if st != 422 {
			t.Fatal(st)
		}
	}
	if successes != 1 {
		t.Fatal("quota admitted", successes)
	}
}
