package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"reflect"
	"time"
)

type ScheduleVersion struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}
type ScheduleContext struct {
	Sources    []ScheduleVersion `json:"sources,omitempty"`
	Projects   []ScheduleVersion `json:"projects"`
	Milestones []ScheduleVersion `json:"milestones"`
}
type ScheduleChange struct {
	TaskID       string          `json:"taskId"`
	Version      int64           `json:"version"`
	StartDate    string          `json:"startDate"`
	DueDate      string          `json:"dueDate"`
	DeadlineMode string          `json:"deadlineMode"`
	DueAt        DeadlineInstant `json:"dueAt"`
	DueTimezone  string          `json:"dueTimezone"`
	Reason       string          `json:"reason"`
}
type ScheduleBefore struct {
	TaskID       string         `json:"taskId"`
	Version      int64          `json:"version"`
	OwnerID      string         `json:"ownerId"`
	DepartmentID string         `json:"departmentId"`
	ProjectID    string         `json:"projectId"`
	Commitment   TaskCommitment `json:"commitment"`
	Original     TaskCommitment `json:"original"`
}
type TaskScheduleProposal struct {
	ID          string           `json:"id" gorm:"primaryKey"`
	CompanyID   string           `json:"companyId" gorm:"index"`
	ActorID     string           `json:"actorId"`
	Version     int64            `json:"version"`
	Method      string           `json:"method"`
	DayOffset   *int             `json:"dayOffset,omitempty"`
	Changes     []ScheduleChange `json:"changes" gorm:"serializer:json;type:jsonb"`
	Context     ScheduleContext  `json:"context" gorm:"serializer:json;type:jsonb"`
	Before      []ScheduleBefore `json:"before" gorm:"serializer:json;type:jsonb"`
	RequestHash string           `json:"-"`
	CreatedAt   time.Time        `json:"createdAt"`
	ExpiresAt   time.Time        `json:"expiresAt"`
}
type SchedulePreviewInput struct {
	RetryKey  string           `json:"retryKey"`
	Method    string           `json:"method"`
	DayOffset *int             `json:"dayOffset,omitempty"`
	Changes   []ScheduleChange `json:"changes"`
	Context   ScheduleContext  `json:"context"`
}

func scheduleSources(tx *gorm.DB, a *access, p TaskScheduleProposal) error {
	if p.CompanyID != a.Company.ID || p.ActorID != a.User.ID {
		return missing()
	}
	for _, c := range p.Changes {
		t, e := scopedTask(tx, a, c.TaskID)
		if e != nil {
			return e
		}
		if !a.canWrite(t) {
			return denied()
		}
	}
	for _, b := range p.Before {
		if !a.activeUser(b.OwnerID) || !departmentExists(tx, a.Company.ID, b.DepartmentID) {
			return denied()
		}
		if b.ProjectID != "" {
			if _, e := scopedProject(tx, a, b.ProjectID); e != nil {
				return e
			}
		}
	}
	for _, v := range p.Context.Sources {
		if _, e := scopedTask(tx, a, v.ID); e != nil {
			return e
		}
	}
	for _, v := range p.Context.Projects {
		if _, e := scopedProject(tx, a, v.ID); e != nil {
			return e
		}
	}
	for _, v := range p.Context.Milestones {
		if _, _, e := scopedMilestone(tx, a, v.ID); e != nil {
			return e
		}
	}
	return nil
}
func scopedSchedule(tx *gorm.DB, a *access, id string) (TaskScheduleProposal, error) {
	var p TaskScheduleProposal
	if e := tx.Where("id = ? AND company_id = ? AND actor_id = ?", id, a.Company.ID, a.User.ID).First(&p).Error; e != nil {
		return p, missing()
	}
	return p, scheduleSources(tx, a, p)
}
func schedulePatch(old Task, c ScheduleChange) map[string]json.RawMessage {
	fields := map[string]json.RawMessage{}
	for k, v := range map[string]any{"startDate": c.StartDate, "dueDate": c.DueDate, "deadlineMode": c.DeadlineMode, "dueAt": c.DueAt, "dueTimezone": c.DueTimezone} {
		fields[k], _ = json.Marshal(v)
	}
	candidate := old
	applyFields(fields, &candidate)
	if deadlineChanged(old, candidate) {
		fields["deadlineChangeReason"], _ = json.Marshal(c.Reason)
	}
	return fields
}
func inspectSchedule(tx *gorm.DB, a *access, input SchedulePreviewInput) ([]Task, []Task, map[string]map[string]json.RawMessage, []ScheduleBefore, error) {
	if !in(input.Method, "manual", "calendar_day_shift") || len(input.Changes) < 1 || len(input.Changes) > 100 {
		return nil, nil, nil, nil, invalid("Select 1–100 tasks and manual or calendar_day_shift method.")
	}
	if input.Method == "calendar_day_shift" && (input.DayOffset == nil || *input.DayOffset < -366 || *input.DayOffset > 366) {
		return nil, nil, nil, nil, invalid("Choose a signed company-calendar day shift from -366 to 366.")
	}
	if input.Method == "manual" && input.DayOffset != nil {
		return nil, nil, nil, nil, invalid("Manual previews have no automatic day offset.")
	}
	if len(input.Context.Sources) > 1000 {
		return nil, nil, nil, nil, invalid("Narrow selection to at most 1000 inspected sources.")
	}
	sourceVersions := map[string]int64{}
	for _, v := range input.Context.Sources {
		if v.ID == "" || v.Version < 1 || sourceVersions[v.ID] != 0 {
			return nil, nil, nil, nil, invalid("Sources require unique positive inspected versions.")
		}
		t, e := scopedTask(tx, a, v.ID)
		if e != nil {
			return nil, nil, nil, nil, e
		}
		if t.Version != v.Version {
			return nil, nil, nil, nil, conflict()
		}
		sourceVersions[v.ID] = v.Version
	}
	projectVersions := map[string]int64{}
	for _, v := range input.Context.Projects {
		if v.ID == "" || v.Version < 1 || projectVersions[v.ID] != 0 {
			return nil, nil, nil, nil, invalid("Project context must contain unique inspected positive versions.")
		}
		p, e := scopedProject(tx, a, v.ID)
		if e != nil {
			return nil, nil, nil, nil, e
		}
		if p.Version != v.Version {
			return nil, nil, nil, nil, conflict()
		}
		projectVersions[v.ID] = v.Version
	}
	milestones := map[string]bool{}
	for _, v := range input.Context.Milestones {
		if v.ID == "" || v.Version < 1 || milestones[v.ID] {
			return nil, nil, nil, nil, invalid("Milestone context must contain unique inspected versions.")
		}
		m, _, e := scopedMilestone(tx, a, v.ID)
		if e != nil {
			return nil, nil, nil, nil, e
		}
		if m.Version != v.Version {
			return nil, nil, nil, nil, conflict()
		}
		milestones[v.ID] = true
	}
	var all []Task
	if e := tx.Where("company_id = ?", a.Company.ID).Find(&all).Error; e != nil {
		return nil, nil, nil, nil, e
	}
	graph := map[string]Task{}
	for _, t := range all {
		graph[t.ID] = t
	}
	olds := []Task{}
	before := []ScheduleBefore{}
	patches := map[string]map[string]json.RawMessage{}
	usedProjects := map[string]bool{}
	for _, c := range input.Changes {
		if c.TaskID == "" || c.Version < 1 || !clean(c.Reason, 4000) || patches[c.TaskID] != nil {
			return nil, nil, nil, nil, invalid("Each selected task needs a unique ID, positive version and fresh reason.")
		}
		old, e := scopedTask(tx, a, c.TaskID)
		if e != nil {
			return nil, nil, nil, nil, e
		}
		if old.ProjectID != "" {
			if projectVersions[old.ProjectID] == 0 {
				return nil, nil, nil, nil, invalid("Inspect the current version of every affected project.")
			}
			usedProjects[old.ProjectID] = true
		}
		if input.Method == "calendar_day_shift" {
			if old.DeadlineMode == "timed" || old.DueDate == "" {
				return nil, nil, nil, nil, invalid("Timed or missing commitments require explicit manual date/time review.")
			}
			shift := func(date string) string {
				if date == "" {
					return ""
				}
				d, _ := time.Parse("2006-01-02", date)
				return d.AddDate(0, 0, *input.DayOffset).Format("2006-01-02")
			}
			expected := ScheduleChange{TaskID: c.TaskID, Version: c.Version, StartDate: shift(old.StartDate), DueDate: shift(old.DueDate), DeadlineMode: "all_day", Reason: c.Reason}
			if !reflect.DeepEqual(expected, c) {
				return nil, nil, nil, nil, invalid("Concrete dates must exactly match the selected company-calendar shift; use manual for overrides.")
			}
		}
		fields := schedulePatch(old, c)
		candidate := old
		if e = applyFields(fields, &candidate); e != nil {
			return nil, nil, nil, nil, e
		}
		graph[old.ID] = candidate
		olds = append(olds, old)
		patches[old.ID] = fields
		before = append(before, ScheduleBefore{TaskID: old.ID, Version: old.Version, OwnerID: old.OwnerID, DepartmentID: old.DepartmentID, ProjectID: old.ProjectID, Commitment: currentCommitment(old), Original: originalCommitment(old)})
	}
	if len(usedProjects) != len(projectVersions) {
		return nil, nil, nil, nil, invalid("Project context must match affected projects only.")
	}
	nexts := []Task{}
	for i, old := range olds {
		next, e := prepareTaskPatch(tx, a, old, input.Changes[i].Version, patches[old.ID], graph)
		if e != nil {
			return nil, nil, nil, nil, e
		}
		nexts = append(nexts, next)
	}
	return olds, nexts, patches, before, nil
}
func scheduleProjection(tx *gorm.DB, a *access, p TaskScheduleProposal) (map[string]any, error) {
	if e := scheduleSources(tx, a, p); e != nil {
		return nil, e
	}
	rows := []map[string]any{}
	advisories := []string{}
	for i, c := range p.Changes {
		t, e := scopedTask(tx, a, c.TaskID)
		if e != nil {
			return nil, e
		}
		rows = append(rows, map[string]any{"taskId": t.ID, "code": t.Code, "title": t.Title, "version": t.Version, "before": p.Before[i].Commitment, "current": currentCommitment(t), "original": p.Before[i].Original, "after": TaskCommitment{StartDate: c.StartDate, DueDate: c.DueDate, DeadlineMode: c.DeadlineMode, DueAt: c.DueAt, DueTimezone: c.DueTimezone}, "reason": c.Reason})
		for _, depID := range t.Dependencies {
			dep, e := scopedTask(tx, a, depID)
			if e != nil {
				continue
			}
			due := dep.DueDate
			for _, candidate := range p.Changes {
				if candidate.TaskID == depID {
					due = candidate.DueDate
				}
			}
			if due != "" && c.StartDate != "" && due > c.StartDate {
				advisories = append(advisories, dep.Code+" deadline overlaps "+t.Code+" start; review this visible dependency.")
			}
		}
	}
	return map[string]any{"id": p.ID, "version": p.Version, "method": p.Method, "dayOffset": p.DayOffset, "createdAt": p.CreatedAt, "expiresAt": p.ExpiresAt, "expired": time.Now().After(p.ExpiresAt), "rows": rows, "context": p.Context, "advisories": advisories, "notice": "Only authorized linked work is shown."}, nil
}
func (s *Server) scheduleRoutes() {
	base := "/api/companies/{cid}"
	s.route("GET "+base+"/tasks/{id}/impact", s.taskImpact)
	s.route("POST "+base+"/task-schedule/preview", s.schedulePreview)
	s.route("GET "+base+"/task-schedule/{id}", s.scheduleDetail)
	s.route("POST "+base+"/task-schedule/apply", s.scheduleApply)
}
func (s *Server) schedulePreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input SchedulePreviewInput
	if e = decodeBusiness(w, r, &input); e != nil {
		return e
	}
	key := input.RetryKey
	input.RetryKey = ""
	var view map[string]any
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		authorize := func() error {
			return scheduleSources(tx, a, TaskScheduleProposal{CompanyID: a.Company.ID, ActorID: a.User.ID, Changes: input.Changes, Context: input.Context})
		}
		apply := func() (BusinessResult, error) {
			_, _, _, before, e := inspectSchedule(tx, a, input)
			if e != nil {
				return BusinessResult{}, e
			}
			hash, e := businessHash(input)
			if e != nil {
				return BusinessResult{}, e
			}
			p := TaskScheduleProposal{ID: newID("schedule"), CompanyID: a.Company.ID, ActorID: a.User.ID, Version: 1, Method: input.Method, DayOffset: input.DayOffset, Changes: input.Changes, Context: input.Context, Before: before, RequestHash: hash, CreatedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(30 * time.Minute)}
			if e := tx.Create(&p).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "schedule", IDs: []string{p.ID}, Versions: []int64{1}}, nil
		}
		out, e := businessMutation(tx, a, "schedule_preview", key, input, authorize, func(v BusinessResult) error { _, e := scopedSchedule(tx, a, v.IDs[0]); return e }, apply)
		if e != nil {
			return e
		}
		p, e := scopedSchedule(tx, a, out.IDs[0])
		if e != nil {
			return e
		}
		view, e = scheduleProjection(tx, a, p)
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"proposal": view})
}
func (s *Server) scheduleDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var view map[string]any
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		p, e := scopedSchedule(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		view, e = scheduleProjection(tx, a, p)
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"proposal": view})
}
func (s *Server) scheduleApply(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey                string `json:"retryKey"`
		ProposalID              string `json:"proposalId"`
		ExpectedProposalVersion int64  `json:"expectedProposalVersion"`
	}
	if e = decodeBusiness(w, r, &input); e != nil {
		return e
	}
	key := input.RetryKey
	input.RetryKey = ""
	var out BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var p TaskScheduleProposal
		authorize := func() error { var e error; p, e = scopedSchedule(tx, a, input.ProposalID); return e }
		apply := func() (BusinessResult, error) {
			if input.ExpectedProposalVersion < 1 || input.ExpectedProposalVersion != p.Version || time.Now().After(p.ExpiresAt) {
				return BusinessResult{}, conflict()
			}
			intent := SchedulePreviewInput{Method: p.Method, DayOffset: p.DayOffset, Changes: p.Changes, Context: p.Context}
			olds, nexts, patches, _, e := inspectSchedule(tx, a, intent)
			if e != nil {
				return BusinessResult{}, e
			}
			result := BusinessResult{Kind: "tasks", IDs: []string{}, Versions: []int64{}}
			for i, old := range olds {
				if e := commitTaskPatch(tx, a, old, nexts[i], patches[old.ID]); e != nil {
					return BusinessResult{}, e
				}
				if e := audit(tx, a.Company.ID, old.ID, a.User.ID, "schedule_applied", "Reviewed schedule: "+p.Changes[i].Reason); e != nil {
					return BusinessResult{}, e
				}
				result.IDs = append(result.IDs, old.ID)
				result.Versions = append(result.Versions, old.Version+1)
			}
			return result, nil
		}
		out, e = businessMutation(tx, a, "schedule_apply", key, input, authorize, func(v BusinessResult) error { return authorizeTaskResults(tx, a, v) }, apply)
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "ids": out.IDs, "versions": out.Versions})
}
