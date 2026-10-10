package platform

import (
	"gorm.io/gorm"
	"net/http"
	"sort"
	"time"
)

func (s *Server) globalOffboard(w http.ResponseWriter, r *http.Request) error {
	actor, _, e := s.authenticate(r)
	if e != nil {
		return e
	}
	if !actor.IsPlatformAdmin || actor.ID == r.PathValue("user") {
		return denied()
	}
	uid := r.PathValue("user")
	e = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var memberships []Membership
		if e := tx.Where("user_id=?", uid).Order("company_id").Find(&memberships).Error; e != nil {
			return e
		}
		if len(memberships) == 0 {
			return missing()
		}
		companies := []string{}
		for _, m := range memberships {
			companies = append(companies, m.CompanyID)
		}
		sort.Strings(companies)
		for _, cid := range companies {
			if e := lockCompany(tx, cid); e != nil {
				return e
			}
		}
		var currentActor User
		if e := lockCommunicationRow(tx, "SHARE").First(&currentActor, "id=? AND suspended=? AND is_platform_admin=?", actor.ID, false, true).Error; e != nil {
			return denied()
		}
		actorToken, e := sessionToken(r)
		if e != nil {
			return e
		}
		var actorSession SessionRecord
		if e := lockCommunicationRow(tx, "SHARE").First(&actorSession, "token_hash=? AND expires_at>?", hashToken(actorToken), time.Now().UTC()).Error; e != nil {
			return denied()
		}
		var user User
		if e := lockCommunicationRow(tx, "UPDATE").First(&user, "id=?", uid).Error; e != nil {
			return missing()
		}
		var sessions []SessionRecord
		if e := lockCommunicationRow(tx, "UPDATE").Where("user_id=?", uid).Order("token_hash").Find(&sessions).Error; e != nil {
			return e
		}
		if e := lockCommunicationRow(tx, "UPDATE").Where("user_id=?", uid).Order("company_id,user_id").Find(&memberships).Error; e != nil {
			return e
		}
		for _, member := range memberships {
			if !member.Active {
				continue
			}
			if member.Role == "founder" {
				var count int64
				if e := tx.Model(&Membership{}).Where("company_id=? AND role=? AND active=? AND user_id<>?", member.CompanyID, "founder", true, uid).Count(&count).Error; e != nil {
					return e
				}
				if count == 0 {
					return invalid("Transfer company ownership before global offboarding.")
				}
			}
			var count int64
			if e := tx.Model(&ConversationMember{}).Joins("JOIN conversations c ON c.id=conversation_members.conversation_id AND c.company_id=conversation_members.company_id").Where("conversation_members.company_id=? AND conversation_members.user_id=? AND conversation_members.role=? AND conversation_members.active=? AND c.archived=?", member.CompanyID, uid, "owner", true, false).Count(&count).Error; e != nil {
				return e
			}
			if count > 0 {
				return invalid("Transfer or archive owned conversations before global offboarding.")
			}
			if e := revokeCompanyConversations(tx, member.CompanyID, uid); e != nil {
				return e
			}
			if e := tx.Model(&Membership{}).Where("id=?", member.ID).Update("active", false).Error; e != nil {
				return e
			}
			if e := audit(tx, member.CompanyID, "", actor.ID, "global_offboarding", uid+" departed; company membership and scoped communication access revoked."); e != nil {
				return e
			}
		}
		if e := tx.Model(&User{}).Where("id=?", uid).Update("suspended", true).Error; e != nil {
			return e
		}
		if e := tx.Model(&CommunicationDevice{}).Where("user_id=?", uid).Update("active", false).Error; e != nil {
			return e
		}
		var grants []CommunicationCallGrant
		if e := tx.Where("user_id=? AND active=?", uid, true).Find(&grants).Error; e != nil {
			return e
		}
		for _, grant := range grants {
			var call CommunicationCall
			if e := tx.First(&call, "id=? AND company_id=?", grant.CallID, grant.CompanyID).Error; e != nil {
				return e
			}
			if e := enqueueCallJob(tx, call, "RemoveParticipant", grant.Identity); e != nil {
				return e
			}
		}
		if e := tx.Model(&CommunicationCallGrant{}).Where("user_id=?", uid).Update("active", false).Error; e != nil {
			return e
		}
		return tx.Where("user_id=?", uid).Delete(&SessionRecord{}).Error
	})
	if e != nil {
		return e
	}
	return ok(w, uid)
}
