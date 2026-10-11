package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type AccessReview struct {
	ID                     string        `json:"id" gorm:"primaryKey"`
	CompanyID              string        `json:"-" gorm:"index"`
	ReviewerID             string        `json:"reviewerId"`
	PreviewID              string        `json:"previewId"`
	PriorReviewID          string        `json:"priorReviewId"`
	Version                int64         `json:"version"`
	State                  string        `json:"state"`
	Fingerprint            string        `json:"graphFingerprint"`
	Reason                 string        `json:"reason"`
	Snapshots              []Membership  `json:"members" gorm:"serializer:json;type:jsonb"`
	SessionEffect          SessionEffect `json:"sessionEffect" gorm:"serializer:json;type:jsonb"`
	CompanyPermissionEpoch int64         `json:"companyPermissionEpoch"`
	CreatedAt              string        `json:"createdAt"`
	CompletedAt            string        `json:"completedAt"`
}
type AccessReviewDecision struct {
	ID                        string                     `json:"id" gorm:"primaryKey"`
	CompanyID                 string                     `json:"-" gorm:"index"`
	ReviewID                  string                     `json:"reviewId" gorm:"index"`
	UserID                    string                     `json:"userId"`
	ExpectedMembershipVersion int64                      `json:"expectedMembershipVersion"`
	Action                    string                     `json:"action"`
	Fields                    map[string]json.RawMessage `json:"fields" gorm:"serializer:json;type:jsonb"`
	Reason                    string                     `json:"reason"`
	AccessOutcome             string                     `json:"accessOutcome"`
	HandoverStatus            string                     `json:"handoverStatus"`
}
type AccessReviewDecisionInput struct {
	UserID                    string                     `json:"userId"`
	ExpectedMembershipVersion int64                      `json:"expectedMembershipVersion"`
	Action                    string                     `json:"action"`
	Fields                    map[string]json.RawMessage `json:"fields"`
	Reason                    string                     `json:"reason"`
}
type AccessReviewInput struct {
	RetryKey      string                      `json:"retryKey"`
	PriorReviewID string                      `json:"priorReviewId"`
	Reason        string                      `json:"reason"`
	Decisions     []AccessReviewDecisionInput `json:"decisions"`
}
type accessReviewView struct {
	AccessReview
	Decisions []AccessReviewDecision `json:"decisions"`
}

func scopedAccessReview(tx *gorm.DB, a *access, id string) (accessReviewView, error) {
	v := accessReviewView{Decisions: []AccessReviewDecision{}}
	if e := peopleAdministration(a); e != nil {
		return v, e
	}
	if e := tx.First(&v.AccessReview, "id=? AND company_id=?", id, a.Company.ID).Error; e != nil {
		return v, missing()
	}
	e := tx.Where("review_id=? AND company_id=?", id, a.Company.ID).Order("user_id").Find(&v.Decisions).Error
	return v, e
}
func prepareAccessReview(tx *gorm.DB, a *access, ds []AccessReviewDecisionInput) (map[string]Membership, error) {
	if len(a.Members) > 1000 || len(ds) != len(a.Members) {
		return nil, invalid("Decide every company membership exactly once; company reviews support at most 1,000 members. Direct People administration remains available.")
	}
	resulting := cloneMembers(a.Members)
	seen := map[string]bool{}
	for _, d := range ds {
		old, ok := a.Members[d.UserID]
		if !ok || seen[d.UserID] {
			return nil, invalid("Decide each current membership exactly once.")
		}
		seen[d.UserID] = true
		if d.ExpectedMembershipVersion < 1 || old.Version != d.ExpectedMembershipVersion {
			return nil, conflict()
		}
		if len(d.Reason) > 4000 {
			return nil, invalid("Decision reason allows 4,000 characters.")
		}
		if !in(d.Action, "keep", "change", "revoke_access", "departure_required") {
			return nil, invalid("Choose a valid access decision.")
		}
		if d.Action != "change" && len(d.Fields) > 0 {
			return nil, invalid("Only a change decision accepts membership fields.")
		}
		for key, raw := range d.Fields {
			if !in(key, "role", "departmentId", "managerId", "title", "capacityHours") || string(raw) == "null" {
				return nil, invalid("Invalid reviewed membership field.")
			}
		}
		next := old
		if e := applyFields(d.Fields, &next); e != nil {
			return nil, e
		}
		if d.Action == "revoke_access" {
			next.Active = false
		}
		resulting[d.UserID] = next
	}
	for _, d := range ds {
		if d.Action != "change" && d.Action != "revoke_access" {
			continue
		}
		fields := d.Fields
		if d.Action == "revoke_access" {
			fields = map[string]json.RawMessage{"active": json.RawMessage("false")}
		}
		if _, e := prepareMemberPatch(tx, a, a.Members[d.UserID], MemberPatch{ExpectedVersion: d.ExpectedMembershipVersion, Fields: fields}, resulting); e != nil {
			return nil, e
		}
	}
	return resulting, nil
}
func (s *Server) peopleReviewPreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input AccessReviewInput
	if e = decodeBusiness(w, r, &input); e != nil {
		return e
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if !clean(input.Reason, 4000) {
		return invalid("Explain the access review in 1–4,000 characters.")
	}
	raw, e := json.Marshal(input)
	if e != nil || len(raw) > 1<<20 {
		return invalid("The complete company review exceeds the 1 MiB limit.")
	}
	var view accessReviewView
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		_, e := businessMutation(tx, a, "access_review_preview", input.RetryKey, []any{input.Reason, input.PriorReviewID, input.Decisions}, func() error { return peopleAdministration(a) }, func(out BusinessResult) error { var e error; view, e = scopedAccessReview(tx, a, out.IDs[0]); return e }, func() (BusinessResult, error) {
			if input.PriorReviewID != "" {
				if _, e := scopedAccessReview(tx, a, input.PriorReviewID); e != nil {
					return BusinessResult{}, e
				}
			}
			resulting, e := prepareAccessReview(tx, a, input.Decisions)
			if e != nil {
				return BusinessResult{}, e
			}
			effect := SessionEffect{Scope: "account_sessions", OtherCompanyMembershipsPreserved: true}
			for id, after := range resulting {
				if memberScopeChanged(a.Members[id], after) {
					effect.Reauthenticate = true
					effect.DevicesMustReregister = true
					effect.CallsMustRejoin = true
				}
			}
			snapshots := make([]Membership, 0, len(a.Members))
			for _, m := range a.Members {
				snapshots = append(snapshots, m)
			}
			sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].UserID < snapshots[j].UserID })
			manifest, e := json.Marshal(snapshots)
			if e != nil {
				return BusinessResult{}, e
			}
			if len(raw)+len(manifest) > 1<<20 {
				return BusinessResult{}, invalid("The complete company review exceeds the 1 MiB limit. Direct People administration remains available.")
			}
			now := time.Now().UTC()
			p := PeoplePreview{ID: newID("pp"), CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: "review", Version: 1, GraphFingerprint: peopleGraphFingerprint(a), CompanyEpoch: a.Company.PermissionEpoch, Timezone: a.Company.Timezone, Intent: raw, Manifest: manifest, CreatedAt: now, ExpiresAt: now.Add(30 * time.Minute)}
			p.IntentHash, _ = businessHash(input)
			review := AccessReview{ID: newID("review"), CompanyID: a.Company.ID, ReviewerID: a.User.ID, PreviewID: p.ID, PriorReviewID: input.PriorReviewID, Version: 1, State: "draft", Fingerprint: p.GraphFingerprint, Reason: input.Reason, Snapshots: snapshots, CreatedAt: nowString(), CompanyPermissionEpoch: a.Company.PermissionEpoch, SessionEffect: effect}
			if e := tx.Create(&p).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := tx.Create(&review).Error; e != nil {
				return BusinessResult{}, e
			}
			decisions := []AccessReviewDecision{}
			for _, d := range input.Decisions {
				decision := AccessReviewDecision{ID: newID("rd"), CompanyID: a.Company.ID, ReviewID: review.ID, UserID: d.UserID, ExpectedMembershipVersion: d.ExpectedMembershipVersion, Action: d.Action, Fields: d.Fields, Reason: d.Reason, AccessOutcome: "unchanged", HandoverStatus: "not_requested"}
				if d.Action == "departure_required" {
					decision.HandoverStatus = "pending"
				}
				if d.Action == "revoke_access" {
					decision.AccessOutcome = "revoked"
					decision.HandoverStatus = "not_performed"
				}
				if d.Action == "change" {
					decision.AccessOutcome = "changed"
				}
				if e := tx.Create(&decision).Error; e != nil {
					return BusinessResult{}, e
				}
				decisions = append(decisions, decision)
			}
			view = accessReviewView{review, decisions}
			return BusinessResult{Kind: "access_review", IDs: []string{review.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, view)
}
func (s *Server) peopleReviewRead(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var view accessReviewView
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error { var e error; view, e = scopedAccessReview(tx, a, r.PathValue("id")); return e })
	if e != nil {
		return e
	}
	return respond(w, 200, view)
}
func (s *Server) peopleReviewList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, e = strconv.Atoi(raw)
		if e != nil || limit < 1 || limit > 100 {
			return invalid("Page size must be 1–100.")
		}
	}
	rows := []AccessReview{}
	next := ""
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if e := peopleAdministration(a); e != nil {
			return e
		}
		basis := payloadHash([]any{peopleGraphFingerprint(a), a.User.ID, "access_reviews"})
		after := ""
		if cursor := r.URL.Query().Get("cursor"); cursor != "" {
			parts := strings.SplitN(cursor, ".", 2)
			if len(parts) != 2 || parts[0] != basis {
				return conflict()
			}
			after = parts[1]
		}
		if e := tx.Where("company_id=? AND id>?", a.Company.ID, after).Order("id").Limit(limit + 1).Find(&rows).Error; e != nil {
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
func (s *Server) peopleReviewComplete(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey              string `json:"retryKey"`
		PreviewID             string `json:"previewId"`
		ExpectedReviewVersion int64  `json:"expectedReviewVersion"`
	}
	if e = decodeBusiness(w, r, &input); e != nil {
		return e
	}
	if input.ExpectedReviewVersion < 1 {
		return invalid("Use the captured review version.")
	}
	id := r.PathValue("id")
	// Immutable decisions declare every affected User before ordered lock entry.
	var declared []AccessReviewDecision
	if e = s.db.Where("company_id=? AND review_id=? AND action IN ?", a.Company.ID, id, []string{"change", "revoke_access"}).Find(&declared).Error; e != nil {
		return e
	}
	affected := []string{}
	for _, d := range declared {
		affected = append(affected, d.UserID)
	}
	var view accessReviewView
	e = s.withPeopleAccessTransaction(r, a, affected, func(tx *gorm.DB) error {
		var current accessReviewView
		authorize := func() error {
			var e error
			current, e = scopedAccessReview(tx, a, id)
			if e != nil {
				return e
			}
			if current.ReviewerID != a.User.ID {
				return denied()
			}
			return nil
		}
		_, e := businessMutation(tx, a, "access_review_complete", input.RetryKey, []any{id, input.PreviewID, input.ExpectedReviewVersion}, authorize, func(out BusinessResult) error { var e error; view, e = scopedAccessReview(tx, a, out.IDs[0]); return e }, func() (BusinessResult, error) {
			if current.State != "draft" || current.Version != input.ExpectedReviewVersion || current.PreviewID != input.PreviewID || current.Fingerprint != peopleGraphFingerprint(a) {
				return BusinessResult{}, conflict()
			}
			p, e := scopedPeoplePreview(tx, a, input.PreviewID, "review")
			if e != nil {
				return BusinessResult{}, e
			}
			if !p.ExpiresAt.After(time.Now().UTC()) {
				return BusinessResult{}, conflict()
			}
			ds := []AccessReviewDecisionInput{}
			for _, d := range current.Decisions {
				ds = append(ds, AccessReviewDecisionInput{d.UserID, d.ExpectedMembershipVersion, d.Action, d.Fields, d.Reason})
			}
			resulting, e := prepareAccessReview(tx, a, ds)
			if e != nil {
				return BusinessResult{}, e
			}
			before := cloneMembers(a.Members)
			for _, d := range current.Decisions {
				old := before[d.UserID]
				next := resulting[d.UserID]
				if old.Active && !next.Active {
					if e := revokeCompanyConversations(tx, a.Company.ID, d.UserID); e != nil {
						return BusinessResult{}, e
					}
				}
				if e := commitMemberPatch(tx, a, old, next, current.Reason, "access_review_member_changed"); e != nil {
					return BusinessResult{}, e
				}
			}
			effects, e := finalizeMembershipConsequences(tx, a, before, a.Members, current.Reason, "access_review_completed")
			if e != nil {
				return BusinessResult{}, e
			}
			current.State = "completed"
			current.Version++
			current.CompletedAt = nowString()
			current.SessionEffect = effects.SessionEffect
			current.CompanyPermissionEpoch = effects.CompanyEpoch
			result := tx.Model(&AccessReview{}).Where("id=? AND version=? AND state='draft'", id, input.ExpectedReviewVersion).Select("State", "Version", "CompletedAt", "SessionEffect", "CompanyPermissionEpoch").Updates(&current.AccessReview)
			if result.Error != nil {
				return BusinessResult{}, result.Error
			}
			if result.RowsAffected != 1 {
				return BusinessResult{}, conflict()
			}
			if e := tx.Model(&PeoplePreview{}).Where("id=?", p.ID).Update("applied_result_id", id).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := audit(tx, a.Company.ID, "", a.User.ID, "access_review_completed", id+": access decisions attested; handover statuses recorded separately."); e != nil {
				return BusinessResult{}, e
			}
			view = current
			return BusinessResult{Kind: "access_review", IDs: []string{id}, Versions: []int64{current.Version}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, view)
}
