package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"time"
)

type preparedTaskHandover struct {
	Before, After Task
	Fields        map[string]json.RawMessage
}
type preparedGoalHandover struct{ Before, After Goal }
type preparedProjectHandover struct{ Before, After Project }
type preparedMilestoneHandover struct{ Before, After ProjectMilestone }
type preparedDepartmentHandover struct{ Before, After Department }
type preparedDeparture struct {
	Target                      Membership
	Manifest                    departureManifest
	BeforeMembers, AfterMembers map[string]Membership
	Tasks                       []preparedTaskHandover
	Projects                    []preparedProjectHandover
	Milestones                  []preparedMilestoneHandover
	Goals                       []preparedGoalHandover
	Departments                 []preparedDepartmentHandover
}

func prepareDeparture(tx *gorm.DB, a *access, p PeoplePreview) (preparedDeparture, error) {
	result := preparedDeparture{}
	if e := json.Unmarshal(p.Manifest, &result.Manifest); e != nil {
		return result, e
	}
	view, current, e := departureInventory(tx, a, p.TargetUserID, result.Manifest.Replacements)
	if e != nil {
		return result, e
	}
	if p.GraphFingerprint != peopleGraphFingerprint(a) || current.Fingerprint != result.Manifest.Fingerprint {
		return result, conflict()
	}
	if !view.ReadyToApply {
		return result, invalid("Resolve every reviewed responsibility before guided departure. Direct access revocation remains a separate action.")
	}
	result.Target = a.Members[p.TargetUserID]
	result.BeforeMembers = cloneMembers(a.Members)
	result.AfterMembers = cloneMembers(a.Members)
	fields := map[string]map[string]json.RawMessage{}
	for _, r := range result.Manifest.Replacements {
		if r.Kind == "reporting_manager" {
			m := result.AfterMembers[r.SourceID]
			m.ManagerID = r.NewUserID
			result.AfterMembers[r.SourceID] = m
			continue
		}
		if r.Kind == "expense_review_route" {
			continue
		}
		kind := r.Kind[:len(r.Kind)-len("_owner")]
		switch r.Kind {
		case "task_owner", "task_reviewer":
			kind = "task"
		case "milestone_owner", "milestone_reviewer":
			kind = "milestone"
		case "department_head":
			kind = "department"
		}
		key := kind + ":" + r.SourceID
		if fields[key] == nil {
			fields[key] = map[string]json.RawMessage{}
		}
		raw, _ := json.Marshal(r.NewUserID)
		fields[key][departureField(r.Kind)] = raw
	}
	target := result.Target
	target.Active = false
	result.AfterMembers[target.UserID] = target
	for uid, next := range result.AfterMembers {
		old := result.BeforeMembers[uid]
		if !memberChanged(old, next) {
			continue
		}
		f := map[string]json.RawMessage{}
		if old.ManagerID != next.ManagerID {
			f["managerId"], _ = json.Marshal(next.ManagerID)
		}
		if old.Active != next.Active {
			f["active"] = json.RawMessage("false")
		}
		if _, e := prepareMemberPatch(tx, a, old, MemberPatch{ExpectedVersion: old.Version, Fields: f}, result.AfterMembers); e != nil {
			return result, e
		}
	}
	scope := *a
	scope.Members = result.AfterMembers
	keys := []string{}
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	graph := map[string]Task{}
	var allTasks []Task
	if e := tx.Where("company_id=?", a.Company.ID).Find(&allTasks).Error; e != nil {
		return result, e
	}
	for _, t := range allTasks {
		graph[t.ID] = t
	}
	for _, r := range result.Manifest.Replacements {
		if r.Kind == "task_owner" || r.Kind == "task_reviewer" {
			t := graph[r.SourceID]
			if r.Kind == "task_owner" {
				t.OwnerID = r.NewUserID
			} else {
				t.ReviewerID = r.NewUserID
			}
			graph[t.ID] = t
		}
	}
	for _, key := range keys {
		var kind, id string
		for i, c := range key {
			if c == ':' {
				kind, id = key[:i], key[i+1:]
				break
			}
		}
		f := fields[key]
		switch kind {
		case "task":
			old, e := scopedTask(tx, a, id)
			if e != nil {
				return result, e
			}
			next, e := prepareTaskPatch(tx, &scope, old, old.Version, f, graph)
			if e != nil {
				return result, e
			}
			result.Tasks = append(result.Tasks, preparedTaskHandover{old, next, f})
		case "project":
			old, e := scopedProject(tx, a, id)
			if e != nil {
				return result, e
			}
			if !projectEditor(a, old) {
				return result, denied()
			}
			next := old
			if e := applyFields(f, &next); e != nil {
				return result, e
			}
			if e := validateProject(tx, &scope, next); e != nil {
				return result, e
			}
			next.Version++
			result.Projects = append(result.Projects, preparedProjectHandover{old, next})
		case "milestone":
			old, p, e := scopedMilestone(tx, a, id)
			if e != nil {
				return result, e
			}
			if old.State != "draft" {
				return result, conflict()
			}
			if !projectEditor(a, p) {
				return result, denied()
			}
			next := old
			if e := applyFields(f, &next); e != nil {
				return result, e
			}
			if !scope.canCreate(next.OwnerID, p.DepartmentID) {
				return result, denied()
			}
			if e := validateMilestone(tx, &scope, &next); e != nil {
				return result, e
			}
			next.Version++
			result.Milestones = append(result.Milestones, preparedMilestoneHandover{old, next})
		case "goal":
			old, e := scopedGoal(tx, a, id)
			if e != nil {
				return result, e
			}
			var uid string
			json.Unmarshal(f["ownerId"], &uid)
			next, e := prepareGoalOwnerChange(tx, &scope, old, old.Version, uid)
			if e != nil {
				return result, e
			}
			result.Goals = append(result.Goals, preparedGoalHandover{old, next})
		case "department":
			var old Department
			if e := tx.First(&old, "company_id=? AND id=?", a.Company.ID, id).Error; e != nil {
				return result, missing()
			}
			next := old
			if e := applyFields(f, &next); e != nil {
				return result, e
			}
			if next.HeadID == "" || !scope.activeUser(next.HeadID) {
				return result, invalid("Choose an active department head.")
			}
			next.Version++
			result.Departments = append(result.Departments, preparedDepartmentHandover{old, next})
		default:
			return result, invalid("Unsupported source responsibility.")
		}
	}
	return result, nil
}
func commitDeparture(tx *gorm.DB, a *access, p PeoplePreview, prepared preparedDeparture) (CompanyDeparture, []DepartureTransfer, error) {
	d := CompanyDeparture{ID: newID("departure"), CompanyID: a.Company.ID, TargetUserID: prepared.Target.UserID, MembershipID: prepared.Target.ID, ActorID: a.User.ID, PreviewID: p.ID, Reason: prepared.Manifest.Reason, OriginalMembershipVersion: prepared.Target.Version, OriginalAccessEpoch: prepared.Target.AccessEpoch, GraphFingerprint: p.GraphFingerprint, SourceManifestHash: prepared.Manifest.Fingerprint, CreatedAt: nowString()}
	transfers := []DepartureTransfer{}
	for _, t := range prepared.Tasks {
		if e := commitTaskPatch(tx, a, t.Before, t.After, t.Fields); e != nil {
			return d, nil, e
		}
	}
	for _, p := range prepared.Projects {
		if e := commitProjectRevision(tx, a, p.After, p.Before.Version); e != nil {
			return d, nil, e
		}
	}
	for _, m := range prepared.Milestones {
		if e := commitMilestoneRevision(tx, a, m.Before, m.After); e != nil {
			return d, nil, e
		}
	}
	for _, g := range prepared.Goals {
		if e := commitGoalMetadataRevision(tx, a, g.Before, g.After, d.Reason); e != nil {
			return d, nil, e
		}
	}
	for _, dep := range prepared.Departments {
		if e := commitDepartmentRevision(tx, a, dep.After, dep.Before.Version); e != nil {
			return d, nil, e
		}
	}
	for _, r := range prepared.Manifest.Replacements {
		if r.Kind == "expense_review_route" {
			if e := commitDepartureExpenseRoute(tx, a, prepared.Target.UserID, r, d.ID, d.Reason); e != nil {
				return d, nil, e
			}
		}
	}
	ids := []string{}
	for uid := range prepared.AfterMembers {
		ids = append(ids, uid)
	}
	sort.Strings(ids)
	for _, uid := range ids {
		if uid == prepared.Target.UserID {
			continue
		}
		if e := commitMemberPatch(tx, a, prepared.BeforeMembers[uid], prepared.AfterMembers[uid], d.Reason, "people_handover"); e != nil {
			return d, nil, e
		}
	}
	// Existing source guards are checked after the ordinary writes too; any error rolls back all transfers.
	if e := revokeCompanyConversations(tx, a.Company.ID, prepared.Target.UserID); e != nil {
		return d, nil, e
	}
	var openReviews int64
	if e := tx.Model(&CommunicationRecord{}).Where("company_id=? AND reviewer_id=? AND kind='decision' AND state='open'", a.Company.ID, prepared.Target.UserID).Count(&openReviews).Error; e != nil {
		return d, nil, e
	}
	if openReviews > 0 {
		return d, nil, conflict()
	}
	if e := commitMemberPatch(tx, a, prepared.Target, prepared.AfterMembers[prepared.Target.UserID], d.Reason, "company_departure"); e != nil {
		return d, nil, e
	}
	effects, e := finalizeMembershipConsequences(tx, a, prepared.BeforeMembers, a.Members, d.Reason, "company_departure")
	if e != nil {
		return d, nil, e
	}
	d.CompanyPermissionEpoch = effects.CompanyEpoch
	d.SessionEffect = effects.SessionEffect
	if e := tx.Create(&d).Error; e != nil {
		return d, nil, e
	}
	for _, r := range prepared.Manifest.Replacements {
		t := DepartureTransfer{ID: newID("transfer"), CompanyID: a.Company.ID, DepartureID: d.ID, Kind: r.Kind, SourceID: r.SourceID, BeforeVersion: r.ExpectedVersion, AfterVersion: r.ExpectedVersion + 1, OldUserID: prepared.Target.UserID, NewUserID: r.NewUserID, Reason: d.Reason}
		if r.Kind == "expense_review_route" {
			var episode AttentionItem
			if e := tx.First(&episode, "id=? AND company_id=?", r.SourceID, a.Company.ID).Error; e != nil {
				return d, nil, e
			}
			t.AfterVersion = episode.Version
		}
		if e := tx.Create(&t).Error; e != nil {
			return d, nil, e
		}
		transfers = append(transfers, t)
	}
	if e := tx.Model(&PeoplePreview{}).Where("id=?", p.ID).Update("applied_result_id", d.ID).Error; e != nil {
		return d, nil, e
	}
	if e := audit(tx, a.Company.ID, "", a.User.ID, "company_departure_completed", d.ID+": reviewed ordinary responsibilities transferred; company access revoked."); e != nil {
		return d, nil, e
	}
	return d, transfers, nil
}
func commitDepartureExpenseRoute(tx *gorm.DB, a *access, target string, r DepartureReplacement, departure, reason string) error {
	var item AttentionItem
	if e := tx.First(&item, "id=? AND company_id=? AND recipient_id=?", r.SourceID, a.Company.ID, target).Error; e != nil {
		return missing()
	}
	origin := departureCandidateScope(a, target)
	if _, e := prepareAttentionRouteTarget(tx, origin, item, r.NewUserID, departure, r.Action == "retain_current_reviewer"); e != nil {
		return e
	}
	if r.Action == "retain_current_reviewer" {
		return nil
	}
	now := time.Now().UTC()
	res := tx.Model(&AttentionItem{}).Where("id=? AND version=? AND state='open'", item.ID, r.ExpectedVersion).Updates(map[string]any{"state": "routed", "routed_to_id": r.NewUserID, "resolution_reason": reason, "version": item.Version + 1, "updated_at": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return conflict()
	}
	return nil
}
func authorizeDepartureResult(tx *gorm.DB, a *access, id string) (CompanyDeparture, []DepartureTransfer, error) {
	var d CompanyDeparture
	rows := []DepartureTransfer{}
	if e := peopleAdministration(a); e != nil {
		return d, rows, e
	}
	if e := tx.First(&d, "id=? AND company_id=?", id, a.Company.ID).Error; e != nil {
		return d, rows, missing()
	}
	if e := tx.Where("departure_id=? AND company_id=?", id, a.Company.ID).Order("kind,source_id").Find(&rows).Error; e != nil {
		return d, rows, e
	}
	for _, t := range rows {
		var e error
		switch t.Kind {
		case "task_owner", "task_reviewer":
			_, e = scopedTask(tx, a, t.SourceID)
		case "project_owner":
			_, e = scopedProject(tx, a, t.SourceID)
		case "milestone_owner", "milestone_reviewer":
			_, _, e = scopedMilestone(tx, a, t.SourceID)
		case "goal_owner":
			_, e = scopedGoal(tx, a, t.SourceID)
		case "department_head":
			var dep Department
			e = tx.First(&dep, "id=? AND company_id=?", t.SourceID, a.Company.ID).Error
		case "reporting_manager":
			if _, ok := a.Members[t.SourceID]; !ok {
				e = missing()
			}
		case "expense_review_route":
			var item AttentionItem
			e = tx.First(&item, "id=? AND company_id=?", t.SourceID, a.Company.ID).Error
			if e == nil {
				_, e = scopedExpense(tx, a, item.SourceID)
			}
		default:
			e = missing()
		}
		if e != nil {
			return d, nil, missing()
		}
	}
	return d, rows, nil
}
func (s *Server) peopleDepartureApply(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey                string `json:"retryKey"`
		PreviewID               string `json:"previewId"`
		ExpectedPreviewVersion  int64  `json:"expectedPreviewVersion"`
		ConfirmCompanyDeparture bool   `json:"confirmCompanyDeparture"`
	}
	if e = decodeBusiness(w, r, &input); e != nil {
		return e
	}
	if input.ExpectedPreviewVersion < 1 || !input.ConfirmCompanyDeparture {
		return invalid("Confirm the reviewed company departure using its captured preview version.")
	}
	uid := r.PathValue("id")
	var captured PeoplePreview
	if e := s.db.First(&captured, "id=? AND company_id=? AND actor_id=? AND operation='departure'", input.PreviewID, a.Company.ID, a.User.ID).Error; e != nil {
		return missing()
	}
	var manifest departureManifest
	if e = json.Unmarshal(captured.Manifest, &manifest); e != nil {
		return e
	}
	affected := []string{uid}
	for _, r := range manifest.Replacements {
		if r.Kind == "reporting_manager" {
			affected = append(affected, r.SourceID)
		}
	}
	var departure CompanyDeparture
	var transfers []DepartureTransfer
	e = s.withPeopleAccessTransaction(r, a, affected, func(tx *gorm.DB) error {
		var p PeoplePreview
		authorize := func() error {
			if _, e := departureAuthority(a, uid, false); e != nil {
				return e
			}
			var e error
			p, e = scopedPeoplePreview(tx, a, input.PreviewID, "departure")
			if e != nil {
				return e
			}
			if p.TargetUserID != uid {
				return missing()
			}
			return nil
		}
		_, e := businessMutation(tx, a, "company_departure", input.RetryKey, []any{uid, input.PreviewID, input.ExpectedPreviewVersion, input.ConfirmCompanyDeparture}, authorize, func(result BusinessResult) error {
			var e error
			departure, transfers, e = authorizeDepartureResult(tx, a, result.IDs[0])
			return e
		}, func() (BusinessResult, error) {
			if p.Version != input.ExpectedPreviewVersion || !p.ExpiresAt.After(time.Now().UTC()) || p.AppliedResultID != "" {
				return BusinessResult{}, conflict()
			}
			prepared, e := prepareDeparture(tx, a, p)
			if e != nil {
				return BusinessResult{}, e
			}
			departure, transfers, e = commitDeparture(tx, a, p, prepared)
			if e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "company_departure", IDs: []string{departure.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "id": departure.ID, "userId": departure.TargetUserID, "membershipId": departure.MembershipID, "transfers": transfers, "sessionEffect": departure.SessionEffect, "companyPermissionEpoch": departure.CompanyPermissionEpoch})
}
