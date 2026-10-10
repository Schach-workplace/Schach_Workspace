package platform

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

const cookieName = "schach_session"
const passwordIterations = 600000

func passwordHash(password string) (string, error) {
	salt := make([]byte, 24)
	if _, e := rand.Read(salt); e != nil {
		return "", e
	}
	key, e := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
	if e != nil {
		return "", e
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", passwordIterations, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}
func passwordMatches(hash, password string) bool {
	p := strings.Split(hash, "$")
	if len(p) != 4 || p[0] != "pbkdf2-sha256" {
		return false
	}
	n, e := strconv.Atoi(p[1])
	if e != nil || n < 100000 || n > 2000000 {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(p[2])
	if e != nil {
		return false
	}
	want, e := base64.RawStdEncoding.DecodeString(p[3])
	if e != nil || len(want) != 32 {
		return false
	}
	key, e := pbkdf2.Key(sha256.New, password, salt, n, 32)
	return e == nil && subtle.ConstantTimeCompare(key, want) == 1
}
func validatePassword(s string) error {
	if utf8.RuneCountInString(s) < 12 || len(s) > 256 {
		return invalid("Password must contain at least 12 characters and at most 256 UTF-8 bytes.")
	}
	return nil
}
func validEmail(s string) bool {
	a, e := mail.ParseAddress(s)
	return e == nil && a.Address == s && len(s) <= 254
}
func hashToken(t string) string { v := sha256.Sum256([]byte(t)); return hex.EncodeToString(v[:]) }
func (s *Server) authenticate(r *http.Request) (User, string, error) {
	var u User
	token, e := sessionToken(r)
	if e != nil {
		return u, "", &apiError{401, "unauthenticated", "Please sign in to continue.", nil}
	}
	hash := hashToken(token)
	var sr SessionRecord
	if e = s.db.WithContext(r.Context()).Where("token_hash = ? AND expires_at > ?", hash, time.Now().UTC()).First(&sr).Error; e != nil {
		return u, "", &apiError{401, "unauthenticated", "Your session has expired. Please sign in again.", nil}
	}
	if e = s.db.WithContext(r.Context()).First(&u, "id = ?", sr.UserID).Error; e != nil {
		return u, "", e
	}
	if u.Suspended {
		return u, "", &apiError{401, "unauthenticated", "Please sign in again.", nil}
	}
	return u, hash, nil
}
func (s *Server) sessionFor(db *gorm.DB, u User) (Session, error) {
	companies := []Company{}
	err := db.Joins("JOIN memberships ON memberships.company_id = companies.id").Where("memberships.user_id = ? AND memberships.active = ?", u.ID, true).Order("companies.created_at ASC, companies.name ASC").Find(&companies).Error
	return Session{User: u, Companies: companies}, err
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Email        string `json:"email"`
		Password     string `json:"password"`
		Code         string `json:"code"`
		RecoveryCode string `json:"recoveryCode"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	key := ip + ":" + input.Email
	if len(input.Email) > 254 || len(input.Password) > 256 {
		return &apiError{401, "invalid_credentials", "Email or password is incorrect.", nil}
	}
	s.throttleMu.Lock()
	a := s.throttles[key]
	now := time.Now()
	if a.Until.Before(now) {
		a = loginAttempt{Until: now.Add(15 * time.Minute)}
	}
	if a.Count >= 6 {
		s.throttleMu.Unlock()
		return &apiError{429, "too_many_attempts", "Too many sign-in attempts. Try again in 15 minutes.", nil}
	}
	a.Count++
	s.throttles[key] = a
	if len(s.throttles) > 10000 {
		for k, v := range s.throttles {
			if v.Until.Before(now) {
				delete(s.throttles, k)
			}
		}
	}
	s.throttleMu.Unlock()
	var u User
	err := s.db.WithContext(r.Context()).Where("email = ?", input.Email).First(&u).Error
	if err != nil {
		_, _ = pbkdf2.Key(sha256.New, input.Password, []byte("unregistered-account-timing-salt"), passwordIterations, 32)
		return &apiError{401, "invalid_credentials", "Email or password is incorrect.", nil}
	}
	if u.Suspended || !passwordMatches(u.PasswordHash, input.Password) {
		return &apiError{401, "invalid_credentials", "Email or password is incorrect.", nil}
	}
	var membershipCount int64
	if err = s.db.Model(&Membership{}).Where("user_id = ? AND active = ?", u.ID, true).Count(&membershipCount).Error; err != nil {
		return err
	}
	if membershipCount == 0 && !u.IsPlatformAdmin {
		return &apiError{403, "inactive_account", "This account has no active company membership.", nil}
	}
	var random [32]byte
	if _, err = rand.Read(random[:]); err != nil {
		return err
	}
	token := hex.EncodeToString(random[:])
	expires := now.Add(time.Duration(s.opts.SessionHours) * time.Hour)
	sr := SessionRecord{TokenHash: hashToken(token), UserID: u.ID, CreatedAt: now.UTC(), ExpiresAt: expires.UTC()}
	if err = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var current User
		if e := lockCommunicationRow(tx, "UPDATE").First(&current, "id=?", u.ID).Error; e != nil {
			return e
		}
		if current.Suspended || current.PasswordHash != u.PasswordHash {
			return &apiError{401, "invalid_credentials", "Email or password is incorrect.", nil}
		}
		var count int64
		if e := tx.Model(&Membership{}).Where("user_id=? AND active=?", u.ID, true).Count(&count).Error; e != nil {
			return e
		}
		if count == 0 && !current.IsPlatformAdmin {
			return &apiError{403, "inactive_account", "This account has no active company membership.", nil}
		}
		var mfa UserMFA
		e := tx.First(&mfa, "user_id=? AND enabled=?", u.ID, true).Error
		if e == nil {
			if e := s.consumeMFACode(tx, &mfa, input.Code, input.RecoveryCode); e != nil {
				return e
			}
		} else if e != gorm.ErrRecordNotFound {
			return e
		}
		return tx.Create(&sr).Error
	}); err != nil {
		return err
	}
	s.throttleMu.Lock()
	delete(s.throttles, key)
	s.throttleMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/api", HttpOnly: true, Secure: s.opts.SecureCookies, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: s.opts.SessionHours * 3600})
	session, err := s.sessionFor(s.db, u)
	if err != nil {
		return err
	}
	return respond(w, 200, session)
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) error {
	u, _, e := s.authenticate(r)
	if e != nil {
		return e
	}
	v, e := s.sessionFor(s.db, u)
	if e != nil {
		return e
	}
	return respond(w, 200, v)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	if token, e := sessionToken(r); e == nil {
		hash := hashToken(token)
		if e := s.db.Transaction(func(tx *gorm.DB) error {
			var session SessionRecord
			e := lockCommunicationRow(tx, "UPDATE").First(&session, "token_hash=?", hash).Error
			if e == gorm.ErrRecordNotFound {
				return nil
			}
			if e != nil {
				return e
			}
			if e := tx.Model(&CommunicationDevice{}).Where("session_hash=?", hash).Update("active", false).Error; e != nil {
				return e
			}
			return tx.Where("token_hash=?", hash).Delete(&SessionRecord{}).Error
		}); e != nil {
			return e
		}
	}

	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/api", HttpOnly: true, Secure: s.opts.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
	return ok(w, "")
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) error {
	u, token, e := s.authenticate(r)
	if e != nil {
		return e
	}
	var v struct {
		Current string `json:"currentPassword"`
		New     string `json:"newPassword"`
	}
	if e = decode(w, r, &v); e != nil {
		return e
	}
	if !passwordMatches(u.PasswordHash, v.Current) {
		return &apiError{403, "invalid_password", "Current password is incorrect.", nil}
	}
	if e = validatePassword(v.New); e != nil {
		return e
	}
	hash, e := passwordHash(v.New)
	if e != nil {
		return e
	}
	e = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&User{}).Where("id = ? AND password_hash = ?", u.ID, u.PasswordHash).Update("password_hash", hash)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return &apiError{409, "account_changed", "Account credentials changed during this request. Sign in again before retrying.", nil}
		}
		if e := tx.Where("user_id = ? AND token_hash <> ?", u.ID, token).Delete(&SessionRecord{}).Error; e != nil {
			return e
		}
		var ms []Membership
		if e := tx.Where("user_id = ? AND active = ?", u.ID, true).Find(&ms).Error; e != nil {
			return e
		}
		for _, m := range ms {
			if e := audit(tx, m.CompanyID, "", u.ID, "password_changed", "Account password changed; other sessions revoked."); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return ok(w, "")
}
func Bootstrap(db *gorm.DB, email, password, name string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) {
		return invalid("Bootstrap requires a valid email address.")
	}
	if e := validatePassword(password); e != nil {
		return e
	}
	if !clean(name, 120) {
		return invalid("Bootstrap requires a display name.")
	}
	hash, e := passwordHash(password)
	if e != nil {
		return e
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var n int64
		if e := tx.Model(&User{}).Count(&n).Error; e != nil {
			return e
		}
		if n > 0 {
			return fmt.Errorf("bootstrap refused: users already exist")
		}
		u := User{ID: newID("usr"), Name: name, Email: email, PasswordHash: hash, IsPlatformAdmin: true}
		if e := tx.Create(&u).Error; e != nil {
			return e
		}
		c := Company{ID: newID("cmp"), Name: "My company", Slug: "workspace", Timezone: "UTC", Color: "#F97316", Currency: "INR", FiscalYearStartMonth: 4, CreatedAt: nowString()}
		if e := tx.Create(&c).Error; e != nil {
			return e
		}
		if e := tx.Create(&Membership{ID: newID("mem"), CompanyID: c.ID, UserID: u.ID, Role: "founder", CapacityHours: 40, Active: true}).Error; e != nil {
			return e
		}
		if e := defaultExpenseCategories(tx, c.ID); e != nil {
			return e
		}
		return audit(tx, c.ID, "", u.ID, "company_created", "Initial company and founder account created.")
	})
}

// ResetPassword is an operator recovery action, not an HTTP endpoint. The caller
// must already hold direct database access. It never creates an account and
// revokes every session after resetting the password.
func ResetPassword(db *gorm.DB, email, newPassword string) error {
	return RecoverAccount(db, email, newPassword, false, "")
}

// RecoverAccount requires direct operator database access and verified identity.
// Password-only recovery preserves MFA. MFA recovery requires an explicit reason.
func RecoverAccount(db *gorm.DB, email, newPassword string, resetMFA bool, reason string) error {
	if resetMFA && !clean(reason, 1000) {
		return invalid("A verified recovery reason is required for resetting MFA.")
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) {
		return invalid("A valid existing account email is required.")
	}
	if e := validatePassword(newPassword); e != nil {
		return e
	}
	hash, e := passwordHash(newPassword)
	if e != nil {
		return e
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var u User
		if e := lockCommunicationRow(tx, "UPDATE").Where("email = ?", email).First(&u).Error; e != nil {
			if e == gorm.ErrRecordNotFound {
				return invalid("No account exists with this email. No account was created.")
			}
			return e
		}
		if e := tx.Model(&User{}).Where("id = ?", u.ID).Update("password_hash", hash).Error; e != nil {
			return e
		}
		var sessions []SessionRecord
		if e := lockCommunicationRow(tx, "UPDATE").Where("user_id=?", u.ID).Order("token_hash").Find(&sessions).Error; e != nil {
			return e
		}
		if e := tx.Model(&CommunicationDevice{}).Where("user_id=?", u.ID).Update("active", false).Error; e != nil {
			return e
		}
		if e := tx.Where("user_id = ?", u.ID).Delete(&SessionRecord{}).Error; e != nil {
			return e
		}
		if resetMFA {
			if e := tx.Where("user_id=?", u.ID).Delete(&MFARecovery{}).Error; e != nil {
				return e
			}
			if e := tx.Where("user_id=?", u.ID).Delete(&UserMFA{}).Error; e != nil {
				return e
			}
		}
		var memberships []Membership
		if e := tx.Where("user_id = ?", u.ID).Find(&memberships).Error; e != nil {
			return e
		}
		for _, m := range memberships {
			if resetMFA {
				if e := audit(tx, m.CompanyID, "", "", "operator_mfa_recovery", "Operator recovered MFA for "+u.ID+"; verified reason: "+reason); e != nil {
					return e
				}
			}
			if e := audit(tx, m.CompanyID, "", "", "operator_password_reset", "Operator reset password for "+u.ID+" and revoked all account sessions."); e != nil {
				return e
			}
		}
		return nil
	})
}
