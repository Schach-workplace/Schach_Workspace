package platform

import (
	"database/sql"
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"time"
)

func goalReadQuery(tx *gorm.DB, a *access) *gorm.DB {
	q := tx.Model(&Goal{}).Where("company_id=?", a.Company.ID)
	if leadership(a.Member.Role) || a.Member.Role == "viewer" {
		return q
	}
	ids := []string{a.User.ID}
	for id := range a.Members {
		if id != a.User.ID && a.ownsScope(id) {
			ids = append(ids, id)
		}
	}
	if a.Member.Role == "head" && a.Member.DepartmentID != "" {
		return q.Where("owner_id IN ? OR department_id=?", ids, a.Member.DepartmentID)
	}
	return q.Where("owner_id IN ?", ids)
}
func scopedGoal(tx *gorm.DB, a *access, id string) (Goal, error) {
	var g Goal
	e := goalReadQuery(tx, a).Where("id=?", id).First(&g).Error
	if e == gorm.ErrRecordNotFound {
		return g, missing()
	}
	return g, e
}
func canMeasureGoal(a *access, g Goal) bool {
	return a.Member.Role != "viewer" && a.canCreate(g.OwnerID, g.DepartmentID) && (!in(a.Member.Role, "member", "finance") || g.OwnerID == a.User.ID)
}
func measureAuthority(tx *gorm.DB, a *access, g Goal) error {
	if !canMeasureGoal(a, g) {
		return denied()
	}
	if !a.activeUser(g.OwnerID) || !departmentExists(tx, a.Company.ID, g.DepartmentID) {
		return invalid("Transfer inactive ownership before recording a measurement.")
	}
	return nil
}
func filteredGoal(tx *gorm.DB, a *access, g Goal) Goal {
	ids := []string{}
	for _, id := range g.TaskIDs {
		if _, e := scopedTask(tx, a, id); e == nil {
			ids = append(ids, id)
		}
	}
	g.TaskIDs = ids
	return g
}
func normalizeGoalMeasurement(i *GoalMeasurementInput) error {
	if !finite(i.Value) || !clean(i.Reason, 4000) {
		return invalid("Enter a finite measured value and a reason (1–4000 characters).")
	}
	if i.Value == 0 {
		i.Value = 0
	}
	if i.Evidence == nil {
		i.Evidence = []GoalEvidenceInput{}
	}
	if len(i.Evidence) > 50 {
		return invalid("Select at most 50 evidence sources.")
	}
	if i.EffectiveAt == "" && i.CorrectsID != "" {
		return nil
	}
	t, e := time.Parse(time.RFC3339Nano, i.EffectiveAt)
	if e != nil || t.Year() < 1900 || t.Year() > 2200 || t.Nanosecond()%1000 != 0 {
		return invalid("Choose an absolute observation instant from 1900–2200 at exact microsecond precision.")
	}
	i.EffectiveAt = t.UTC().Format(time.RFC3339Nano)
	return nil
}
func recordGoalRevision(tx *gorm.DB, a *access, before, after Goal, reason, action string) error {
	now := time.Now().UTC().Truncate(time.Microsecond)
	if e := tx.Create(&GoalRevision{ID: newID("goalrev"), CompanyID: a.Company.ID, GoalID: after.ID, ActorID: a.User.ID, Reason: reason, CreatedAt: now, Version: after.Version, Before: before, After: after}).Error; e != nil {
		return e
	}
	return tx.Create(&GoalAudit{ID: newID("goalaudit"), CompanyID: a.Company.ID, GoalID: after.ID, ActorID: a.User.ID, Action: action, Version: after.Version, CreatedAt: now}).Error
}
func prepareGoalMeasurement(tx *gorm.DB, a *access, g Goal, i GoalMeasurementInput, version int64) (GoalMeasurement, bool, error) {
	m := GoalMeasurement{ID: newID("measurement"), CompanyID: a.Company.ID, GoalID: g.ID, ActorID: a.User.ID, Value: i.Value, Reason: i.Reason, CorrectsID: i.CorrectsID, CreatedAt: time.Now().UTC().Truncate(time.Microsecond), GoalVersionAfter: version, Unit: g.Unit, Baseline: g.Baseline, Target: g.Target, Evidence: []GoalEvidenceBinding{}}
	current := true
	if i.CorrectsID != "" {
		var target GoalMeasurement
		if e := tx.Where("id=? AND company_id=? AND goal_id=?", i.CorrectsID, a.Company.ID, g.ID).First(&target).Error; e != nil {
			return m, false, missing()
		}
		var n int64
		if e := tx.Model(&GoalMeasurement{}).Where("company_id=? AND goal_id=? AND corrects_id=?", a.Company.ID, g.ID, target.ID).Count(&n).Error; e != nil {
			return m, false, e
		}
		if n > 0 {
			return m, false, conflict()
		}
		if i.EffectiveAt != "" && i.EffectiveAt != target.EffectiveAt.UTC().Format(time.RFC3339Nano) {
			return m, false, invalid("Corrections inherit the original observation instant.")
		}
		m.EffectiveAt = target.EffectiveAt
		m.Unit = target.Unit
		m.Baseline = target.Baseline
		m.Target = target.Target
		current = g.CurrentMeasurementID == target.ID
	} else {
		at, e := time.Parse(time.RFC3339Nano, i.EffectiveAt)
		if e != nil || at.After(time.Now().UTC()) {
			return m, false, invalid("Observation cannot be in the future.")
		}
		m.EffectiveAt = at
		if g.CurrentMeasurementID != "" {
			var prior GoalMeasurement
			if e := tx.First(&prior, "id=? AND company_id=? AND goal_id=?", g.CurrentMeasurementID, a.Company.ID, g.ID).Error; e != nil {
				return m, false, e
			}
			if at.Before(prior.EffectiveAt) {
				return m, false, invalid("Correct the relevant history entry instead of rewinding the current observation.")
			}
		}
	}
	var e error
	m.Evidence, e = bindGoalEvidence(tx, a, g, i.Evidence)
	return m, current, e
}
func appendGoalMeasurement(tx *gorm.DB, a *access, g *Goal, i GoalMeasurementInput) (GoalMeasurement, error) {
	var m GoalMeasurement
	if e := measureAuthority(tx, a, *g); e != nil {
		return m, e
	}
	if g.Version != i.ExpectedVersion {
		return m, conflict()
	}
	before := *g
	var current bool
	var e error
	m, current, e = prepareGoalMeasurement(tx, a, *g, i, g.Version+1)
	if e != nil {
		return m, e
	}
	if e = tx.Create(&m).Error; e != nil {
		return m, e
	}
	if current {
		g.Current = m.Value
		g.CurrentMeasurementID = m.ID
	}
	g.Version++
	result := tx.Model(&Goal{}).Where("id=? AND company_id=? AND version=?", g.ID, g.CompanyID, before.Version).Select("*").Updates(g)
	if result.Error != nil {
		return m, result.Error
	}
	if result.RowsAffected != 1 {
		return m, conflict()
	}
	if e = recordGoalRevision(tx, a, before, *g, i.Reason, "measurement"); e != nil {
		return m, e
	}
	return m, nil
}
func authorizeGoalResult(tx *gorm.DB, a *access, result BusinessResult) error {
	if len(result.IDs) == 0 {
		return missing()
	}
	g, e := scopedGoal(tx, a, result.IDs[0])
	if e != nil {
		return e
	}
	if e := measureAuthority(tx, a, g); e != nil {
		return e
	}
	if len(result.IDs) > 1 && result.IDs[1] != "" {
		var m GoalMeasurement
		if e := tx.First(&m, "id=? AND company_id=? AND goal_id=?", result.IDs[1], a.Company.ID, g.ID).Error; e != nil {
			return missing()
		}
		for _, b := range m.Evidence {
			if e := authorizeStoredGoalEvidence(tx, a, b); e != nil {
				return e
			}
		}
	}
	return nil
}
func goalMutationResponse(tx *gorm.DB, a *access, result BusinessResult) (map[string]any, error) {
	if e := authorizeGoalResult(tx, a, result); e != nil {
		return nil, e
	}
	var revision GoalRevision
	if e := tx.Where("company_id=? AND goal_id=? AND version=?", a.Company.ID, result.IDs[0], result.Versions[0]).First(&revision).Error; e != nil {
		return nil, e
	}
	mid := ""
	if len(result.IDs) > 1 {
		mid = result.IDs[1]
	}
	return map[string]any{"ok": true, "id": result.IDs[0], "goalVersion": result.Versions[0], "measurementId": mid, "current": revision.After.Current, "currentMeasurementId": revision.After.CurrentMeasurementID}, nil
}
func (s *Server) goalMeasurement(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input GoalMeasurementInput
	if e = decode(w, r, &input); e != nil {
		return e
	}
	if e = normalizeGoalMeasurement(&input); e != nil {
		return e
	}
	id := r.PathValue("id")
	var response map[string]any
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var g Goal
		authorize := func() error {
			var e error
			g, e = scopedGoal(tx, a, id)
			if e != nil {
				return e
			}
			if e = measureAuthority(tx, a, g); e != nil {
				return e
			}
			return goalEvidenceAuthority(tx, a, g, input.Evidence)
		}
		result, e := businessMutation(tx, a, "goal_measurement", input.RetryKey, []any{id, input}, authorize, func(result BusinessResult) error { return authorizeGoalResult(tx, a, result) }, func() (BusinessResult, error) {
			m, e := appendGoalMeasurement(tx, a, &g, input)
			return BusinessResult{Kind: "goal_measurement", IDs: []string{id, m.ID}, Versions: []int64{g.Version}}, e
		})
		if e != nil {
			return e
		}
		response, e = goalMutationResponse(tx, a, result)
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, response)
}
func goalMetadataFields(f map[string]json.RawMessage) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, k := range []string{"name", "description", "ownerId", "departmentId", "unit", "baseline", "target", "dueDate", "taskIds"} {
		if v, ok := f[k]; ok {
			out[k] = v
		}
	}
	return out
}
func validateGoalMetadata(tx *gorm.DB, a *access, g Goal, links bool) error {
	if !clean(g.Name, 160) || !clean(g.Unit, 60) || len(g.Description) > 8000 || !finite(g.Baseline) || !finite(g.Target) || !finite(g.Current) || g.Target == g.Baseline || !validDate(g.DueDate) {
		return invalid("Goal name, unit, finite values, distinct target and valid date are required.")
	}
	if !a.activeUser(g.OwnerID) || !departmentExists(tx, a.Company.ID, g.DepartmentID) {
		return invalid("Choose an active owner and current department.")
	}
	if !a.canCreate(g.OwnerID, g.DepartmentID) {
		return denied()
	}
	if len(g.TaskIDs) > 500 {
		return invalid("Link at most 500 currently readable tasks.")
	}
	if links {
		for _, id := range g.TaskIDs {
			if _, e := scopedTask(tx, a, id); e != nil {
				return missing()
			}
		}
	}
	return nil
}
func (s *Server) saveGoal(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "name", "description", "ownerId", "departmentId", "unit", "baseline", "target", "current", "dueDate", "taskIds", "retryKey", "version", "reason", "effectiveAt", "measurementReason", "evidence", "initialMeasurement")
	if e != nil {
		return e
	}
	key, e := optionalBusinessKey(f)
	if e != nil {
		return e
	}
	update := r.Method == "PATCH"
	id := r.PathValue("id")
	metadata := goalMetadataFields(f)
	var version int64
	var reason string
	json.Unmarshal(f["version"], &version)
	json.Unmarshal(f["reason"], &reason)
	var measurement *GoalMeasurementInput
	if _, ok := f["current"]; ok {
		m := GoalMeasurementInput{ExpectedVersion: version, RetryKey: key}
		if json.Unmarshal(f["current"], &m.Value) != nil {
			return invalid("Invalid current value.")
		}
		json.Unmarshal(f["effectiveAt"], &m.EffectiveAt)
		json.Unmarshal(f["measurementReason"], &m.Reason)
		if v, ok := f["evidence"]; ok && json.Unmarshal(v, &m.Evidence) != nil {
			return invalid("Invalid evidence.")
		}
		if e = normalizeGoalMeasurement(&m); e != nil {
			return e
		}
		measurement = &m
	}
	if !update {
		if _, ok := f["current"]; ok {
			return invalid("Use an explicit initial measurement.")
		}
		var m GoalMeasurementInput
		raw, ok := f["initialMeasurement"]
		if !ok {
			return invalid("Provide an initial measured observation and reason.")
		}
		if json.Unmarshal(raw, &m) != nil {
			return invalid("Invalid initial observation.")
		}
		if e = normalizeGoalMeasurement(&m); e != nil {
			return e
		}
		if m.CorrectsID != "" {
			return invalid("An initial observation cannot correct an earlier fact.")
		}
		measurement = &m
	}
	if update && !clean(reason, 4000) {
		return invalid("Explain the goal update.")
	}
	if measurement != nil {
		b, _ := json.Marshal(measurement)
		f["normalizedMeasurement"] = b
		delete(f, "current")
		delete(f, "effectiveAt")
		delete(f, "measurementReason")
		delete(f, "initialMeasurement")
		delete(f, "evidence")
	}
	var response map[string]any
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var old, candidate Goal
		authorize := func() error {
			if a.Member.Role == "viewer" {
				return denied()
			}
			candidate = Goal{CompanyID: a.Company.ID, Version: 1, TaskIDs: []string{}}
			if update {
				var e error
				old, e = scopedGoal(tx, a, id)
				if e != nil {
					return e
				}
				if e = measureAuthority(tx, a, old); e != nil {
					return e
				}
				candidate = old
			}
			if in(a.Member.Role, "member", "finance") {
				if !update || len(metadata) > 0 {
					return denied()
				}
			}
			if e := applyFields(metadata, &candidate); e != nil {
				return e
			}
			if candidate.TaskIDs == nil {
				candidate.TaskIDs = []string{}
			}
			if !a.canCreate(candidate.OwnerID, candidate.DepartmentID) {
				return denied()
			}
			if measurement != nil {
				return goalEvidenceAuthority(tx, a, candidate, measurement.Evidence)
			}
			return nil
		}
		operation := "goal_create"
		if update {
			operation = "goal_update"
		}
		result, e := businessMutation(tx, a, operation, key, []any{id, f}, authorize, func(result BusinessResult) error { return authorizeGoalResult(tx, a, result) }, func() (BusinessResult, error) {
			if update && old.Version != version {
				return BusinessResult{}, conflict()
			}
			if e := validateGoalMetadata(tx, a, candidate, f["taskIds"] != nil || !update); e != nil {
				return BusinessResult{}, e
			}
			if update && candidate.Unit != old.Unit && measurement == nil {
				return BusinessResult{}, invalid("Unit changes require an explicit new measurement in that unit.")
			}
			mid := ""
			if !update {
				candidate.ID = newID("goal")
				now := time.Now().UTC().Truncate(time.Microsecond)
				candidate.MeasurementCoverageFrom = &now
				m, current, e := prepareGoalMeasurement(tx, a, candidate, *measurement, 1)
				if e != nil {
					return BusinessResult{}, e
				}
				if !current {
					return BusinessResult{}, invalid("Initial observation must be current.")
				}
				candidate.Current = m.Value
				candidate.CurrentMeasurementID = m.ID
				if e = tx.Create(&candidate).Error; e != nil {
					return BusinessResult{}, e
				}
				if e = tx.Create(&m).Error; e != nil {
					return BusinessResult{}, e
				}
				mid = m.ID
				if e = recordGoalRevision(tx, a, Goal{}, candidate, m.Reason, "created"); e != nil {
					return BusinessResult{}, e
				}
			} else {
				candidate.Version = old.Version + 1
				if measurement != nil {
					m, current, e := prepareGoalMeasurement(tx, a, candidate, *measurement, candidate.Version)
					if e != nil {
						return BusinessResult{}, e
					}
					if current {
						candidate.Current = m.Value
						candidate.CurrentMeasurementID = m.ID
					}
					if e = tx.Create(&m).Error; e != nil {
						return BusinessResult{}, e
					}
					mid = m.ID
				}
				res := tx.Model(&Goal{}).Where("id=? AND company_id=? AND version=?", candidate.ID, candidate.CompanyID, old.Version).Select("*").Updates(&candidate)
				if res.Error != nil {
					return BusinessResult{}, res.Error
				}
				if res.RowsAffected != 1 {
					return BusinessResult{}, conflict()
				}
				if e = recordGoalRevision(tx, a, old, candidate, reason, "updated"); e != nil {
					return BusinessResult{}, e
				}
			}
			return BusinessResult{Kind: operation, IDs: []string{candidate.ID, mid}, Versions: []int64{candidate.Version}}, nil
		})
		if e != nil {
			return e
		}
		response, e = goalMutationResponse(tx, a, result)
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, response)
}
func (s *Server) goalsList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := planningLimit(r)
	if e != nil {
		return e
	}
	rows := []Goal{}
	cursor := ""
	more := false
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		basis := payloadHash([]any{accessBasis(a), "goals"})
		c := readCursor{}
		if r.URL.Query().Get("cursor") != "" {
			c, e = decodeReadCursor(r.URL.Query().Get("cursor"), basis)
			if e != nil {
				return e
			}
		}
		q := goalReadQuery(tx, a)
		if c.ID != "" {
			q = q.Where("id>?", c.ID)
		}
		if e = q.Order("id").Limit(limit + 1).Find(&rows).Error; e != nil {
			return e
		}
		more = len(rows) > limit
		if more {
			rows = rows[:limit]
			cursor = encodeReadCursor(readCursor{Basis: basis, ID: rows[len(rows)-1].ID})
		}
		for i, g := range rows {
			rows[i] = filteredGoal(tx, a, g)
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"goals": rows, "cursor": cursor, "hasMore": more})
}
func (s *Server) goalDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	out := map[string]any{}
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		g, e := scopedGoal(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		var attainment *float64
		if finite(g.Current) && finite(g.Target) && finite(g.Baseline) && g.Target != g.Baseline {
			v := (g.Current - g.Baseline) / (g.Target - g.Baseline) * 100
			if v < 0 {
				v = 0
			}
			if v > 100 {
				v = 100
			}
			attainment = &v
		}
		out = map[string]any{"goal": filteredGoal(tx, a, g), "canMeasure": canMeasureGoal(a, g) && a.activeUser(g.OwnerID), "canEdit": canMeasureGoal(a, g) && !in(a.Member.Role, "member", "finance"), "attainment": attainment, "readBasis": accessBasis(a)}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, out)
}
func goalMeasurementView(tx *gorm.DB, a *access, m GoalMeasurement) map[string]any {
	b, _ := json.Marshal(m)
	out := map[string]any{}
	json.Unmarshal(b, &out)
	name := "Former actor"
	if u, ok := a.Users[m.ActorID]; ok && a.Members[m.ActorID].Active && (a.ownsScope(m.ActorID) || m.ActorID == a.User.ID) {
		name = u.Name
	}
	out["actorName"] = name
	evidence := []map[string]any{}
	for _, binding := range m.Evidence {
		evidence = append(evidence, projectGoalEvidence(tx, a, binding))
	}
	out["evidence"] = evidence
	return out
}
func (s *Server) goalHistory(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := planningLimit(r)
	if e != nil {
		return e
	}
	rows := []map[string]any{}
	cursor := ""
	more := false
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		g, e := scopedGoal(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		basis := payloadHash([]any{accessBasis(a), g.ID, g.Version, "history"})
		c := readCursor{}
		if r.URL.Query().Get("cursor") != "" {
			c, e = decodeReadCursor(r.URL.Query().Get("cursor"), basis)
			if e != nil {
				return e
			}
		}
		q := tx.Model(&GoalMeasurement{}).Where("company_id=? AND goal_id=?", a.Company.ID, g.ID)
		if c.ID != "" {
			var after GoalMeasurement
			if e := tx.First(&after, "id=? AND company_id=? AND goal_id=?", c.ID, a.Company.ID, g.ID).Error; e != nil {
				return missing()
			}
			q = q.Where("goal_version_after<? OR (goal_version_after=? AND id>?)", after.GoalVersionAfter, after.GoalVersionAfter, after.ID)
		}
		var ms []GoalMeasurement
		if e = q.Order("goal_version_after DESC,id").Limit(limit + 1).Find(&ms).Error; e != nil {
			return e
		}
		more = len(ms) > limit
		if more {
			ms = ms[:limit]
			cursor = encodeReadCursor(readCursor{Basis: basis, ID: ms[len(ms)-1].ID})
		}
		for _, m := range ms {
			rows = append(rows, goalMeasurementView(tx, a, m))
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"measurements": rows, "cursor": cursor, "hasMore": more})
}

func migrateGoalMeasurements(db *gorm.DB) error {
	if e := db.Exec("UPDATE goals SET version=1,measurement_coverage_from=?,legacy_observed_current=current,legacy_observed_unit=unit WHERE measurement_coverage_from IS NULL AND current_measurement_id = ?", time.Now().UTC().Truncate(time.Microsecond), "").Error; e != nil {
		return e
	}
	return db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS goal_correction_leaf ON goal_measurements(company_id,goal_id,corrects_id) WHERE corrects_id <> ''").Error
}
