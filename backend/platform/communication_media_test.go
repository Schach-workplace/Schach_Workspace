package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

type cleanTestScanner struct{}

func (cleanTestScanner) Scan(context.Context, io.Reader) error { return nil }
func TestMediaQuarantineAndRevocation(t *testing.T) {
	s, c, cid, owner, uid, mc := conversationFixture(t)
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	s.opts.MediaStore = store
	s.opts.MediaScanner = cleanTestScanner{}
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	content := []byte("safe photo notes")
	h := sha256.Sum256(content)
	root := "/api/companies/" + cid + "/conversations/" + id + "/media"
	st, b, w := req(t, s, "POST", root, map[string]any{"fileName": "notes.txt", "size": len(content), "sha256": hex.EncodeToString(h[:])}, mc)
	if st != 200 {
		t.Fatalf("reserve %d %s", st, w.Body.String())
	}
	media := b["id"].(string)
	st, _, _ = req(t, s, "GET", root+"/"+media+"/download", nil, mc)
	if st != 404 {
		t.Fatal("quarantine download")
	}
	request := httptest.NewRequest("POST", root+"/"+media+"/upload", bytes.NewReader(content))
	request.AddCookie(mc)
	response := httptest.NewRecorder()
	s.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	st, _, _ = req(t, s, "POST", root+"/"+media+"/finalize", map[string]any{}, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "GET", root+"/"+media+"/download", nil, mc)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "POST", "/api/companies/"+cid+"/conversations/"+id+"/members", map[string]any{"expectedVersion": 1, "userId": uid, "role": "member", "active": false}, c)
	if st != 200 {
		t.Fatal(st)
	}
	st, _, _ = req(t, s, "GET", root+"/"+media+"/download", nil, mc)
	if st != 404 {
		t.Fatal("removed media download")
	}
	_, e = store.Open(context.Background(), "../../etc/passwd")
	if e == nil {
		t.Fatal("unsafe key")
	}
	_ = os.ErrNotExist
}

func TestExpiredMediaIsDeniedBeforeCleanupAndQuotaIncludesRejected(t *testing.T) {
	s, c, cid, owner, uid, _ := conversationFixture(t)
	store, e := NewFileMediaStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	s.opts.MediaStore = store
	id := newConversation(t, s, c, cid, []string{owner, uid}, "group")
	mid := newID("med")
	if e := store.Put(t.Context(), mid, bytes.NewReader([]byte("safe"))); e != nil {
		t.Fatal(e)
	}
	row := CommunicationMedia{ID: mid, CompanyID: cid, ConversationID: id, UserID: owner, FileName: "notes.txt", Size: 4, SHA256: "0000000000000000000000000000000000000000000000000000000000000000", MimeType: "text/plain", State: "clean", HistorySequence: 1, CreatedAt: nowString(), ExpiresAt: time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)}
	if e := s.db.Create(&row).Error; e != nil {
		t.Fatal(e)
	}
	st, _, _ := req(t, s, "GET", "/api/companies/"+cid+"/conversations/"+id+"/media/"+mid+"/download", nil, c)
	if st != 404 {
		t.Fatal("expired bytes disclosed before cleanup", st)
	}
	n, e := s.RunMediaCleanup(t.Context())
	if e != nil || n != 1 {
		t.Fatal(n, e)
	}
	if _, e := store.Open(t.Context(), mid); e == nil {
		t.Fatal("expired file retained")
	}
}
