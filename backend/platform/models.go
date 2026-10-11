package platform

import "time"

type Company struct {
	ID                   string `json:"id" gorm:"primaryKey;size:80"`
	Name                 string `json:"name"`
	Slug                 string `json:"slug" gorm:"uniqueIndex"`
	Industry             string `json:"industry"`
	Timezone             string `json:"timezone"`
	Color                string `json:"color"`
	CreatedAt            string `json:"createdAt"`
	NextTaskNumber       int64  `json:"-"`
	Currency             string `json:"currency" gorm:"default:INR"`
	FiscalYearStartMonth int    `json:"fiscalYearStartMonth" gorm:"default:4"`
	NextExpenseNumber    int64  `json:"-" gorm:"default:0"`
}
type User struct {
	Suspended       bool   `json:"-"`
	ID              string `json:"id" gorm:"primaryKey;size:80"`
	Name            string `json:"name"`
	Email           string `json:"email" gorm:"uniqueIndex"`
	IsPlatformAdmin bool   `json:"isPlatformAdmin"`
	PasswordHash    string `json:"-"`
}
type Membership struct {
	ID            string  `json:"membershipId" gorm:"primaryKey;size:80"`
	CompanyID     string  `json:"-" gorm:"uniqueIndex:membership_company_user;index"`
	UserID        string  `json:"id" gorm:"uniqueIndex:membership_company_user;index"`
	Role          string  `json:"role"`
	DepartmentID  string  `json:"departmentId"`
	ManagerID     string  `json:"managerId"`
	Title         string  `json:"title"`
	CapacityHours float64 `json:"capacityHours"`
	Avatar        string  `json:"avatar"`
	Active        bool    `json:"active"`
}
type Person struct {
	ID            string  `json:"id"`
	MembershipID  string  `json:"membershipId"`
	Name          string  `json:"name"`
	Email         string  `json:"email"`
	Role          string  `json:"role"`
	DepartmentID  string  `json:"departmentId"`
	ManagerID     string  `json:"managerId"`
	Title         string  `json:"title"`
	CapacityHours float64 `json:"capacityHours"`
	Avatar        string  `json:"avatar"`
	Active        bool    `json:"active"`
}
type Department struct {
	ID          string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID   string `json:"companyId" gorm:"index"`
	Name        string `json:"name"`
	HeadID      string `json:"headId"`
	Color       string `json:"color"`
	Description string `json:"description"`
}
type Project struct {
	Version                 int64  `json:"version" gorm:"default:1"`
	TaskOwnerPolicy         string `json:"taskOwnerPolicy" gorm:"default:actor"`
	DefaultTaskOwnerID      string `json:"defaultTaskOwnerId"`
	DefaultReviewerID       string `json:"defaultReviewerId"`
	DefaultRequiresApproval bool   `json:"defaultRequiresApproval"`
	ID                      string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID               string `json:"companyId" gorm:"index"`
	Name                    string `json:"name"`
	Description             string `json:"description"`
	DepartmentID            string `json:"departmentId"`
	OwnerID                 string `json:"ownerId"`
	DueDate                 string `json:"dueDate"`
	Color                   string `json:"color"`
	Status                  string `json:"status"`
}
type ChecklistItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}
type Task struct {
	ID                   string          `json:"id" gorm:"primaryKey;size:80"`
	Code                 string          `json:"code" gorm:"uniqueIndex:task_company_code"`
	CompanyID            string          `json:"companyId" gorm:"uniqueIndex:task_company_code;index"`
	ProjectID            string          `json:"projectId"`
	DepartmentID         string          `json:"departmentId" gorm:"index"`
	ParentID             string          `json:"parentId"`
	Title                string          `json:"title"`
	Description          string          `json:"description"`
	OwnerID              string          `json:"ownerId" gorm:"index"`
	CreatedBy            string          `json:"createdBy"`
	ReviewerID           string          `json:"reviewerId"`
	Status               string          `json:"status" gorm:"index"`
	Priority             string          `json:"priority"`
	StartDate            string          `json:"startDate"`
	DueDate              string          `json:"dueDate" gorm:"index"`
	DeadlineMode         string          `json:"deadlineMode" gorm:"default:all_day"`
	DueAt                DeadlineInstant `json:"dueAt" gorm:"type:timestamptz"`
	DueTimezone          string          `json:"dueTimezone"`
	OriginalDeadlineMode string          `json:"originalDeadlineMode" gorm:"default:all_day"`
	OriginalDueAt        DeadlineInstant `json:"originalDueAt" gorm:"type:timestamptz"`
	OriginalDueTimezone  string          `json:"originalDueTimezone"`
	OriginalDueDate      string          `json:"originalDueDate"`
	Progress             float64         `json:"progress"`
	EstimatedHours       float64         `json:"estimatedHours"`
	ActualHours          float64         `json:"actualHours"`
	Tags                 []string        `json:"tags" gorm:"serializer:json;type:jsonb"`
	Checklist            []ChecklistItem `json:"checklist" gorm:"serializer:json;type:jsonb"`
	Dependencies         []string        `json:"dependencies" gorm:"serializer:json;type:jsonb"`
	Collaborators        []string        `json:"collaborators" gorm:"serializer:json;type:jsonb"`
	Recurrence           string          `json:"recurrence"`
	RequiresApproval     bool            `json:"requiresApproval"`
	BlockerReason        string          `json:"blockerReason"`
	DeadlineChangeReason string          `json:"deadlineChangeReason"`
	CompletedAt          string          `json:"completedAt"`
	CreatedAt            string          `json:"createdAt"`
	UpdatedAt            string          `json:"updatedAt"`
	Version              int64           `json:"version"`
	Comments             []Comment       `json:"comments" gorm:"foreignKey:TaskID;references:ID"`
	TimeEntries          []TimeEntry     `json:"timeEntries" gorm:"foreignKey:TaskID;references:ID"`
	Attachments          []Attachment    `json:"attachments" gorm:"foreignKey:TaskID;references:ID"`
}
type Comment struct {
	ID        string `json:"id" gorm:"primaryKey;size:80"`
	TaskID    string `json:"-" gorm:"index"`
	CompanyID string `json:"-" gorm:"index"`
	UserID    string `json:"userId"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}
type TimeEntry struct {
	ID        string  `json:"id" gorm:"primaryKey;size:80"`
	TaskID    string  `json:"-" gorm:"index"`
	CompanyID string  `json:"-" gorm:"index"`
	UserID    string  `json:"userId"`
	Hours     float64 `json:"hours"`
	Date      string  `json:"date"`
	Note      string  `json:"note"`
	CreatedAt string  `json:"createdAt"`
}
type Attachment struct {
	ID         string `json:"id" gorm:"primaryKey;size:80"`
	TaskID     string `json:"-" gorm:"index"`
	CompanyID  string `json:"-" gorm:"index"`
	FileName   string `json:"fileName"`
	MimeType   string `json:"mimeType"`
	Size       int64  `json:"size"`
	UploadedBy string `json:"uploadedBy"`
	CreatedAt  string `json:"createdAt"`
	Data       []byte `json:"-"`
}
type Goal struct {
	Version                 int64      `json:"version" gorm:"default:1"`
	CurrentMeasurementID    string     `json:"currentMeasurementId" gorm:"default:''"`
	MeasurementCoverageFrom *time.Time `json:"measurementCoverageFrom"`
	LegacyObservedCurrent   *float64   `json:"legacyObservedCurrent"`
	LegacyObservedUnit      string     `json:"legacyObservedUnit" gorm:"default:''"`
	ID                      string     `json:"id" gorm:"primaryKey;size:80"`
	CompanyID               string     `json:"companyId" gorm:"index"`
	Name                    string     `json:"name"`
	Description             string     `json:"description"`
	OwnerID                 string     `json:"ownerId"`
	DepartmentID            string     `json:"departmentId"`
	Unit                    string     `json:"unit"`
	Baseline                float64    `json:"baseline"`
	Target                  float64    `json:"target"`
	Current                 float64    `json:"current"`
	DueDate                 string     `json:"dueDate"`
	TaskIDs                 []string   `json:"taskIds" gorm:"serializer:json;type:jsonb"`
}
type Activity struct {
	ID        string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID string `json:"companyId" gorm:"index"`
	TaskID    string `json:"taskId" gorm:"index"`
	UserID    string `json:"userId"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"createdAt" gorm:"index"`
}
type Notification struct {
	ID        string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID string `json:"companyId" gorm:"index"`
	UserID    string `json:"userId" gorm:"index"`
	TaskID    string `json:"taskId"`
	ExpenseID string `json:"expenseId" gorm:"default:''"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Kind      string `json:"kind"`
	Read      bool   `json:"read"`
	CreatedAt string `json:"createdAt"`
}
type SessionRecord struct {
	TokenHash string `gorm:"primaryKey;size:64"`
	UserID    string `gorm:"index"`
	CreatedAt time.Time
	ExpiresAt time.Time `gorm:"index"`
}

func (SessionRecord) TableName() string { return "sessions" }

type AutomationRecord struct {
	Key       string `gorm:"primaryKey;size:240"`
	CompanyID string `gorm:"index"`
	CreatedAt string
}
type Session struct {
	User      User      `json:"user"`
	Companies []Company `json:"companies"`
}
type WorkspaceData struct {
	ReadBasis         string            `json:"readBasis"`
	Company           Company           `json:"company"`
	Me                Person            `json:"me"`
	Departments       []Department      `json:"departments"`
	People            []Person          `json:"people"`
	Projects          []Project         `json:"projects"`
	Tasks             []Task            `json:"tasks"`
	Goals             []Goal            `json:"goals"`
	Activities        []Activity        `json:"activities"`
	Notifications     []Notification    `json:"notifications"`
	FinanceScope      string            `json:"financeScope"`
	ExpenseCategories []ExpenseCategory `json:"expenseCategories"`
	Budgets           []Budget          `json:"budgets"`
	Expenses          []Expense         `json:"expenses"`
	FinanceEvents     []FinanceEvent    `json:"financeEvents"`
}
