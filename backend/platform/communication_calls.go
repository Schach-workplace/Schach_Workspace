package platform

import (
	"context"
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

type CommunicationCall struct {
	ID             string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID      string `json:"-" gorm:"index;uniqueIndex:call_retry"`
	ConversationID string `json:"conversationId"`
	CreatedBy      string `json:"createdBy" gorm:"uniqueIndex:call_retry"`
	RetryKey       string `json:"-" gorm:"uniqueIndex:call_retry"`
	Kind           string `json:"kind"`
	Room           string `json:"-"`
	State          string `json:"state"`
	Version        int64  `json:"version"`
	CreatedAt      string `json:"createdAt"`
	EndedAt        string `json:"endedAt"`
}
type CommunicationCallGrant struct {
	JoinedAt       *time.Time `json:"-"`
	CheckedAt      time.Time  `json:"-"`
	ID             string     `json:"id" gorm:"primaryKey;size:80"`
	CompanyID      string     `json:"-"`
	ConversationID string     `json:"conversationId"`
	CallID         string     `json:"callId" gorm:"index"`
	UserID         string     `json:"userId"`
	DeviceID       string     `json:"deviceId"`
	SessionHash    string     `json:"-"`
	Identity       string     `json:"-"`
	MemberEpoch    int64      `json:"-"`
	Active         bool       `json:"active"`
	ExpiresAt      time.Time  `json:"expiresAt"`
}

func (s *Server) callsConfigured() bool {
	return s.opts.LiveKitURL != "" && s.opts.LiveKitAPIKey != "" && len(s.opts.LiveKitAPISecret) >= 32
}
func (s *Server) createCall(w http.ResponseWriter, r *http.Request) error {
	if !s.callsConfigured() {
		return &apiError{503, "calls_unconfigured", "Calling is not configured.", nil}
	}
	var input struct {
		Kind     string `json:"kind"`
		RetryKey string `json:"retryKey"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !in(input.Kind, "audio", "video") || !clean(input.RetryKey, 100) {
		return invalid("Choose audio/video and a retry key.")
	}
	id := ""
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		var existing CommunicationCall
		e := tx.First(&existing, "company_id=? AND created_by=? AND retry_key=?", a.CompanyID, a.UserID, input.RetryKey).Error
		if e == nil {
			if existing.Kind != input.Kind || existing.ConversationID != a.Conversation.ID {
				return conflict()
			}
			id = existing.ID
			return nil
		}
		if e != gorm.ErrRecordNotFound {
			return e
		}
		id = newID("call")
		call := CommunicationCall{ID: id, CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, CreatedBy: a.UserID, RetryKey: input.RetryKey, Kind: input.Kind, Room: newID("room"), State: "active", Version: 1, CreatedAt: nowString()}
		if e := tx.Create(&call).Error; e != nil {
			return e
		}
		return appendCommunicationEvent(tx, a, "call_started", "", 0)
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) callScope(r *http.Request) (CommunicationCall, error) {
	var call CommunicationCall
	e := s.db.First(&call, "company_id=? AND id=?", r.PathValue("cid"), r.PathValue("call")).Error
	if e != nil {
		return call, missing()
	}
	r.SetPathValue("id", call.ConversationID)
	return call, nil
}
func (s *Server) callToken(w http.ResponseWriter, r *http.Request) error {
	if !s.callsConfigured() {
		return &apiError{503, "calls_unconfigured", "Calling is not configured.", nil}
	}
	call, e := s.callScope(r)
	if e != nil {
		return e
	}
	var input struct {
		DeviceID string `json:"deviceId"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	raw, e := sessionToken(r)
	if e != nil {
		return e
	}
	hash := hashToken(raw)
	var grant CommunicationCallGrant
	token := ""
	e = s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() {
			return denied()
		}
		if e := tx.First(&call, "company_id=? AND id=? AND state=?", a.CompanyID, call.ID, "active").Error; e != nil {
			return missing()
		}
		var device CommunicationDevice
		if e := tx.First(&device, "id=? AND user_id=? AND session_hash=? AND active=?", input.DeviceID, a.UserID, hash, true).Error; e != nil {
			return missing()
		}
		grant = CommunicationCallGrant{CheckedAt: time.Now().UTC(), ID: newID("grant"), CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, CallID: call.ID, UserID: a.UserID, DeviceID: device.ID, SessionHash: hash, Identity: "", MemberEpoch: a.Epoch, Active: true, ExpiresAt: time.Now().UTC().Add(2 * time.Minute)}
		// Provider cleanup addresses an immutable grant identity, so old leased
		// jobs cannot remove a later authorized rejoin on the same device.
		grant.Identity = a.UserID + "." + device.ID + "." + grant.ID
		var older []CommunicationCallGrant
		if e := tx.Where("call_id=? AND user_id=? AND device_id=? AND active=?", call.ID, a.UserID, device.ID, true).Find(&older).Error; e != nil {
			return e
		}
		for _, old := range older {
			if e := tx.Model(&old).Update("active", false).Error; e != nil {
				return e
			}
			if e := enqueueCallJob(tx, call, "RemoveParticipant", old.Identity); e != nil {
				return e
			}
		}
		if e := tx.Create(&grant).Error; e != nil {
			return e
		}
		metadata, _ := json.Marshal(map[string]string{"schachGrant": grant.ID})
		sources := []string{"microphone"}
		if call.Kind == "video" {
			sources = append(sources, "camera", "screen_share", "screen_share_audio")
		}
		var e error
		token, e = signCallToken(liveKitClaims{Issuer: s.opts.LiveKitAPIKey, Subject: grant.Identity, JWTID: grant.ID, NotBefore: time.Now().Unix() - 1, Expires: grant.ExpiresAt.Unix(), Metadata: string(metadata), Video: map[string]any{"roomJoin": true, "room": call.Room, "canPublish": true, "canPublishSources": sources, "canSubscribe": true, "canPublishData": false, "canUpdateOwnMetadata": false}}, s.opts.LiveKitAPISecret)
		return e
	})
	if e != nil {
		return e
	}
	scheme := "ws"
	if r.TLS != nil || s.opts.SecureCookies {
		scheme = "wss"
	}
	gateway := scheme + "://" + r.Host + "/api/companies/" + call.CompanyID + "/calls/" + call.ID + "/transport"
	return respond(w, 200, map[string]any{"token": token, "url": gateway, "expiresAt": grant.ExpiresAt, "call": call})
}
func (s *Server) authorizeCallGrant(ctx context.Context, claims liveKitClaims, cid, callID string, joining bool) error {
	return s.withAuthorizedCallGrant(ctx, claims, cid, callID, joining, nil)
}
func (s *Server) withAuthorizedCallGrant(ctx context.Context, claims liveKitClaims, cid, callID string, joining bool, fn func(*gorm.DB, CommunicationCallGrant) error) error {
	if joining && (claims.Issuer != s.opts.LiveKitAPIKey || claims.Expires <= time.Now().Unix() || claims.NotBefore > time.Now().Unix()) {
		return denied()
	}
	var metadata struct {
		GrantID string `json:"schachGrant"`
	}
	if json.Unmarshal([]byte(claims.Metadata), &metadata) != nil || metadata.GrantID == "" {
		return denied()
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var grant CommunicationCallGrant
		if e := tx.First(&grant, "id=? AND company_id=? AND call_id=? AND active=?", metadata.GrantID, cid, callID, true).Error; e != nil {
			return missing()
		}
		if grant.Identity != claims.Subject {
			return denied()
		}
		var session SessionRecord
		if e := lockCommunicationRow(tx, "SHARE").First(&session, "token_hash=? AND user_id=? AND expires_at>?", grant.SessionHash, grant.UserID, time.Now().UTC()).Error; e != nil {
			return denied()
		}
		var member Membership
		if e := lockCommunicationRow(tx, "SHARE").First(&member, "company_id=? AND user_id=? AND active=?", cid, grant.UserID, true).Error; e != nil {
			return missing()
		}
		if _, e := fenceSessionUser(tx, session, "SHARE"); e != nil {
			return e
		}
		var conversation Conversation
		if e := lockCommunicationRow(tx, "UPDATE").First(&conversation, "company_id=? AND id=?", cid, grant.ConversationID).Error; e != nil {
			return missing()
		}
		var call CommunicationCall
		if e := lockCommunicationRow(tx, "SHARE").First(&call, "id=? AND company_id=? AND state=?", callID, cid, "active").Error; e != nil {
			return missing()
		}
		if claims.Video["room"] != call.Room {
			return denied()
		}
		scope, e := conversationAccess(tx, grant.UserID, cid, grant.ConversationID)
		if e != nil {
			return e
		}
		if !scope.Conversation.Public && scope.Epoch != grant.MemberEpoch || !scope.canPost() {
			return denied()
		}
		var device CommunicationDevice
		if e := tx.First(&device, "id=? AND user_id=? AND session_hash=? AND active=?", grant.DeviceID, grant.UserID, grant.SessionHash, true).Error; e != nil {
			return denied()
		}
		if fn != nil {
			return fn(tx, grant)
		}
		return nil
	})
}

// The provider signaling port must be private. A cached or refreshed provider
// JWT still passes through current Schach session/device/membership authorization.
func (s *Server) callGateway(w http.ResponseWriter, r *http.Request) error {
	if !s.callsConfigured() {
		return missing()
	}
	if !s.communicationOriginAllowed(r) {
		return denied()
	}
	path := r.PathValue("path")
	if path != "rtc" && path != "rtc/validate" {
		return missing()
	}
	claims, e := parseCallToken(r.URL.Query().Get("access_token"), s.opts.LiveKitAPISecret, s.opts.LiveKitAPIKey)
	if e != nil {
		return e
	}
	if e = s.authorizeCallGrant(r.Context(), claims, r.PathValue("cid"), r.PathValue("call"), true); e != nil {
		return e
	}
	target, e := url.Parse(s.opts.LiveKitURL)
	if e != nil {
		return e
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	original := proxy.Director
	proxy.Director = func(out *http.Request) {
		original(out)
		out.URL.Path = "/" + path
		out.URL.RawPath = ""
		out.Header.Del("Cookie")
		out.Header.Del("Authorization")
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		if response.StatusCode == http.StatusSwitchingProtocols {
			return s.withAuthorizedCallGrant(r.Context(), claims, r.PathValue("cid"), r.PathValue("call"), true, func(tx *gorm.DB, grant CommunicationCallGrant) error {
				return tx.Model(&grant).Update("joined_at", time.Now().UTC()).Error
			})
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		http.Error(w, "Call transport unavailable.", 503)
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e := s.authorizeCallGrant(ctx, claims, r.PathValue("cid"), r.PathValue("call"), false); e != nil {
					cancel()
					return
				}
			}
		}
	}()
	proxy.ServeHTTP(w, r.WithContext(ctx))
	return nil
}
func (s *Server) endCall(w http.ResponseWriter, r *http.Request) error {
	call, e := s.callScope(r)
	if e != nil {
		return e
	}
	var input struct {
		ExpectedVersion int64 `json:"expectedVersion"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	e = s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if a.UserID != call.CreatedBy && !a.canManage() {
			return denied()
		}
		if e := lockCommunicationRow(tx, "UPDATE").First(&call, "company_id=? AND id=?", a.CompanyID, call.ID).Error; e != nil {
			return missing()
		}
		if call.Version != input.ExpectedVersion {
			return conflict()
		}
		call.State = "ended"
		call.EndedAt = nowString()
		call.Version++
		if e := tx.Save(&call).Error; e != nil {
			return e
		}
		if e := tx.Model(&CommunicationCallGrant{}).Where("company_id=? AND call_id=?", a.CompanyID, call.ID).Update("active", false).Error; e != nil {
			return e
		}
		if e := enqueueCallJob(tx, call, "DeleteRoom", ""); e != nil {
			return e
		}
		return appendCommunicationEvent(tx, a, "call_ended", "", 0)
	})
	if e != nil {
		return e
	}
	// Local state revokes gateway joins immediately. Provider cleanup is a separate
	// retryable operation; no successful provider cleanup is inferred here.
	// The worker performs provider cleanup using the durable job.
	return ok(w, call.ID)
}
func (s *Server) callRoutes() {
	s.route("GET /api/companies/{cid}/conversations/{id}/calls", s.listCalls)
	s.route("POST /api/companies/{cid}/conversations/{id}/calls", s.createCall)
	s.route("POST /api/companies/{cid}/calls/{call}/token", s.callToken)
	s.route("POST /api/companies/{cid}/calls/{call}/end", s.endCall)
	s.route("GET /api/companies/{cid}/calls/{call}/transport/{path...}", s.callGateway)
}

func (s *Server) listCalls(w http.ResponseWriter, r *http.Request) error {
	rows := []CommunicationCall{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		query := tx.Where("company_id=? AND conversation_id=?", a.CompanyID, a.Conversation.ID)
		if !a.Conversation.Public {
			var interval ConversationInterval
			if e := tx.Where("company_id=? AND conversation_id=? AND user_id=? AND through_sequence IS NULL", a.CompanyID, a.Conversation.ID, a.UserID).Order("joined_at DESC").First(&interval).Error; e != nil {
				return e
			}
			query = query.Where("state=? OR created_at>=?", "active", interval.JoinedAt)
		}
		return query.Order("created_at DESC,id").Limit(100).Find(&rows).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"calls": rows})
}
