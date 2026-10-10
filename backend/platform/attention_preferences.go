package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"time"
)

func attentionPreference(tx *gorm.DB, cid, uid string) (AttentionPreference, error) {
	p := AttentionPreference{CompanyID: cid, UserID: uid, Version: 1, WorkingDays: []int{}}
	e := tx.First(&p, "company_id=? AND user_id=?", cid, uid).Error
	if e == gorm.ErrRecordNotFound {
		return p, nil
	}
	return p, e
}
func (s *Server) getAttentionPreferences(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var p AttentionPreference
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var err error
		p, err = attentionPreference(tx, a.Company.ID, a.User.ID)
		return err
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"preferences": p})
}
func (s *Server) patchAttentionPreferences(w http.ResponseWriter, r *http.Request) error {
	var raw map[string]json.RawMessage
	if e := decode(w, r, &raw); e != nil {
		return e
	}
	for k, v := range raw {
		if !in(k, "version", "workingHoursEnabled", "workingDays", "workingStart", "workingEnd", "quietStart", "quietEnd", "escalationEnabled", "escalationAfterMinutes", "escalationUserId") || string(v) == "null" {
			return invalid("Unknown or null preference field.")
		}
	}
	var p AttentionPreference
	b, _ := json.Marshal(raw)
	if e := json.Unmarshal(b, &p); e != nil {
		return invalid("Invalid attention preferences.")
	}
	if p.Version < 1 {
		return invalid("A current preference version is required.")
	}
	a, e := s.access(r)
	if e != nil {
		return e
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		old, e := attentionPreference(tx, a.Company.ID, a.User.ID)
		if e != nil {
			return e
		}
		if old.Version != p.Version {
			return conflict()
		}
		if _, e := nextAttentionWindow(p, a.Company.Timezone, time.Now().UTC()); e != nil {
			return e
		}
		if p.EscalationEnabled {
			if p.EscalationAfterMinutes < 1 || p.EscalationAfterMinutes > 90*24*60 || p.EscalationUserID == a.User.ID {
				return invalid("Choose an independent escalation recipient and interval of 1 minute to 90 days.")
			}
			if _, e := currentAttentionActorLocked(tx, a.Company.ID, p.EscalationUserID); e != nil {
				return invalid("Escalation recipient must be an active company member.")
			}
		}
		p.CompanyID = a.Company.ID
		p.UserID = a.User.ID
		p.Version++
		if p.WorkingDays == nil {
			p.WorkingDays = []int{}
		}
		return tx.Save(&p).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"preferences": p})
}
