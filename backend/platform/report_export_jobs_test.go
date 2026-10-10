package platform

import (
	"context"
	"gorm.io/gorm"
	"io"
	"os"
	"path/filepath"
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
