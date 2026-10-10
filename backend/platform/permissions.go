package platform

import (
	"net/http"
	"time"

	"gorm.io/gorm"
)

type access struct {
	User    User
	Company Company
	Member  Membership
	Members map[string]Membership
	Users   map[string]User
}

func leadership(role string) bool { return in(role, "founder", "ceo", "admin") }
func rank(role string) int {
	switch role {
	case "founder":
		return 7
	case "ceo":
		return 6
	case "admin":
		return 5
	case "head":
		return 4
	case "manager":
		return 3
	case "finance":
		return 3
	case "member":
		return 2
	case "viewer":
		return 1
	}
	return 0
}
func (s *Server) access(r *http.Request) (*access, error) {
	u, _, err := s.authenticate(r)
	if err != nil {
		return nil, err
	}
	a := &access{User: u, Members: map[string]Membership{}, Users: map[string]User{}}
	cid := r.PathValue("cid")
	if err = s.db.WithContext(r.Context()).Where("company_id = ? AND user_id = ? AND active = ?", cid, u.ID, true).First(&a.Member).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, denied()
		}
		return nil, err
	}
	if err = s.db.WithContext(r.Context()).First(&a.Company, "id = ?", cid).Error; err != nil {
		return nil, err
	}
	var ms []Membership
	if err = s.db.WithContext(r.Context()).Where("company_id = ?", cid).Find(&ms).Error; err != nil {
		return nil, err
	}
	ids := []string{}
	for _, m := range ms {
		a.Members[m.UserID] = m
		ids = append(ids, m.UserID)
	}
	var us []User
	if err = s.db.WithContext(r.Context()).Where("id IN ?", ids).Find(&us).Error; err != nil {
		return nil, err
	}
	for _, v := range us {
		a.Users[v.ID] = v
	}
	return a, nil
}
func (a *access) ownsScope(uid string) bool {
	if uid == a.User.ID {
		return true
	}
	if leadership(a.Member.Role) || a.Member.Role == "viewer" {
		return true
	}
	m, ok := a.Members[uid]
	if !ok || !m.Active {
		return false
	}
	if a.Member.Role == "head" {
		return a.Member.DepartmentID != "" && m.DepartmentID == a.Member.DepartmentID
	}
	if a.Member.Role == "manager" {
		seen := map[string]bool{}
		for m.ManagerID != "" && !seen[m.UserID] {
			seen[m.UserID] = true
			if m.ManagerID == a.User.ID {
				return true
			}
			var exists bool
			m, exists = a.Members[m.ManagerID]
			if !exists {
				return false
			}
		}
	}
	return false
}
func (a *access) canRead(t Task) bool {
	if leadership(a.Member.Role) || a.Member.Role == "viewer" {
		return true
	}
	if t.OwnerID == a.User.ID || t.CreatedBy == a.User.ID || t.ReviewerID == a.User.ID || in(a.User.ID, t.Collaborators...) {
		return true
	}
	if a.Member.Role == "head" && a.Member.DepartmentID != "" && t.DepartmentID == a.Member.DepartmentID {
		return true
	}
	return a.Member.Role == "manager" && a.ownsScope(t.OwnerID)
}
func (a *access) canWrite(t Task) bool {
	if a.Member.Role == "viewer" {
		return false
	}
	if leadership(a.Member.Role) {
		return true
	}
	if a.Member.Role == "head" && a.Member.DepartmentID != "" && t.DepartmentID == a.Member.DepartmentID {
		return true
	}
	if a.Member.Role == "manager" && a.ownsScope(t.OwnerID) {
		return true
	}
	return t.OwnerID == a.User.ID || t.CreatedBy == a.User.ID
}
func (a *access) canStructure(t Task) bool {
	return leadership(a.Member.Role) || (a.Member.Role == "head" && a.Member.DepartmentID != "" && t.DepartmentID == a.Member.DepartmentID) || (a.Member.Role == "manager" && a.ownsScope(t.OwnerID))
}
func (a *access) canCreate(owner, department string) bool {
	if leadership(a.Member.Role) {
		return true
	}
	switch a.Member.Role {
	case "head":
		return department == a.Member.DepartmentID && department != "" && a.ownsScope(owner)
	case "manager":
		return a.ownsScope(owner) && (department == a.Member.DepartmentID || department == "")
	case "member", "finance":
		return owner == a.User.ID && (department == a.Member.DepartmentID || department == "")
	}
	return false
}
func (a *access) activeUser(id string) bool { m, ok := a.Members[id]; return ok && m.Active }
func scopedTask(db *gorm.DB, a *access, id string) (Task, error) {
	var t Task
	if e := db.Where("id = ? AND company_id = ?", id, a.Company.ID).First(&t).Error; e != nil {
		if e == gorm.ErrRecordNotFound {
			return t, missing()
		}
		return t, e
	}
	if !a.canRead(t) {
		return t, missing()
	}
	return t, nil
}

// withAccessTransaction serializes company mutations before refreshing permissions.
// This protects reporting/dependency graphs across edits to different rows as well
// as preventing stale role snapshots from authorizing a later write.
func (s *Server) withAccessTransaction(r *http.Request, a *access, fn func(*gorm.DB) error) error {
	return s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := lockCompany(tx, a.Company.ID); err != nil {
			return err
		}
		rawToken, e := sessionToken(r)
		if e != nil {
			return &apiError{401, "unauthenticated", "Please sign in again.", nil}
		}
		var session SessionRecord
		if e := lockCommunicationRow(tx, "SHARE").Where("token_hash = ? AND user_id = ? AND expires_at > ?", hashToken(rawToken), a.User.ID, time.Now().UTC()).First(&session).Error; e != nil {
			return &apiError{401, "unauthenticated", "Please sign in again.", nil}
		}
		var members []Membership
		if err := lockCommunicationRow(tx, "UPDATE").Where("company_id = ?", a.Company.ID).Order("user_id").Find(&members).Error; err != nil {
			return err
		}
		a.Members = make(map[string]Membership, len(members))
		for _, m := range members {
			a.Members[m.UserID] = m
		}
		current, exists := a.Members[a.User.ID]
		if !exists || !current.Active {
			return denied()
		}
		a.Member = current
		if err := tx.First(&a.Company, "id = ?", a.Company.ID).Error; err != nil {
			return err
		}
		// Publication audiences must use the directory under this transaction,
		// including users provisioned after the initial HTTP access snapshot.
		var users []User
		ids := make([]string, 0, len(a.Members))
		for id := range a.Members {
			ids = append(ids, id)
		}
		if e := tx.Where("id IN ?", ids).Find(&users).Error; e != nil {
			return e
		}
		a.Users = make(map[string]User, len(users))
		for _, user := range users {
			a.Users[user.ID] = user
		}
		return fn(tx)
	})
}
