package platform

import "time"

// ReportTaskState is deliberately lean: no private prose, files or source links.
type ReportDeadline struct {
	Mode string `json:"mode"`
	Date string `json:"date"`
	At   string `json:"at"`
	Zone string `json:"zone"`
}
type ReportTaskState struct {
	Code              string         `json:"code"`
	Title             string         `json:"title"`
	CreatedAtRaw      string         `json:"createdAtRaw"`
	OwnerID           string         `json:"ownerId"`
	ReviewerID        string         `json:"reviewerId"`
	CreatorID         string         `json:"creatorId"`
	DepartmentID      string         `json:"departmentId"`
	ProjectID         string         `json:"projectId"`
	Status            string         `json:"status"`
	Priority          string         `json:"priority"`
	StartDate         string         `json:"startDate"`
	Progress          float64        `json:"progress"`
	EstimatedHours    float64        `json:"estimatedHours"`
	ActualHours       float64        `json:"actualHours"`
	RequiresApproval  bool           `json:"requiresApproval"`
	Original          ReportDeadline `json:"original"`
	Current           ReportDeadline `json:"current"`
	DeadlineReason    string         `json:"deadlineReason"`
	CompletedAtRaw    string         `json:"completedAtRaw"`
	CompanyPolicyZone string         `json:"companyPolicyZone"`
	ParentID          string         `json:"parentId"`
	Dependencies      []string       `json:"dependencies"`
}
type TaskFact struct {
	ID             string `gorm:"primaryKey"`
	CompanyID      string `gorm:"uniqueIndex:task_fact_version;index"`
	TaskID         string `gorm:"uniqueIndex:task_fact_version"`
	TaskVersion    int64  `gorm:"uniqueIndex:task_fact_version"`
	RecordedAt     time.Time
	EffectiveAt    time.Time `gorm:"index"`
	EffectiveAtRaw string
	Operation      string
	ActorID        string
	ActorKind      string
	Provenance     string
	KnownFrom      time.Time
	UnknownBefore  bool
	StateHash      string
	State          ReportTaskState `gorm:"serializer:json;type:jsonb"`
}
type TaskHistoryCoverage struct {
	CompanyID           string `gorm:"primaryKey"`
	TaskID              string `gorm:"primaryKey"`
	FirstKnownAt        time.Time
	UnknownBefore       bool
	LastRecordedVersion int64
	StateHash           string
	Inconsistent        bool
	LastFactID          string
}
type TaskHistoryGap struct {
	ID            string `gorm:"primaryKey"`
	CompanyID     string `gorm:"index"`
	TaskID        string `gorm:"index"`
	FromExclusive time.Time
	ToExclusive   *time.Time
	Reason        string
	BeforeFactID  string
	AfterFactID   string
}
type TaskAcceptanceFact struct {
	ID             string    `gorm:"primaryKey"`
	CompanyID      string    `gorm:"uniqueIndex:task_acceptance_version;index"`
	TaskID         string    `gorm:"uniqueIndex:task_acceptance_version"`
	TaskVersion    int64     `gorm:"uniqueIndex:task_acceptance_version"`
	TaskFactID     string    `gorm:"uniqueIndex"`
	AcceptedAt     time.Time `gorm:"index"`
	AcceptedAtRaw  string
	ActorID        string
	AcceptanceKind string
	State          ReportTaskState `gorm:"serializer:json;type:jsonb"`
}
type TaskTimeFact struct {
	ID            string `gorm:"primaryKey"`
	CompanyID     string `gorm:"uniqueIndex:report_time_entry;index"`
	TimeEntryID   string `gorm:"uniqueIndex:report_time_entry"`
	TaskID        string `gorm:"index"`
	TaskVersion   int64
	TaskFactID    string
	RecordedAt    time.Time
	RecordedAtRaw string
	ObservedAt    *time.Time
	EntryDate     string `gorm:"index"`
	Hours         float64
	ActorID       string
	Provenance    string
}
type ReportFactActor struct {
	ID   string
	Kind string
}
