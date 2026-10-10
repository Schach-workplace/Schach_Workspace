package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"sort"
	"strings"
	"time"
)

func prepareTaskPatch(tx *gorm.DB, a *access, old Task, version int64, f map[string]json.RawMessage, graph map[string]Task) (Task, error) {
	t := old
	var e error
	if a.Member.Role == "viewer" {
		return t, denied()
	}
	if !a.canWrite(old) {
		return t, denied()
	}
	if version < 1 {
		return t, invalid("A positive task version is required.")
	}
	if old.Version != version {
		return t, conflict()
	}
	if e = applyFields(f, &t); e != nil {
		return t, e
	}
	if old.Status == "done" && t.Status == "done" {
		return t, invalid("Reopen accepted work before editing task fields. Comments and time can still be added; reopen before adding evidence.")
	}
	if old.RequiresApproval && (!t.RequiresApproval || (a.User.ID == old.OwnerID && t.ReviewerID != old.ReviewerID)) {
		return t, denied()
	}
	if !a.canStructure(old) && structuralChanged(old, t) {
		return t, denied()
	}
	if (old.OwnerID != t.OwnerID || old.DepartmentID != t.DepartmentID) && !a.canCreate(t.OwnerID, t.DepartmentID) {
		return t, denied()
	}
	if e := validateDeadline(&t); e != nil {
		return t, e
	}
	if deadlineChanged(old, t) {
		if _, present := f["deadlineChangeReason"]; !present || !clean(t.DeadlineChangeReason, 4000) {
			return t, invalid("Explain why the deadline is changing. The original commitment is preserved.")
		}
	}
	if e = validateTaskWithGraph(tx, a, &t, graph); e != nil {
		return t, e
	}
	if e = setWorkflow(tx, &t, old.Status, false); e != nil {
		return t, e
	}

	if graph != nil {
		if e = validateTaskGraph(a, t, graph); e != nil {
			return t, e
		}
	}
	return t, nil
}
func commitTaskPatch(tx *gorm.DB, a *access, old, t Task, f map[string]json.RawMessage) error {
	var e error
	t.Version = old.Version + 1
	t.UpdatedAt = nowString()
	res := tx.Model(&Task{}).Where("id = ? AND company_id = ? AND version = ?", t.ID, t.CompanyID, old.Version).Select(taskColumns).Updates(&t)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return conflict()
	}
	if e := appendTaskFact(tx, &old, t, ReportFactActor{ID: a.User.ID}, "patch", time.Now().UTC()); e != nil {
		return e
	}
	keys := []string{}
	for k := range f {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	detail := "Changed " + strings.Join(keys, ", ") + "."
	if old.Status != t.Status {
		detail += " Status: " + old.Status + " → " + t.Status + "."
	}
	if deadlineChanged(old, t) {
		detail += " Deadline: " + old.DueDate + " → " + t.DueDate + ". Reason: " + t.DeadlineChangeReason
	}
	if e = audit(tx, t.CompanyID, t.ID, a.User.ID, "task_updated", detail); e != nil {
		return e
	}
	if old.OwnerID != t.OwnerID {
		if e = notification(tx, t.CompanyID, t.ID, t.OwnerID, "Task assigned", t.Code+" · "+t.Title, "assignment"); e != nil {
			return e
		}
	}
	if t.Status == "in_review" && (old.Status != "in_review" || old.ReviewerID != t.ReviewerID) {
		if e = notification(tx, t.CompanyID, t.ID, t.ReviewerID, "Review requested", t.Code+" · "+t.Title, "review"); e != nil {
			return e
		}
	}
	return syncTaskAttention(tx, a, &old, t)
}
