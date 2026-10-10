package platform

import (
	"embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

//go:embed sample.json
var fixtures embed.FS
var dateOnlyPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// SeedDemo loads fictional evaluation data. Call only after an explicit development --demo or SEED_DEMO request.
func SeedDemo(db *gorm.DB) error {
	var count int64
	if e := db.Model(&User{}).Count(&count).Error; e != nil {
		return e
	}
	if count > 0 {
		return nil
	}
	b, e := fixtures.ReadFile("sample.json")
	if e != nil {
		return e
	}
	var generic map[string]any
	if e = json.Unmarshal(b, &generic); e != nil {
		return e
	}
	anchor, _ := generic["anchorDate"].(string)
	a, e := time.Parse("2006-01-02", anchor)
	if e != nil {
		return e
	}
	today := time.Now().UTC()
	midnight := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	delta := int(midnight.Sub(a).Hours() / 24)
	var shift func(any) any
	shift = func(v any) any {
		switch x := v.(type) {
		case map[string]any:
			for k, value := range x {
				if k != "anchorDate" && k != "budgets" && k != "receiptContents" {
					x[k] = shift(value)
				}
			}
			return x
		case []any:
			for i, value := range x {
				x[i] = shift(value)
			}
			return x
		case string:
			if dateOnlyPattern.MatchString(x) {
				if t, e := time.Parse("2006-01-02", x); e == nil {
					return t.AddDate(0, 0, delta).Format("2006-01-02")
				}
			}
			if t, e := time.Parse(time.RFC3339Nano, x); e == nil {
				return t.AddDate(0, 0, delta).UTC().Format(time.RFC3339Nano)
			}
		}
		return v
	}
	generic = shift(generic).(map[string]any)
	if e = shiftSeedBudgetPeriods(generic, a, today); e != nil {
		return e
	}
	b, e = json.Marshal(generic)
	if e != nil {
		return e
	}
	var fixture struct {
		Sessions        []Session         `json:"sessions"`
		Workspaces      []WorkspaceData   `json:"workspaces"`
		ReceiptContents map[string]string `json:"receiptContents"`
	}
	if e = json.Unmarshal(b, &fixture); e != nil {
		return e
	}
	if len(fixture.Workspaces) == 0 {
		return fmt.Errorf("demo fixture has no workspaces")
	}
	hash, e := passwordHash("SchachDemo!2026")
	if e != nil {
		return e
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if e := tx.Model(&User{}).Count(&count).Error; e != nil {
			return e
		}
		if count > 0 {
			return nil
		}
		users := map[string]User{}
		for _, session := range fixture.Sessions {
			u := session.User
			u.PasswordHash = hash
			users[u.ID] = u
		}
		for _, w := range fixture.Workspaces {
			for _, p := range w.People {
				if _, exists := users[p.ID]; !exists {
					users[p.ID] = User{ID: p.ID, Name: p.Name, Email: strings.ToLower(p.Email), PasswordHash: hash}
				}
			}
		}
		for _, u := range users {
			if e := tx.Create(&u).Error; e != nil {
				return e
			}
		}
		for _, w := range fixture.Workspaces {
			c := w.Company
			if c.Currency == "" {
				c.Currency = "INR"
			}
			if c.FiscalYearStartMonth == 0 {
				c.FiscalYearStartMonth = 4
			}
			for _, t := range w.Tasks {
				parts := strings.Split(t.Code, "-")
				if n, e := strconv.ParseInt(parts[len(parts)-1], 10, 64); e == nil && n > c.NextTaskNumber {
					c.NextTaskNumber = n
				}
			}
			for _, expense := range w.Expenses {
				parts := strings.Split(expense.Code, "-")
				if n, err := strconv.ParseInt(parts[len(parts)-1], 10, 64); err == nil && n > c.NextExpenseNumber {
					c.NextExpenseNumber = n
				}
			}
			if e := tx.Create(&c).Error; e != nil {
				return e
			}
			for _, p := range w.People {
				m := Membership{ID: p.MembershipID, UserID: p.ID, CompanyID: c.ID, Role: p.Role, DepartmentID: p.DepartmentID, ManagerID: p.ManagerID, Title: p.Title, CapacityHours: p.CapacityHours, Avatar: p.Avatar, Active: p.Active}
				if m.ID == "" {
					m.ID = newID("mem")
				}
				if e := tx.Create(&m).Error; e != nil {
					return e
				}
			}
			for _, d := range w.Departments {
				if e := tx.Create(&d).Error; e != nil {
					return e
				}
			}
			for _, p := range w.Projects {
				if e := tx.Create(&p).Error; e != nil {
					return e
				}
			}
			for _, t := range w.Tasks {
				comments, times, attachments := t.Comments, t.TimeEntries, t.Attachments
				t.Comments = nil
				t.TimeEntries = nil
				t.Attachments = nil
				t.ActualHours = 0
				for _, tm := range times {
					t.ActualHours += tm.Hours
				}
				if t.Version < 1 {
					t.Version = 1
				}
				if e := tx.Omit("Comments", "TimeEntries", "Attachments").Create(&t).Error; e != nil {
					return e
				}
				for _, v := range comments {
					v.TaskID = t.ID
					v.CompanyID = c.ID
					if e := tx.Create(&v).Error; e != nil {
						return e
					}
				}
				for _, v := range times {
					v.TaskID = t.ID
					v.CompanyID = c.ID
					if e := tx.Create(&v).Error; e != nil {
						return e
					}
				}
				for _, v := range attachments {
					v.TaskID = t.ID
					v.CompanyID = c.ID
					v.FileName = "demo-evidence.txt"
					v.MimeType = "text/plain; charset=utf-8"
					v.Data = []byte("Fictional demonstration evidence for " + t.Code + ". Replace this sample with your actual delivery evidence.\n")
					v.Size = int64(len(v.Data))
					if e := tx.Create(&v).Error; e != nil {
						return e
					}
				}
			}
			for _, g := range w.Goals {
				if e := tx.Create(&g).Error; e != nil {
					return e
				}
			}
			if len(w.ExpenseCategories) == 0 {
				if err := defaultExpenseCategories(tx, c.ID); err != nil {
					return err
				}
			}
			for _, category := range w.ExpenseCategories {
				if category.Version < 1 {
					category.Version = 1
				}
				if err := tx.Create(&category).Error; err != nil {
					return err
				}
			}
			for _, budget := range w.Budgets {
				if budget.Currency == "" {
					budget.Currency = c.Currency
				}
				if budget.Version < 1 {
					budget.Version = 1
				}
				if err := tx.Create(&budget).Error; err != nil {
					return err
				}
			}
			for _, expense := range w.Expenses {
				receipts := expense.Receipts
				expense.Receipts = nil
				if expense.Version < 1 {
					expense.Version = 1
				}
				if expense.Currency == "" {
					expense.Currency = c.Currency
				}
				expense.VendorKey, expense.InvoiceKey = invoiceKey(expense.Vendor), invoiceKey(expense.InvoiceNumber)
				if err := tx.Omit("Receipts").Create(&expense).Error; err != nil {
					return err
				}
				for _, receipt := range receipts {
					content, present := fixture.ReceiptContents[receipt.ID]
					if !present || content == "" {
						return fmt.Errorf("demo receipt %s has no real receiptContents bytes", receipt.ID)
					}
					receipt.CompanyID, receipt.ExpenseID = c.ID, expense.ID
					receipt.Data = []byte(content)
					receipt.Size = int64(len(receipt.Data))
					if receipt.Size > maxUpload {
						return fmt.Errorf("demo receipt %s exceeds the upload limit", receipt.ID)
					}
					mimeType, err := uploadType(receipt.FileName, receipt.Data)
					if err != nil {
						return fmt.Errorf("demo receipt %s: %w", receipt.ID, err)
					}
					receipt.MimeType = mimeType
					if err := tx.Create(&receipt).Error; err != nil {
						return err
					}
				}
			}
			for _, event := range w.FinanceEvents {
				if err := tx.Create(&event).Error; err != nil {
					return err
				}
			}
			for _, v := range w.Activities {
				if e := tx.Create(&v).Error; e != nil {
					return e
				}
			}
			for _, v := range w.Notifications {
				if e := tx.Create(&v).Error; e != nil {
					return e
				}
			}
		}
		return nil
	})
}

// Budget envelopes follow whole financial years rather than the day offset used
// for tasks and expenses. This keeps April–March allocations inside one year
// when the fictional fixture is first opened in a different month or year.
func shiftSeedBudgetPeriods(fixture map[string]any, anchor, today time.Time) error {
	workspaces, _ := fixture["workspaces"].([]any)
	for _, raw := range workspaces {
		workspace, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		company, _ := workspace["company"].(map[string]any)
		startMonth := 4
		if month, ok := company["fiscalYearStartMonth"].(float64); ok && month >= 1 && month <= 12 {
			startMonth = int(month)
		}
		zone, _ := company["timezone"].(string)
		if zone == "" {
			zone = "UTC"
		}
		loc, err := time.LoadLocation(zone)
		if err != nil {
			return err
		}
		localToday := today.In(loc).Format("2006-01-02")
		years := fiscalYear(localToday, startMonth) - fiscalYear(anchor.Format("2006-01-02"), startMonth)
		budgets, _ := workspace["budgets"].([]any)
		for _, rawBudget := range budgets {
			budget, ok := rawBudget.(map[string]any)
			if !ok {
				continue
			}
			for _, key := range []string{"startDate", "endDate"} {
				original, _ := budget[key].(string)
				date, err := time.Parse("2006-01-02", original)
				if err != nil {
					return fmt.Errorf("demo budget %s: %w", key, err)
				}
				year, month, day := date.Year()+years, date.Month(), date.Day()
				last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
				if day > last {
					day = last
				}
				budget[key] = time.Date(year, month, day, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
			}
			start, end := budget["startDate"].(string), budget["endDate"].(string)
			updated := localToday
			if end < updated {
				updated = end
			}
			if updated < start {
				updated = start
			}
			budget["createdAt"], budget["updatedAt"] = start+"T09:00:00Z", updated+"T09:00:00Z"
		}
	}
	return nil
}
