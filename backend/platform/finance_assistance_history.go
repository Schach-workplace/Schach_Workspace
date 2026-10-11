package platform

import (
	"gorm.io/gorm"
	"time"
)

// Private scratch history records bounded operation metadata, never OCR text,
// bank cells, filenames, content hashes, credentials or lease/session tokens.
// It remains separate from the independently retained expense ledger audit.
type FinanceAssistanceHistory struct {
	ID         string `gorm:"primaryKey"`
	CompanyID  string `gorm:"index:finance_assistance_history_owner"`
	ActorID    string `gorm:"index:finance_assistance_history_owner"`
	Operation  string
	ResultKind string
	ResultIDs  []string `gorm:"serializer:json;type:jsonb"`
	CreatedAt  time.Time
}

func financeBusinessMutation(tx *gorm.DB, a *access, operation, key string, intent any, authorizeIntent func() error, authorizeResult func(BusinessResult) error, apply func() (BusinessResult, error)) (BusinessResult, error) {
	return businessMutation(tx, a, operation, key, intent, authorizeIntent, authorizeResult, func() (BusinessResult, error) {
		result, e := apply()
		if e != nil {
			return result, e
		}
		history := FinanceAssistanceHistory{ID: newID("fh"), CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: operation, ResultKind: result.Kind, ResultIDs: result.IDs, CreatedAt: time.Now().UTC()}
		if e = tx.Create(&history).Error; e != nil {
			return BusinessResult{}, e
		}
		return result, nil
	})
}
