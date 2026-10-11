package platform

import (
	"sort"

	"gorm.io/gorm"
)

func loadFinanceWorkspace(db *gorm.DB, a *access, d *WorkspaceData, visibleTasks map[string]bool) (map[string]bool, error) {
	return loadFinanceProjection(db, a, d, visibleTasks, false)
}
func loadFinanceProjection(db *gorm.DB, a *access, d *WorkspaceData, visibleTasks map[string]bool, lean bool) (map[string]bool, error) {
	d.FinanceScope = a.financeScope()
	d.ExpenseCategories = []ExpenseCategory{}
	d.Budgets = []Budget{}
	d.Expenses = []Expense{}
	d.FinanceEvents = []FinanceEvent{}
	visibleExpenses := map[string]bool{}
	if d.FinanceScope == "none" {
		return visibleExpenses, nil
	}
	if err := db.Where("company_id = ?", a.Company.ID).Order("name ASC").Find(&d.ExpenseCategories).Error; err != nil {
		return nil, err
	}
	budgetQuery := db.Where("company_id = ?", a.Company.ID)
	if d.FinanceScope == "department" {
		budgetQuery = budgetQuery.Where("department_id = ? AND department_id <> ''", a.Member.DepartmentID)
	}
	if d.FinanceScope != "personal" {
		if err := budgetQuery.Order("start_date DESC, department_id ASC, id ASC").Find(&d.Budgets).Error; err != nil {
			return nil, err
		}
	}
	expenseQuery := db.Where("company_id = ?", a.Company.ID)
	if d.FinanceScope == "personal" {
		expenseQuery = expenseQuery.Where("created_by = ?", a.User.ID)
	}
	if d.FinanceScope == "department" {
		expenseQuery = expenseQuery.Where("(created_by = ? OR (department_id = ? AND department_id <> ''))", a.User.ID, a.Member.DepartmentID)
	}
	if lean {
		expenseQuery = expenseQuery.Select("id", "department_id", "created_by", "reviewed_by", "paid_by", "task_id", "project_id")
	}
	if err := expenseQuery.Order("created_at DESC, id DESC").Find(&d.Expenses).Error; err != nil {
		return nil, err
	}
	ids := []string{}
	departments := map[string]bool{}
	people := map[string]bool{}
	projects := map[string]bool{}
	for _, p := range d.Projects {
		projects[p.ID] = true
	}
	for i := range d.Expenses {
		e := &d.Expenses[i]
		visibleExpenses[e.ID] = true
		ids = append(ids, e.ID)
		e.Receipts = []ExpenseReceipt{}
		departments[e.DepartmentID] = true
		people[e.CreatedBy] = true
		people[e.ReviewedBy] = true
		people[e.PaidBy] = true
		if !visibleTasks[e.TaskID] {
			e.TaskID = ""
		}
		if !projects[e.ProjectID] {
			e.ProjectID = ""
		}
	}
	for _, b := range d.Budgets {
		departments[b.DepartmentID] = true
		people[b.CreatedBy] = true
	}
	receipts := map[string][]ExpenseReceipt{}
	if len(ids) > 0 && !lean {
		var rows []ExpenseReceipt
		if err := db.Omit("Data").Where("company_id = ? AND expense_id IN ?", a.Company.ID, ids).Order("created_at ASC, id ASC").Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, receipt := range rows {
			receipts[receipt.ExpenseID] = append(receipts[receipt.ExpenseID], receipt)
			people[receipt.UploadedBy] = true
		}
		for i := range d.Expenses {
			if rows := receipts[d.Expenses[i].ID]; rows != nil {
				d.Expenses[i].Receipts = rows
			}
		}
	}
	events := db.Where("company_id = ?", a.Company.ID)
	switch d.FinanceScope {
	case "personal":
		if len(ids) == 0 {
			events = events.Where("1 = 0")
		} else {
			events = events.Where("entity_type = ? AND entity_id IN ?", "expense", ids)
		}
	case "department":
		if len(ids) == 0 {
			events = events.Where("entity_type = ? AND department_id = ? AND department_id <> ''", "budget", a.Member.DepartmentID)
		} else {
			events = events.Where("((entity_type = ? AND entity_id IN ?) OR (entity_type = ? AND department_id = ? AND department_id <> ''))", "expense", ids, "budget", a.Member.DepartmentID)
		}
	}
	// Restrict the query before LIMIT so unrelated company events cannot crowd out
	// the latest thousand events a department head or expense creator can read.
	if lean {
		events = events.Where("1 = 0")
	}
	if err := events.Order("created_at DESC, id DESC").Limit(1000).Find(&d.FinanceEvents).Error; err != nil {
		return nil, err
	}
	for _, event := range d.FinanceEvents {
		people[event.UserID] = true
	}
	knownDepartments := map[string]bool{}
	for _, department := range d.Departments {
		knownDepartments[department.ID] = true
	}
	var allDepartments []Department
	if err := db.Where("company_id = ?", a.Company.ID).Order("name").Find(&allDepartments).Error; err != nil {
		return nil, err
	}
	for _, department := range allDepartments {
		if !knownDepartments[department.ID] && (d.FinanceScope == "company" || departments[department.ID]) {
			d.Departments = append(d.Departments, department)
		}
	}
	sort.Slice(d.Departments, func(i, j int) bool { return d.Departments[i].Name < d.Departments[j].Name })
	knownPeople := map[string]bool{}
	for _, person := range d.People {
		knownPeople[person.ID] = true
	}
	for uid := range people {
		if uid == "" || knownPeople[uid] {
			continue
		}
		m, ok := a.Members[uid]
		if !ok {
			continue
		}
		d.People = append(d.People, person(a.Users[uid], m, a.Company.PermissionEpoch))
	}
	sort.Slice(d.People, func(i, j int) bool { return d.People[i].Name < d.People[j].Name })
	return visibleExpenses, nil
}
