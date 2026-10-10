package platform

import (
	"gorm.io/gorm"
	"net/url"
)

// currentAttentionActorLocked refreshes current actor/directory after the caller
// has locked company, optional session, and sorted memberships. It obtains no
// company lock, allowing target checks after HTTP access without lock inversion.
func currentAttentionActorLocked(tx *gorm.DB, cid, uid string) (*access, error) {
	a := &access{Members: map[string]Membership{}, Users: map[string]User{}}
	if e := tx.First(&a.Company, "id=?", cid).Error; e != nil {
		return nil, e
	}
	var members []Membership
	if e := lockCommunicationRow(tx, "SHARE").Where("company_id=?", cid).Order("user_id").Find(&members).Error; e != nil {
		return nil, e
	}
	ids := []string{}
	for _, m := range members {
		a.Members[m.UserID] = m
		ids = append(ids, m.UserID)
	}
	var users []User
	if e := lockCommunicationRow(tx, "SHARE").Where("id IN ?", ids).Order("id").Find(&users).Error; e != nil {
		return nil, e
	}
	for _, u := range users {
		a.Users[u.ID] = u
	}
	var ok bool
	a.Member, ok = a.Members[uid]
	a.User = a.Users[uid]
	if !ok || !a.Member.Active || a.User.ID == "" || a.User.Suspended {
		return nil, missing()
	}
	return a, nil
}
func taskAttentionReviewer(a *access, t Task) bool {
	return t.Status == "in_review" && a.Member.Role != "viewer" && t.OwnerID != a.User.ID && (t.ReviewerID == a.User.ID || leadership(a.Member.Role))
}
func attentionSource(tx *gorm.DB, a *access, item AttentionItem) (AttentionView, error) {
	v := AttentionView{ID: item.ID, CompanyID: item.CompanyID, RecipientID: item.RecipientID, SourceKind: item.SourceKind, SourceID: item.SourceID, Kind: item.Kind, State: item.State, Version: item.Version, SnoozedUntil: item.SnoozedUntil, DueAt: item.DueAt, Actions: []string{}, RoutePeople: []Person{}, ReminderState: "pending"}
	if item.CompanyID != a.Company.ID || item.RecipientID != a.User.ID || item.State == "superseded" || a.User.Suspended {
		return v, missing()
	}
	switch item.SourceKind {
	case "task":
		t, e := scopedTask(tx, a, item.SourceID)
		if e != nil {
			return v, e
		}
		if item.Kind == "task_review" && !taskAttentionReviewer(a, t) {
			return v, missing()
		}
		if item.Kind == "blocker" && t.Status != "blocked" {
			return v, missing()
		}
		v.Title = t.Title
		v.Summary = t.Description
		v.SourceVersion = t.Version
		v.OwnerName = a.Users[t.OwnerID].Name
		v.CanDecide = taskAttentionReviewer(a, t)
		v.Link = "/work?task=" + url.QueryEscape(t.ID)
		v.CanRoute = item.Kind == "task_review" && v.CanDecide || item.Kind != "task_review" && (t.OwnerID == a.User.ID || t.CreatedBy == a.User.ID || a.canStructure(t))
	case "expense":
		e, err := scopedExpense(tx, a, item.SourceID)
		if err != nil {
			return v, err
		}
		if item.Kind == "expense_review" && (e.Status != "submitted" || !a.canApproveExpense(e)) {
			return v, missing()
		}
		v.Title = e.Title
		v.SourceVersion = e.Version
		v.OwnerName = a.Users[e.CreatedBy].Name
		v.CanDecide = e.Status == "submitted" && a.canApproveExpense(e)
		v.CanRoute = v.CanDecide
		v.Link = "/finance?expense=" + url.QueryEscape(e.ID)
	case "intake":
		var i CommunicationRequest
		if e := tx.First(&i, "company_id=? AND id=?", a.Company.ID, item.SourceID).Error; e != nil {
			return v, missing()
		}
		if !a.canReadIntake(i) || item.Kind == "intake_triage" && (!a.canTriageIntake(i) || i.State != "open") {
			return v, missing()
		}
		v.Title = i.Title
		v.Summary = i.Summary
		v.SourceVersion = i.Version
		v.CanDecide = i.State == "open" && a.canTriageIntake(i)
		v.CanRoute = v.CanDecide
		v.Link = "/connect?intake=" + url.QueryEscape(i.ID)
	case "record", "bookmark":
		var c Conversation
		if e := lockCommunicationRow(tx, "SHARE").Where("company_id=? AND id=?", a.Company.ID, item.ConversationID).First(&c).Error; e != nil {
			return v, missing()
		}
		scope, e := conversationAccess(tx, a.User.ID, a.Company.ID, item.ConversationID)
		if e != nil {
			return v, e
		}
		if scope.Epoch != item.RecipientEpoch {
			return v, missing()
		}
		m, e := scopedMessage(tx, scope, item.AnchorMessageID)
		if e != nil || m.Removed || m.Revision != item.SourceRevision || m.Sequence != item.MessageSequence {
			return v, missing()
		}
		v.Link = "/connect?conversation=" + url.QueryEscape(c.ID) + "&message=" + url.QueryEscape(m.ID)
		if item.SourceKind == "bookmark" {
			var b CommunicationBookmark
			if e := tx.First(&b, "company_id=? AND user_id=? AND message_id=?", a.Company.ID, a.User.ID, item.SourceID).Error; e != nil || b.RemindAt == "" || item.OccurrenceKey != payloadHash(b.RemindAt) {
				return v, missing()
			}
			v.Title = "Saved reminder"
			v.Summary = m.Body
			v.SourceVersion = m.Revision
		} else {
			var rec CommunicationRecord
			if e := tx.First(&rec, "company_id=? AND conversation_id=? AND id=?", a.Company.ID, c.ID, item.SourceID).Error; e != nil {
				return v, missing()
			}
			if rec.Revision != item.RecordRevision || rec.SourceRevision != m.Revision {
				return v, missing()
			}
			var recipient CommunicationRecipient
			e := tx.First(&recipient, "company_id=? AND record_id=? AND revision=? AND user_id=?", a.Company.ID, rec.ID, rec.Revision, a.User.ID).Error
			if e != nil && rec.CreatedBy != a.User.ID {
				return v, missing()
			}
			if rec.State != "open" || recipient.Response != "" {
				return v, missing()
			}
			if rec.Kind == "decision" && (a.User.ID != rec.ReviewerID || a.User.ID == rec.CreatedBy) {
				return v, missing()
			}
			v.Title = rec.Title
			v.Summary = rec.Body
			v.SourceVersion = rec.Revision
			v.CanDecide = scope.canPost() && rec.Kind == "decision" && rec.ReviewerID == a.User.ID && rec.CreatedBy != a.User.ID
			v.CanRoute = scope.canPost() && rec.Kind != "decision" && (rec.CreatedBy == a.User.ID || e == nil)
		}
	default:
		return v, missing()
	}
	if item.State == "open" {
		v.Actions = []string{"resolve", "snooze", "unsnooze"}
		if v.CanRoute {
			v.Actions = append(v.Actions, "route")
		}
	} else {
		v.CanRoute = false
	}
	var delivered int64
	if e := tx.Model(&AttentionDelivery{}).Where("company_id=? AND item_id=? AND recipient_id=?", item.CompanyID, item.ID, item.RecipientID).Count(&delivered).Error; e != nil {
		return v, e
	}
	if delivered > 0 {
		v.ReminderState = "delivered"
	}
	return v, nil
}
func attentionCanRoute(tx *gorm.DB, actor *access, item AttentionItem, targetID string) error {
	v, e := attentionSource(tx, actor, item)
	if e != nil {
		return e
	}
	if !v.CanRoute || targetID == actor.User.ID || item.SourceKind == "bookmark" {
		return denied()
	}
	target, e := currentAttentionActorLocked(tx, actor.Company.ID, targetID)
	if e != nil {
		return missing()
	}
	copy := item
	copy.RecipientID = targetID
	if in(item.SourceKind, "record", "bookmark") {
		scope, e := conversationAccess(tx, targetID, item.CompanyID, item.ConversationID)
		if e != nil {
			return missing()
		}
		copy.RecipientEpoch = scope.Epoch
	}
	if _, e := attentionSource(tx, target, copy); e != nil {
		return denied()
	}
	if item.SourceKind == "task" && item.Kind != "task_review" {
		t, e := scopedTask(tx, target, item.SourceID)
		if e != nil {
			return e
		}
		if !(t.OwnerID == targetID || t.ReviewerID == targetID || in(targetID, t.Collaborators...) || target.canStructure(t)) {
			return denied()
		}
	}
	return nil
}
