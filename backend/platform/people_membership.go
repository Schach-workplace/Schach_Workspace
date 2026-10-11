package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"sort"
)

type MemberPatch struct {
	ExpectedVersion int64
	Fields          map[string]json.RawMessage
}
type SessionEffect struct {
	Reauthenticate                   bool   `json:"reauthenticate"`
	Scope                            string `json:"scope"`
	DevicesMustReregister            bool   `json:"devicesMustReregister"`
	CallsMustRejoin                  bool   `json:"callsMustRejoin"`
	OtherCompanyMembershipsPreserved bool   `json:"otherCompanyMembershipsPreserved"`
}
type MembershipConsequences struct {
	ChangedUsers, ScopeChangedUsers, DepartedUsers []string
	CompanyEpoch                                   int64
	SessionEffect                                  SessionEffect
}

func memberScopeChanged(a, b Membership) bool {
	return a.ID == "" || a.Role != b.Role || a.DepartmentID != b.DepartmentID || a.ManagerID != b.ManagerID || a.Active != b.Active
}
func memberChanged(a, b Membership) bool {
	return memberScopeChanged(a, b) || a.Title != b.Title || a.CapacityHours != b.CapacityHours
}
func cloneMembers(m map[string]Membership) map[string]Membership {
	n := make(map[string]Membership, len(m))
	for k, v := range m {
		n[k] = v
	}
	return n
}
func prepareMemberPatch(tx *gorm.DB, a *access, old Membership, patch MemberPatch, resulting map[string]Membership) (Membership, error) {
	m := old
	if !leadership(a.Member.Role) {
		return m, denied()
	}
	if patch.ExpectedVersion > 0 && patch.ExpectedVersion != old.Version {
		return m, conflict()
	}
	for key := range patch.Fields {
		if !in(key, "role", "departmentId", "managerId", "title", "capacityHours", "active") {
			return m, invalid("Unknown membership field.")
		}
	}
	if e := applyFields(patch.Fields, &m); e != nil {
		return m, e
	}
	if rank(old.Role) > rank(a.Member.Role) || rank(m.Role) > rank(a.Member.Role) || (m.Role == "founder" && a.Member.Role != "founder") {
		return m, denied()
	}
	if m.UserID == a.User.ID && rank(m.Role) > rank(old.Role) {
		return m, denied()
	}
	if m.UserID == a.User.ID && !m.Active {
		return m, invalid("Ask another company administrator to deactivate your membership.")
	}
	graph := cloneMembers(resulting)
	graph[m.UserID] = m
	scope := *a
	scope.Members = graph
	if e := validateMember(tx, &scope, m); e != nil {
		return m, e
	}
	if m.Active {
		if u, ok := a.Users[m.UserID]; !ok || u.Suspended {
			return m, invalid("A suspended account cannot be activated by company administration.")
		}
	}
	if old.Role == "founder" && old.Active && (m.Role != "founder" || !m.Active) {
		founders := 0
		for _, row := range graph {
			if row.Active && row.Role == "founder" {
				founders++
			}
		}
		if founders == 0 {
			return m, invalid("A company must retain at least one active founder.")
		}
	}
	return m, nil
}
func commitMemberPatch(tx *gorm.DB, a *access, before, after Membership, reason, operation string) error {
	if !memberChanged(before, after) {
		return nil
	}
	after.Version = before.Version + 1
	after.AccessEpoch = before.AccessEpoch
	if memberScopeChanged(before, after) {
		after.AccessEpoch++
	}
	res := tx.Model(&Membership{}).Where("id=? AND company_id=? AND version=? AND access_epoch=?", before.ID, before.CompanyID, before.Version, before.AccessEpoch).Select("*").Updates(&after)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return conflict()
	}
	a.Members[after.UserID] = after
	return audit(tx, a.Company.ID, "", a.User.ID, operation, after.UserID+": membership updated. "+reason)
}
func finalizeMembershipConsequences(tx *gorm.DB, a *access, before, after map[string]Membership, reason, operation string) (MembershipConsequences, error) {
	c := MembershipConsequences{CompanyEpoch: a.Company.PermissionEpoch, SessionEffect: SessionEffect{Scope: "account_sessions", OtherCompanyMembershipsPreserved: true}}
	for id, m := range after {
		old := before[id]
		if memberChanged(old, m) {
			c.ChangedUsers = append(c.ChangedUsers, id)
		}
		if memberScopeChanged(old, m) {
			c.ScopeChangedUsers = append(c.ScopeChangedUsers, id)
		}
		if old.Active && !m.Active {
			c.DepartedUsers = append(c.DepartedUsers, id)
		}
	}
	sort.Strings(c.ChangedUsers)
	sort.Strings(c.ScopeChangedUsers)
	sort.Strings(c.DepartedUsers)
	if len(c.ScopeChangedUsers) == 0 {
		return c, nil
	}
	for _, id := range c.ScopeChangedUsers {
		if e := revokePrincipalSessionsLocked(tx, id, a.Users[id].SessionEpoch, SessionRevocationScope{Sessions: a.LockedSessions, CompanyID: a.Company.ID, Departed: in(id, c.DepartedUsers...)}); e != nil {
			return c, e
		}
	}
	res := tx.Model(&Company{}).Where("id=? AND permission_epoch=?", a.Company.ID, a.Company.PermissionEpoch).Update("permission_epoch", a.Company.PermissionEpoch+1)
	if res.Error != nil {
		return c, res.Error
	}
	if res.RowsAffected != 1 {
		return c, conflict()
	}
	a.Company.PermissionEpoch++
	c.CompanyEpoch = a.Company.PermissionEpoch
	if e := invalidatePeopleOutputs(tx, a.Company.ID, before, after, c); e != nil {
		return c, e
	}
	c.SessionEffect.Reauthenticate = true
	c.SessionEffect.DevicesMustReregister = true
	c.SessionEffect.CallsMustRejoin = true
	return c, nil
}
