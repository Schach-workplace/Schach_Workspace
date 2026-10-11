package platform

import (
	"encoding/json"
	"time"
)

type PeopleMembershipDefaults struct {
	Role          string  `json:"role"`
	DepartmentID  string  `json:"departmentId"`
	ManagerID     string  `json:"managerId"`
	Title         string  `json:"title"`
	CapacityHours float64 `json:"capacityHours"`
}
type OnboardingPreset struct {
	ID          string                   `json:"id" gorm:"primaryKey"`
	CompanyID   string                   `json:"companyId" gorm:"index"`
	Version     int64                    `json:"version"`
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	Archived    bool                     `json:"archived"`
	Membership  PeopleMembershipDefaults `json:"membership" gorm:"serializer:json;type:jsonb"`
	TemplateIDs []string                 `json:"templateIds" gorm:"serializer:json;type:jsonb"`
	CreatedBy   string                   `json:"createdBy"`
	UpdatedBy   string                   `json:"updatedBy"`
	CreatedAt   string                   `json:"createdAt"`
	UpdatedAt   string                   `json:"updatedAt"`
}
type PeoplePreview struct {
	ID                 string `gorm:"primaryKey"`
	CompanyID          string `gorm:"index"`
	ActorID            string
	Operation          string
	Version            int64
	TargetUserID       string
	TargetMembershipID string
	GraphFingerprint   string
	IntentHash         string
	CompanyEpoch       int64
	Timezone           string
	Intent             json.RawMessage `gorm:"type:jsonb"`
	Manifest           json.RawMessage `gorm:"type:jsonb"`
	CreatedAt          time.Time
	ExpiresAt          time.Time
	AppliedResultID    string
}
type OnboardingApplication struct {
	ID                     string        `json:"id" gorm:"primaryKey"`
	CompanyID              string        `json:"-" gorm:"index"`
	ActorID                string        `json:"-"`
	PreviewID              string        `json:"previewId"`
	PresetID               string        `json:"presetId"`
	PresetVersion          int64         `json:"presetVersion"`
	UserID                 string        `json:"userId"`
	MembershipID           string        `json:"membershipId"`
	TaskIDs                []string      `json:"taskIds" gorm:"serializer:json;type:jsonb"`
	TaskVersions           []int64       `json:"-" gorm:"serializer:json;type:jsonb"`
	SessionEffect          SessionEffect `json:"sessionEffect" gorm:"serializer:json;type:jsonb"`
	CompanyPermissionEpoch int64         `json:"companyPermissionEpoch"`
	CreatedAt              string        `json:"createdAt"`
}
type OnboardingTask struct {
	TemplateID              string                     `json:"templateId"`
	ExpectedTemplateVersion int64                      `json:"expectedTemplateVersion"`
	ProjectID               string                     `json:"projectId"`
	ExpectedProjectVersion  int64                      `json:"expectedProjectVersion"`
	AnchorDate              string                     `json:"anchorDate"`
	Fields                  map[string]json.RawMessage `json:"fields"`
}

func (t OnboardingTask) templateInput() TemplateUseInput {
	return TemplateUseInput{ExpectedTemplateVersion: t.ExpectedTemplateVersion, ProjectID: t.ProjectID, ExpectedProjectVersion: t.ExpectedProjectVersion, AnchorDate: t.AnchorDate, Fields: t.Fields}
}

type OnboardingIntent struct {
	Name                  string                   `json:"name"`
	Email                 string                   `json:"email"`
	PresetID              string                   `json:"presetId"`
	ExpectedPresetVersion int64                    `json:"expectedPresetVersion"`
	Membership            PeopleMembershipDefaults `json:"membership"`
	Tasks                 []OnboardingTask         `json:"tasks"`
}
type onboardingManifest struct {
	TaskPreviews []TemplateTaskPreview
	Unresolved   []FieldRequirement
	Intent       OnboardingIntent
	AccountMode  string
	UserID       string
	MembershipID string
}
type PermissionGrantSummary struct {
	Area    string `json:"area"`
	Summary string `json:"summary"`
}
type FieldRequirement struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}
type TemplateTaskPreview struct {
	// Captured text requirements, without task item IDs or completion state.
	Checklist       []string                   `json:"checklist"`
	TemplateID      string                     `json:"templateId"`
	TemplateVersion int64                      `json:"templateVersion"`
	ProjectVersion  int64                      `json:"projectVersion"`
	Fields          map[string]json.RawMessage `json:"fields"`
}
type OnboardingPreviewView struct {
	ID               string    `json:"id"`
	Version          int64     `json:"version"`
	ExpiresAt        time.Time `json:"expiresAt"`
	GraphFingerprint string    `json:"graphFingerprint"`
	AccountMode      string    `json:"accountMode"`
	Person           struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"person"`
	MembershipAfter PeopleMembershipDefaults `json:"membershipAfter"`
	Grants          []PermissionGrantSummary `json:"grants"`
	TaskPreviews    []TemplateTaskPreview    `json:"taskPreviews"`
	Unresolved      []FieldRequirement       `json:"unresolved"`
	SessionEffect   SessionEffect            `json:"sessionEffect"`
}
