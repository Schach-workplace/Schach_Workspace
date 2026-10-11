package platform

import (
	"context"
	"gorm.io/gorm"
	"time"
)

type SessionRevocationScope struct {
	Sessions     []SessionRecord
	CompanyID    string
	Departed     bool
	AllGrants    bool
	PreserveHash string
}

// The caller holds the captured session union UPDATE and the principal User
// UPDATE. A login arriving after capture is invalidated by the epoch CAS.
func revokePrincipalSessionsLocked(tx *gorm.DB, uid string, expectedEpoch int64, scope SessionRevocationScope) error {
	if expectedEpoch < 1 {
		return conflict()
	}
	hashes := []string{}
	for _, s := range scope.Sessions {
		if s.UserID == uid && s.TokenHash != scope.PreserveHash {
			hashes = append(hashes, s.TokenHash)
		}
	}
	res := tx.Model(&User{}).Where("id=? AND session_epoch=?", uid, expectedEpoch).Update("session_epoch", expectedEpoch+1)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return conflict()
	}
	if scope.PreserveHash != "" {
		res = tx.Model(&SessionRecord{}).Where("token_hash=? AND user_id=? AND session_epoch=?", scope.PreserveHash, uid, expectedEpoch).Update("session_epoch", expectedEpoch+1)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return unauthenticated()
		}
	}
	if e := revokeSessionCapabilitiesLocked(tx, uid, hashes, scope); e != nil {
		return e
	}
	if len(hashes) > 0 {
		return tx.Where("user_id=? AND token_hash IN ?", uid, hashes).Delete(&SessionRecord{}).Error
	}
	return nil
}

// User UPDATE is held; capability issuers hold User SHARE. All affected calls
// precede any device/grant row, including account-only and device-only cleanup.
func revokeSessionCapabilitiesLocked(tx *gorm.DB, uid string, hashes []string, scope SessionRevocationScope) error {
	var grants []CommunicationCallGrant
	query := tx.Where("user_id=? AND active=?", uid, true)
	if scope.AllGrants {
	} else if scope.Departed {
		query = query.Where("session_hash IN ? OR company_id=?", hashes, scope.CompanyID)
	} else {
		query = query.Where("session_hash IN ?", hashes)
	}
	if e := query.Order("company_id,call_id,id").Find(&grants).Error; e != nil {
		return e
	}
	calls := map[string]CommunicationCall{}
	// Lock calls before devices/grants/job insertion: jobs hold a call FK.
	for _, g := range grants {
		key := g.CompanyID + ":" + g.CallID
		if _, ok := calls[key]; ok {
			continue
		}
		var c CommunicationCall
		if e := lockCommunicationRow(tx, "SHARE").First(&c, "company_id=? AND id=?", g.CompanyID, g.CallID).Error; e != nil {
			return e
		}
		calls[key] = c
	}
	if len(hashes) > 0 {
		if e := tx.Model(&CommunicationDevice{}).Where("user_id=? AND session_hash IN ?", uid, hashes).Updates(map[string]any{"active": false, "push_token": ""}).Error; e != nil {
			return e
		}
	}
	for _, g := range grants {
		res := tx.Model(&CommunicationCallGrant{}).Where("id=? AND active=?", g.ID, true).Update("active", false)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			continue
		}
		if e := enqueueCallJob(tx, calls[g.CompanyID+":"+g.CallID], "RemoveParticipant", g.Identity); e != nil {
			return e
		}
	}
	return nil
}

// Account-only writers take the entire captured session set before User UPDATE.
// They never acquire existing company/membership locks after this point.
func lockAccountWriter(tx *gorm.DB, uid, currentHash string) (User, []SessionRecord, error) {
	var sessions []SessionRecord
	if e := lockCommunicationRow(tx, "UPDATE").Where("user_id=?", uid).Order("token_hash").Find(&sessions).Error; e != nil {
		return User{}, nil, e
	}
	var u User
	if e := lockCommunicationRow(tx, "UPDATE").First(&u, "id=?", uid).Error; e != nil {
		return u, nil, e
	}
	if currentHash != "" {
		found := false
		for _, s := range sessions {
			if s.TokenHash == currentHash && validCurrentSession(s, u) {
				found = true
			}
		}
		if !found {
			return u, nil, unauthenticated()
		}
	}
	return u, sessions, nil
}
func fenceSessionUser(tx *gorm.DB, session SessionRecord, strength string) (User, error) {
	var u User
	if e := lockCommunicationRow(tx, strength).First(&u, "id=?", session.UserID).Error; e != nil {
		return u, unauthenticated()
	}
	if !validCurrentSession(session, u) {
		return u, unauthenticated()
	}
	return u, nil
}

// This adapter retires personal capabilities, never ordinary task/finance/goal
// facts. Source projection and final delivery still reload actual authority.
func invalidatePeopleOutputs(tx *gorm.DB, cid string, before, after map[string]Membership, c MembershipConsequences) error {
	if e := markFinanceReconciliationDirty(tx, cid); e != nil {
		return e
	}
	for _, uid := range c.ScopeChangedUsers {
		if e := tx.Model(&CommunicationInbox{}).Where("company_id=? AND user_id=?", cid, uid).Update("read", true).Error; e != nil {
			return e
		}
		if e := tx.Model(&CommunicationPush{}).Where("company_id=? AND user_id=? AND done=false", cid, uid).Updates(map[string]any{"done": true, "lease_token": "", "lease_until": nil}).Error; e != nil {
			return e
		}
		if e := tx.Model(&ReportDeliveryIntent{}).Where("company_id=? AND recipient_id=? AND state='pending'", cid, uid).Update("state", "cancelled").Error; e != nil {
			return e
		}
		// Epoch-bound personal outputs are retired for consequential scope changes.
		if e := tx.Model(&AttentionItem{}).Where("company_id=? AND recipient_id=? AND state<>'superseded'", cid, uid).Updates(map[string]any{"state": "superseded", "version": gorm.Expr("version+1"), "updated_at": time.Now().UTC()}).Error; e != nil {
			return e
		}
		if e := tx.Model(&AttentionReminder{}).Where("company_id=? AND recipient_id=? AND delivered_at IS NULL AND cancelled_at IS NULL", cid, uid).Update("cancelled_at", time.Now().UTC()).Error; e != nil {
			return e
		}
		if e := tx.Model(&ReportExportJob{}).Where("company_id=? AND recipient_id=? AND state IN ?", cid, uid, []string{"queued", "running", "ready"}).Updates(map[string]any{"state": "cancelled", "lease_token": "", "lease_until": nil, "failure_code": "access_changed", "updated_at": time.Now().UTC()}).Error; e != nil {
			return e
		}
		if e := tx.Model(&ReportArtifact{}).Where("company_id=? AND recipient_id=? AND state='ready'", cid, uid).Update("state", "revoked").Error; e != nil {
			return e
		}
		if e := tx.Model(&GoalReminderPreference{}).Where("company_id=? AND user_id=?", cid, uid).Updates(map[string]any{"enabled": false, "checked_at": nil}).Error; e != nil {
			return e
		}
	}
	// Definition-backed exports are capabilities of both owner and recipient.
	// Retire the owner's complete output set under the same Company fence; a
	// later rejoin cannot restore it, and independent snapshots remain untouched.
	definitions := tx.Model(&SavedReportDefinition{}).Select("id").Where("company_id=? AND owner_id IN ?", cid, c.ScopeChangedUsers)
	ownedJobs := tx.Model(&ReportExportJob{}).Select("id").Where("company_id=? AND definition_id IN (?)", cid, definitions)
	if e := tx.Model(&ReportArtifact{}).Where("company_id=? AND job_id IN (?) AND state='ready'", cid, ownedJobs).Update("state", "revoked").Error; e != nil {
		return e
	}
	if e := tx.Model(&ReportDeliveryIntent{}).Where("company_id=? AND job_id IN (?) AND state='pending'", cid, ownedJobs).Update("state", "cancelled").Error; e != nil {
		return e
	}
	if e := tx.Model(&ReportExportJob{}).Where("company_id=? AND definition_id IN (?) AND state IN ?", cid, definitions, []string{"queued", "running", "ready"}).Updates(map[string]any{"state": "cancelled", "failure_code": "access_changed", "lease_token": "", "lease_until": nil, "updated_at": time.Now().UTC()}).Error; e != nil {
		return e
	}
	for _, uid := range c.DepartedUsers {
		definitions := tx.Model(&SavedReportDefinition{}).Select("id").Where("company_id=? AND owner_id=?", cid, uid)
		if e := tx.Model(&ReportSchedule{}).Where("company_id=? AND definition_id IN (?) AND state='active'", cid, definitions).Updates(map[string]any{"state": "paused", "version": gorm.Expr("version+1")}).Error; e != nil {
			return e
		}
	}
	return nil
}

// Predeclare the batch union before any callback can mutate intervals, devices,
// grants or job foreign keys. Reentrant per-principal cleanup never widens it.
func prelockPeopleRevocationSources(tx *gorm.DB, cid string, users []string) error {
	var conversations []Conversation
	if e := lockCommunicationRow(tx, "UPDATE").Where("company_id=? AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.company_id=conversations.company_id AND cm.conversation_id=conversations.id AND cm.user_id IN ? AND cm.active=true)", cid, users).Order("company_id,id").Find(&conversations).Error; e != nil {
		return e
	}
	return prelockPrincipalCalls(tx, users)
}
func prelockPrincipalCalls(tx *gorm.DB, users []string) error {
	var calls []CommunicationCall
	return lockCommunicationRow(tx, "SHARE").Where("EXISTS (SELECT 1 FROM communication_call_grants g WHERE g.call_id=communication_calls.id AND g.company_id=communication_calls.company_id AND g.user_id IN ? AND g.active=true)", users).Order("company_id,id").Find(&calls).Error
}

// Expiry cleanup is an account-only transaction, never nested beneath a company
// automation's User SHARE fence. Live independent sessions keep their epoch.
func (s *Server) cleanExpiredSessions(ctx context.Context, now time.Time) error {
	var users []string
	if e := s.db.WithContext(ctx).Model(&SessionRecord{}).Where("expires_at<=?", now).Distinct("user_id").Order("user_id").Limit(100).Pluck("user_id", &users).Error; e != nil {
		return e
	}
	for _, uid := range users {
		if e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var sessions []SessionRecord
			if e := lockCommunicationRow(tx, "UPDATE").Where("user_id=? AND expires_at<=?", uid, now).Order("token_hash").Limit(100).Find(&sessions).Error; e != nil {
				return e
			}
			if len(sessions) == 0 {
				return nil
			}
			var user User
			if e := lockCommunicationRow(tx, "UPDATE").First(&user, "id=?", uid).Error; e != nil {
				return e
			}
			hashes := make([]string, 0, len(sessions))
			for _, session := range sessions {
				hashes = append(hashes, session.TokenHash)
			}
			if e := revokeSessionCapabilitiesLocked(tx, uid, hashes, SessionRevocationScope{}); e != nil {
				return e
			}
			return tx.Where("token_hash IN ?", hashes).Delete(&SessionRecord{}).Error
		}); e != nil {
			return e
		}
	}
	return nil
}
