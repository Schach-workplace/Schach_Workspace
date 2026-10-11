package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

func peopleGraphFingerprint(a *access) string {
	rows := make([]Membership, 0, len(a.Members))
	for _, m := range a.Members {
		rows = append(rows, m)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].UserID < rows[j].UserID })
	return payloadHash([]any{a.Company.ID, a.Company.Timezone, a.Company.PermissionEpoch, rows})
}
func peopleAdministration(a *access) error {
	if !leadership(a.Member.Role) {
		return denied()
	}
	return nil
}
func scopedPeoplePreset(tx *gorm.DB, a *access, id string, apply bool) (OnboardingPreset, error) {
	var p OnboardingPreset
	if e := peopleAdministration(a); e != nil {
		return p, e
	}
	if e := tx.First(&p, "company_id=? AND id=?", a.Company.ID, id).Error; e != nil {
		return p, missing()
	}
	if rank(p.Membership.Role) > rank(a.Member.Role) || apply && p.Archived {
		return p, missing()
	}
	return p, nil
}
func validatePeopleDefaults(tx *gorm.DB, a *access, d PeopleMembershipDefaults, uid string) error {
	if rank(d.Role) > rank(a.Member.Role) || d.Role == "founder" && a.Member.Role != "founder" {
		return denied()
	}
	return validateMember(tx, a, Membership{CompanyID: a.Company.ID, UserID: uid, Role: d.Role, DepartmentID: d.DepartmentID, ManagerID: d.ManagerID, Title: d.Title, CapacityHours: d.CapacityHours, Active: true})
}
func validatePeoplePreset(tx *gorm.DB, a *access, p OnboardingPreset) error {
	if !clean(p.Name, 160) || len(p.Description) > 4000 || len(p.TemplateIDs) > 20 {
		return invalid("Provide a preset name up to160 characters, description up to4000 and at most20 task templates.")
	}
	if e := validatePeopleDefaults(tx, a, p.Membership, ""); e != nil {
		return e
	}
	seen := map[string]bool{}
	for _, id := range p.TemplateIDs {
		if seen[id] {
			return invalid("Task templates must be unique.")
		}
		seen[id] = true
		t, e := scopedTemplate(tx, a, id, true)
		if e != nil {
			return e
		}
		if t.Kind != "task" {
			return invalid("Presets require task templates.")
		}
	}
	return nil
}
func (s *Server) peopleRoutes() {
	const root = "/api/companies/{cid}/people"
	s.route("GET "+root+"/context", s.peopleContext)
	s.route("GET "+root+"/presets", s.peoplePresetsList)
	s.route("GET "+root+"/presets/{id}", s.peoplePresetRead)
	s.route("POST "+root+"/presets", s.peoplePresetWrite)
	s.route("PATCH "+root+"/presets/{id}", s.peoplePresetWrite)
	s.route("POST "+root+"/onboarding/preview", s.peopleOnboardingPreview)
	s.route("POST "+root+"/onboarding/apply", s.peopleOnboardingApply)
	s.route("POST "+root+"/{id}/departure/preview", s.peopleDeparturePreview)
	s.route("POST "+root+"/{id}/departure/apply", s.peopleDepartureApply)
	s.route("GET "+root+"/departure-previews/{id}", s.peopleDeparturePreviewRead)
	s.route("POST "+root+"/access-reviews/preview", s.peopleReviewPreview)
	s.route("POST "+root+"/access-reviews/{id}/complete", s.peopleReviewComplete)
	s.route("GET "+root+"/access-reviews", s.peopleReviewList)
	s.route("GET "+root+"/access-reviews/{id}", s.peopleReviewRead)
}
func (s *Server) peoplePresetRead(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var p OnboardingPreset
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error { p, e = scopedPeoplePreset(tx, a, r.PathValue("id"), false); return e })
	if e != nil {
		return e
	}
	return respond(w, 200, p)
}
func (s *Server) peoplePresetsList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	rows := []OnboardingPreset{}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		limit, e = strconv.Atoi(v)
		if e != nil || limit < 1 || limit > 100 {
			return invalid("Page size must be1–100.")
		}
	}
	// Cursor binds both current graph and rank-filtered result sequence.
	cursor := r.URL.Query().Get("cursor")
	next := ""
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if e := peopleAdministration(a); e != nil {
			return e
		}
		basis := payloadHash([]any{peopleGraphFingerprint(a), a.User.ID, "people_presets"})
		after := ""
		if cursor != "" {
			parts := strings.SplitN(cursor, ".", 2)
			if len(parts) != 2 || parts[0] != basis {
				return conflict()
			}
			after = parts[1]
		}
		roles := []string{}
		for _, role := range []string{"founder", "ceo", "admin", "finance", "head", "manager", "member", "viewer"} {
			if rank(role) <= rank(a.Member.Role) {
				roles = append(roles, role)
			}
		}
		q := tx.Where("company_id=? AND id>?", a.Company.ID, after)
		if tx.Dialector.Name() == "postgres" {
			q = q.Where("membership->>'role' IN ?", roles)
		} else {
			q = q.Where("json_extract(membership,'$.role') IN ?", roles)
		}
		if e := q.Order("id").Limit(limit + 1).Find(&rows).Error; e != nil {
			return e
		}
		if len(rows) > limit {
			rows = rows[:limit]
			next = basis + "." + rows[len(rows)-1].ID
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"items": rows, "cursor": next, "hasMore": next != ""})
}
func (s *Server) peoplePresetWrite(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var f map[string]json.RawMessage
	if e = decodeBusiness(w, r, &f); e != nil {
		return e
	}
	for key := range f {
		if !in(key, "retryKey", "expectedVersion", "name", "description", "archived", "membership", "templateIds") {
			return invalid("Unknown preset field.")
		}
	}
	key, e := optionalBusinessKey(f)
	if e != nil {
		return e
	}
	delete(f, "retryKey")
	var version int64
	if raw, ok := f["expectedVersion"]; ok {
		if json.Unmarshal(raw, &version) != nil || version < 1 {
			return invalid("A captured positive preset version is required.")
		}
	}
	delete(f, "expectedVersion")
	id := r.PathValue("id")
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var old OnboardingPreset
		authorize := func() error {
			if e := peopleAdministration(a); e != nil {
				return e
			}
			if id != "" {
				var e error
				old, e = scopedPeoplePreset(tx, a, id, false)
				return e
			}
			return nil
		}
		result, e = businessMutation(tx, a, "people_preset", key, []any{id, version, f}, authorize, func(out BusinessResult) error { _, e := scopedPeoplePreset(tx, a, out.IDs[0], false); return e }, func() (BusinessResult, error) {
			p := old
			if id == "" {
				p = OnboardingPreset{ID: newID("preset"), CompanyID: a.Company.ID, Version: 1, TemplateIDs: []string{}, CreatedBy: a.User.ID, CreatedAt: nowString()}
			} else if version != old.Version {
				return BusinessResult{}, conflict()
			}
			if raw, ok := f["membership"]; ok {
				var defaults PeopleMembershipDefaults
				if e := strictJSON(raw, &defaults); e != nil {
					return BusinessResult{}, e
				}
			}
			raw, _ := json.Marshal(f)
			if e := json.Unmarshal(raw, &p); e != nil {
				return BusinessResult{}, invalid("Invalid preset fields.")
			}
			p.Name = strings.TrimSpace(p.Name)
			if e := validatePeoplePreset(tx, a, p); e != nil {
				return BusinessResult{}, e
			}
			p.UpdatedBy = a.User.ID
			p.UpdatedAt = nowString()
			if id == "" {
				if e := tx.Create(&p).Error; e != nil {
					return BusinessResult{}, e
				}
			} else {
				p.Version++
				res := tx.Model(&OnboardingPreset{}).Where("id=? AND version=?", id, version).Select("*").Updates(&p)
				if res.Error != nil {
					return BusinessResult{}, res.Error
				}
				if res.RowsAffected != 1 {
					return BusinessResult{}, conflict()
				}
			}
			if e := audit(tx, a.Company.ID, "", a.User.ID, "people_preset_updated", p.ID+": preset reviewed."); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "people_preset", IDs: []string{p.ID}, Versions: []int64{p.Version}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": result.IDs[0], "version": result.Versions[0]})
}
