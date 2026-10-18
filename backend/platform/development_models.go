package platform

type DevelopmentFields struct {
	Pilot           string   `json:"pilot"`
	Title           string   `json:"title"`
	CareerRole      string   `json:"careerRole"`
	CareerLevel     string   `json:"careerLevel"`
	CompetencyIDs   []string `json:"competencyIds" gorm:"serializer:json;type:jsonb"`
	Objective       string   `json:"objective"`
	LearningActions []string `json:"learningActions" gorm:"serializer:json;type:jsonb"`
	EvidenceNote    string   `json:"evidenceNote"`
	MentorID        string   `json:"mentorId"`
	State           string   `json:"state"`
}
type DevelopmentPlan struct {
	ID                string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID         string `json:"-" gorm:"index"`
	OwnerID           string `json:"ownerId"`
	Version           int64  `json:"version"`
	DevelopmentFields `gorm:"embedded"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}
type DevelopmentReview struct {
	ID          string `json:"id" gorm:"primaryKey;size:80"`
	CompanyID   string `json:"-" gorm:"index"`
	PlanID      string `json:"planId" gorm:"index"`
	MentorID    string `json:"mentorId"`
	Feedback    string `json:"feedback"`
	NextStep    string `json:"nextStep"`
	PlanVersion int64  `json:"planVersion"`
	CreatedAt   string `json:"createdAt"`
}
type DevelopmentCompetency struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}
type DevelopmentPilot struct {
	ID                string                  `json:"id"`
	Label             string                  `json:"label"`
	CareerRoles       []string                `json:"careerRoles"`
	Levels            []string                `json:"levels"`
	Competencies      []DevelopmentCompetency `json:"competencies"`
	SuggestedLearning []string                `json:"suggestedLearning"`
	RoleMeaning       string                  `json:"roleMeaning"`
}

func developmentCatalog() []DevelopmentPilot {
	return []DevelopmentPilot{
		{"engineering", "Engineering", []string{"Software engineer", "Engineering specialist"}, []string{"foundation", "practitioner", "advanced"}, []DevelopmentCompetency{{"engineering.reliability", "Reliability"}, {"engineering.design", "System design"}, {"engineering.collaboration", "Technical collaboration"}}, []string{"Practice incident review", "Review a system design", "Pair on a technical problem"}, "Career development only; separate from application permission roles"},
		{"office", "Office", []string{"Operations specialist", "Office coordinator"}, []string{"foundation", "practitioner", "advanced"}, []DevelopmentCompetency{{"office.communication", "Communication"}, {"office.planning", "Planning"}, {"office.analysis", "Analysis"}}, []string{"Practice a stakeholder update", "Plan a small improvement", "Discuss an analysis example"}, "Career development only; separate from application permission roles"},
		{"field", "Field", []string{"Field specialist", "Field coordinator"}, []string{"foundation", "practitioner", "advanced"}, []DevelopmentCompetency{{"field.practice", "Field practice"}, {"field.coordination", "Coordination"}, {"field.quality", "Quality"}}, []string{"Reflect on a field practice", "Practice a team handover", "Review a quality example"}, "Career development only; separate from application permission roles"},
	}
}
