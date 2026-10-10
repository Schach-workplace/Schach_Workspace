package platform

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"syscall"
	"time"
)

const reportCSVByteLimit int64 = 16 << 20

type ReportArtifactStore interface {
	Put(context.Context, string, io.Reader) error
	Open(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}
type FileReportArtifactStore struct {
	root  string
	sweep *os.File
}

var reportArtifactKey = regexp.MustCompile(`^rpt_[0-9a-f]{32}$`)

func NewFileReportArtifactStore(root string) (*FileReportArtifactStore, error) {
	absolute, e := filepath.Abs(root)
	if e != nil || root == "" {
		return nil, errors.New("private report artifact root is required")
	}
	if e := os.MkdirAll(absolute, 0700); e != nil {
		return nil, e
	}
	resolved, e := filepath.EvalSymlinks(absolute)
	if e != nil || resolved != absolute {
		return nil, errors.New("report artifact root cannot contain symlinks")
	}
	info, e := os.Lstat(absolute)
	if e != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return nil, errors.New("report artifact root must be a private 0700 directory")
	}
	return &FileReportArtifactStore{root: absolute}, nil
}
func (s *FileReportArtifactStore) path(key string) (string, error) {
	if !reportArtifactKey.MatchString(key) {
		return "", invalid("Invalid report artifact key.")
	}
	return filepath.Join(s.root, key), nil
}

type reportContextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r reportContextReader) Read(b []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.r.Read(b)
}
func (s *FileReportArtifactStore) Put(ctx context.Context, key string, reader io.Reader) error {
	path, e := s.path(key)
	if e != nil {
		return e
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	f, e := os.CreateTemp(s.root, ".report-tmp-")
	if e != nil {
		return e
	}
	temp := f.Name()
	defer os.Remove(temp)
	defer f.Close()
	written, e := io.Copy(f, io.LimitReader(reportContextReader{ctx, reader}, reportCSVByteLimit+1))
	if e != nil {
		return e
	}
	if written > reportCSVByteLimit {
		return rangeTooLarge()
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	if e := f.Sync(); e != nil {
		return e
	}
	if e := f.Close(); e != nil {
		return e
	}
	if _, e := os.Lstat(path); e == nil {
		return errors.New("report artifact key already exists")
	} else if !os.IsNotExist(e) {
		return e
	}
	if e := os.Rename(temp, path); e != nil {
		return e
	}
	return nil
}
func (s *FileReportArtifactStore) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	path, e := s.path(key)
	if e != nil {
		return nil, e
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	f, e := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if e != nil {
		return nil, e
	}
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		f.Close()
		return nil, errors.New("report artifact is not a private regular file")
	}
	return f, nil
}
func (s *FileReportArtifactStore) Delete(ctx context.Context, key string) error {
	path, e := s.path(key)
	if e != nil {
		return e
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	info, e := os.Lstat(path)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	if !info.Mode().IsRegular() {
		return errors.New("report artifact is not a regular file")
	}
	return os.Remove(path)
}

// Check immediately before each bounded network write. Locks are released first;
// bytes already written or in flight cannot be recalled after revocation.
func (s *Server) downloadReportArtifact(w http.ResponseWriter, r *http.Request) error {
	if s.opts.ReportArtifactStore == nil {
		return &apiError{Status: 503, Code: "export_unavailable", Message: "Report export storage is unavailable."}
	}
	var artifact ReportArtifact
	authorize := func() error {
		a, e := s.access(r)
		if e != nil {
			return e
		}
		return s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
			if e := tx.First(&artifact, "id=? AND company_id=? AND recipient_id=?", r.PathValue("id"), a.Company.ID, a.User.ID).Error; e != nil {
				return missing()
			}
			if artifact.State != "ready" || !time.Now().UTC().Before(artifact.ExpiresAt) {
				return missing()
			}
			job, e := authorizeReportExportJob(tx, a, artifact.JobID)
			if e != nil {
				return e
			}
			if job.State != "ready" || job.ArtifactID != artifact.ID {
				return missing()
			}
			return nil
		})
	}
	if e := authorize(); e != nil {
		return e
	}
	reader, e := s.opts.ReportArtifactStore.Open(r.Context(), artifact.StoreKey)
	if e != nil {
		return &apiError{Status: 503, Code: "artifact_unavailable", Message: "The private report file is unavailable. Generate another export."}
	}
	defer reader.Close()
	if e := authorize(); e != nil {
		return e
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Length", strconv.FormatInt(artifact.Length, 10))
	w.Header().Set("X-Report-SHA256", artifact.SHA256)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", `attachment; filename="historical-report.csv"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	buffer := make([]byte, 64<<10)
	for {
		if e := r.Context().Err(); e != nil {
			return e
		}
		n, readErr := reader.Read(buffer)
		if n > 0 {
			if e := authorize(); e != nil {
				return e
			}
			if _, e := w.Write(buffer[:n]); e != nil {
				return e
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}
