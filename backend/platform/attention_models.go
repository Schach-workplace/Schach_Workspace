package platform

import "time"

// AttentionItem stores identifiers and attention outcomes, never source previews.
type AttentionItem struct {
	ID               string `gorm:"primaryKey;size:80"`
	CompanyID        string `gorm:"uniqueIndex:attention_obligation;index"`
	RecipientID      string `gorm:"uniqueIndex:attention_obligation;index"`
	SourceKind       string `gorm:"uniqueIndex:attention_obligation"`
	SourceID         string `gorm:"uniqueIndex:attention_obligation"`
	SourceRevision   int64
	RecordRevision   int64
	OccurrenceKey    string `gorm:"uniqueIndex:attention_obligation"`
	Kind             string `gorm:"uniqueIndex:attention_obligation"`
	ConversationID   string
	AnchorMessageID  string
	MessageSequence  int64
	RecipientEpoch   int64
	State            string
	Version          int64
	SnoozedUntil     *time.Time
	DueAt            *time.Time
	RoutedToID       string
	ResolvedBy       string
	ResolvedAt       *time.Time
	ResolutionReason string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}
type AttentionRetry struct {
	CompanyID     string `gorm:"primaryKey;size:80"`
	ActorID       string `gorm:"primaryKey;size:80"`
	Operation     string `gorm:"primaryKey;size:80"`
	RetryKey      string `gorm:"primaryKey;size:120"`
	RequestHash   string
	ItemID        string
	ResultItemID  string
	ResultVersion int64
	CreatedAt     time.Time
}
type AttentionPreference struct {
	CompanyID              string `json:"-" gorm:"primaryKey;size:80"`
	UserID                 string `json:"-" gorm:"primaryKey;size:80"`
	Version                int64  `json:"version"`
	WorkingHoursEnabled    bool   `json:"workingHoursEnabled"`
	WorkingDays            []int  `json:"workingDays" gorm:"serializer:json;type:jsonb"`
	WorkingStart           string `json:"workingStart"`
	WorkingEnd             string `json:"workingEnd"`
	QuietStart             string `json:"quietStart"`
	QuietEnd               string `json:"quietEnd"`
	EscalationEnabled      bool   `json:"escalationEnabled"`
	EscalationAfterMinutes int    `json:"escalationAfterMinutes"`
	EscalationUserID       string `json:"escalationUserId"`
}
type AttentionReminder struct {
	ID          string `gorm:"primaryKey;size:80"`
	CompanyID   string `gorm:"uniqueIndex:attention_reminder_window"`
	ItemID      string `gorm:"uniqueIndex:attention_reminder_window"`
	RecipientID string `gorm:"uniqueIndex:attention_reminder_window"`
	Stage       string `gorm:"uniqueIndex:attention_reminder_window"`
	WindowKey   string `gorm:"uniqueIndex:attention_reminder_window"`
	AvailableAt time.Time
	LeaseToken  string
	LeaseUntil  *time.Time
	Attempts    int
	DeliveredAt *time.Time
	CancelledAt *time.Time
}

// Explicit DTO excludes persistence-only private source, occurrence and history fields.
type AttentionView struct {
	ID            string     `json:"id"`
	CompanyID     string     `json:"companyId"`
	RecipientID   string     `json:"recipientId"`
	SourceKind    string     `json:"sourceKind"`
	SourceID      string     `json:"sourceId"`
	Kind          string     `json:"kind"`
	State         string     `json:"state"`
	Version       int64      `json:"version"`
	SourceVersion int64      `json:"sourceVersion"`
	Title         string     `json:"title"`
	Summary       string     `json:"summary"`
	Link          string     `json:"link"`
	OwnerName     string     `json:"ownerName"`
	CanDecide     bool       `json:"canDecide"`
	CanRoute      bool       `json:"canRoute"`
	Actions       []string   `json:"actions"`
	RoutePeople   []Person   `json:"routePeople"`
	SnoozedUntil  *time.Time `json:"snoozedUntil"`
	DueAt         *time.Time `json:"dueAt"`
	ReminderState string     `json:"reminderState"`
}
type AttentionTransitionInput struct {
	ExpectedVersion int64      `json:"expectedVersion"`
	RetryKey        string     `json:"retryKey"`
	Action          string     `json:"action"`
	Reason          string     `json:"reason"`
	SnoozedUntil    *time.Time `json:"snoozedUntil,omitempty"`
	RecipientID     string     `json:"recipientId,omitempty"`
}

// AttentionDelivery is the durable IDs-only local Inbox delivery receipt.
type AttentionDelivery struct {
	ID          string `gorm:"primaryKey;size:80"`
	CompanyID   string
	ItemID      string
	RecipientID string
	Stage       string
	CreatedAt   time.Time
}
