package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"strings"
	"time"
)

type DepartureReplacement struct {
	Kind            string `json:"kind"`
	SourceID        string `json:"sourceId"`
	ExpectedVersion int64  `json:"expectedVersion"`
	Action          string `json:"action"`
	NewUserID       string `json:"newUserId"`
}
type DepartureCandidate struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	DepartmentID string `json:"departmentId"`
	Eligibility  string `json:"eligibility"`
}
type DepartureItemView struct {
	Kind            string                `json:"kind"`
	SourceID        string                `json:"sourceId"`
	Version         int64                 `json:"version"`
	Title           string                `json:"title"`
	State           string                `json:"state"`
	Candidates      []DepartureCandidate  `json:"candidates"`
	AllowsNoManager bool                  `json:"allowsNoManager"`
	Replacement     *DepartureReplacement `json:"replacement,omitempty"`
}
type DepartureRequirement struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	SourcePath string `json:"sourcePath,omitempty"`
	ProjectID  string `json:"projectId,omitempty"`
}
type DeparturePreviewView struct {
	ID               string    `json:"id"`
	Version          int64     `json:"version"`
	ExpiresAt        time.Time `json:"expiresAt"`
	GraphFingerprint string    `json:"graphFingerprint"`
	Target           struct {
		ID                string `json:"id"`
		Name              string `json:"name"`
		Role              string `json:"role"`
		MembershipVersion int64  `json:"membershipVersion"`
	} `json:"target"`
	LiveItems       []DepartureItemView    `json:"liveItems"`
	RetainedHistory map[string]int64       `json:"retainedHistory"`
	Unresolved      []DepartureRequirement `json:"unresolved"`
	SessionEffect   SessionEffect          `json:"sessionEffect"`
	ReadyToApply    bool                   `json:"readyToApply"`
}
type departureSource struct {
	Kind    string
	ID      string
	Version int64
	Hash    string
}
type departureManifest struct {
	Sources      []departureSource
	Fingerprint  string
	Replacements []DepartureReplacement
	Reason       string
}
type CompanyDeparture struct {
	ID                        string        `json:"id" gorm:"primaryKey"`
	CompanyID                 string        `json:"-" gorm:"index"`
	TargetUserID              string        `json:"userId"`
	MembershipID              string        `json:"membershipId" gorm:"uniqueIndex:departure_epoch"`
	ActorID                   string        `json:"actorId"`
	PreviewID                 string        `json:"previewId"`
	Reason                    string        `json:"reason"`
	OriginalMembershipVersion int64         `json:"-"`
	OriginalAccessEpoch       int64         `json:"-" gorm:"uniqueIndex:departure_epoch"`
	GraphFingerprint          string        `json:"graphFingerprint"`
	SourceManifestHash        string        `json:"-"`
	CompanyPermissionEpoch    int64         `json:"companyPermissionEpoch"`
	SessionEffect             SessionEffect `json:"sessionEffect" gorm:"serializer:json;type:jsonb"`
	CreatedAt                 string        `json:"createdAt"`
}
type DepartureTransfer struct {
	ID            string `json:"transferId" gorm:"primaryKey"`
	CompanyID     string `json:"-"`
	DepartureID   string `json:"-" gorm:"index"`
	Kind          string `json:"kind"`
	SourceID      string `json:"id"`
	BeforeVersion int64  `json:"beforeVersion"`
	AfterVersion  int64  `json:"version"`
	OldUserID     string `json:"oldUserId"`
	NewUserID     string `json:"newUserId"`
	Reason        string `json:"reason"`
}

func departureAuthority(a *access, uid string, active bool) (Membership, error) {
	m, ok := a.Members[uid]
	if !ok {
		return m, missing()
	}
	if e := peopleAdministration(a); e != nil {
		return m, e
	}
	if uid == a.User.ID {
		return m, invalid("Ask another administrator to review your company departure.")
	}
	if rank(m.Role) > rank(a.Member.Role) {
		return m, denied()
	}
	if active && !m.Active {
		return m, conflict()
	}
	return m, nil
}
func departureCandidateScope(a *access, uid string) *access {
	b := *a
	b.User = a.Users[uid]
	b.Member = a.Members[uid]
	return &b
}
func departureField(kind string) string {
	switch kind {
	case "task_owner", "project_owner", "milestone_owner", "goal_owner":
		return "ownerId"
	case "task_reviewer", "milestone_reviewer":
		return "reviewerId"
	case "department_head":
		return "headId"
	case "reporting_manager":
		return "managerId"
	}
	return ""
}
func departureEligible(tx *gorm.DB, a *access, target string, item DepartureItemView, uid string) bool {
	if uid == target || !a.activeUser(uid) {
		return false
	}
	scope := departureCandidateScope(a, uid)
	switch item.Kind {
	case "task_owner", "task_reviewer":
		old, e := scopedTask(tx, a, item.SourceID)
		if e != nil {
			return false
		}
		raw, _ := json.Marshal(uid)
		_, e = prepareTaskPatch(tx, a, old, old.Version, map[string]json.RawMessage{departureField(item.Kind): raw}, nil)
		if e != nil {
			return false
		}
		if item.Kind == "task_reviewer" {
			return scope.Member.Role != "viewer" && scope.canRead(old) && uid != old.OwnerID
		}
		return true
	case "project_owner":
		p, e := scopedProject(tx, a, item.SourceID)
		if e != nil {
			return false
		}
		return projectEditor(a, p) && a.canCreate(uid, p.DepartmentID) && !(p.DefaultReviewerID == uid && p.TaskOwnerPolicy != "fixed")
	case "milestone_owner", "milestone_reviewer":
		m, p, e := scopedMilestone(tx, a, item.SourceID)
		if e != nil || m.State != "draft" || !projectEditor(a, p) {
			return false
		}
		if item.Kind == "milestone_owner" {
			m.OwnerID = uid
		} else {
			m.ReviewerID = uid
		}
		return a.canCreate(m.OwnerID, p.DepartmentID) && validateMilestone(tx, a, &m) == nil
	case "goal_owner":
		g, e := scopedGoal(tx, a, item.SourceID)
		if e != nil || !canMeasureGoal(a, g) || in(a.Member.Role, "member", "finance", "viewer") {
			return false
		}
		g.OwnerID = uid
		return validateGoalMetadata(tx, a, g, false) == nil
	case "department_head":
		return true
	case "reporting_manager":
		old := a.Members[item.SourceID]
		raw, _ := json.Marshal(uid)
		_, e := prepareMemberPatch(tx, a, old, MemberPatch{ExpectedVersion: old.Version, Fields: map[string]json.RawMessage{"managerId": raw}}, a.Members)
		return e == nil
	case "expense_review_route":
		var source AttentionItem
		if tx.First(&source, "id=? AND company_id=?", item.SourceID, a.Company.ID).Error != nil {
			return false
		}
		expense, e := scopedExpense(tx, a, source.SourceID)
		if e != nil || !a.canApproveExpense(expense) || !scope.canReadExpense(expense) || !scope.canApproveExpense(expense) {
			return false
		}
		return checkAttentionRoute(tx, departureCandidateScope(a, target), source, uid, false) == nil
	}
	return false
}
func departureInventory(tx *gorm.DB, a *access, uid string, replacements []DepartureReplacement) (DeparturePreviewView, departureManifest, error) {
	var v DeparturePreviewView
	m, e := departureAuthority(a, uid, true)
	if e != nil {
		return v, departureManifest{}, e
	}
	v.LiveItems = []DepartureItemView{}
	v.Unresolved = []DepartureRequirement{}
	v.RetainedHistory = map[string]int64{}
	v.SessionEffect = peopleSessionEffect()
	v.GraphFingerprint = peopleGraphFingerprint(a)
	v.Target.ID = uid
	v.Target.Name = a.Users[uid].Name
	v.Target.Role = m.Role
	v.Target.MembershipVersion = m.Version
	manifest := departureManifest{Sources: []departureSource{}, Replacements: replacements}
	add := func(kind, id string, version int64, title, state string, source any) {
		v.LiveItems = append(v.LiveItems, DepartureItemView{Kind: kind, SourceID: id, Version: version, Title: title, State: state, Candidates: []DepartureCandidate{}, AllowsNoManager: kind == "reporting_manager"})
		manifest.Sources = append(manifest.Sources, departureSource{kind, id, version, payloadHash(source)})
	}
	opaque := func(code, msg string) {
		for _, u := range v.Unresolved {
			if u.Code == code {
				return
			}
		}
		v.Unresolved = append(v.Unresolved, DepartureRequirement{Code: code, Message: msg})
	}
	var tasks []Task
	if e := tx.Where("company_id=? AND (owner_id=? OR reviewer_id=?) AND status NOT IN ?", a.Company.ID, uid, uid, []string{"done", "cancelled"}).Order("id").Limit(1001).Find(&tasks).Error; e != nil {
		return v, manifest, e
	}
	for _, t := range tasks {
		if !a.canRead(t) || !a.canWrite(t) {
			opaque("ordinary_source_resolution_required", "An ordinary responsibility requires an authorized source editor.")
			manifest.Sources = append(manifest.Sources, departureSource{"unavailable_task", t.ID, t.Version, payloadHash(t)})
			continue
		}
		if t.OwnerID == uid {
			add("task_owner", t.ID, t.Version, t.Title, t.Status, t)
		}
		if t.ReviewerID == uid {
			add("task_reviewer", t.ID, t.Version, t.Title, t.Status, t)
		}
	}
	var mCount int64
	if e := taskReadQuery(tx, a).Where("(owner_id=? OR reviewer_id=?) AND status IN ?", uid, uid, []string{"done", "cancelled"}).Count(&mCount).Error; e != nil {
		return v, manifest, e
	}
	v.RetainedHistory["tasks"] = mCount
	// departureAuthority guarantees ordinary company leadership visibility.
	if e := tx.Model(&Project{}).Where("company_id=? AND owner_id=? AND status IN ?", a.Company.ID, uid, []string{"completed", "archived"}).Count(&mCount).Error; e != nil {
		return v, manifest, e
	}
	v.RetainedHistory["projects"] = mCount
	if e := tx.Model(&ProjectMilestone{}).Where("company_id=? AND (owner_id=? OR reviewer_id=?) AND state='accepted'", a.Company.ID, uid, uid).Count(&mCount).Error; e != nil {
		return v, manifest, e
	}
	v.RetainedHistory["milestones"] = mCount
	var projects []Project
	if e := tx.Where("company_id=? AND owner_id=? AND status IN ?", a.Company.ID, uid, []string{"active", "on_hold"}).Order("id").Limit(1001).Find(&projects).Error; e != nil {
		return v, manifest, e
	}
	for _, p := range projects {
		visible, e := canReadProject(tx, a, p)
		if e != nil {
			return v, manifest, e
		}
		if !visible || !projectEditor(a, p) {
			opaque("ordinary_source_resolution_required", "An ordinary responsibility requires an authorized source editor.")
			manifest.Sources = append(manifest.Sources, departureSource{"unavailable_project", p.ID, p.Version, payloadHash(p)})
			continue
		}
		add("project_owner", p.ID, p.Version, p.Name, p.Status, p)
	}
	var milestones []ProjectMilestone
	if e := tx.Where("company_id=? AND (owner_id=? OR reviewer_id=?) AND state<>?", a.Company.ID, uid, uid, "accepted").Order("id").Limit(1001).Find(&milestones).Error; e != nil {
		return v, manifest, e
	}
	for _, m := range milestones {
		p, e := milestoneScope(tx, a, m)
		if e != nil || !projectEditor(a, p) {
			opaque("ordinary_source_resolution_required", "An ordinary responsibility requires an authorized source editor.")
			manifest.Sources = append(manifest.Sources, departureSource{"unavailable_milestone", m.ID, m.Version, payloadHash(m)})
			continue
		}
		if m.State == "in_review" {
			u := DepartureRequirement{Code: "milestone_request_changes_required", Message: "A submitted milestone needs a separate authorized request changes action, then a new departure preview."}
			if a.User.ID != m.OwnerID && (a.User.ID == m.ReviewerID || leadership(a.Member.Role)) {
				u.SourcePath = "/project-milestones/" + m.ID
				u.ProjectID = m.ProjectID
			}
			v.Unresolved = append(v.Unresolved, u)
		}
		if m.OwnerID == uid {
			add("milestone_owner", m.ID, m.Version, m.Title, m.State, []any{m, p.Version})
		}
		if m.ReviewerID == uid {
			add("milestone_reviewer", m.ID, m.Version, m.Title, m.State, []any{m, p.Version})
		}
	}
	var goals []Goal
	if e := tx.Where("company_id=? AND owner_id=?", a.Company.ID, uid).Order("id").Limit(1001).Find(&goals).Error; e != nil {
		return v, manifest, e
	}
	for _, g := range goals {
		if _, e := scopedGoal(tx, a, g.ID); e != nil || !canMeasureGoal(a, g) {
			opaque("ordinary_source_resolution_required", "An ordinary responsibility requires an authorized source editor.")
			manifest.Sources = append(manifest.Sources, departureSource{"unavailable_goal", g.ID, g.Version, payloadHash(g)})
			continue
		}
		add("goal_owner", g.ID, g.Version, g.Name, "live", g)
	}
	var departments []Department
	if e := tx.Where("company_id=? AND head_id=?", a.Company.ID, uid).Order("id").Limit(1001).Find(&departments).Error; e != nil {
		return v, manifest, e
	}
	for _, d := range departments {
		add("department_head", d.ID, d.Version, d.Name, "live", d)
	}
	ids := []string{}
	for id, m := range a.Members {
		if m.Active && m.ManagerID == uid {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		member := a.Members[id]
		add("reporting_manager", id, member.Version, a.Users[id].Name, "active", member)
	}
	var owned []Conversation
	if e := tx.Where("company_id=? AND archived=false AND kind<>'dm' AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.company_id=conversations.company_id AND cm.conversation_id=conversations.id AND cm.user_id=? AND cm.active=true AND cm.role='owner')", a.Company.ID, uid).Order("id").Limit(1001).Find(&owned).Error; e != nil {
		return v, manifest, e
	}
	if len(owned) > 0 {
		opaque("private_ownership_transfer_required", "An owned conversation requires an authorized ownership transfer or archive before departure.")
	}
	for _, c := range owned {
		manifest.Sources = append(manifest.Sources, departureSource{"private_owner", c.ID, c.Version, payloadHash([]any{c.ID, c.Version, c.Archived})})
	}
	var decisions []struct {
		ID       string
		Revision int64
	}
	if e := tx.Model(&CommunicationRecord{}).Select("id,revision").Where("company_id=? AND reviewer_id=? AND kind='decision' AND state='open'", a.Company.ID, uid).Order("id").Limit(1001).Find(&decisions).Error; e != nil {
		return v, manifest, e
	}
	if len(decisions) > 0 {
		opaque("private_review_resolution_required", "An independent private review requires its authorized source resolution before guided departure.")
	}
	for _, d := range decisions {
		manifest.Sources = append(manifest.Sources, departureSource{"private_review", d.ID, d.Revision, payloadHash(d)})
	}
	var attention []AttentionItem
	if e := tx.Where("company_id=? AND recipient_id=? AND source_kind='expense' AND kind='expense_review' AND state='open'", a.Company.ID, uid).Order("id").Limit(1001).Find(&attention).Error; e != nil {
		return v, manifest, e
	}
	for _, item := range attention {
		expense, e := scopedExpense(tx, a, item.SourceID)
		if e != nil {
			opaque("ordinary_source_resolution_required", "An ordinary responsibility requires an authorized source editor.")
			continue
		}
		if expense.Status != "submitted" {
			continue
		}
		add("expense_review_route", item.ID, item.Version, expense.Title, "submitted", []any{item, expense})
	}
	if len(manifest.Sources) > 1000 {
		return v, manifest, invalid("Guided departure supports at most 1,000 obligations. Transfer responsibilities in smaller stages, then create a new preview; direct access revocation remains separate.")
	}
	raw, e := json.Marshal(manifest.Sources)
	if e != nil {
		return v, manifest, e
	}
	if len(raw) > 8<<20 {
		return v, manifest, invalid("The complete departure manifest exceeds 8 MiB. Transfer responsibilities in smaller stages.")
	}
	manifest.Fingerprint = payloadHash(manifest.Sources)
	selected := map[string]DepartureReplacement{}
	for _, r := range replacements {
		key := r.Kind + ":" + r.SourceID
		if _, ok := selected[key]; ok {
			return v, manifest, invalid("Choose each replacement once.")
		}
		if r.ExpectedVersion < 1 {
			return v, manifest, invalid("Use the captured source version.")
		}
		selected[key] = r
	}
	users := []string{}
	for id := range a.Members {
		users = append(users, id)
	}
	sort.Strings(users)
	for i := range v.LiveItems {
		item := &v.LiveItems[i]
		for _, id := range users {
			if departureEligible(tx, a, uid, *item, id) {
				u := a.Users[id]
				m := a.Members[id]
				item.Candidates = append(item.Candidates, DepartureCandidate{id, u.Name, m.Role, m.DepartmentID, "Eligible for this responsibility"})
			}
		}
		key := item.Kind + ":" + item.SourceID
		r, ok := selected[key]
		if !ok {
			opaque("replacement_required", "Choose an explicit eligible replacement for every live responsibility.")
			continue
		}
		delete(selected, key)
		if r.ExpectedVersion != item.Version {
			return v, manifest, conflict()
		}
		if r.Action == "clear_reporting_manager" && item.Kind == "reporting_manager" && r.NewUserID == "" {
			item.Replacement = &r
			continue
		}
		if !in(r.Action, "transfer", "retain_current_reviewer") || r.NewUserID == "" || r.Action == "retain_current_reviewer" && item.Kind != "expense_review_route" {
			return v, manifest, invalid("Choose a valid explicit replacement action.")
		}
		eligible := false
		for _, c := range item.Candidates {
			if c.ID == r.NewUserID {
				eligible = true
			}
		}
		if !eligible {
			return v, manifest, invalid("Choose a current eligible replacement for this responsibility.")
		}
		item.Replacement = &r
	}
	if len(selected) > 0 {
		return v, manifest, invalid("A replacement does not match the complete current inventory.")
	}
	v.ReadyToApply = len(v.Unresolved) == 0
	viewBytes, e := json.Marshal(v)
	if e != nil {
		return v, manifest, e
	}
	if len(viewBytes) > 8<<20 {
		return v, manifest, invalid("The complete departure preview exceeds 8 MiB. Transfer responsibilities in smaller stages.")
	}
	return v, manifest, nil
}
func (s *Server) peopleDeparturePreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey     string                 `json:"retryKey"`
		Reason       string                 `json:"reason"`
		Replacements []DepartureReplacement `json:"replacements"`
	}
	if e = decodeBusiness(w, r, &input); e != nil {
		return e
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if !clean(input.Reason, 4000) || len(input.Replacements) > 1000 {
		return invalid("Explain the departure in 1–4,000 characters with at most 1,000 explicit replacements.")
	}
	uid := r.PathValue("id")
	var view DeparturePreviewView
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		_, e := businessMutation(tx, a, "departure_preview", input.RetryKey, []any{uid, input.Reason, input.Replacements}, func() error { _, e := departureAuthority(a, uid, false); return e }, func(out BusinessResult) error {
			p, e := scopedPeoplePreview(tx, a, out.IDs[0], "departure")
			if e != nil {
				return e
			}
			var m departureManifest
			if e = json.Unmarshal(p.Manifest, &m); e != nil {
				return e
			}
			var current departureManifest
			view, current, e = departureInventory(tx, a, uid, m.Replacements)
			if e != nil {
				return e
			}
			view.ID = p.ID
			view.Version = p.Version
			view.ExpiresAt = p.ExpiresAt
			view.GraphFingerprint = p.GraphFingerprint
			if p.GraphFingerprint != peopleGraphFingerprint(a) || current.Fingerprint != m.Fingerprint {
				return conflict()
			}
			return nil
		}, func() (BusinessResult, error) {
			var manifest departureManifest
			var e error
			view, manifest, e = departureInventory(tx, a, uid, input.Replacements)
			if e != nil {
				return BusinessResult{}, e
			}
			manifest.Reason = input.Reason
			now := time.Now().UTC()
			raw, _ := json.Marshal(manifest)
			intent, _ := json.Marshal(input)
			m := a.Members[uid]
			p := PeoplePreview{ID: newID("pp"), CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: "departure", Version: 1, TargetUserID: uid, TargetMembershipID: m.ID, GraphFingerprint: peopleGraphFingerprint(a), IntentHash: payloadHash(input), CompanyEpoch: a.Company.PermissionEpoch, Timezone: a.Company.Timezone, Intent: intent, Manifest: raw, CreatedAt: now, ExpiresAt: now.Add(30 * time.Minute)}
			if e := tx.Create(&p).Error; e != nil {
				return BusinessResult{}, e
			}
			view.ID = p.ID
			view.Version = p.Version
			view.ExpiresAt = p.ExpiresAt
			return BusinessResult{Kind: "departure_preview", IDs: []string{p.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, view)
}
func (s *Server) peopleDeparturePreviewRead(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var view DeparturePreviewView
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		p, e := scopedPeoplePreview(tx, a, r.PathValue("id"), "departure")
		if e != nil {
			return e
		}
		var m departureManifest
		if e = json.Unmarshal(p.Manifest, &m); e != nil {
			return e
		}
		var current departureManifest
		view, current, e = departureInventory(tx, a, p.TargetUserID, m.Replacements)
		if e != nil {
			return e
		}
		if p.GraphFingerprint != peopleGraphFingerprint(a) || m.Fingerprint != current.Fingerprint {
			return conflict()
		}
		view.ID = p.ID
		view.Version = p.Version
		view.ExpiresAt = p.ExpiresAt
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, view)
}
