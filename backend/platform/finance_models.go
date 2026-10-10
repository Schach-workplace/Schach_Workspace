package platform

type ExpenseCategory struct {
	ID              string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID       string `json:"companyId" gorm:"index"`
	Name            string `json:"name"`
	Color           string `json:"color"`
	Active          bool   `json:"active"`
	ReceiptRequired bool   `json:"receiptRequired"`
	Version         int64  `json:"version"`
}

type Budget struct {
	ID           string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID    string `json:"companyId" gorm:"index"`
	DepartmentID string `json:"departmentId" gorm:"index"`
	Name         string `json:"name"`
	StartDate    string `json:"startDate"`
	EndDate      string `json:"endDate"`
	AmountMinor  int64  `json:"amountMinor"`
	Currency     string `json:"currency"`
	Status       string `json:"status"`
	Notes        string `json:"notes"`
	CreatedBy    string `json:"createdBy"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	Version      int64  `json:"version"`
}

type Expense struct {
	ID                     string           `json:"id" gorm:"primaryKey;size:80"`
	CompanyID              string           `json:"companyId" gorm:"uniqueIndex:expense_company_code;index"`
	Code                   string           `json:"code" gorm:"uniqueIndex:expense_company_code"`
	DepartmentID           string           `json:"departmentId" gorm:"index"`
	CategoryID             string           `json:"categoryId" gorm:"index"`
	Title                  string           `json:"title"`
	Description            string           `json:"description"`
	Vendor                 string           `json:"vendor"`
	InvoiceNumber          string           `json:"invoiceNumber"`
	VendorKey              string           `json:"-"`
	InvoiceKey             string           `json:"-"`
	ExpenseDate            string           `json:"expenseDate" gorm:"index"`
	AmountMinor            int64            `json:"amountMinor"`
	Currency               string           `json:"currency"`
	ProjectID              string           `json:"projectId"`
	TaskID                 string           `json:"taskId"`
	CreatedBy              string           `json:"createdBy" gorm:"index"`
	Status                 string           `json:"status" gorm:"index"`
	ReceiptExceptionReason string           `json:"receiptExceptionReason"`
	SubmittedAt            string           `json:"submittedAt"`
	ReviewedBy             string           `json:"reviewedBy"`
	ReviewedAt             string           `json:"reviewedAt"`
	ReviewNote             string           `json:"reviewNote"`
	BudgetOverrideReason   string           `json:"budgetOverrideReason"`
	PaidBy                 string           `json:"paidBy"`
	PaidAt                 string           `json:"paidAt"`
	PaidDate               string           `json:"paidDate"`
	PaymentMethod          string           `json:"paymentMethod"`
	PaymentReference       string           `json:"paymentReference"`
	CreatedAt              string           `json:"createdAt"`
	UpdatedAt              string           `json:"updatedAt"`
	Version                int64            `json:"version"`
	Receipts               []ExpenseReceipt `json:"receipts" gorm:"foreignKey:ExpenseID;references:ID"`
}

type ExpenseReceipt struct {
	ID         string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID  string `json:"-" gorm:"index"`
	ExpenseID  string `json:"-" gorm:"index"`
	FileName   string `json:"fileName"`
	MimeType   string `json:"mimeType"`
	Size       int64  `json:"size"`
	UploadedBy string `json:"uploadedBy"`
	CreatedAt  string `json:"createdAt"`
	Data       []byte `json:"-"`
}

type FinanceEvent struct {
	ID           string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID    string `json:"companyId" gorm:"index"`
	DepartmentID string `json:"departmentId" gorm:"index"`
	EntityType   string `json:"entityType" gorm:"index"`
	EntityID     string `json:"entityId" gorm:"index"`
	UserID       string `json:"userId"`
	Action       string `json:"action"`
	Detail       string `json:"detail"`
	CreatedAt    string `json:"createdAt" gorm:"index"`
}
