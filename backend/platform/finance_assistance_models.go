package platform

import "time"

// Scratch records never authorize their independently retained destination evidence.
type FinanceAssistanceIntake struct {
	ID                      string    `json:"id" gorm:"primaryKey"`
	CompanyID               string    `json:"-" gorm:"index"`
	OwnerID                 string    `json:"-"`
	Purpose                 string    `json:"purpose"`
	SessionRef              string    `json:"-"`
	StoreKey                string    `json:"-"`
	FileName                string    `json:"fileName"`
	Size                    int64     `json:"size"`
	MimeType                string    `json:"mimeType"`
	InternalSHA256          string    `json:"-"`
	State                   string    `json:"state"`
	ContentGeneration       int64     `json:"-"`
	CleanGeneration         int64     `json:"-"`
	Version                 int64     `json:"version"`
	DestinationDepartmentID string    `json:"destinationDepartmentId,omitempty"`
	CreatedAt               time.Time `json:"createdAt"`
	ExpiresAt               time.Time `json:"expiresAt" gorm:"index"`
}
type ReceiptEvidenceFingerprint struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	CompanyID      string    `json:"-" gorm:"index"`
	ReceiptID      string    `json:"-" gorm:"uniqueIndex:receipt_assessment_identity"`
	ExpenseID      string    `json:"-"`
	RequesterID    string    `json:"-"`
	SessionRef     string    `json:"-"`
	SHA256         string    `json:"-" gorm:"uniqueIndex:receipt_assessment_identity"`
	ScannerVersion string    `json:"engine" gorm:"uniqueIndex:receipt_assessment_identity"`
	Size           int64     `json:"-"`
	MimeType       string    `json:"-"`
	State          string    `json:"state"`
	Generation     int64     `json:"generation"`
	AssessedAt     time.Time `json:"assessedAt"`
}
type FinanceAssistanceJob struct {
	ID                      string    `json:"id" gorm:"primaryKey"`
	CompanyID               string    `json:"-" gorm:"index"`
	RequesterID             string    `json:"-"`
	SessionRef              string    `json:"-"`
	Operation               string    `json:"operation"`
	SourceKind              string    `json:"sourceKind"`
	SourceID                string    `json:"sourceId"`
	SourceParentID          string    `json:"-"`
	SourceVersion           int64     `json:"sourceVersion"`
	InternalHash            string    `json:"-"`
	ContentGeneration       int64     `json:"-"`
	CleanGeneration         int64     `json:"-"`
	DestinationDepartmentID string    `json:"destinationDepartmentId"`
	TargetExpenseID         string    `json:"targetExpenseId,omitempty"`
	TargetVersion           int64     `json:"targetVersion,omitempty"`
	CompanyCurrency         string    `json:"-"`
	ProviderFingerprint     string    `json:"-"`
	Status                  string    `json:"status" gorm:"index"`
	Version                 int64     `json:"version"`
	Attempts                int       `json:"-"`
	AvailableAt             time.Time `json:"-" gorm:"index"`
	LeaseToken              string    `json:"-"`
	LeaseUntil              time.Time `json:"-"`
	CreatedAt               time.Time `json:"createdAt"`
	UpdatedAt               time.Time `json:"updatedAt"`
	ExpiresAt               time.Time `json:"expiresAt"`
	ErrorCode               string    `json:"errorCode,omitempty"`
	ResultID                string    `json:"resultId,omitempty"`
}
