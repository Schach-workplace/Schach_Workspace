package platform

// Communication records never enter taskless company Activity/Notification rows.
type Conversation struct {
	ID           string `json:"id" gorm:"primaryKey;size:80;uniqueIndex:conversation_company_id"`
	CompanyID    string `json:"companyId" gorm:"index;uniqueIndex:conversation_company_id"`
	Title        string `json:"title"`
	Kind         string `json:"kind"`
	Public       bool   `json:"public"`
	PairKey      string `json:"-"`
	Forwarding   string `json:"forwarding"`
	Version      int64  `json:"version"`
	NextSequence int64  `json:"-"`
	NextEvent    int64  `json:"-"`
	Archived     bool   `json:"archived"`
	CreatedBy    string `json:"createdBy"`
	CreatedAt    string `json:"createdAt"`
}
type ConversationMember struct {
	CompanyID           string `json:"-" gorm:"primaryKey;size:80"`
	ConversationID      string `json:"conversationId" gorm:"primaryKey;size:80"`
	UserID              string `json:"userId" gorm:"primaryKey;size:80"`
	Role                string `json:"role"`
	Active              bool   `json:"active"`
	HistoryFromSequence int64  `json:"historyFromSequence"`
	ReadSequence        int64  `json:"readSequence"`
	Epoch               int64  `json:"epoch"`
}
type ConversationInterval struct {
	ID              string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID       string `json:"-" gorm:"index"`
	ConversationID  string `json:"conversationId" gorm:"index"`
	UserID          string `json:"userId" gorm:"index"`
	FromSequence    int64  `json:"fromSequence"`
	ThroughSequence *int64 `json:"throughSequence"`
	JoinedAt        string `json:"joinedAt"`
	LeftAt          string `json:"leftAt"`
}
