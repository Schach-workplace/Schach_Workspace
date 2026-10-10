package platform

import (
	"crypto/sha256"
	"encoding/hex"
	"gorm.io/gorm"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

const maxCommunicationMedia = 25 << 20
const communicationUserQuota = 500 << 20

type CommunicationMedia struct {
	ClientUploadID  string `json:"-"`
	RequestHash     string `json:"-"`
	ID              string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID       string `json:"-" gorm:"index"`
	ConversationID  string `json:"conversationId" gorm:"index"`
	UserID          string `json:"userId"`
	MessageID       string `json:"messageId"`
	HistorySequence int64  `json:"-"`
	FileName        string `json:"fileName"`
	Size            int64  `json:"size"`
	SHA256          string `json:"sha256"`
	MimeType        string `json:"mimeType"`
	State           string `json:"state"`
	CreatedAt       string `json:"createdAt"`
	ExpiresAt       string `json:"expiresAt"`
}

func mediaType(name string, bytes []byte) (string, error) {
	if kind, e := uploadType(name, bytes); e == nil {
		return kind, nil
	}
	ext := strings.ToLower(filepath.Ext(name))
	kind := http.DetectContentType(bytes)
	if (ext == ".webm" && kind == "video/webm") || ((ext == ".mp4" || ext == ".m4a") && kind == "video/mp4") || (ext == ".wav" && kind == "audio/wave") || (ext == ".ogg" && kind == "application/ogg") || (ext == ".mp3" && (kind == "audio/mpeg" || kind == "audio/mp3")) {
		return kind, nil
	}
	return "", invalid("Media type must match a supported image, document, WebM/MP4 video or WAV/OGG/MP3 recording.")
}
func (s *Server) media(tx *gorm.DB, a *conversationScope, id string) (CommunicationMedia, error) {
	return eligibleCommunicationMedia(tx, a, id)
}

func eligibleCommunicationMedia(tx *gorm.DB, a *conversationScope, id string) (CommunicationMedia, error) {
	var m CommunicationMedia
	e := tx.First(&m, "company_id=? AND conversation_id=? AND id=?", a.CompanyID, a.Conversation.ID, id).Error
	if e == gorm.ErrRecordNotFound {
		return m, missing()
	}
	if e != nil {
		return m, e
	}
	expiry, e := time.Parse(time.RFC3339Nano, m.ExpiresAt)
	if e != nil || !time.Now().Before(expiry) {
		return m, missing()
	}
	if m.MessageID != "" {
		parent, e := scopedMessage(tx, a, m.MessageID)
		if e != nil || parent.Removed {
			return m, missing()
		}
	} else if m.UserID != a.UserID {
		return m, missing()
	}
	return m, nil
}
func (s *Server) reserveMedia(w http.ResponseWriter, r *http.Request) error {
	if s.opts.MediaStore == nil {
		return &apiError{503, "media_unconfigured", "Media storage is not configured.", nil}
	}
	var input struct {
		ClientUploadID string `json:"clientUploadId"`
		FileName       string `json:"fileName"`
		Size           int64  `json:"size"`
		SHA256         string `json:"sha256"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	hash, e := hex.DecodeString(input.SHA256)
	if e != nil || len(hash) != 32 || input.Size < 1 || input.Size > s.opts.MediaLimitBytes || safeFileName(input.FileName) == "" {
		return invalid("Choose a safe filename, SHA-256 hash and 1-byte to 25-MiB file.")
	}
	id := newID("med")
	e = s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		if len(input.ClientUploadID) > 100 {
			return invalid("Upload retry key allows up to 100 characters.")
		}
		if input.ClientUploadID != "" {
			var old CommunicationMedia
			e := tx.First(&old, "company_id=? AND user_id=? AND client_upload_id=?", a.CompanyID, a.UserID, input.ClientUploadID).Error
			if e == nil {
				if old.RequestHash != payloadHash(input) || old.ConversationID != a.Conversation.ID {
					return conflict()
				}
				if old.State == "purged" {
					return missing()
				}
				id = old.ID
				return nil
			}
			if e != gorm.ErrRecordNotFound {
				return e
			}
		}
		if tx.Dialector.Name() == "postgres" {
			if e := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", a.CompanyID+":media-quota").Error; e != nil {
				return e
			}
		}
		var used int64
		if e := tx.Model(&CommunicationMedia{}).Where("company_id=? AND user_id=? AND state<>?", a.CompanyID, a.UserID, "purged").Select("COALESCE(sum(size),0)").Scan(&used).Error; e != nil {
			return e
		}
		if used+input.Size > s.opts.MediaUserQuotaBytes {
			return invalid("Your media quota is full.")
		}
		var companyUsed int64
		if e := tx.Model(&CommunicationMedia{}).Where("company_id=? AND state<>?", a.CompanyID, "purged").Select("COALESCE(sum(size),0)").Scan(&companyUsed).Error; e != nil {
			return e
		}
		if companyUsed+input.Size > s.opts.MediaCompanyQuotaBytes {
			return invalid("Company media quota is full.")
		}
		return tx.Create(&CommunicationMedia{ID: id, ClientUploadID: input.ClientUploadID, RequestHash: payloadHash(input), CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, UserID: a.UserID, HistorySequence: a.Conversation.NextSequence + 1, FileName: safeFileName(input.FileName), Size: input.Size, SHA256: strings.ToLower(input.SHA256), State: "reserved", CreatedAt: nowString(), ExpiresAt: time.Now().UTC().Add(time.Duration(s.opts.UnusedUploadHours) * time.Hour).Format(time.RFC3339Nano)}).Error
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) uploadMedia(w http.ResponseWriter, r *http.Request) error {
	if s.opts.MediaStore == nil {
		return &apiError{503, "media_unconfigured", "Media storage is not configured.", nil}
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.opts.MediaLimitBytes)
	bytes, e := io.ReadAll(r.Body)
	if e != nil {
		return &apiError{413, "media_size", "Media exceeds the upload limit.", nil}
	}
	e = s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		m, e := s.media(tx, a, r.PathValue("mid"))
		if e != nil {
			return e
		}
		if m.UserID != a.UserID {
			return denied()
		}
		if m.State != "reserved" && m.State != "uploaded" {
			return conflict()
		}
		if m.ExpiresAt < nowString() {
			return missing()
		}
		hash := sha256.Sum256(bytes)
		if int64(len(bytes)) != m.Size || hex.EncodeToString(hash[:]) != m.SHA256 {
			return invalid("File size/hash differs from its reservation.")
		}
		kind, e := mediaType(m.FileName, bytes)
		if e != nil {
			return e
		}
		if e = s.opts.MediaStore.Put(r.Context(), m.ID, strings.NewReader(string(bytes))); e != nil {
			return e
		}
		m.State = "uploaded"
		m.MimeType = kind
		return tx.Save(&m).Error
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("mid"))
}
func (s *Server) finalizeMedia(w http.ResponseWriter, r *http.Request) error {
	if s.opts.MediaStore == nil || s.opts.MediaScanner == nil {
		return &apiError{503, "scanner_unconfigured", "Media remains quarantined until scanning is configured.", nil}
	}
	// Scanning occurs without holding authorization locks. Its result is committed
	// only after session, company and conversation access are checked again.
	var candidate CommunicationMedia
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		m, e := s.media(tx, a, r.PathValue("mid"))
		if e != nil {
			return e
		}
		if m.UserID != a.UserID || !a.canPost() {
			return denied()
		}
		if m.State == "clean" {
			candidate = m
			return nil
		}
		if m.State != "uploaded" {
			return conflict()
		}
		candidate = m
		return nil
	})
	if e != nil {
		return e
	}
	if candidate.State == "clean" {
		return ok(w, candidate.ID)
	}
	reader, e := s.opts.MediaStore.Open(r.Context(), candidate.ID)
	if e != nil {
		return e
	}
	scanErr := s.opts.MediaScanner.Scan(r.Context(), reader)
	_ = reader.Close()
	e = s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		m, e := s.media(tx, a, candidate.ID)
		if e != nil {
			return e
		}
		if m.UserID != a.UserID {
			return denied()
		}
		if m.State == "clean" {
			return nil
		}
		if m.State != "uploaded" || m.SHA256 != candidate.SHA256 {
			return conflict()
		}
		if scanErr != nil {
			m.State = "rejected"
		} else {
			m.State = "clean"
		}
		return tx.Save(&m).Error
	})
	if e != nil {
		return e
	}
	if scanErr != nil {
		return invalid("Media scanning rejected the file or was unavailable. The file remains inaccessible.")
	}
	return ok(w, candidate.ID)
}
func (s *Server) downloadMedia(w http.ResponseWriter, r *http.Request) error {
	if s.opts.MediaStore == nil {
		return missing()
	}
	return s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		m, e := s.media(tx, a, r.PathValue("mid"))
		if e != nil {
			return e
		}
		if m.State != "clean" {
			return missing()
		}
		reader, e := s.opts.MediaStore.Open(r.Context(), m.ID)
		if e != nil {
			return missing()
		}
		defer reader.Close()
		w.Header().Set("Content-Type", m.MimeType)
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": m.FileName}))
		w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		_, e = io.Copy(w, io.LimitReader(reader, m.Size))
		return e
	})
}
func (s *Server) mediaRoutes() {
	s.route("POST /api/companies/{cid}/conversations/{id}/media", s.reserveMedia)
	s.route("POST /api/companies/{cid}/conversations/{id}/media/{mid}/upload", s.uploadMedia)
	s.route("POST /api/companies/{cid}/conversations/{id}/media/{mid}/finalize", s.finalizeMedia)
	s.route("GET /api/companies/{cid}/conversations/{id}/media/{mid}/download", s.downloadMedia)
}
