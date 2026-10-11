package platform

import "time"

type ReportExportJob struct {
	RecipientAccessEpoch int64                `json:"-" gorm:"not null;default:1"`
	ID                   string               `json:"id" gorm:"primaryKey"`
	CompanyID            string               `json:"companyId" gorm:"index"`
	RequestActorID       string               `json:"requestActorId"`
	RecipientID          string               `json:"recipientId"`
	DefinitionID         string               `json:"definitionId"`
	DefinitionRevision   int64                `json:"definitionRevision"`
	ScheduleID           string               `json:"scheduleId"`
	ScheduleVersion      int64                `json:"scheduleVersion"`
	OccurrenceUTC        *time.Time           `json:"occurrenceUTC"`
	ScheduledIdentity    *string              `json:"-" gorm:"uniqueIndex"`
	PayloadHash          string               `json:"-"`
	CSVSchemaVersion     int                  `json:"csvSchemaVersion"`
	Period               ResolvedReportPeriod `json:"period" gorm:"serializer:json;type:jsonb"`
	State                string               `json:"state" gorm:"index"`
	LeaseToken           string               `json:"-"`
	LeaseUntil           *time.Time           `json:"-"`
	AttemptCount         int                  `json:"attemptCount"`
	NextAttemptAt        time.Time            `json:"-"`
	FailureCode          string               `json:"failureCode"`
	SnapshotID           string               `json:"snapshotId"`
	ArtifactID           string               `json:"artifactId"`
	CreatedAt            time.Time            `json:"createdAt"`
	UpdatedAt            time.Time            `json:"updatedAt"`
}
type ReportArtifact struct {
	ID            string    `json:"id" gorm:"primaryKey"`
	CompanyID     string    `json:"-"`
	JobID         string    `json:"jobId" gorm:"uniqueIndex"`
	SnapshotID    string    `json:"snapshotId"`
	RecipientID   string    `json:"-"`
	StoreKey      string    `json:"-"`
	SchemaVersion int       `json:"schemaVersion"`
	SHA256        string    `json:"sha256"`
	Length        int64     `json:"length"`
	CreatedAt     time.Time `json:"createdAt"`
	ExpiresAt     time.Time `json:"expiresAt" gorm:"index"`
	State         string    `json:"state"`
}
type ReportDeliveryIntent struct {
	ID              string `gorm:"primaryKey"`
	CompanyID       string `gorm:"uniqueIndex:report_intent_identity"`
	JobID           string `gorm:"uniqueIndex:report_intent_identity"`
	RecipientID     string `gorm:"uniqueIndex:report_intent_identity"`
	State           string
	AttentionItemID string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}
