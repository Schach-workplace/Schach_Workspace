package platform

import (
	"encoding/base64"
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"strings"
)

func (s *Server) createConversation(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Title          string   `json:"title"`
		Kind           string   `json:"kind"`
		Public         bool     `json:"public"`
		ParticipantIDs []string `json:"participantIds"`
		Forwarding     string   `json:"forwarding"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !in(input.Kind, "dm", "group", "channel") || !clean(input.Title, 120) || len(input.ParticipantIDs) > 100 {
		return invalid("Choose a conversation kind, title and up to 100 participants.")
	}
	if input.Forwarding == "" {
		input.Forwarding = "deny"
	}
	if !in(input.Forwarding, "deny", "selected") {
		return invalid("Choose deny or selected publication.")
	}
	if input.Public && input.Kind != "channel" {
		return invalid("Only channels may be public.")
	}
	id := ""
	e := s.withCommunicationTransaction(r, input.ParticipantIDs, func(tx *gorm.DB, a *conversationScope) error {
		if a.CompanyRole == "viewer" {
			return denied()
		}
		set := map[string]bool{a.UserID: true}
		for _, uid := range input.ParticipantIDs {
			set[uid] = true
		}
		ids := []string{}
		for uid := range set {
			ids = append(ids, uid)
		}
		sort.Strings(ids)
		pair := ""
		if input.Kind == "dm" {
			if len(ids) != 2 {
				return invalid("DMs require exactly two participants.")
			}
			if input.Public {
				return invalid("DMs are private.")
			}
			pair = strings.Join(ids, ":")
			if tx.Dialector.Name() == "postgres" {
				if e := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", a.CompanyID+":"+pair).Error; e != nil {
					return e
				}
			}
			var existing Conversation
			var blocked int64
			if e := tx.Model(&CommunicationBlock{}).Where("company_id=? AND user_id IN ? AND blocked_user_id IN ?", a.CompanyID, ids, ids).Count(&blocked).Error; e != nil {
				return e
			}
			if blocked > 0 {
				return denied()
			}
			if e := tx.Where("company_id = ? AND pair_key = ?", a.CompanyID, pair).First(&existing).Error; e == nil {
				scope, e := conversationAccess(tx, a.UserID, a.CompanyID, existing.ID)
				if e != nil {
					return e
				}
				if scope.Blocked {
					return denied()
				}
				id = existing.ID
				return nil
			} else if e != gorm.ErrRecordNotFound {
				return e
			}
		}
		c := Conversation{ID: newID("con"), CompanyID: a.CompanyID, Title: strings.TrimSpace(input.Title), Kind: input.Kind, Public: input.Public, PairKey: pair, Forwarding: input.Forwarding, Version: 1, CreatedBy: a.UserID, CreatedAt: nowString()}
		if e := tx.Create(&c).Error; e != nil {
			return e
		}
		id = c.ID
		for _, uid := range ids {
			role := "member"
			if uid == a.UserID {
				role = "owner"
			}
			cm := ConversationMember{CompanyID: c.CompanyID, ConversationID: c.ID, UserID: uid, Role: role, Active: true, HistoryFromSequence: 1, Epoch: 1}
			if e := tx.Create(&cm).Error; e != nil {
				return e
			}
			if e := tx.Create(&ConversationInterval{ID: newID("join"), CompanyID: c.CompanyID, ConversationID: c.ID, UserID: uid, FromSequence: 1, JoinedAt: nowString()}).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}

type conversationListCursor struct{ Company, User, CreatedAt, ID string }

func (s *Server) listConversations(w http.ResponseWriter, r *http.Request) error {
	rows := []Conversation{}
	cursor := ""
	hasMore := false
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		q := tx.Where("company_id = ? AND (public = ? OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.company_id = conversations.company_id AND cm.conversation_id = conversations.id AND cm.user_id = ? AND cm.active = ?))", a.CompanyID, true, a.UserID, true)
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			data, e := base64.RawURLEncoding.DecodeString(raw)
			var position conversationListCursor
			if e != nil || len(data) > 2048 || json.Unmarshal(data, &position) != nil {
				return invalid("Invalid conversation cursor.")
			}
			if position.Company != a.CompanyID || position.User != a.UserID {
				return &apiError{409, "refetch_required", "Fetch the current company conversation list again.", nil}
			}
			q = q.Where("(created_at>? OR (created_at=? AND id>?))", position.CreatedAt, position.CreatedAt, position.ID)
		}
		if e := q.Order("created_at,id").Limit(101).Find(&rows).Error; e != nil {
			return e
		}
		hasMore = len(rows) > 100
		if hasMore {
			rows = rows[:100]
		}
		if len(rows) > 0 {
			last := rows[len(rows)-1]
			data, _ := json.Marshal(conversationListCursor{a.CompanyID, a.UserID, last.CreatedAt, last.ID})
			cursor = base64.RawURLEncoding.EncodeToString(data)
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"conversations": rows, "cursor": cursor, "hasMore": hasMore})
}
func (s *Server) getConversation(w http.ResponseWriter, r *http.Request) error {
	var c Conversation
	members := []ConversationMember{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		c = a.Conversation
		return tx.Where("company_id = ? AND conversation_id = ? AND active = ?", a.CompanyID, c.ID, true).Find(&members).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"conversation": c, "members": members})
}
func (s *Server) patchConversation(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		ExpectedVersion int64   `json:"expectedVersion"`
		Title           *string `json:"title"`
		Archived        *bool   `json:"archived"`
		Forwarding      *string `json:"forwarding"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canManage() {
			return denied()
		}
		if in.ExpectedVersion != a.Version {
			return conflict()
		}
		c := a.Conversation
		if in.Title != nil {
			if !clean(*in.Title, 120) {
				return invalid("A title up to 120 characters is required.")
			}
			c.Title = strings.TrimSpace(*in.Title)
		}
		if in.Archived != nil {
			c.Archived = *in.Archived
		}
		if in.Forwarding != nil {
			if a.Role != "owner" {
				return denied()
			}
			if *in.Forwarding != "deny" && *in.Forwarding != "selected" {
				return invalid("Choose deny or selected publication.")
			}
			c.Forwarding = *in.Forwarding
		}
		c.Version++
		if e := tx.Save(&c).Error; e != nil {
			return e
		}
		return appendCommunicationEvent(tx, a, "policy_changed", "", 0)
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("id"))
}
func (s *Server) changeConversationMember(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		ExpectedVersion int64  `json:"expectedVersion"`
		UserID          string `json:"userId"`
		Role            string `json:"role"`
		Active          bool   `json:"active"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !in(input.Role, "owner", "moderator", "member", "viewer") {
		return invalid("Choose a conversation role.")
	}
	extras := []string{}
	if input.Active {
		extras = append(extras, input.UserID)
	}
	e := s.withCommunicationTransaction(r, extras, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canManage() {
			return denied()
		}
		if input.ExpectedVersion != a.Version {
			return conflict()
		}
		c := a.Conversation
		if c.Kind == "dm" {
			return invalid("DM participants are fixed.")
		}
		var old ConversationMember
		e := tx.Where("company_id = ? AND conversation_id = ? AND user_id = ?", a.CompanyID, c.ID, input.UserID).First(&old).Error
		if e != nil && e != gorm.ErrRecordNotFound {
			return e
		}
		if old.Role == "owner" || input.Role == "owner" {
			if a.Role != "owner" {
				return denied()
			}
			if old.Role == "owner" && (!input.Active || input.Role != "owner") {
				return invalid("Transfer ownership before removing the owner.")
			}
		}
		if input.Role == "owner" && !input.Active {
			return invalid("The conversation owner must be active.")
		}
		if input.Role == "owner" && input.UserID != a.UserID {
			if e := tx.Model(&ConversationMember{}).Where("company_id = ? AND conversation_id = ? AND role = ?", a.CompanyID, c.ID, "owner").Update("role", "member").Error; e != nil {
				return e
			}
		}
		if old.Active && !input.Active {
			through := c.NextSequence
			if e := tx.Model(&ConversationInterval{}).Where("company_id = ? AND conversation_id = ? AND user_id = ? AND through_sequence IS NULL", a.CompanyID, c.ID, input.UserID).Updates(map[string]any{"through_sequence": through, "left_at": nowString()}).Error; e != nil {
				return e
			}
		}
		joining := input.Active && !old.Active
		if joining {
			old.HistoryFromSequence = c.NextSequence + 1
			old.Epoch++
		}
		old.CompanyID = a.CompanyID
		old.ConversationID = c.ID
		old.UserID = input.UserID
		old.Role = input.Role
		old.Active = input.Active
		if e := tx.Save(&old).Error; e != nil {
			return e
		}
		if joining {
			if e := tx.Create(&ConversationInterval{ID: newID("join"), CompanyID: a.CompanyID, ConversationID: c.ID, UserID: input.UserID, FromSequence: old.HistoryFromSequence, JoinedAt: nowString()}).Error; e != nil {
				return e
			}
		}
		if e := tx.Model(&Conversation{}).Where("id = ? AND company_id = ?", c.ID, a.CompanyID).Update("version", c.Version+1).Error; e != nil {
			return e
		}
		return appendCommunicationEvent(tx, a, "membership_changed", "", 0)
	})
	if e != nil {
		return e
	}
	return ok(w, r.PathValue("id"))
}
func (s *Server) communicationRoutes() {
	s.route("POST /api/companies/{cid}/conversations/{id}/exports", s.exportSelectedCommunication)
	s.route("GET /api/companies/{cid}/communication/briefing", s.publishedWorkBriefing)
	s.route("GET /api/companies/{cid}/conversations/{id}/work-actions", s.listCommunicationActions)
	s.messageRoutes()
	s.dailyCommunicationRoutes()
	s.communicationControlRoutes()
	s.mediaRoutes()
	s.deviceRoutes()
	s.mfaRoutes()
	s.callRoutes()
	s.structuredRoutes()
	s.intakeRoutes()
	s.communicationFinanceRoutes()
	s.route("POST /api/companies/{cid}/conversations/{id}/work-actions", s.createCommunicationBundle)
	s.route("GET /api/companies/{cid}/conversations/{id}/work-links/{task}/sources", s.conversationTaskSources)
	s.route("POST /api/companies/{cid}/conversations/{id}/task-conversions/preview", s.previewTaskConversion)
	s.route("POST /api/companies/{cid}/conversations/{id}/task-conversions", s.convertMessageToTask)
	s.route("GET /api/companies/{cid}/conversations/{id}/work-links", s.conversationWorkLinks)
	s.route("POST /api/companies/{cid}/conversations", s.createConversation)
	s.route("GET /api/companies/{cid}/conversations", s.listConversations)
	s.route("GET /api/companies/{cid}/conversations/{id}", s.getConversation)
	s.route("PATCH /api/companies/{cid}/conversations/{id}", s.patchConversation)
	s.route("POST /api/companies/{cid}/conversations/{id}/members", s.changeConversationMember)
}

func (s *Server) messageRoutes() {
	s.route("GET /api/companies/{cid}/communication/stream", s.streamCommunication)
	s.route("GET /api/companies/{cid}/conversations/{id}/stream", s.streamCommunication)
	s.route("POST /api/companies/{cid}/conversations/{id}/messages", s.sendMessage)
	s.route("GET /api/companies/{cid}/conversations/{id}/messages", s.listMessages)
	s.route("PATCH /api/companies/{cid}/conversations/{id}/messages/{mid}", s.editMessage)
	s.route("GET /api/companies/{cid}/conversations/{id}/sync", s.syncCommunication)
}
