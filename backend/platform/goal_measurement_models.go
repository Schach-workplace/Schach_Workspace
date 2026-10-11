package platform

import "time"

type GoalEvidenceInput struct {
	Kind        string `json:"kind"`
	SourceID    string `json:"sourceId"`
	ParentID    string `json:"parentId"`
	Revision    int64  `json:"revision,omitempty"`
	ContentHash string `json:"contentHash"`
}
type GoalEvidenceBinding struct {
	GoalEvidenceInput
	HistoryEpoch int64 `json:"historyEpoch,omitempty"`
	Sequence     int64 `json:"sequence,omitempty"`
}
type GoalMeasurement struct {
	ID               string                `json:"id" gorm:"primaryKey"`
	CompanyID        string                `json:"-" gorm:"index"`
	GoalID           string                `json:"goalId" gorm:"index"`
	ActorID          string                `json:"actorId"`
	Value            float64               `json:"value"`
	EffectiveAt      time.Time             `json:"effectiveAt"`
	Reason           string                `json:"reason"`
	CorrectsID       string                `json:"correctsId,omitempty"`
	CreatedAt        time.Time             `json:"createdAt"`
	GoalVersionAfter int64                 `json:"goalVersionAfter"`
	Unit             string                `json:"unit"`
	Baseline         float64               `json:"baseline"`
	Target           float64               `json:"target"`
	Evidence         []GoalEvidenceBinding `json:"-" gorm:"serializer:json;type:jsonb"`
}
type GoalRevision struct {
	ID        string `gorm:"primaryKey"`
	CompanyID string `gorm:"index"`
	GoalID    string `gorm:"index"`
	ActorID   string
	Reason    string
	CreatedAt time.Time
	Version   int64
	Before    Goal `gorm:"serializer:json;type:jsonb"`
	After     Goal `gorm:"serializer:json;type:jsonb"`
}
type GoalAudit struct {
	ID        string `gorm:"primaryKey"`
	CompanyID string
	GoalID    string
	ActorID   string
	Action    string
	Version   int64
	CreatedAt time.Time
}
type GoalMeasurementInput struct {
	RetryKey        string              `json:"retryKey"`
	ExpectedVersion int64               `json:"expectedVersion"`
	Value           float64             `json:"value"`
	EffectiveAt     string              `json:"effectiveAt"`
	Reason          string              `json:"reason"`
	Evidence        []GoalEvidenceInput `json:"evidence"`
	CorrectsID      string              `json:"correctsId,omitempty"`
}
