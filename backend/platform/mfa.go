package platform

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"net/url"
	"time"
)

var mfaSecretEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

type UserMFA struct {
	UserID       string `gorm:"primaryKey;size:80"`
	SecretCipher []byte
	Enabled      bool
	LastCounter  int64
	CreatedAt    string
}
type MFARecovery struct {
	UserID   string `gorm:"primaryKey;size:80"`
	CodeHash string `gorm:"primaryKey;size:64"`
	Used     bool
}

func totpCode(secret []byte, counter int64, digits int) string {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], uint64(counter))
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write(b[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 15
	n := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	mod := uint32(1)
	for range digits {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, n%mod)
}
func (s *Server) mfaCipher() (cipher.AEAD, error) {
	if len(s.opts.MFAEncryptionKey) != 32 {
		return nil, &apiError{503, "mfa_unconfigured", "Authenticator protection is not configured. Contact the workspace operator.", nil}
	}
	block, e := aes.NewCipher(s.opts.MFAEncryptionKey)
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(block)
}
func (s *Server) encryptMFA(uid string, secret []byte) ([]byte, error) {
	a, e := s.mfaCipher()
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, a.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return a.Seal(nonce, nonce, secret, []byte(uid)), nil
}
func (s *Server) decryptMFA(uid string, data []byte) ([]byte, error) {
	a, e := s.mfaCipher()
	if e != nil {
		return nil, e
	}
	if len(data) < a.NonceSize() {
		return nil, denied()
	}
	return a.Open(nil, data[:a.NonceSize()], data[a.NonceSize():], []byte(uid))
}
func (s *Server) consumeMFACode(tx *gorm.DB, mfa *UserMFA, code, recovery string) error {
	if recovery != "" {
		row := tx.Model(&MFARecovery{}).Where("user_id=? AND code_hash=? AND used=?", mfa.UserID, hashToken(recovery), false).Update("used", true)
		if row.Error != nil {
			return row.Error
		}
		if row.RowsAffected == 1 {
			return nil
		}
		return &apiError{401, "invalid_mfa", "Authenticator or recovery code is invalid or already used.", nil}
	}
	if len(code) != 6 {
		return &apiError{401, "mfa_required", "Enter an authenticator code or a single-use recovery code.", nil}
	}
	secret, e := s.decryptMFA(mfa.UserID, mfa.SecretCipher)
	if e != nil {
		return e
	}
	counter := time.Now().Unix() / 30
	for _, offset := range []int64{0, -1, 1} {
		candidate := counter + offset
		if candidate <= mfa.LastCounter {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(code), []byte(totpCode(secret, candidate, 6))) == 1 {
			return tx.Model(mfa).Update("last_counter", candidate).Error
		}
	}
	return &apiError{401, "invalid_mfa", "Authenticator or recovery code is invalid or already used.", nil}
}
func (s *Server) withMFAAccount(r *http.Request, fn func(*gorm.DB, User) error) error {
	u, hash, e := s.authenticate(r)
	if e != nil {
		return e
	}
	return s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var current User
		if e := lockCommunicationRow(tx, "UPDATE").First(&current, "id=? AND suspended=?", u.ID, false).Error; e != nil {
			return denied()
		}
		var session SessionRecord
		if e := lockCommunicationRow(tx, "SHARE").First(&session, "user_id=? AND token_hash=? AND expires_at>?", u.ID, hash, time.Now().UTC()).Error; e != nil {
			return denied()
		}
		return fn(tx, current)
	})
}
func (s *Server) mfaStatus(w http.ResponseWriter, r *http.Request) error {
	u, _, e := s.authenticate(r)
	if e != nil {
		return e
	}
	var m UserMFA
	e = s.db.First(&m, "user_id=?", u.ID).Error
	if e != nil && e != gorm.ErrRecordNotFound {
		return e
	}
	return respond(w, 200, map[string]any{"enabled": m.Enabled, "configured": len(s.opts.MFAEncryptionKey) == 32})
}
func (s *Server) mfaSetup(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Password string `json:"password"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	secret := make([]byte, 20)
	if _, e := rand.Read(secret); e != nil {
		return e
	}
	label := ""
	e := s.withMFAAccount(r, func(tx *gorm.DB, u User) error {
		if !passwordMatches(u.PasswordHash, input.Password) {
			return denied()
		}
		var old UserMFA
		e := tx.First(&old, "user_id=?", u.ID).Error
		if e == nil && old.Enabled {
			return conflict()
		}
		if e != nil && e != gorm.ErrRecordNotFound {
			return e
		}
		encrypted, e := s.encryptMFA(u.ID, secret)
		if e != nil {
			return e
		}
		label = u.Email
		return tx.Save(&UserMFA{UserID: u.ID, SecretCipher: encrypted, LastCounter: -1, CreatedAt: nowString()}).Error
	})
	if e != nil {
		return e
	}
	encoded := mfaSecretEncoding.EncodeToString(secret)
	values := url.Values{"secret": {encoded}, "issuer": {"Schach Workspace"}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}
	uri := "otpauth://totp/" + url.PathEscape("Schach Workspace:"+label) + "?" + values.Encode()
	return respond(w, 200, map[string]any{"secret": encoded, "uri": uri})
}
func (s *Server) mfaConfirm(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Code string `json:"code"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	codes := []string{}
	e := s.withMFAAccount(r, func(tx *gorm.DB, u User) error {
		var m UserMFA
		if e := tx.First(&m, "user_id=? AND enabled=?", u.ID, false).Error; e != nil {
			return missing()
		}
		if e := s.consumeMFACode(tx, &m, input.Code, ""); e != nil {
			return e
		}
		if e := tx.Model(&m).Update("enabled", true).Error; e != nil {
			return e
		}
		if e := tx.Where("user_id=?", u.ID).Delete(&MFARecovery{}).Error; e != nil {
			return e
		}
		for range 10 {
			b := make([]byte, 16)
			if _, e := rand.Read(b); e != nil {
				return e
			}
			code := hex.EncodeToString(b)
			codes = append(codes, code)
			if e := tx.Create(&MFARecovery{UserID: u.ID, CodeHash: hashToken(code)}).Error; e != nil {
				return e
			}
		}
		raw, e := sessionToken(r)
		if e != nil {
			return e
		}
		if e := tx.Model(&CommunicationDevice{}).Where("user_id=? AND session_hash<>?", u.ID, hashToken(raw)).Update("active", false).Error; e != nil {
			return e
		}
		return tx.Where("user_id=? AND token_hash<>?", u.ID, hashToken(raw)).Delete(&SessionRecord{}).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"recoveryCodes": codes, "notice": "Store these codes privately. Each can be used once. Other sessions have been revoked."})
}
func (s *Server) mfaDisable(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Password     string `json:"password"`
		Code         string `json:"code"`
		RecoveryCode string `json:"recoveryCode"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	e := s.withMFAAccount(r, func(tx *gorm.DB, u User) error {
		if !passwordMatches(u.PasswordHash, input.Password) {
			return denied()
		}
		var m UserMFA
		if e := tx.First(&m, "user_id=? AND enabled=?", u.ID, true).Error; e != nil {
			return missing()
		}
		if e := s.consumeMFACode(tx, &m, input.Code, input.RecoveryCode); e != nil {
			return e
		}
		if e := tx.Where("user_id=?", u.ID).Delete(&MFARecovery{}).Error; e != nil {
			return e
		}
		return tx.Where("user_id=?", u.ID).Delete(&UserMFA{}).Error
	})
	if e != nil {
		return e
	}
	return ok(w, "")
}
func (s *Server) mfaRoutes() {
	s.route("GET /api/auth/mfa", s.mfaStatus)
	s.route("POST /api/auth/mfa/setup", s.mfaSetup)
	s.route("POST /api/auth/mfa/confirm", s.mfaConfirm)
	s.route("POST /api/auth/mfa/disable", s.mfaDisable)
}
