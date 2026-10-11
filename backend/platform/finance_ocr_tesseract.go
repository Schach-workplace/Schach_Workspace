package platform

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

type ReceiptOCRInput struct {
	Reader                            io.Reader
	Size                              int64
	MIME, Language, ConfigFingerprint string
}
type ReceiptOCRText struct{ Text, Engine, Version, Language string }
type ReceiptOCRProvider interface {
	Extract(context.Context, ReceiptOCRInput) (ReceiptOCRText, error)
}
type TesseractReceiptOCR struct{ Executable, Language, Version, Fingerprint, ScratchRoot string }
type financeBoundedOutput struct {
	bytes.Buffer
	Limit int
}

func (b *financeBoundedOutput) Write(p []byte) (int, error) {
	if len(p) > b.Limit-b.Len() {
		return 0, errors.New("output_limit")
	}
	return b.Buffer.Write(p)
}
func (p *TesseractReceiptOCR) Extract(ctx context.Context, in ReceiptOCRInput) (ReceiptOCRText, error) {
	var out ReceiptOCRText
	if p.Language != "eng" || in.Language != "eng" || in.ConfigFingerprint != p.Fingerprint || !inMIME(in.MIME) || in.Size < 1 || in.Size > 10<<20 {
		return out, invalid("This receipt requires manual entry.")
	}
	data, e := io.ReadAll(io.LimitReader(in.Reader, in.Size+1))
	if e != nil || int64(len(data)) != in.Size {
		return out, invalid("Invalid receipt input.")
	}
	config, format, e := image.DecodeConfig(bytes.NewReader(data))
	if e != nil || config.Width < 1 || config.Height < 1 || config.Width > 12000 || config.Height > 12000 || int64(config.Width)*int64(config.Height) > 20000000 || in.MIME == "image/png" && format != "png" || in.MIME == "image/jpeg" && format != "jpeg" {
		return out, invalid("Unsupported receipt image dimensions or encoding.")
	}
	dir, e := os.MkdirTemp(p.ScratchRoot, "finance-ocr-")
	if e != nil {
		return out, e
	}
	defer os.RemoveAll(dir)
	if e = os.Chmod(dir, 0700); e != nil {
		return out, e
	}
	path := filepath.Join(dir, "receipt")
	if e = os.WriteFile(path, data, 0600); e != nil {
		return out, e
	}
	bounded, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, "/usr/bin/prlimit", "--as=536870912", "--cpu=45", "--fsize=67108864", "--", p.Executable, path, "stdout", "--tessdata-dir", "/usr/share/tessdata", "-l", "eng", "--psm", "6")
	cmd.Env = append(os.Environ(), "OMP_THREAD_LIMIT=1")
	stdout := &financeBoundedOutput{Limit: 64 << 10}
	stderr := &financeBoundedOutput{Limit: 8 << 10}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if e = cmd.Run(); e != nil {
		return out, errors.New("ocr_failed")
	}
	if !utf8.Valid(stdout.Bytes()) || strings.IndexByte(stdout.String(), 0) >= 0 {
		return out, errors.New("ocr_output_invalid")
	}
	return ReceiptOCRText{stdout.String(), "tesseract", p.Version, "eng"}, nil
}
func inMIME(mime string) bool { return mime == "image/png" || mime == "image/jpeg" }
