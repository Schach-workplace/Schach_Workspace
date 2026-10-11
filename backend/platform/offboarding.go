package platform

import (
	"errors"
	"gorm.io/gorm"
	"net/http"
	"sort"
)

var errPeopleCompanySetChanged = errors.New("company membership set changed")

func (s *Server) globalOffboard(w http.ResponseWriter, r *http.Request) error {
	actor, hash, e := s.authenticate(r)
	if e != nil {
		return e
	}
	uid := r.PathValue("user")
	if !actor.IsPlatformAdmin || actor.ID == uid {
		return denied()
	}
	for attempt := 0; attempt < 3; attempt++ {
		e = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
			var targetMemberships []Membership
			if e := tx.Where("user_id=?", uid).Order("company_id").Find(&targetMemberships).Error; e != nil {
				return e
			}
			if len(targetMemberships) == 0 {
				return missing()
			}
			companies := []string{}
			known := map[string]bool{}
			for _, m := range targetMemberships {
				companies = append(companies, m.CompanyID)
				known[m.CompanyID] = true
			}
			for _, cid := range companies {
				if e := lockCompany(tx, cid); e != nil {
					return e
				}
			}
			var sessions []SessionRecord
			if e := lockCommunicationRow(tx, "UPDATE").Where("user_id=? OR token_hash=?", uid, hash).Order("token_hash").Find(&sessions).Error; e != nil {
				return e
			}
			var members []Membership
			if e := lockCommunicationRow(tx, "UPDATE").Where("company_id IN ?", companies).Order("company_id,user_id").Find(&members).Error; e != nil {
				return e
			}
			ids := map[string]bool{uid: true, actor.ID: true}
			for _, m := range members {
				ids[m.UserID] = true
			}
			order := []string{}
			for id := range ids {
				order = append(order, id)
			}
			sort.Strings(order)
			users := map[string]User{}
			for _, id := range order {
				var u User
				mode := "SHARE"
				if id == uid {
					mode = "UPDATE"
				}
				if e := lockCommunicationRow(tx, mode).First(&u, "id=?", id).Error; e != nil {
					return e
				}
				users[id] = u
			}
			current := users[actor.ID]
			var actorSession SessionRecord
			for _, row := range sessions {
				if row.TokenHash == hash {
					actorSession = row
				}
			}
			if !current.IsPlatformAdmin || !validCurrentSession(actorSession, current) {
				return unauthenticated()
			}
			if e := tx.Where("user_id=?", uid).Order("company_id").Find(&targetMemberships).Error; e != nil {
				return e
			}
			for _, m := range targetMemberships {
				if !known[m.CompanyID] {
					return errPeopleCompanySetChanged
				}
			}
			// Predeclare every conversation before the first dependent interval/event.
			var conversations []Conversation
			if e := lockCommunicationRow(tx, "UPDATE").Where("company_id IN ? AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.company_id=conversations.company_id AND cm.conversation_id=conversations.id AND cm.user_id=? AND cm.active=?)", companies, uid, true).Order("company_id,id").Find(&conversations).Error; e != nil {
				return e
			}
			if e := prelockPrincipalCalls(tx, []string{uid}); e != nil {
				return e
			}
			for _, member := range targetMemberships {
				if !member.Active {
					continue
				}
				if member.Role == "founder" {
					founders := 0
					for _, m := range members {
						if m.CompanyID == member.CompanyID && m.UserID != uid && m.Active && m.Role == "founder" {
							founders++
						}
					}
					if founders == 0 {
						return invalid("Transfer company ownership before global offboarding.")
					}
				}
				var owned int64
				if e := tx.Model(&ConversationMember{}).Joins("JOIN conversations c ON c.id=conversation_members.conversation_id AND c.company_id=conversation_members.company_id").Where("conversation_members.company_id=? AND conversation_members.user_id=? AND conversation_members.role=? AND conversation_members.active=? AND c.archived=?", member.CompanyID, uid, "owner", true, false).Count(&owned).Error; e != nil {
					return e
				}
				if owned > 0 {
					return invalid("Transfer or archive owned conversations before global offboarding.")
				}
				if e := revokeCompanyConversations(tx, member.CompanyID, uid); e != nil {
					return e
				}
				result := tx.Model(&Membership{}).Where("id=? AND version=?", member.ID, member.Version).Updates(map[string]any{"active": false, "version": member.Version + 1, "access_epoch": member.AccessEpoch + 1})
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return conflict()
				}
				if e := tx.Model(&Company{}).Where("id=?", member.CompanyID).Update("permission_epoch", gorm.Expr("permission_epoch + 1")).Error; e != nil {
					return e
				}
				if e := invalidatePeopleOutputs(tx, member.CompanyID, nil, nil, MembershipConsequences{ScopeChangedUsers: []string{uid}, DepartedUsers: []string{uid}}); e != nil {
					return e
				}
				if e := audit(tx, member.CompanyID, "", actor.ID, "global_offboarding", uid+": access revoked. Handover not performed."); e != nil {
					return e
				}
			}
			if e := revokePrincipalSessionsLocked(tx, uid, users[uid].SessionEpoch, SessionRevocationScope{Sessions: sessions, AllGrants: true}); e != nil {
				return e
			}
			return tx.Model(&User{}).Where("id=?", uid).Update("suspended", true).Error
		})
		if !errors.Is(e, errPeopleCompanySetChanged) {
			break
		}
	}
	if errors.Is(e, errPeopleCompanySetChanged) {
		return conflict()
	}
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": uid, "handoverStatus": "not_performed"})
}
