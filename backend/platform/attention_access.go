package platform

import (
	"gorm.io/gorm"
	"net/http"
	"net/url"
	"strings"
	"time"
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
func taskAttentionReviewAuthority(a *access, t Task) bool {
	return a.Member.Role != "viewer" && t.OwnerID != a.User.ID && (t.ReviewerID == a.User.ID || leadership(a.Member.Role))
}
func taskAttentionReviewer(a *access, t Task) bool {
	return t.Status == "in_review" && taskAttentionReviewAuthority(a, t)
}
func attentionSource(tx *gorm.DB, a *access, item AttentionItem) (AttentionView, error) {
	return projectAttentionSource(tx, a, item, false)
}

// Replay preserves a committed outcome after obligation completion, with fresh source authority.
func attentionSourceForReplay(tx *gorm.DB, a *access, item AttentionItem) (AttentionView, error) {
	return projectAttentionSource(tx, a, item, true)
}
func projectAttentionSource(tx *gorm.DB, a *access, item AttentionItem, replay bool) (AttentionView, error) {
	v := AttentionView{ID: item.ID, CompanyID: item.CompanyID, RecipientID: item.RecipientID, SourceKind: item.SourceKind, SourceID: item.SourceID, Kind: item.Kind, State: item.State, Version: item.Version, SnoozedUntil: item.SnoozedUntil, DueAt: item.DueAt, Actions: []string{}, RoutePeople: []Person{}, ReminderState: "pending"}
	if item.CompanyID != a.Company.ID || item.RecipientID != a.User.ID || (!replay && item.State == "superseded") || a.User.Suspended {
		return v, missing()
	}
	switch item.SourceKind {
	case "goal":
		var e error
		v, e = projectGoalAttention(tx, a, item, replay, v)
		if e != nil {
			return v, e
		}
	case "finance_extraction", "finance_duplicate", "finance_reconciliation":
		var e error
		v, e = projectFinanceAttention(tx, a, item, replay, v)
		if e != nil {
			return v, e
		}
	case "report_export":
		job, e := authorizeReportExportJob(tx, a, item.SourceID)
		if e != nil {
			return v, e
		}
		if item.Kind != "report_ready" || job.State != "ready" || job.ArtifactID == "" {
			return v, missing()
		}
		var artifact ReportArtifact
		if e := tx.First(&artifact, "id=? AND company_id=? AND recipient_id=?", job.ArtifactID, a.Company.ID, a.User.ID).Error; e != nil || artifact.State != "ready" || !time.Now().UTC().Before(artifact.ExpiresAt) {
			return v, missing()
		}
		v.Title = "Report ready"
		v.SourceVersion = 1
		v.Link = "#report?company=" + url.QueryEscape(a.Company.ID) + "&job=" + url.QueryEscape(job.ID)
	case "task":
		t, e := scopedTask(tx, a, item.SourceID)
		if e != nil {
			return v, e
		}
		if item.Kind == "task_review" && (!taskAttentionReviewAuthority(a, t) || (!replay && t.Status != "in_review")) {
			return v, missing()
		}
		if !replay && item.Kind == "blocker" && t.Status != "blocked" {
			return v, missing()
		}
		if !replay && item.Kind == "deadline" && (in(t.Status, "done", "cancelled") || !strings.HasPrefix(rootAttentionOccurrence(item.OccurrenceKey), "deadline:"+deadlineFingerprint(t)+":")) {
			return v, missing()
		}
		v.Title = t.Title
		v.Summary = t.Description
		v.SourceVersion = t.Version
		v.OwnerName = a.Users[t.OwnerID].Name
		v.CanDecide = taskAttentionReviewer(a, t)
		v.Link = "#tasks?task=" + url.QueryEscape(t.ID)
		v.CanRoute = item.Kind == "task_review" && (v.CanDecide || replay && taskAttentionReviewAuthority(a, t)) || item.Kind != "task_review" && (t.OwnerID == a.User.ID || t.CreatedBy == a.User.ID || a.canStructure(t))
	case "expense":
		e, err := scopedExpense(tx, a, item.SourceID)
		if err != nil {
			return v, err
		}
		if item.Kind == "expense_review" && ((!replay && e.Status != "submitted") || !a.canApproveExpense(e)) {
			return v, missing()
		}
		v.Title = e.Title
		v.SourceVersion = e.Version
		v.OwnerName = a.Users[e.CreatedBy].Name
		v.CanDecide = e.Status == "submitted" && a.canApproveExpense(e)
		v.CanRoute = v.CanDecide || replay && a.canApproveExpense(e)
		v.Link = "#finance?expense=" + url.QueryEscape(e.ID)
	case "intake":
		var i CommunicationRequest
		if e := tx.First(&i, "company_id=? AND id=?", a.Company.ID, item.SourceID).Error; e != nil {
			return v, missing()
		}
		if !a.canReadIntake(i) || item.Kind == "intake_triage" && (!a.canTriageIntake(i) || !replay && i.State != "open") {
			return v, missing()
		}
		v.Title = i.Title
		v.Summary = i.Summary
		v.SourceVersion = i.Version
		v.CanDecide = i.State == "open" && a.canTriageIntake(i)
		v.CanRoute = v.CanDecide || replay && a.canTriageIntake(i)
		v.Link = "#connect?intake=" + url.QueryEscape(i.ID)
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
		v.Link = "#connect?conversation=" + url.QueryEscape(c.ID) + "&message=" + url.QueryEscape(m.ID)
		if item.SourceKind == "bookmark" {
			var b CommunicationBookmark
			if e := tx.First(&b, "company_id=? AND user_id=? AND message_id=?", a.Company.ID, a.User.ID, item.SourceID).Error; e != nil || b.RemindAt == "" || item.OccurrenceKey != bookmarkOccurrence(b.RemindAt, scope.Epoch, m.Revision) {
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
			if !replay && (rec.State != "open" || recipient.Response != "") {
				return v, missing()
			}
			if rec.Kind == "decision" && (a.User.ID != rec.ReviewerID || a.User.ID == rec.CreatedBy) {
				return v, missing()
			}
			v.Link += "&record=" + url.QueryEscape(rec.ID)
			v.Title = rec.Title
			v.Summary = rec.Body
			v.SourceVersion = rec.Revision
			v.CanDecide = rec.State == "open" && recipient.Response == "" && scope.canPost() && rec.Kind == "decision" && rec.ReviewerID == a.User.ID && rec.CreatedBy != a.User.ID
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
	return checkAttentionRoute(tx, actor, item, targetID, false)
}
func checkAttentionRoute(tx *gorm.DB, actor *access, item AttentionItem, targetID string, replay bool) error {
	v, e := projectAttentionSource(tx, actor, item, replay)
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
	if item.SourceKind == "record" {
		var recipient CommunicationRecipient
		if e := tx.First(&recipient, "company_id=? AND record_id=? AND revision=? AND user_id=?", item.CompanyID, item.SourceID, item.RecordRevision, targetID).Error; e != nil {
			return denied()
		}
	}
	if _, e := projectAttentionSource(tx, target, copy, replay); e != nil {
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

// Published intake detail is independent of the private source conversation.
func (s *Server) getPublishedIntake(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var item CommunicationRequest
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if e := tx.First(&item, "company_id=? AND id=?", a.Company.ID, r.PathValue("request")).Error; e != nil {
			return missing()
		}
		if !a.canReadIntake(item) {
			return missing()
		}
		if item.TaskID != "" {
			if _, e := scopedTask(tx, a, item.TaskID); e != nil {
				item.TaskID = ""
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"request": item})
}
func (s *Server) getAttentionRecord(w http.ResponseWriter, r *http.Request) error {
	var record CommunicationRecord
	responses := []CommunicationRecipient{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, a *conversationScope) error {
		var err error
		record, err = s.record(tx, a, r.PathValue("record"))
		if err != nil {
			return err
		}
		source, err := scopedMessage(tx, a, record.AnchorMessageID)
		if err != nil || source.Removed || source.Revision != record.SourceRevision {
			return missing()
		}
		var recipient CommunicationRecipient
		err = tx.First(&recipient, "company_id=? AND record_id=? AND revision=? AND user_id=?", a.CompanyID, record.ID, record.Revision, a.UserID).Error
		if err != nil && record.CreatedBy != a.UserID {
			return missing()
		}
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		if err == nil {
			responses = append(responses, recipient)
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"record": record, "responses": responses})
}

// Reuse only an open target whose exact current source projection is still valid.
func openAttentionTarget(tx *gorm.DB, a *access, item AttentionItem, uid string) (AttentionItem, error) {
	var rows []AttentionItem
	base := rootAttentionOccurrence(item.OccurrenceKey)
	e := tx.Where("company_id=? AND recipient_id=? AND source_kind=? AND source_id=? AND kind=? AND state=? AND (occurrence_key=? OR occurrence_key LIKE ?)", item.CompanyID, uid, item.SourceKind, item.SourceID, item.Kind, "open", base, "%:"+base+":%").Order("created_at,id").Find(&rows).Error
	if e != nil {
		return AttentionItem{}, e
	}
	target := attentionForMember(a, uid)
	for _, candidate := range rows {
		if _, e := attentionSource(tx, target, candidate); e == nil {
			return candidate, nil
		} else if !attentionMissing(e) {
			return AttentionItem{}, e
		}
	}
	return AttentionItem{}, gorm.ErrRecordNotFound
}
