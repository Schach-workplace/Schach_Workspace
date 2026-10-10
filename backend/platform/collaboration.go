package platform

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"gorm.io/gorm"
)

func (s *Server) addComment(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	if a.Member.Role == "viewer" {
		return denied()
	}
	var v struct {
		Body string `json:"body"`
	}
	if e = decode(w, r, &v); e != nil {
		return e
	}
	v.Body = strings.TrimSpace(v.Body)
	if !clean(v.Body, 10000) {
		return invalid("Comment must contain 1–10,000 characters.")
	}
	id := newID("cmt")
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if a.Member.Role == "viewer" {
			return denied()
		}
		t, e := scopedTask(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		c := Comment{ID: id, TaskID: t.ID, CompanyID: t.CompanyID, UserID: a.User.ID, Body: v.Body, CreatedAt: nowString()}
		if e = tx.Create(&c).Error; e != nil {
			return e
		}
		if e = audit(tx, t.CompanyID, t.ID, a.User.ID, "comment_added", "Added a comment."); e != nil {
			return e
		}
		targets := map[string]bool{t.OwnerID: true, t.ReviewerID: true, t.CreatedBy: true}
		for _, uid := range t.Collaborators {
			targets[uid] = true
		}
		for uid := range targets {
			if uid != "" && uid != a.User.ID {
				if e = notification(tx, t.CompanyID, t.ID, uid, "New comment", a.User.Name+" commented on "+t.Code, "comment"); e != nil {
					return e
				}
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) addTime(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	if a.Member.Role == "viewer" {
		return denied()
	}
	var v struct {
		Hours float64 `json:"hours"`
		Date  string  `json:"date"`
		Note  string  `json:"note"`
	}
	if e = decode(w, r, &v); e != nil {
		return e
	}
	if !finite(v.Hours) || v.Hours <= 0 || v.Hours > 24 || !validDate(v.Date) || v.Date == "" || len(v.Note) > 4000 {
		return invalid("Time entries need more than 0 and at most 24 hours, a YYYY-MM-DD date, and a note up to 4,000 characters.")
	}
	id := newID("tim")
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if a.Member.Role == "viewer" {
			return denied()
		}
		t, e := scopedTask(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if !a.canWrite(t) && !in(a.User.ID, t.Collaborators...) && t.ReviewerID != a.User.ID {
			return denied()
		}
		entry := TimeEntry{ID: id, CompanyID: t.CompanyID, TaskID: t.ID, UserID: a.User.ID, Hours: v.Hours, Date: v.Date, Note: strings.TrimSpace(v.Note), CreatedAt: nowString()}
		if e = tx.Create(&entry).Error; e != nil {
			return e
		}
		if e = tx.Model(&Task{}).Where("id = ? AND company_id = ?", t.ID, t.CompanyID).Updates(map[string]any{"actual_hours": gorm.Expr("actual_hours + ?", v.Hours), "version": gorm.Expr("version + 1"), "updated_at": nowString()}).Error; e != nil {
			return e
		}
		return audit(tx, t.CompanyID, t.ID, a.User.ID, "time_logged", fmt.Sprintf("Logged %.2f hours on %s. %s", v.Hours, v.Date, entry.Note))
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) nudge(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	if a.Member.Role == "viewer" {
		return denied()
	}
	var v struct {
		Message string `json:"message"`
	}
	if e = decode(w, r, &v); e != nil {
		return e
	}
	if !clean(v.Message, 2000) {
		return invalid("Write a nudge of 1–2,000 characters.")
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if a.Member.Role == "viewer" {
			return denied()
		}
		t, e := scopedTask(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if e = notification(tx, t.CompanyID, t.ID, t.OwnerID, "Update requested", a.User.Name+": "+strings.TrimSpace(v.Message), "nudge"); e != nil {
			return e
		}
		return audit(tx, t.CompanyID, t.ID, a.User.ID, "owner_nudged", strings.TrimSpace(v.Message))
	})
	if e != nil {
		return e
	}
	return ok(w, "")
}

const maxUpload = 10 << 20

func safeFileName(v string) string {
	v = filepath.Base(strings.ReplaceAll(v, "\\", "/"))
	v = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '/' || r == '\\' {
			return -1
		}
		return r
	}, v)
	v = strings.TrimSpace(v)
	if len(v) > 180 {
		ext := filepath.Ext(v)
		v = v[:160] + ext
	}
	return v
}
func uploadType(name string, b []byte) (string, error) {
	ext := strings.ToLower(filepath.Ext(name))
	sniff := http.DetectContentType(b)
	switch ext {
	case ".pdf":
		if strings.HasPrefix(string(b), "%PDF-") {
			return "application/pdf", nil
		}
	case ".png":
		if sniff == "image/png" {
			return sniff, nil
		}
	case ".jpg", ".jpeg":
		if sniff == "image/jpeg" {
			return sniff, nil
		}
	case ".webp":
		if sniff == "image/webp" {
			return sniff, nil
		}
	case ".txt", ".csv":
		if strings.HasPrefix(sniff, "text/plain") {
			if ext == ".csv" {
				return "text/csv; charset=utf-8", nil
			}
			return "text/plain; charset=utf-8", nil
		}
	}
	return "", invalid("Upload a valid PDF, PNG, JPEG, WebP, plain-text or CSV file (maximum 10 MiB). File content must match its extension.")
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	if a.Member.Role == "viewer" {
		return denied()
	}
	t, e := scopedTask(s.db, a, r.PathValue("id"))
	if e != nil {
		return e
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+(1<<20))
	if e = r.ParseMultipartForm(1 << 20); e != nil {
		return &apiError{413, "invalid_upload", "Upload a multipart file no larger than 10 MiB.", nil}
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	f, h, e := r.FormFile("file")
	if e != nil {
		return invalid("Choose a file in the multipart field named file.")
	}
	defer f.Close()
	if h.Size > maxUpload {
		return &apiError{413, "file_too_large", "Attachment exceeds the 10 MiB limit.", nil}
	}
	b, e := io.ReadAll(io.LimitReader(f, maxUpload+1))
	if e != nil {
		return e
	}
	if len(b) > maxUpload {
		return &apiError{413, "file_too_large", "Attachment exceeds the 10 MiB limit.", nil}
	}
	if len(b) == 0 {
		return invalid("The attachment is empty.")
	}
	name := safeFileName(h.Filename)
	if name == "" || name == "." {
		return invalid("Choose a valid file name.")
	}
	mimeType, e := uploadType(name, b)
	if e != nil {
		return e
	}
	file := Attachment{ID: newID("att"), CompanyID: t.CompanyID, TaskID: t.ID, FileName: name, MimeType: mimeType, Size: int64(len(b)), UploadedBy: a.User.ID, CreatedAt: nowString(), Data: b}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if a.Member.Role == "viewer" {
			return denied()
		}
		if _, e := scopedTask(tx, a, t.ID); e != nil {
			return e
		}
		return appendTaskEvidence(tx, a, t.ID, file)
	})
	if e != nil {
		return e
	}
	return ok(w, file.ID)
}
func (s *Server) download(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var f Attachment
	if e = s.db.Omit("Data").Where("id = ? AND company_id = ?", r.PathValue("id"), a.Company.ID).First(&f).Error; e != nil {
		return missing()
	}
	if _, e = scopedTask(s.db, a, f.TaskID); e != nil {
		return e
	}
	if e = s.db.Select("data").First(&f, "id = ? AND company_id = ?", f.ID, a.Company.ID).Error; e != nil {
		return e
	}
	w.Header().Set("Content-Type", f.MimeType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": f.FileName}))
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Content-Length", strconv.Itoa(len(f.Data)))
	w.WriteHeader(200)
	_, e = w.Write(f.Data)
	return e
}
func (s *Server) readNotifications(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var v struct {
		IDs []string `json:"ids"`
	}
	if e = decode(w, r, &v); e != nil {
		return e
	}
	if len(v.IDs) > 1000 {
		return invalid("Mark at most 1,000 notifications at a time.")
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		q := tx.Model(&Notification{}).Where("company_id = ? AND user_id = ?", a.Company.ID, a.User.ID)
		if len(v.IDs) > 0 {
			q = q.Where("id IN ?", v.IDs)
		}
		result := q.Where("read = ?", false).Update("read", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		return audit(tx, a.Company.ID, "", a.User.ID, "notifications_read", fmt.Sprintf("Marked %d notifications as read.", result.RowsAffected))
	})
	if e != nil {
		return e
	}
	return ok(w, "")
}
