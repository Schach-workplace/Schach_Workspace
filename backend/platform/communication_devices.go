package platform

import (
	"bytes"
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"strings"
	"time"
)

type CommunicationDevice struct {
	ID           string `json:"id" gorm:"primaryKey;size:80"`
	UserID       string `json:"-" gorm:"index"`
	SessionHash  string `json:"-" gorm:"index"`
	Platform     string `json:"platform"`
	Name         string `json:"name"`
	PushProvider string `json:"-"`
	PushToken    string `json:"-"`
	Active       bool   `json:"active"`
	CreatedAt    string `json:"createdAt"`
	LastSeenAt   string `json:"lastSeenAt"`
}
type CommunicationPreference struct {
	CompanyID    string `json:"-" gorm:"primaryKey;size:80"`
	DeviceID     string `json:"deviceId" gorm:"primaryKey;size:80"`
	Muted        bool   `json:"muted"`
	MentionsOnly bool   `json:"mentionsOnly"`
	Timezone     string `json:"timezone"`
	QuietStart   string `json:"quietStart"`
	QuietEnd     string `json:"quietEnd"`
}

func sessionToken(r *http.Request) (string, error) {
	if cookie, e := r.Cookie(cookieName); e == nil && len(cookie.Value) == 64 {
		return cookie.Value, nil
	}
	if value := r.Header.Get("Authorization"); strings.HasPrefix(value, "Bearer ") && len(value) == 71 {
		return strings.TrimPrefix(value, "Bearer "), nil
	}
	return "", &apiError{401, "unauthenticated", "Please sign in to continue.", nil}
}
func (s *Server) registerDevice(w http.ResponseWriter, r *http.Request) error {
	u, hash, e := s.authenticate(r)
	if e != nil {
		return e
	}
	var input struct {
		DeviceID     string  `json:"deviceId"`
		Platform     string  `json:"platform"`
		Name         string  `json:"name"`
		PushProvider *string `json:"pushProvider"`
		PushToken    *string `json:"pushToken"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !in(input.Platform, "android", "ios", "web") || !clean(input.Name, 120) || (input.PushToken != nil && len(*input.PushToken) > 4096) || (input.PushProvider != nil && !in(*input.PushProvider, "", "fcm", "apns")) || (input.PushToken == nil) != (input.PushProvider == nil) {
		return invalid("Choose a device platform, name and optional native push provider.")
	}
	id := input.DeviceID
	if id == "" {
		id = newID("dev")
	}
	e = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var session SessionRecord
		if e := lockCommunicationRow(tx, "SHARE").First(&session, "token_hash=? AND expires_at>?", hash, time.Now().UTC()).Error; e != nil {
			return &apiError{401, "unauthenticated", "Please sign in again.", nil}
		}
		if _, e := fenceSessionUser(tx, session, "SHARE"); e != nil {
			return e
		}
		var existing CommunicationDevice
		e := tx.First(&existing, "id=?", id).Error
		if e == nil && existing.UserID != u.ID {
			return missing()
		}
		if e != nil && e != gorm.ErrRecordNotFound {
			return e
		}
		created := existing.CreatedAt
		if created == "" {
			created = nowString()
		}
		provider, token := existing.PushProvider, existing.PushToken
		if input.PushProvider != nil {
			provider, token = *input.PushProvider, *input.PushToken
		}
		return tx.Save(&CommunicationDevice{ID: id, UserID: u.ID, SessionHash: hash, Platform: input.Platform, Name: input.Name, PushProvider: provider, PushToken: token, Active: true, CreatedAt: created, LastSeenAt: nowString()}).Error
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) devicePreferences(w http.ResponseWriter, r *http.Request) error {
	var input CommunicationPreference
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if _, e := time.LoadLocation(input.Timezone); e != nil {
		return invalid("Choose an IANA attention timezone.")
	}
	if (input.QuietStart == "") != (input.QuietEnd == "") {
		return invalid("Choose both quiet-hour boundaries or neither.")
	}
	for _, clock := range []string{input.QuietStart, input.QuietEnd} {
		if clock != "" {
			if _, e := time.Parse("15:04", clock); e != nil {
				return invalid("Quiet hours use HH:MM.")
			}
		}
	}
	rawToken, e := sessionToken(r)
	if e != nil {
		return e
	}
	hash := hashToken(rawToken)
	e = s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		var device CommunicationDevice
		if e := tx.First(&device, "id=? AND user_id=? AND session_hash=? AND active=?", r.PathValue("device"), a.UserID, hash, true).Error; e != nil {
			return missing()
		}
		input.CompanyID = a.CompanyID
		input.DeviceID = device.ID
		return tx.Save(&input).Error
	})
	if e != nil {
		return e
	}
	return ok(w, "")
}
func (s *Server) communicationInbox(w http.ResponseWriter, r *http.Request) error {
	rows := []struct {
		CommunicationInbox
		Kind string `json:"kind"`
	}{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		return tx.Table("communication_inboxes AS i").Select("i.*, e.kind AS kind").Joins("JOIN communication_events e ON e.id=i.event_id AND e.company_id=i.company_id").Joins("JOIN conversations c ON c.id=i.conversation_id AND c.company_id=i.company_id").Joins("LEFT JOIN conversation_members cm ON cm.company_id=i.company_id AND cm.conversation_id=i.conversation_id AND cm.user_id=i.user_id").Joins("JOIN memberships im ON im.company_id=i.company_id AND im.user_id=i.user_id AND im.active=true AND im.access_epoch=i.membership_epoch").Where("i.recipient_epoch=CASE WHEN cm.active=true THEN cm.epoch ELSE 0 END").Where("i.company_id=? AND i.user_id=? AND (c.public=? OR (cm.active=? AND (e.message_sequence=0 OR e.message_sequence>=cm.history_from_sequence)))", a.CompanyID, a.UserID, true, true).Order("e.created_at DESC,e.id").Limit(100).Scan(&rows).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"events": rows})
}

type nativeLoginCapture struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func (w *nativeLoginCapture) Header() http.Header    { return w.header }
func (w *nativeLoginCapture) WriteHeader(status int) { w.status = status }
func (w *nativeLoginCapture) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.body.Write(b)
}
func (s *Server) mobileLogin(w http.ResponseWriter, r *http.Request) error {
	capture := &nativeLoginCapture{header: http.Header{}}
	if e := s.login(capture, r); e != nil {
		return e
	}
	if capture.status != 200 {
		return invalid("Native login failed.")
	}
	response := &http.Response{Header: capture.header}
	token := ""
	for _, cookie := range response.Cookies() {
		if cookie.Name == cookieName {
			token = cookie.Value
		}
	}
	var session Session
	if e := json.Unmarshal(capture.body.Bytes(), &session); e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"session": session, "token": token})
}
func (s *Server) deviceRoutes() {
	s.route("POST /api/admin/users/{user}/offboard", s.globalOffboard)
	s.route("POST /api/auth/mobile-login", s.mobileLogin)
	s.route("POST /api/devices", s.registerDevice)
	s.route("GET /api/devices", s.listDevices)
	s.route("POST /api/devices/{device}/revoke", s.revokeDevice)
	s.route("POST /api/companies/{cid}/devices/{device}/preferences", s.devicePreferences)
	s.route("POST /api/companies/{cid}/communication/inbox/{event}/ack", s.ackCommunicationInbox)
	s.route("GET /api/companies/{cid}/communication/inbox", s.communicationInbox)
}

func (s *Server) listDevices(w http.ResponseWriter, r *http.Request) error {
	u, hash, e := s.authenticate(r)
	if e != nil {
		return e
	}
	rows := []CommunicationDevice{}
	e = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var session SessionRecord
		if e := lockCommunicationRow(tx, "SHARE").First(&session, "token_hash=? AND expires_at>?", hash, time.Now().UTC()).Error; e != nil {
			return &apiError{401, "unauthenticated", "Please sign in again.", nil}
		}
		if _, e := fenceSessionUser(tx, session, "SHARE"); e != nil {
			return e
		}
		return tx.Where("user_id=?", u.ID).Order("created_at,id").Find(&rows).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"devices": rows})
}

// Revoking a lost device revokes its entire bound session, including non-device
// HTTP access. Other sessions and company memberships remain intact.
func (s *Server) revokeDevice(w http.ResponseWriter, r *http.Request) error {
	u, hash, e := s.authenticate(r)
	if e != nil {
		return e
	}
	e = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var device CommunicationDevice
		if e := tx.First(&device, "id=? AND user_id=?", r.PathValue("device"), u.ID).Error; e != nil {
			return missing()
		}
		keys := []string{hash, device.SessionHash}
		sort.Strings(keys)
		var actorSession SessionRecord
		for i, key := range keys {
			if i > 0 && key == keys[i-1] {
				continue
			}
			var session SessionRecord
			e := lockCommunicationRow(tx, "UPDATE").First(&session, "token_hash=?", key).Error
			if key == hash && (e != nil || session.UserID != u.ID || !session.ExpiresAt.After(time.Now().UTC())) {
				return &apiError{401, "unauthenticated", "Please sign in again.", nil}
			}
			if e != nil && e != gorm.ErrRecordNotFound {
				return e
			}
			if key == hash {
				actorSession = session
			}
		}
		if _, e := fenceSessionUser(tx, actorSession, "UPDATE"); e != nil {
			return e
		}
		if e := revokeSessionCapabilitiesLocked(tx, u.ID, []string{device.SessionHash}, SessionRevocationScope{}); e != nil {
			return e
		}
		var current CommunicationDevice
		if e := lockCommunicationRow(tx, "UPDATE").First(&current, "id=? AND user_id=?", device.ID, u.ID).Error; e != nil {
			return missing()
		}
		// A concurrent registration can bind the device to a new session. Refetch
		// instead of revoking a session we did not lock.
		if current.SessionHash != device.SessionHash {
			return conflict()
		}
		if e := tx.Model(&CommunicationDevice{}).Where("user_id=? AND session_hash=?", u.ID, current.SessionHash).Updates(map[string]any{"active": false, "push_token": ""}).Error; e != nil {
			return e
		}
		return tx.Where("token_hash=? AND user_id=?", current.SessionHash, u.ID).Delete(&SessionRecord{}).Error
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("device"))
}
