package platform

import (
	"context"
	"gorm.io/gorm"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestReportExportCanonical(t *testing.T) {
	s, _ := testServer(t)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	s.opts.ReportArtifactStore = store
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/reports"
	st, b, w := req(t, s, "POST", base+"/history/snapshots", map[string]any{"retryKey": "export-snapshot", "request": historyRequest()}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	input := map[string]any{"retryKey": "export-one", "snapshotId": b["snapshotId"], "csvSchemaVersion": 1}
	st, b, w = req(t, s, "POST", base+"/exports", input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := b["job"].(map[string]any)["id"]
	st, b, w = req(t, s, "POST", base+"/exports", input, c)
	if st != 200 || b["job"].(map[string]any)["id"] != id {
		t.Fatal("duplicate export", w.Body.String())
	}
	input["csvSchemaVersion"] = 2
	st, _, _ = req(t, s, "POST", base+"/exports", input, c)
	if st != 422 {
		t.Fatal("unsupported schema", st)
	}
}
func TestReportArtifactAuthorizationAndCleanup(t *testing.T) {
	s, _ := testServer(t)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	s.opts.ReportArtifactStore = store
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	st, _, w := req(t, s, "GET", "/api/companies/"+cid+"/reports/artifacts/unknown", nil, c)
	if st != 404 {
		t.Fatal(st, w.Body.String())
	}
	// Authenticated unknown IDs must be inaccessible, not bearer capabilities.
}

func TestReportExportLeaseLifecycle(t *testing.T) {
	s, db := testServer(t)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	s.opts.ReportArtifactStore = store
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/reports"
	st, b, w := req(t, s, "POST", base+"/history/snapshots", map[string]any{"retryKey": "lease-snap", "request": historyRequest()}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	st, b, w = req(t, s, "POST", base+"/exports", map[string]any{"retryKey": "lease-job", "snapshotId": b["snapshotId"], "csvSchemaVersion": 1}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	now := time.Now().UTC()
	job, oldToken, e := s.claimReportExport(context.Background(), now)
	if e != nil {
		t.Fatal(e)
	}
	expired := now.Add(-time.Minute)
	db.Model(&ReportExportJob{}).Where("id=?", job.ID).Update("lease_until", expired)
	current, token, e := s.claimReportExport(context.Background(), now.Add(time.Second))
	if e != nil || token == oldToken {
		t.Fatal(current, e)
	}
	if e := s.renewReportExport(context.Background(), job.ID, oldToken, now); e == nil {
		t.Fatal("old lease renewed")
	}
	if e := s.generateReportExport(context.Background(), job, oldToken); e == nil {
		t.Fatal("old worker published")
	}
	if e := s.generateReportExport(context.Background(), current, token); e != nil {
		t.Fatal(e)
	}
	var ready ReportExportJob
	db.First(&ready, "id=?", job.ID)
	if ready.State != "ready" || ready.ArtifactID == "" {
		t.Fatal(ready)
	}
	st, _, w = req(t, s, "GET", base+"/artifacts/"+ready.ArtifactID, nil, c)
	if st != 200 || !strings.Contains(w.Body.String(), "schema,basis") {
		t.Fatal(st, w.Body.String())
	}
	if w.Header().Get("Content-Length") == "" {
		t.Fatal("partial CSV cannot be detected without exact content length")
	}
	var intents int64
	db.Model(&ReportDeliveryIntent{}).Where("job_id=?", job.ID).Count(&intents)
	if intents != 1 {
		t.Fatal("duplicate publication", intents)
	}
}
func TestReportArtifactStoreBoundsAndPrivacy(t *testing.T) {
	root := t.TempDir() + "/private"
	store, e := NewFileReportArtifactStore(root)
	if e != nil {
		t.Fatal(e)
	}
	key := newID("rpt")
	if e := store.Put(context.Background(), key, strings.NewReader("PRIVATE")); e != nil {
		t.Fatal(e)
	}
	info, e := os.Stat(filepath.Join(root, key))
	if e != nil || info.Mode().Perm() != 0600 {
		t.Fatal(info, e)
	}
	if _, e := store.Open(context.Background(), "../bad"); e == nil {
		t.Fatal("traversal accepted")
	}
	symlink := newID("rpt")
	os.Symlink(filepath.Join(root, key), filepath.Join(root, symlink))
	if _, e := store.Open(context.Background(), symlink); e == nil {
		t.Fatal("symlink open accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e := store.Put(ctx, newID("rpt"), strings.NewReader("cancelled")); e == nil {
		t.Fatal("cancelled write accepted")
	}
	if e := store.Put(context.Background(), newID("rpt"), io.LimitReader(zeroReportReader{}, reportCSVByteLimit+1)); e == nil {
		t.Fatal("oversized artifact accepted")
	}
}

type zeroReportReader struct{}

func (zeroReportReader) Read(b []byte) (int, error) { clear(b); return len(b), nil }

func TestReportArtifactCancellationImmediatelyDeniesBytes(t *testing.T) {
	s, _ := testServer(t)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	s.opts.ReportArtifactStore = store
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	base := "/api/companies/" + cid + "/reports"
	st, b, w := req(t, s, "POST", base+"/history/snapshots", map[string]any{"retryKey": "cancel-snap", "request": historyRequest()}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	st, b, w = req(t, s, "POST", base+"/exports", map[string]any{"retryKey": "cancel-job", "snapshotId": b["snapshotId"], "csvSchemaVersion": 1}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	id := b["job"].(map[string]any)["id"].(string)
	job, token, e := s.claimReportExport(context.Background(), time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	if e := s.generateReportExport(context.Background(), job, token); e != nil {
		t.Fatal(e)
	}
	st, b, w = req(t, s, "GET", base+"/exports/"+id, nil, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	aid := b["job"].(map[string]any)["artifactId"].(string)
	st, _, w = req(t, s, "POST", base+"/exports/"+id+"/cancel", map[string]any{"retryKey": "cancel-ready"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	st, _, w = req(t, s, "GET", base+"/artifacts/"+aid, nil, c)
	if st != 404 {
		t.Fatal("cancelled artifact disclosed", st, w.Body.String())
	}
}

func TestReportExportLeaseCapsCrashAttempts(t *testing.T) {
	s, db := testServer(t)
	now := time.Now().UTC()
	expired := now.Add(-time.Second)
	job := ReportExportJob{ID: newID("rj"), CompanyID: "fixture", RecipientID: "fixture", State: "running", LeaseToken: "old", LeaseUntil: &expired, AttemptCount: 5, NextAttemptAt: now, CreatedAt: now, UpdatedAt: now}
	if e := db.Create(&job).Error; e != nil {
		t.Fatal(e)
	}
	_, _, e := s.claimReportExport(context.Background(), now)
	if e != gorm.ErrRecordNotFound {
		t.Fatal("sixth crash attempt claimed", e)
	}
	db.First(&job, "id=?", job.ID)
	if job.State != "failed" {
		t.Fatal("crash cap not terminal", job)
	}
}

type reportRevokingWriter struct {
	*httptest.ResponseRecorder
	revoke func()
	chunks int
}

func (w *reportRevokingWriter) Write(b []byte) (int, error) {
	n, e := w.ResponseRecorder.Write(b)
	w.chunks++
	if w.chunks == 1 {
		w.revoke()
	}
	return n, e
}
func TestReportArtifactMidstreamAllSourceAndSessionRevocation(t *testing.T) {
	for _, mode := range []string{"source_outside_page", "session"} {
		t.Run(mode, func(t *testing.T) {
			s, db := testServer(t)
			store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
			if e != nil {
				t.Fatal(e)
			}
			s.opts.ReportArtifactStore = store
			c := login(t, s, "founder@example.com")
			cid := firstCompany(t, s, c)
			owner := me(t, s, c)
			for i := 0; i < 103; i++ {
				createTask(t, s, c, cid, taskBody(owner))
			}
			db.Where("company_id=?", cid).Delete(&TaskFact{})
			db.Where("company_id=?", cid).Delete(&TaskHistoryCoverage{})
			root := "/api/companies/" + cid + "/reports"
			st, b, w := req(t, s, "POST", root+"/history/snapshots", map[string]any{"retryKey": "stream-snap", "request": historyRequest()}, c)
			if st != 200 {
				t.Fatal(w.Body.String())
			}
			sid := b["snapshotId"].(string)
			st, b, w = req(t, s, "GET", root+"/history/snapshots/"+sid+"/rows?metric=coverage.unknown_before&limit=100", nil, c)
			if st != 200 || b["cursor"] == "" {
				t.Fatal(st, w.Body.String())
			}
			displayed := map[string]bool{}
			for _, x := range b["rows"].([]any) {
				displayed[x.(map[string]any)["taskId"].(string)] = true
			}
			var sources []ReportSnapshotSource
			db.Where("snapshot_id=?", sid).Find(&sources)
			hidden := ""
			for _, x := range sources {
				if !displayed[x.TaskID] {
					hidden = x.TaskID
					break
				}
			}
			if hidden == "" {
				t.Fatal("no unloaded source")
			}
			st, _, w = req(t, s, "POST", root+"/exports", map[string]any{"retryKey": "stream-job", "snapshotId": sid, "csvSchemaVersion": 1}, c)
			if st != 200 {
				t.Fatal(w.Body.String())
			}
			job, token, e := s.claimReportExport(t.Context(), time.Now().UTC())
			if e != nil {
				t.Fatal(e)
			}
			if e = s.generateReportExport(t.Context(), job, token); e != nil {
				t.Fatal(e)
			}
			var artifact ReportArtifact
			db.First(&artifact, "job_id=?", job.ID)
			if e = store.Delete(t.Context(), artifact.StoreKey); e != nil {
				t.Fatal(e)
			}
			data := strings.Repeat("bounded-private-csv\n", 12000)
			if e = store.Put(t.Context(), artifact.StoreKey, strings.NewReader(data)); e != nil {
				t.Fatal(e)
			}
			db.Model(&artifact).Update("length", len(data))
			out := &reportRevokingWriter{ResponseRecorder: httptest.NewRecorder(), revoke: func() {
				var e error
				if mode == "session" {
					e = db.Where("user_id=?", owner).Delete(&SessionRecord{}).Error
				} else {
					e = db.Delete(&Task{}, "id=?", hidden).Error
				}
				if e != nil {
					t.Fatal(e)
				}
			}}
			request := httptest.NewRequest("GET", root+"/artifacts/"+artifact.ID, nil)
			request.AddCookie(c)
			s.ServeHTTP(out, request)
			if out.Code != 200 || out.chunks != 1 || out.Body.Len() != 64<<10 || out.Header().Get("Content-Length") != strconv.Itoa(len(data)) {
				t.Fatal("revoked stream continued", out.Code, out.chunks, out.Body.Len(), out.Body.String()[:min(100, out.Body.Len())])
			}
			if strings.Contains(out.Body.String(), "\"error\"") {
				t.Fatal("JSON appended after CSV")
			}
		})
	}
}

func TestReportExportConcurrentClaimsAndDelivery(t *testing.T) {
	s, db := testServer(t)
	store, e := NewFileReportArtifactStore(t.TempDir() + "/reports")
	if e != nil {
		t.Fatal(e)
	}
	s.opts.ReportArtifactStore = store
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	root := "/api/companies/" + cid + "/reports"
	b := financeOK(t, s, "POST", root+"/history/snapshots", map[string]any{"retryKey": "concurrent-snapshot", "request": historyRequest()}, c)
	for _, key := range []string{"one", "two"} {
		financeOK(t, s, "POST", root+"/exports", map[string]any{"retryKey": key, "snapshotId": b["snapshotId"], "csvSchemaVersion": 1}, c)
	}
	type claimed struct {
		job   ReportExportJob
		token string
		e     error
	}
	results := make(chan claimed, 2)
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			j, tok, e := s.claimReportExport(t.Context(), time.Now().UTC())
			results <- claimed{j, tok, e}
		}()
	}
	close(start)
	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		r := <-results
		if r.e != nil || seen[r.job.ID] || r.job.AttemptCount != 1 {
			t.Fatal("duplicate claim", r, seen)
		}
		seen[r.job.ID] = true
		if e = s.generateReportExport(t.Context(), r.job, r.token); e != nil {
			t.Fatal(e)
		}
	}
	type delivered struct {
		n int
		e error
	}
	dispatch := make(chan delivered, 2)
	for i := 0; i < 2; i++ {
		go func() { n, e := s.RunReportDelivery(t.Context(), time.Now().UTC(), 100); dispatch <- delivered{n, e} }()
	}
	total := 0
	for i := 0; i < 2; i++ {
		r := <-dispatch
		if r.e != nil {
			t.Fatal(r.e)
		}
		total += r.n
	}
	if total != 2 {
		t.Fatal("duplicate delivery", total)
	}
	var items, intents int64
	db.Model(&AttentionItem{}).Where("company_id=? AND source_kind='report_export'", cid).Count(&items)
	db.Model(&ReportDeliveryIntent{}).Where("company_id=? AND state='delivered'", cid).Count(&intents)
	if items != 2 || intents != 2 {
		t.Fatal(items, intents)
	}
}
