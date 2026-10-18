package platform

import (
	"database/sql"
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
)

func (s *Server) developmentRoutes() {
	b := "/api/companies/{cid}/growth"
	s.route("GET "+b+"/catalog", s.developmentCatalog)
	s.route("GET "+b+"/plans", s.developmentList)
	s.route("GET "+b+"/plans/{id}", s.developmentDetail)
	s.route("POST "+b+"/plans", s.developmentSave)
	s.route("PATCH "+b+"/plans/{id}", s.developmentSave)
	s.route("POST "+b+"/plans/{id}/reviews", s.developmentReview)
}
func developmentReadQuery(tx *gorm.DB, a *access) *gorm.DB {
	q := tx.Model(&DevelopmentPlan{}).Where("company_id=?", a.Company.ID)
	if a.Member.Role == "viewer" {
		return q.Where("owner_id=?", a.User.ID)
	}
	return q.Where("owner_id=? OR mentor_id=?", a.User.ID, a.User.ID)
}
func scopedDevelopment(tx *gorm.DB, a *access, id string) (DevelopmentPlan, error) {
	var p DevelopmentPlan
	e := developmentReadQuery(tx, a).Where("id=?", id).First(&p).Error
	if e == gorm.ErrRecordNotFound {
		return p, missing()
	}
	return p, e
}
func developmentAuthority(a *access, p DevelopmentPlan, review bool) error {
	if a.Member.Role == "viewer" {
		return denied()
	}
	if review {
		if p.MentorID != a.User.ID || p.OwnerID == a.User.ID {
			return denied()
		}
	} else if p.OwnerID != a.User.ID {
		return denied()
	}
	return nil
}
func validateDevelopment(a *access, p DevelopmentPlan) error {
	if !clean(p.Title, 160) || !clean(p.CareerRole, 120) || !clean(p.Objective, 4000) || len(p.EvidenceNote) > 8000 || !in(p.State, "active", "archived") {
		return invalid("Supply a title, career role, objective, bounded narrative and valid state.")
	}
	var pilot *DevelopmentPilot
	for _, v := range developmentCatalog() {
		if v.ID == p.Pilot {
			v := v
			pilot = &v
		}
	}
	if pilot == nil || !in(p.CareerLevel, pilot.Levels...) {
		return invalid("Choose a pilot and career level from the catalog.")
	}
	if len(p.CompetencyIDs) < 1 || len(p.CompetencyIDs) > 12 || len(p.LearningActions) > 20 {
		return invalid("Choose 1–12 competencies and at most 20 learning actions.")
	}
	seen := map[string]bool{}
	for _, id := range p.CompetencyIDs {
		found := false
		for _, c := range pilot.Competencies {
			if c.ID == id {
				found = true
			}
		}
		if !found || seen[id] {
			return invalid("Choose distinct competencies from the selected pilot.")
		}
		seen[id] = true
	}
	for _, v := range p.LearningActions {
		if !clean(v, 1000) {
			return invalid("Learning actions must contain 1–1000 characters.")
		}
	}
	if p.MentorID != "" && (p.MentorID == p.OwnerID || !a.activeUser(p.MentorID) || a.Members[p.MentorID].Role == "viewer") {
		return invalid("Choose an active, independent mentor in this company.")
	}
	return nil
}
func (s *Server) developmentCatalog(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error { return nil })
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"pilots": developmentCatalog()})
}
func (s *Server) developmentList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := planningLimit(r)
	if e != nil {
		return e
	}
	rows := []DevelopmentPlan{}
	cursor := ""
	more := false
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		// Bind pagination to current participant sharing as well as membership
		// authority. A mentor replacement must invalidate an already issued page.
		var visible []struct {
			ID       string
			Version  int64
			MentorID string
		}
		if err := developmentReadQuery(tx, a).Select("id,version,mentor_id").Order("id").Find(&visible).Error; err != nil {
			return err
		}
		basis := payloadHash([]any{accessBasis(a), "development", visible})
		c := readCursor{}
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			var err error
			c, err = decodeReadCursor(raw, basis)
			if err != nil {
				return err
			}
		}
		q := developmentReadQuery(tx, a)
		if c.ID != "" {
			q = q.Where("id>?", c.ID)
		}
		if err := q.Order("id").Limit(limit + 1).Find(&rows).Error; err != nil {
			return err
		}
		more = len(rows) > limit
		if more {
			rows = rows[:limit]
			cursor = encodeReadCursor(readCursor{Basis: basis, ID: rows[len(rows)-1].ID})
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"plans": rows, "hasMore": more, "cursor": cursor})
}
func (s *Server) developmentDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	out := map[string]any{}
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		p, e := scopedDevelopment(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		rows := []DevelopmentReview{}
		if e = tx.Where("company_id=? AND plan_id=?", a.Company.ID, p.ID).Order("plan_version,id").Find(&rows).Error; e != nil {
			return e
		}
		out = map[string]any{"plan": p, "reviews": rows, "canEdit": developmentAuthority(a, p, false) == nil, "canReview": developmentAuthority(a, p, true) == nil && p.State == "active"}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, out)
}
func developmentResult(tx *gorm.DB, a *access, result BusinessResult, review bool) error {
	if len(result.IDs) == 0 {
		return missing()
	}
	p, e := scopedDevelopment(tx, a, result.IDs[0])
	if e != nil {
		return e
	}
	return developmentAuthority(a, p, review)
}
func developmentResponse(result BusinessResult) map[string]any {
	out := map[string]any{"id": result.IDs[0], "version": result.Versions[0]}
	if len(result.IDs) > 1 {
		out["reviewId"] = result.IDs[1]
	}
	return out
}
func (s *Server) developmentSave(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedVersion", "pilot", "title", "careerRole", "careerLevel", "competencyIds", "objective", "learningActions", "evidenceNote", "mentorId", "state")
	if e != nil {
		return e
	}
	key, e := optionalBusinessKey(f)
	if e != nil {
		return e
	}
	var version int64
	if raw, ok := f["expectedVersion"]; ok {
		if json.Unmarshal(raw, &version) != nil {
			return invalid("Invalid expected version.")
		}
	}
	update := r.Method == "PATCH"
	if update && version < 1 {
		return invalid("Supply expectedVersion.")
	}
	if !update {
		if _, ok := f["state"]; ok {
			return invalid("New plans start active.")
		}
		if _, ok := f["expectedVersion"]; ok {
			return invalid("New plans have no expectedVersion.")
		}
	}
	id := r.PathValue("id")
	fields := map[string]json.RawMessage{}
	for k, v := range f {
		if k != "retryKey" && k != "expectedVersion" {
			if string(v) == "null" {
				return invalid("Plan fields cannot be null.")
			}
			fields[k] = v
		}
	}
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var old, candidate DevelopmentPlan
		authorize := func() error {
			if a.Member.Role == "viewer" {
				return denied()
			}
			candidate = DevelopmentPlan{CompanyID: a.Company.ID, OwnerID: a.User.ID, Version: 1, DevelopmentFields: DevelopmentFields{State: "active", CompetencyIDs: []string{}, LearningActions: []string{}}}
			if update {
				var err error
				old, err = scopedDevelopment(tx, a, id)
				if err != nil {
					return err
				}
				if err = developmentAuthority(a, old, false); err != nil {
					return err
				}
				candidate = old
			}
			b, _ := json.Marshal(fields)
			if json.Unmarshal(b, &candidate) != nil {
				return invalid("Invalid plan fields.")
			}
			return nil
		}
		operation := "development_create"
		if update {
			operation = "development_update"
		}
		var err error
		result, err = businessMutation(tx, a, operation, key, []any{id, f}, authorize, func(v BusinessResult) error { return developmentResult(tx, a, v, false) }, func() (BusinessResult, error) {
			if err := validateDevelopment(a, candidate); err != nil {
				return BusinessResult{}, err
			}
			if update && old.Version != version {
				return BusinessResult{}, conflict()
			}
			candidate.UpdatedAt = nowString()
			if update {
				candidate.Version = old.Version + 1
				res := tx.Model(&DevelopmentPlan{}).Where("company_id=? AND id=? AND version=?", a.Company.ID, id, version).Select("*").Updates(&candidate)
				if res.Error != nil {
					return BusinessResult{}, res.Error
				}
				if res.RowsAffected != 1 {
					return BusinessResult{}, conflict()
				}
				if candidate.MentorID != old.MentorID {
					// Sharing changed. Advance the existing company scope so
					// cached/queued clients discard former participant data.
					scope := tx.Model(&Company{}).Where("id=? AND permission_epoch=?", a.Company.ID, a.Company.PermissionEpoch).Update("permission_epoch", a.Company.PermissionEpoch+1)
					if scope.Error != nil {
						return BusinessResult{}, scope.Error
					}
					if scope.RowsAffected != 1 {
						return BusinessResult{}, conflict()
					}
					a.Company.PermissionEpoch++
				}
			} else {
				candidate.ID = newID("development")
				candidate.CreatedAt = candidate.UpdatedAt
				if err := tx.Create(&candidate).Error; err != nil {
					return BusinessResult{}, err
				}
			}
			return BusinessResult{Kind: operation, IDs: []string{candidate.ID}, Versions: []int64{candidate.Version}}, nil
		})
		return err
	})
	if e != nil {
		return e
	}
	return respond(w, 200, developmentResponse(result))
}
func (s *Server) developmentReview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey        string `json:"retryKey"`
		ExpectedVersion int64  `json:"expectedVersion"`
		Feedback        string `json:"feedback"`
		NextStep        string `json:"nextStep"`
	}
	if e = decode(w, r, &input); e != nil {
		return e
	}
	if input.ExpectedVersion < 1 || !clean(input.Feedback, 4000) || !clean(input.NextStep, 4000) {
		return invalid("Supply expectedVersion, feedback and next step (1–4000 characters).")
	}
	id := r.PathValue("id")
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var p DevelopmentPlan
		authorize := func() error {
			var err error
			p, err = scopedDevelopment(tx, a, id)
			if err != nil {
				return err
			}
			return developmentAuthority(a, p, true)
		}
		var err error
		result, err = businessMutation(tx, a, "development_review", input.RetryKey, []any{id, input}, authorize, func(v BusinessResult) error { return developmentResult(tx, a, v, true) }, func() (BusinessResult, error) {
			if p.Version != input.ExpectedVersion {
				return BusinessResult{}, conflict()
			}
			if p.State != "active" {
				return BusinessResult{}, invalid("Archived plans cannot receive reviews.")
			}
			review := DevelopmentReview{ID: newID("developmentreview"), CompanyID: a.Company.ID, PlanID: id, MentorID: a.User.ID, Feedback: input.Feedback, NextStep: input.NextStep, PlanVersion: p.Version + 1, CreatedAt: nowString()}
			res := tx.Model(&DevelopmentPlan{}).Where("company_id=? AND id=? AND version=?", a.Company.ID, id, p.Version).Updates(map[string]any{"version": p.Version + 1, "updated_at": review.CreatedAt})
			if res.Error != nil {
				return BusinessResult{}, res.Error
			}
			if res.RowsAffected != 1 {
				return BusinessResult{}, conflict()
			}
			if err := tx.Create(&review).Error; err != nil {
				return BusinessResult{}, err
			}
			return BusinessResult{Kind: "development_review", IDs: []string{id, review.ID}, Versions: []int64{review.PlanVersion}}, nil
		})
		return err
	})
	if e != nil {
		return e
	}
	return respond(w, 200, developmentResponse(result))
}
