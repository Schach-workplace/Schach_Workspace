package platform

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type MediaStore interface {
	Put(context.Context, string, io.Reader) error
	Open(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}
type MediaScanner interface {
	Scan(context.Context, io.Reader) error
}
type FileMediaStore struct{ root string }

var mediaKeyPattern = regexp.MustCompile(`^med_[0-9a-f]{32}$`)

func NewFileMediaStore(root string) (*FileMediaStore, error) {
	abs, e := filepath.Abs(root)
	if e != nil {
		return nil, e
	}
	if e = os.MkdirAll(abs, 0700); e != nil {
		return nil, e
	}
	resolved, e := filepath.EvalSymlinks(abs)
	if e != nil {
		return nil, e
	}
	if e = os.Chmod(resolved, 0700); e != nil {
		return nil, e
	}
	return &FileMediaStore{resolved}, nil
}
func (s *FileMediaStore) path(key string) (string, error) {
	if !mediaKeyPattern.MatchString(key) {
		return "", errors.New("invalid media key")
	}
	return filepath.Join(s.root, key), nil
}
func (s *FileMediaStore) Put(ctx context.Context, key string, reader io.Reader) error {
	target, e := s.path(key)
	if e != nil {
		return e
	}
	file, e := os.CreateTemp(s.root, ".quarantine-")
	if e != nil {
		return e
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, e = io.Copy(file, reader); e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	if e = file.Sync(); e != nil {
		return e
	}
	if e = file.Close(); e != nil {
		return e
	}
	if e := os.Rename(file.Name(), target); e != nil {
		return e
	}
	directory, e := os.Open(s.root)
	if e != nil {
		return e
	}
	defer directory.Close()
	return directory.Sync()
}
func (s *FileMediaStore) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	path, e := s.path(key)
	if e != nil {
		return nil, e
	}
	info, e := os.Lstat(path)
	if e != nil {
		return nil, e
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("invalid media object")
	}
	return os.Open(path)
}
func (s *FileMediaStore) Delete(ctx context.Context, key string) error {
	path, e := s.path(key)
	if e != nil {
		return e
	}
	e = os.Remove(path)
	if errors.Is(e, os.ErrNotExist) {
		return nil
	}
	return e
}

// ClamAV INSTREAM scans bytes, so the scanner never needs filesystem privileges.
type ClamAVScanner struct{ Address string }

func (s ClamAVScanner) Scan(ctx context.Context, reader io.Reader) error {
	bounded, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	conn, e := (&net.Dialer{}).DialContext(bounded, "tcp", s.Address)
	if e != nil {
		return e
	}
	defer conn.Close()
	deadline, _ := bounded.Deadline()
	_ = conn.SetDeadline(deadline)
	if _, e = conn.Write([]byte("zINSTREAM\x00")); e != nil {
		return e
	}
	buffer := make([]byte, 64*1024)
	header := make([]byte, 4)
	for {
		n, e := reader.Read(buffer)
		if n > 0 {
			binary.BigEndian.PutUint32(header, uint32(n))
			if _, e := conn.Write(header); e != nil {
				return e
			}
			if _, e := conn.Write(buffer[:n]); e != nil {
				return e
			}
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return e
		}
	}
	binary.BigEndian.PutUint32(header, 0)
	if _, e = conn.Write(header); e != nil {
		return e
	}
	result, e := io.ReadAll(io.LimitReader(conn, 4096))
	if e != nil {
		return e
	}
	if !strings.HasSuffix(strings.TrimRight(string(result), "\x00\n"), ": OK") {
		return errors.New("media scan rejected or unavailable")
	}
	return nil
}
