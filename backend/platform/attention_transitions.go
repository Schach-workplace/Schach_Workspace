package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

func ensureAttentionItem(tx *gorm.DB, item AttentionItem) error {
	if item.ID == "" {
		item.ID = newID("attention")
	}
	if item.Version == 0 {
		item.Version = 1
	}
	if item.State == "" {
		item.State = "open"
	}
	if item.CreatedAt.IsZero() {
		item.CreatedAt = time.Now().UTC()
	}
	if item.UpdatedAt.IsZero() {
		item.UpdatedAt = item.CreatedAt
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&item).Error
}
func decodeAttentionTransition(w http.ResponseWriter, r *http.Request) (AttentionTransitionInput, error) {
	var input AttentionTransitionInput
	var raw map[string]json.RawMessage
	if e := decode(w, r, &raw); e != nil {
		return input, e
	}
	for k, v := range raw {
		if !in(k, "expectedVersion", "retryKey", "action", "reason", "snoozedUntil", "recipientId") || string(v) == "null" {
			return input, invalid("Unknown or null attention field.")
		}
	}
	b, _ := json.Marshal(raw)
	if e := json.Unmarshal(b, &input); e != nil {
		return input, invalid("Invalid attention action.")
	}
	if input.ExpectedVersion < 1 || !clean(input.RetryKey, 120) || !in(input.Action, "resolve", "snooze", "unsnooze", "route") {
		return input, invalid("Expected version, retry key and action are required.")
	}
	if utf8.RuneCountInString(input.Reason) > 4000 {
		return input, invalid("Reason exceeds 4000 characters.")
	}
	if in(input.Action, "resolve", "route") && strings.TrimSpace(input.Reason) == "" {
		return input, invalid("A reason is required.")
	}
	if input.Action == "snooze" {
		if input.SnoozedUntil == nil || !input.SnoozedUntil.After(time.Now()) || input.SnoozedUntil.After(time.Now().Add(90*24*time.Hour)) {
			return input, invalid("Snooze must be in the next 90 days.")
		}
	} else if _, ok := raw["snoozedUntil"]; ok {
		return input, invalid("Snooze time is only supported for snooze.")
	}
	if input.Action == "route" {
		if input.RecipientID == "" {
			return input, invalid("Choose a recipient.")
		}
	} else if _, ok := raw["recipientId"]; ok {
		return input, invalid("Recipient is only supported for route.")
	}
	if in(input.Action, "snooze", "unsnooze") {
		if _, ok := raw["reason"]; ok {
			return input, invalid("Reason is only supported for resolve and route.")
		}
	}
	return input, nil
}
func (s *Server) transitionAttention(w http.ResponseWriter, r *http.Request) error {
	input, e := decodeAttentionTransition(w, r)
	if e != nil {
		return e
	}
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var view AttentionView
	var result AttentionRetry
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var err error
		a, err = currentAttentionActorLocked(tx, a.Company.ID, a.User.ID)
		if err != nil {
			return err
		}
		var item AttentionItem
		// Conversation authorization precedes dependent row lock/retry replay.
		if err = tx.First(&item, "company_id=? AND recipient_id=? AND id=?", a.Company.ID, a.User.ID, r.PathValue("item")).Error; err != nil {
			return missing()
		}
		view, err = attentionSource(tx, a, item)
		if err != nil {
			return err
		}
		if err = lockCommunicationRow(tx, "UPDATE").First(&item, "id=?", item.ID).Error; err != nil {
			return err
		}
		hash := payloadHash([]any{item.ID, input})
		var old AttentionRetry
		err = tx.First(&old, "company_id=? AND actor_id=? AND operation=? AND retry_key=?", a.Company.ID, a.User.ID, "transition", input.RetryKey).Error
		if err == nil {
			if old.RequestHash != hash {
				return conflict()
			}
			if input.Action == "route" {
				if err := attentionCanRouteReplay(tx, a, item, input.RecipientID); err != nil {
					return missing()
				}
			}
			result = old
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if item.State != "open" || item.Version != input.ExpectedVersion {
			return conflict()
		}
		now := time.Now().UTC()
		result = AttentionRetry{CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: "transition", RetryKey: input.RetryKey, RequestHash: hash, ItemID: item.ID, ResultItemID: item.ID, ResultVersion: item.Version + 1, CreatedAt: now}
		switch input.Action {
		case "resolve":
			item.State = "resolved"
			item.ResolvedBy = a.User.ID
			item.ResolvedAt = &now
			item.ResolutionReason = input.Reason
		case "snooze":
			item.SnoozedUntil = input.SnoozedUntil
		case "unsnooze":
			item.SnoozedUntil = nil
		case "route":
			if err := attentionCanRoute(tx, a, item, input.RecipientID); err != nil {
				return err
			}
			var target AttentionItem
			err := tx.Where("company_id=? AND recipient_id=? AND source_kind=? AND source_id=? AND kind=? AND state=? AND (occurrence_key=? OR occurrence_key LIKE ?)", item.CompanyID, input.RecipientID, item.SourceKind, item.SourceID, item.Kind, "open", item.OccurrenceKey, "route:"+item.OccurrenceKey+":%").Order("created_at,id").First(&target).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == nil {
				t, e := currentAttentionActorLocked(tx, item.CompanyID, input.RecipientID)
				if e != nil {
					return e
				}
				if _, e = attentionSource(tx, t, target); e != nil {
					err = gorm.ErrRecordNotFound
				}
			}
			if err == gorm.ErrRecordNotFound {
				target = item
				target.ID = newID("attention")
				target.RecipientID = input.RecipientID
				target.OccurrenceKey = "route:" + item.OccurrenceKey + ":" + payloadHash([]string{item.ID, input.RetryKey})
				target.Version = 1
				target.CreatedAt = now
				target.UpdatedAt = now
				target.SnoozedUntil = nil
				if item.SourceKind == "record" {
					scope, e := conversationAccess(tx, target.RecipientID, item.CompanyID, item.ConversationID)
					if e != nil {
						return e
					}
					target.RecipientEpoch = scope.Epoch
				}
				if e := ensureAttentionItem(tx, target); e != nil {
					return e
				}
			}
			result.ResultItemID = target.ID
			item.State = "routed"
			item.RoutedToID = input.RecipientID
			item.ResolutionReason = input.Reason
		}
		item.Version++
		item.UpdatedAt = now
		if err := tx.Save(&item).Error; err != nil {
			return err
		}
		if err := tx.Create(&result).Error; err != nil {
			return err
		}
		view, err = attentionSource(tx, a, item)
		return err
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"item": view, "resultItemId": result.ResultItemID, "resultVersion": result.ResultVersion})
}
func attentionCanRouteReplay(tx *gorm.DB, a *access, item AttentionItem, target string) error {
	copy := item
	copy.State = "open"
	return attentionCanRoute(tx, a, copy, target)
}
