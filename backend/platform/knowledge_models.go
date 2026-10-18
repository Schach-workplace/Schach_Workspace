package platform

type KnowledgeFields struct {
	Pilot         string   `json:"pilot"`
	Title         string   `json:"title"`
	Body          string   `json:"body"`
	ReviewerID    string   `json:"reviewerId"`
	Audience      string   `json:"audience"`
	ReaderIDs     []string `json:"readerIds" gorm:"serializer:json;type:jsonb"`
	State         string   `json:"state"`
	ReviewDueDate string   `json:"reviewDueDate"`
}
type KnowledgeArticle struct {
	ID              string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID       string `json:"-" gorm:"index"`
	OwnerID         string `json:"ownerId"`
	Version         int64  `json:"version"`
	KnowledgeFields `gorm:"embedded"`
	ReviewedVersion int64  `json:"reviewedVersion,omitempty"`
	ReviewedBy      string `json:"reviewedBy,omitempty"`
	ReviewedAt      string `json:"reviewedAt,omitempty"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}
type KnowledgeReview struct {
	ID             string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID      string `json:"-" gorm:"index"`
	ArticleID      string `json:"articleId" gorm:"index"`
	ArticleVersion int64  `json:"articleVersion"`
	ReviewerID     string `json:"reviewerId"`
	Decision       string `json:"decision"`
	Reason         string `json:"reason"`
	CreatedAt      string `json:"createdAt"`
}
