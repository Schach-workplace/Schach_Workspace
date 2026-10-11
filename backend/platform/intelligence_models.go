package platform

import (
	"encoding/json"
	"time"
)

type IntelligenceOperation string

const intelligencePolicy = "local-selected-v1"

type IntelligenceSourceRequest struct {
	Kind                string           `json:"kind"`
	ID                  string           `json:"id"`
	ParentID            string           `json:"parentId,omitempty"`
	ConversationID      string           `json:"conversationId,omitempty"`
	ExpectedRevision    int64            `json:"expectedRevision,omitempty"`
	ExpectedVersion     int64            `json:"expectedVersion,omitempty"`
	ExpectedContentHash string           `json:"expectedContentHash,omitempty"`
	SelectedFieldSet    string           `json:"selectedFieldSet"`
	Filters             *PlanningFilters `json:"filters,omitempty"`
}
type IntelligenceSelection struct {
	Operation IntelligenceOperation       `json:"operation"`
	Sources   []IntelligenceSourceRequest `json:"sources"`
	Language  string                      `json:"language,omitempty"`
}
type IntelligenceOptIn struct {
	Accepted      bool   `json:"accepted"`
	PolicyVersion string `json:"policyVersion"`
}
type IntelligenceEnqueue struct {
	IntelligenceSelection
	RetryKey      string            `json:"retryKey"`
	SelectionHash string            `json:"selectionHash"`
	OptIn         IntelligenceOptIn `json:"optIn"`
}
type ProviderIdentity struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	Digest     string `json:"digest"`
	ConfigHash string `json:"configHash"`
}
type BoundIntelligenceSource struct {
	SourceKey           string                    `json:"sourceKey"`
	Request             IntelligenceSourceRequest `json:"request"`
	BindingMode         string                    `json:"bindingMode"`
	CompanyID           string                    `json:"companyId"`
	Revision            int64                     `json:"revision"`
	Version             int64                     `json:"version"`
	ContentHash         string                    `json:"contentHash"`
	PolicyVersion       int64                     `json:"policyVersion"`
	MemberEpoch         int64                     `json:"memberEpoch"`
	HistoryFromSequence int64                     `json:"historyFromSequence"`
	Sequence            int64                     `json:"sequence"`
	ExpiresAt           time.Time                 `json:"expiresAt,omitempty"`
	SourceSchemaVersion int                       `json:"sourceSchemaVersion"`
	Roots               []IntelligenceRoot        `json:"roots"`
	Label               string                    `json:"-"`
	Text                string                    `json:"-"`
	Value               any                       `json:"-"`
}
type IntelligenceRoot struct {
	Kind     string               `json:"kind"`
	ID       string               `json:"id"`
	ParentID string               `json:"parentId,omitempty"`
	Hash     string               `json:"hash,omitempty"`
	Evidence *GoalEvidenceBinding `json:"evidence,omitempty"`
}
type SourceManifest struct {
	Sources       []BoundIntelligenceSource `json:"sources"`
	SourceSetHash string                    `json:"sourceSetHash"`
	ExpiresAt     time.Time                 `json:"expiresAt"`
}
type SourceCheckMode int

const (
	IntelligenceExactCurrent SourceCheckMode = iota
	IntelligenceCurrentACL
)

type IntelligenceJob struct {
	ID                            string                `gorm:"primaryKey"`
	CompanyID                     string                `gorm:"uniqueIndex:intelligence_retry;index"`
	ActorID                       string                `gorm:"uniqueIndex:intelligence_retry"`
	Operation                     IntelligenceOperation `gorm:"uniqueIndex:intelligence_retry"`
	RetryKey                      string                `gorm:"uniqueIndex:intelligence_retry"`
	OriginatingSessionRef         string
	CapturedUserEpoch             int64
	CapturedCompanyAuthorityEpoch int64
	ClientIntentHash              string
	EffectiveRequestHash          string
	SourceSetHash                 string
	OptInVersion                  string
	Provider                      ProviderIdentity      `gorm:"serializer:json;type:jsonb"`
	Selection                     IntelligenceSelection `gorm:"serializer:json;type:jsonb"`
	State                         string                `gorm:"index"`
	Attempts                      int
	NextAttemptAt                 time.Time `gorm:"index"`
	LeaseToken                    string
	LeaseUntil                    time.Time
	CancellationVersion           int64
	ReasonCode                    string
	CreatedAt                     time.Time
	UpdatedAt                     time.Time
	ExpiresAt                     time.Time `gorm:"index"`
	ResultHash                    string
	ResultJSON                    string
}
type IntelligenceSource struct {
	JobID     string                  `gorm:"primaryKey"`
	SourceKey string                  `gorm:"primaryKey"`
	CompanyID string                  `gorm:"index:intelligence_source_reverse"`
	Kind      string                  `gorm:"index:intelligence_source_reverse"`
	SourceID  string                  `gorm:"index:intelligence_source_reverse"`
	Binding   BoundIntelligenceSource `gorm:"serializer:json;type:jsonb"`
}
type IntelligencePublication struct {
	Outcome             string `gorm:"not null;default:created"`
	ID                  string `gorm:"primaryKey"`
	JobID               string `gorm:"index"`
	CompanyID           string
	ActorID             string
	ResultHash          string
	DestinationKind     string
	CanonicalResultID   string
	CanonicalOperation  string
	RetryKey            string
	ReviewedPayloadHash string
	Manifest            SourceManifest `gorm:"serializer:json;type:jsonb"`
}
type IntelligenceResult struct {
	SchemaVersion    int                       `json:"schemaVersion"`
	Operation        IntelligenceOperation     `json:"operation"`
	SourceSetHash    string                    `json:"sourceSetHash"`
	ProviderIdentity ProviderIdentity          `json:"providerIdentity"`
	Limitations      []string                  `json:"limitations"`
	Language         string                    `json:"language,omitempty"`
	Uncertain        bool                      `json:"uncertain,omitempty"`
	Segments         []IntelligenceSegment     `json:"segments,omitempty"`
	Claims           []IntelligenceClaim       `json:"claims,omitempty"`
	Candidates       []IntelligenceCandidate   `json:"candidates,omitempty"`
	Items            []IntelligenceExplanation `json:"items,omitempty"`
}
type IntelligenceSegment struct {
	StartMS   int64  `json:"startMs"`
	EndMS     int64  `json:"endMs"`
	Text      string `json:"text"`
	SourceKey string `json:"sourceKey"`
}
type IntelligenceClaim struct {
	Text       string   `json:"text"`
	SourceKeys []string `json:"sourceKeys"`
	Confidence string   `json:"confidence"`
}
type IntelligenceCandidate struct {
	Kind        string   `json:"kind"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	SourceKeys  []string `json:"sourceKeys"`
	OwnerID     *string  `json:"ownerId"`
	DueDate     *string  `json:"dueDate"`
	ReviewerID  *string  `json:"reviewerId"`
	AmountMinor *int64   `json:"amountMinor"`
	Currency    *string  `json:"currency"`
	Unresolved  []string `json:"unresolved"`
}
type IntelligenceExplanation struct {
	FactKey         string   `json:"factKey"`
	Relation        string   `json:"relation"`
	ExplanationCode string   `json:"explanationCode"`
	SourceKeys      []string `json:"sourceKeys"`
	Text            string   `json:"text,omitempty"`
}
type IntelligenceJobView struct {
	Operation     IntelligenceOperation `json:"operation"`
	Publication   map[string]any        `json:"publication,omitempty"`
	JobID         string                `json:"jobId"`
	State         string                `json:"state"`
	ReasonCode    string                `json:"reasonCode,omitempty"`
	ExpiresAt     time.Time             `json:"expiresAt"`
	ResultHash    string                `json:"resultHash,omitempty"`
	SourceSetHash string                `json:"sourceSetHash,omitempty"`
	Result        json.RawMessage       `json:"result,omitempty"`
	Sources       []map[string]any      `json:"sources,omitempty"`
}
