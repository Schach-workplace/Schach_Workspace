package platform

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// Successful identities live for the company's lifetime. Only identifiers and
// versions are retained here; current scope is checked before every replay.
type BusinessMutationRetry struct {
	CompanyID      string `gorm:"primaryKey"`
	ActorID        string `gorm:"primaryKey"`
	Operation      string `gorm:"primaryKey"`
	RetryKey       string `gorm:"primaryKey"`
	RequestHash    string
	ResultKind     string
	ResultIDs      []string `gorm:"serializer:json;type:jsonb"`
	ResultVersions []int64  `gorm:"serializer:json;type:jsonb"`
	CreatedAt      string
}
type BusinessResult struct {
	Kind     string   `json:"kind"`
	IDs      []string `json:"ids"`
	Versions []int64  `json:"versions"`
}

func optionalBusinessKey(f map[string]json.RawMessage) (string, error) {
	v, ok := f["retryKey"]
	if !ok {
		return "", nil
	}
	var key string
	if json.Unmarshal(v, &key) != nil || !clean(key, 100) {
		return "", invalid("A nonblank retry key of at most 100 characters is required.")
	}
	return key, nil
}
func businessHash(intent any) (string, error) {
	b, e := json.Marshal(intent)
	if e != nil {
		return "", e
	}
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.UseNumber()
	var normalized any
	if e = decoder.Decode(&normalized); e != nil {
		return "", e
	}
	b, e = json.Marshal(normalized)
	if e != nil {
		return "", e
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}
func businessMutation(tx *gorm.DB, a *access, operation, key string, intent any, authorizeIntent func() error, authorizeResult func(BusinessResult) error, apply func() (BusinessResult, error)) (BusinessResult, error) {
	var out BusinessResult
	if !clean(key, 100) || strings.TrimSpace(key) == "" {
		return out, invalid("A nonblank retry key of at most 100 characters is required.")
	}
	if e := authorizeIntent(); e != nil {
		return out, e
	}
	hash, e := businessHash(intent)
	if e != nil {
		return out, e
	}
	var stored BusinessMutationRetry
	e = tx.Where("company_id = ? AND actor_id = ? AND operation = ? AND retry_key = ?", a.Company.ID, a.User.ID, operation, key).First(&stored).Error
	if e == nil {
		if stored.RequestHash != hash {
			return out, conflict()
		}
		out = BusinessResult{Kind: stored.ResultKind, IDs: stored.ResultIDs, Versions: stored.ResultVersions}
		if e = authorizeResult(out); e != nil {
			return BusinessResult{}, e
		}
		return out, nil
	}
	if e != gorm.ErrRecordNotFound {
		return out, e
	}
	out, e = apply()
	if e != nil {
		return BusinessResult{}, e
	}
	stored = BusinessMutationRetry{CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: operation, RetryKey: key, RequestHash: hash, ResultKind: out.Kind, ResultIDs: out.IDs, ResultVersions: out.Versions, CreatedAt: nowString()}
	if e = tx.Create(&stored).Error; e != nil {
		return BusinessResult{}, e
	}
	return out, nil
}
func authorizeTaskResults(tx *gorm.DB, a *access, result BusinessResult) error {
	for _, id := range result.IDs {
		if _, e := scopedTask(tx, a, id); e != nil {
			return e
		}
	}
	return nil
}

// This callback creates neither identifiers nor workflow side effects. Creation
// validation runs only for a first execution, allowing changed canonical tasks.
func authorizeTaskCreation(tx *gorm.DB, a *access, f map[string]json.RawMessage) error {
	if a.Member.Role == "viewer" {
		return denied()
	}
	t := Task{CompanyID: a.Company.ID, CreatedBy: a.User.ID, Priority: "medium", Status: "todo", Recurrence: "none"}
	if e := applyFields(f, &t); e != nil {
		return e
	}
	for i := range t.Checklist {
		if t.Checklist[i].ID == "" {
			t.Checklist[i].ID = fmt.Sprintf("scope_check_%d", i)
		}
	}
	if e := validateTask(tx, a, &t); e != nil {
		return e
	}
	if !a.activeUser(t.OwnerID) || !a.canCreate(t.OwnerID, t.DepartmentID) {
		return denied()
	}
	if t.ReviewerID != "" && (!a.activeUser(t.ReviewerID) || a.Members[t.ReviewerID].Role == "viewer" || t.ReviewerID == t.OwnerID) {
		return invalid("Choose an active independent reviewer.")
	}
	if !departmentExists(tx, a.Company.ID, t.DepartmentID) {
		return denied()
	}
	if t.ProjectID != "" {
		var p Project
		if e := tx.Where("id = ? AND company_id = ?", t.ProjectID, a.Company.ID).First(&p).Error; e != nil {
			return missing()
		}
		visible, e := canReadProject(tx, a, p)
		if e != nil {
			return e
		}
		if !visible {
			return missing()
		}
	}
	for _, id := range append(append([]string{}, t.Dependencies...), t.ParentID) {
		if id != "" {
			if _, e := scopedTask(tx, a, id); e != nil {
				return e
			}
		}
	}
	for _, id := range t.Collaborators {
		if !a.activeUser(id) {
			return denied()
		}
	}
	return nil
}
