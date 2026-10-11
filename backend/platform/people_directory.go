package platform

import (
	"gorm.io/gorm"
	"net/http"
	"sort"
)

// Administrative choices use the complete current fenced directory. A bounded
// failure is explicit; a truncated directory cannot masquerade as a full review.
func (s *Server) peopleContext(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	people := []Person{}
	departments := []Department{}
	roles := []string{}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if e := peopleAdministration(a); e != nil {
			return e
		}
		if len(a.Members) > 1000 {
			return invalid("Guided company reviews support at most 1,000 members. Use direct People administration for this company.")
		}
		ids := []string{}
		for id := range a.Members {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			people = append(people, person(a.Users[id], a.Members[id], a.Company.PermissionEpoch))
		}
		for _, role := range []string{"founder", "ceo", "admin", "finance", "head", "manager", "member", "viewer"} {
			if rank(role) <= rank(a.Member.Role) && (role != "founder" || a.Member.Role == "founder") {
				roles = append(roles, role)
			}
		}
		return tx.Where("company_id=?", a.Company.ID).Order("name,id").Find(&departments).Error
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"people": people, "departments": departments, "roles": roles, "readBasis": accessBasis(a), "companyPermissionEpoch": a.Company.PermissionEpoch})
}
