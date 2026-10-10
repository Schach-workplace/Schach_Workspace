package platform

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// advanceDate preserves the day of month where possible, clamping to the last day for shorter months.
func advanceDate(d, recurrence string) string {
	t, e := time.Parse("2006-01-02", d)
	if e != nil {
		return ""
	}
	switch recurrence {
	case "daily":
		return t.AddDate(0, 0, 1).Format("2006-01-02")
	case "weekly":
		return t.AddDate(0, 0, 7).Format("2006-01-02")
	case "monthly":
		first := time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		last := first.AddDate(0, 1, -1).Day()
		day := t.Day()
		if day > last {
			day = last
		}
		return time.Date(first.Year(), first.Month(), day, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	}
	return ""
}
func claimAutomation(tx *gorm.DB, cid, key string) (bool, error) {
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&AutomationRecord{Key: key, CompanyID: cid, CreatedAt: nowString()})
	return result.RowsAffected == 1, result.Error
}

// RunAutomations is safe to invoke repeatedly or concurrently. The unique claim and resulting changes commit atomically.
func (s *Server) RunAutomations(ctx context.Context) (created, reminders int, err error) {
	var companies []Company
	if err = s.db.WithContext(ctx).Find(&companies).Error; err != nil {
		return
	}
	for _, c := range companies {
		var n, r int
		n, r, err = s.runCompanyAutomations(ctx, c, "")
		created += n
		reminders += r
		if err != nil {
			return
		}
	}
	return
}
func (s *Server) runCompanyAutomations(ctx context.Context, c Company, actorID string) (created, reminders int, err error) {
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := lockCompany(tx, c.ID); e != nil {
			return e
		}
		if actorID != "" {
			var actor Membership
			if e := tx.Where("company_id = ? AND user_id = ? AND active = ?", c.ID, actorID, true).First(&actor).Error; e != nil {
				if e == gorm.ErrRecordNotFound {
					return denied()
				}
				return e
			}
			if !leadership(actor.Role) {
				return denied()
			}
		}

		loc, e := time.LoadLocation(c.Timezone)
		if e != nil {
			return e
		}
		today := time.Now().In(loc).Format("2006-01-02")
		tomorrow := time.Now().In(loc).AddDate(0, 0, 1).Format("2006-01-02")
		var tasks []Task
		if e = tx.Where("company_id = ?", c.ID).Find(&tasks).Error; e != nil {
			return e
		}
		var members []Membership
		if e = lockCommunicationRow(tx, "UPDATE").Where("company_id = ? AND active = ?", c.ID, true).Order("user_id").Find(&members).Error; e != nil {
			return e
		}
		active := map[string]bool{}
		roles := map[string]string{}
		for _, m := range members {
			active[m.UserID] = true
			roles[m.UserID] = m.Role
		}
		for _, t := range tasks {
			if t.Status == "done" && t.Recurrence != "none" && t.DueDate != "" && active[t.OwnerID] {
				invalidReviewer := (t.RequiresApproval && t.ReviewerID == "") || (t.ReviewerID != "" && (!active[t.ReviewerID] || roles[t.ReviewerID] == "viewer" || t.ReviewerID == t.OwnerID))
				if invalidReviewer {
					key := "recurrence-blocked:" + t.ID + ":" + t.ReviewerID + ":" + roles[t.ReviewerID]
					claimed, err := claimAutomation(tx, c.ID, key)
					if err != nil {
						return err
					}
					if claimed {
						detail := t.Code + ": recurrence paused because the assigned reviewer is missing, inactive, read-only or the owner. Ask a company administrator to reopen this task and assign an active independent reviewer, then submit it for approval. Required review has been preserved."
						if err := audit(tx, c.ID, t.ID, "", "recurrence_blocked", detail); err != nil {
							return err
						}
						recipients := map[string]bool{t.OwnerID: true}
						if active[t.CreatedBy] {
							recipients[t.CreatedBy] = true
						}
						for _, member := range members {
							if leadership(member.Role) {
								recipients[member.UserID] = true
							}
						}
						for uid := range recipients {
							if err := notification(tx, c.ID, t.ID, uid, "Recurring task needs a reviewer", detail, "automation"); err != nil {
								return err
							}
						}
					}
					continue
				}
				next := advanceDate(t.DueDate, t.Recurrence)
				if next == "" {
					continue
				}
				claimed, e := claimAutomation(tx, c.ID, "recurrence:"+t.ID+":"+next)
				if e != nil {
					return e
				}
				if claimed {
					newTask := t
					newTask.ID = newID("tsk")
					newTask.Code = ""
					newTask.DueDate = next
					newTask.OriginalDueDate = next
					if t.StartDate != "" {
						newTask.StartDate = advanceDate(t.StartDate, t.Recurrence)
					}
					newTask.Status = "todo"
					newTask.Progress = 0
					newTask.ActualHours = 0
					newTask.Version = 1
					newTask.BlockerReason = ""
					newTask.DeadlineChangeReason = ""
					newTask.CompletedAt = ""
					newTask.CreatedAt = nowString()
					newTask.UpdatedAt = nowString()
					newTask.Comments = []Comment{}
					newTask.TimeEntries = []TimeEntry{}
					newTask.Attachments = []Attachment{}
					newTask.Checklist = append([]ChecklistItem{}, t.Checklist...)
					for i := range newTask.Checklist {
						newTask.Checklist[i].ID = newID("chk")
						newTask.Checklist[i].Done = false
					}
					newTask.Collaborators = []string{}
					for _, id := range t.Collaborators {
						if active[id] {
							newTask.Collaborators = append(newTask.Collaborators, id)
						}
					}
					newTask.Code, e = nextCode(tx, c)
					if e != nil {
						return e
					}
					if e = tx.Omit("Comments", "TimeEntries", "Attachments").Create(&newTask).Error; e != nil {
						return e
					}
					actor, e := currentAttentionActorLocked(tx, c.ID, newTask.OwnerID)
					if e != nil {
						return e
					}
					if e = syncTaskAttention(tx, actor, nil, newTask); e != nil {
						return e
					}
					if e = audit(tx, c.ID, newTask.ID, "", "recurrence_created", "Next "+t.Recurrence+" occurrence of "+t.Code+"; deadline "+next+"."); e != nil {
						return e
					}
					if e = notification(tx, c.ID, newTask.ID, newTask.OwnerID, "Recurring task created", newTask.Code+" · "+newTask.Title, "assignment"); e != nil {
						return e
					}
					tasks = append(tasks, newTask)
					created++
				}
			}
		}
		// A separate pass includes tasks created above, keeping repeated runs idempotent.
		for _, t := range tasks {
			if t.DeadlineMode == "timed" {
				if !in(t.Status, "done", "cancelled") && active[t.OwnerID] {
					n, e := timedDeadlineReminder(tx, t, time.Now().UTC(), loc)
					if e != nil {
						return e
					}
					reminders += n
				}
				continue
			}
			if !in(t.Status, "done", "cancelled") && t.DueDate != "" && t.DueDate <= tomorrow && active[t.OwnerID] {
				claimed, e := claimAutomation(tx, c.ID, "reminder:"+t.ID+":"+today)
				if e != nil {
					return e
				}
				if e := ensureDeadlineAttention(tx, t, "day:"+today, time.Now().UTC()); e != nil {
					return e
				}
				if claimed {
					title := "Deadline approaching"
					if t.DueDate < today {
						title = "Task overdue"
					}
					if e = notification(tx, c.ID, t.ID, t.OwnerID, title, fmt.Sprintf("%s · %s · due %s", t.Code, t.Title, t.DueDate), "deadline"); e != nil {
						return e
					}
					reminders++
				}
			}
		}
		if e = tx.Where("expires_at < ?", time.Now().UTC()).Delete(&SessionRecord{}).Error; e != nil {
			return e
		}
		if actorID != "" {
			return audit(tx, c.ID, "", actorID, "automations_run", fmt.Sprintf("Created %d recurring tasks and %d reminders.", created, reminders))
		}
		return nil
	})
	if err != nil {
		created = 0
		reminders = 0
	}
	return
}
func (s *Server) runAutomationsHTTP(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	if !leadership(a.Member.Role) {
		return denied()
	}
	n, m, e := s.runCompanyAutomations(r.Context(), a.Company, a.User.ID)
	if e != nil {
		return e
	}
	local, e := s.RunAttention(r.Context(), time.Now().UTC(), 100)
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"ok": true, "created": n, "reminders": m, "attentionDeliveries": local})
}
