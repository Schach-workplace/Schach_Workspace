package platform

import (
	"gorm.io/gorm"
	"net/http"
)

type CommunicationBundle struct {
	ID              string `gorm:"primaryKey;size:80"`
	CompanyID       string `gorm:"uniqueIndex:bundle_retry"`
	ActorID         string `gorm:"uniqueIndex:bundle_retry"`
	RetryKey        string `gorm:"uniqueIndex:bundle_retry"`
	RequestHash     string
	ConversationID  string
	AnchorMessageID string
	SourceRevision  int64
	CreatedAt       string
}
type CommunicationBundleAction struct {
	ID              string `gorm:"primaryKey;size:80"`
	CompanyID       string
	ConversationID  string
	AnchorMessageID string
	BundleID        string
	Title           string
	Position        int
}

func (s *Server) createCommunicationBundle(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		RetryKey              string   `json:"retryKey"`
		AnchorMessageID       string   `json:"anchorMessageId"`
		SourceRevision        int64    `json:"sourceRevision"`
		ExpectedPolicyVersion int64    `json:"expectedPolicyVersion"`
		Titles                []string `json:"titles"`
	}
	if e := decode(w, r, &input); e != nil {
		return e
	}
	if !clean(input.RetryKey, 100) || len(input.Titles) < 2 || len(input.Titles) > 20 {
		return invalid("Choose 2–20 explicit actions and a retry key.")
	}
	for _, title := range input.Titles {
		if !clean(title, 240) {
			return invalid("Each action requires a title up to 240 characters.")
		}
	}
	ids := []string{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		if !a.canPost() || a.Conversation.Forwarding != "selected" {
			return denied()
		}
		if a.Version != input.ExpectedPolicyVersion {
			return conflict()
		}
		m, e := scopedMessage(tx, a, input.AnchorMessageID)
		if e != nil {
			return e
		}
		if m.Removed {
			return missing()
		}
		var bundle CommunicationBundle
		e = tx.First(&bundle, "company_id=? AND actor_id=? AND retry_key=?", a.CompanyID, a.UserID, input.RetryKey).Error
		if e == nil {
			if bundle.RequestHash != payloadHash(input) || bundle.ConversationID != a.Conversation.ID {
				return conflict()
			}
			return tx.Model(&CommunicationBundleAction{}).Where("bundle_id=?", bundle.ID).Order("position").Pluck("id", &ids).Error
		}
		if e != gorm.ErrRecordNotFound {
			return e
		}
		if m.Revision != input.SourceRevision {
			return conflict()
		}
		bundle = CommunicationBundle{ID: newID("bundle"), CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, AnchorMessageID: m.ID, SourceRevision: m.Revision, ActorID: a.UserID, RetryKey: input.RetryKey, RequestHash: payloadHash(input), CreatedAt: nowString()}
		if e := tx.Create(&bundle).Error; e != nil {
			return e
		}
		for i, title := range input.Titles {
			id := newID("action")
			ids = append(ids, id)
			if e := tx.Create(&CommunicationBundleAction{ID: id, CompanyID: a.CompanyID, ConversationID: a.Conversation.ID, AnchorMessageID: m.ID, BundleID: bundle.ID, Title: title, Position: i}).Error; e != nil {
				return e
			}
		}
		return appendCommunicationEvent(tx, a, "work_actions_declared", m.ID, m.Sequence)
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"actionIds": ids})
}

func (s *Server) listCommunicationActions(w http.ResponseWriter, r *http.Request) error {
	rows := []struct {
		ID             string `json:"id"`
		Title          string `json:"title"`
		SourceRevision int64  `json:"sourceRevision"`
	}{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		m, e := scopedMessage(tx, a, r.URL.Query().Get("anchorMessageId"))
		if e != nil {
			return e
		}
		if m.Removed {
			return missing()
		}
		return tx.Table("communication_bundle_actions x").Select("x.id,x.title,b.source_revision").Joins("JOIN communication_bundles b ON b.id=x.bundle_id AND b.company_id=x.company_id").Where("x.company_id=? AND x.conversation_id=? AND x.anchor_message_id=?", a.CompanyID, a.Conversation.ID, m.ID).Order("b.created_at,x.position,x.id").Limit(100).Scan(&rows).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"actions": rows})
}
