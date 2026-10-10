# Schach Workspace: a practical quick tour

Schach Workspace connects goals, people and daily commitments. Open a task to see its owner, deadline, evidence and next step.

## Your first five minutes

1. **Open `preview.html`** from the extracted ZIP. The demo starts as founder **Rohan Mehta**, with fictional sample work. Changes stay in this browser; use the server edition for shared work.
2. In **Overview**, click **Overdue tasks** to open a filtered **All tasks** view. Open a task title and inspect **Details**: owner, status, deadline, original commitment and checklist.
3. Open **Evidence & time**. **Upload** attaches supporting material; the download icon retrieves it. **Log time** records hours, a date and the work completed. Use **Activity → Post comment** to add context.
4. Return to **Overview** and click **Awaiting review**. Open a task awaiting a decision. When the outcome is ready, an eligible reviewer can use **Accept work**. If corrections are needed, enter feedback and choose **Request changes**.
5. Use the company selector above the navigation to explore **Meridian Works**. Each company has separate work and membership. Switch back to **Schach Engineers** when finished.

To try another perspective, use the sign-out icon beside your name. The sign-in screen offers **Founder**, **CEO**, **Department head** and **Team member** sample accounts. Use `finance@schach.demo` for the dedicated Finance perspective. Their demonstration password is `SchachDemo!2026`.

## Choose a useful starting view

| Your role | Start here | What to look for |
| --- | --- | --- |
| Founder or CEO | **Overview** | Overdue commitments, blocked work, pending decisions and project health. |
| Department head or manager | **All tasks**, **Projects**, **Workload** | Ownership, delivery obstacles and the capacity available within your scope. |
| Finance | **Finance** | Department allocation, category spending, approvals, receipts and recorded payments. |
| Junior employee or other member | **My work** | Your assigned tasks and review-related work, with deadlines and clear next steps. |

Your role and relationship to the work determine access. Disabled fields require someone with the appropriate responsibility.

## Set up your organisation

In **Settings → Company**, use **Edit details** to update the current company's identity, timezone, currency and financial-year start. Set the currency and financial year before recording the first budget or expense; those two settings are locked afterward. Calendar deadlines and overdue calculations follow that timezone. Platform owners also see **Add company** under **Your companies**.

Open **People → Departments → Add department**. Enter the name and description. You can assign its head immediately or edit the department after adding the right person.

In **People → People → Add person**, enter their name, email, initial password, job title, role, department, **Reports to** and **Weekly capacity (hours)**. A new account requires a password of at least 12 characters. Share its credentials directly; this action does not send an invitation email. The person can change their password under **Settings → My account**.

Use **Reporting lines** to check department and manager relationships. In **Projects**, choose **New project** to group related work under an owner and target date.

## Create and update a commitment

Choose **Create task** from the overview or **New task** in **All tasks**. Write a specific title and use **Outcome & context** to explain what a successful result looks like. Choose one **Accountable owner**, the department/project, priority and deadline. Selecting another eligible owner fills their department and reporting reviewer; check those details before saving.

Use the **Acceptance checklist** for concrete completion criteria. Expand **Dependencies, collaborators & recurring work** when a task relies on other work, belongs under a parent task, needs collaborators or should repeat. Choose **Create task** to save it.

For daily updates, open a task from **My work**, choose **In progress**, adjust its progress estimate and **Save changes**. Progress is an estimate; 100% does not mean the work has been accepted.

If work stops, select **Blocked** and complete **What is blocking this task?** Explain the obstacle and the help needed. If the deadline changes, record why when prompted. The original commitment remains available for reporting and history.

**All tasks** provides **List** and **Board** views. Use **Filters** to combine owner, project, priority and deadline conditions; **Clear filters** restores the full view. Board cards have status selectors, so moving work does not require dragging.

## Submit, review and reopen

Before submitting, complete the checklist and attach the evidence needed for a decision. Set **Status** to **In review**, then **Save changes**.

The assigned reviewer or an authorised company leader can use **Accept work** or **Request changes**. Owners cannot approve their own work. Required checklist items and prerequisite work must be complete before acceptance. Save any task edits before making the review decision. Requesting changes requires feedback and returns the task to **In progress**.

Accepted task fields are locked. **Reopen task** returns the task to **In progress** before further editing; required-review work needs acceptance again. If someone updates a task during your edit, use **Load latest version** before intentionally retrying.

## Read reports with context

In **Reports**, set **From** and **Through**, then select a department or person. **Original commitment met** measures acceptance against the initial deadline. **Current deadline met** uses the revised deadline. Their difference makes rescheduling visible.

**Tasks accepted in period** follows completion dates. **Commitment completion** considers non-cancelled tasks due in the selected period. Each rate shows its denominator; a dash means no qualifying data. Choose the relevant task tab before **Export report**.

**Workload** compares remaining estimated effort with declared weekly capacity. Open a person's row to inspect the underlying tasks. It is a planning conversation, not an employee performance rating. **Goals** track entered business results against baselines and targets; completing linked tasks does not automatically change those results.

## Import, notifications and mobile use

For bulk entry, open **All tasks → Import CSV → Download CSV template**. Use existing owner emails and exact department/project names. Select **Choose CSV**, review the validated tasks, then **Import**. Correct reported errors before retrying; an invalid import does not partially add tasks.

**Inbox** collects assignments, comments, work and expense review requests and reminders. Use **Open task** or **Open expense**, mark an update read, or choose **Mark all read**.

On mobile, use the bottom navigation for common views. **More** opens the full menu and company selector. Task details fill the screen; use the close icon to return to your work.


## Add department budgets and expenses

Open **Finance** from the sidebar or **More** on mobile. Leadership sees the financial-year totals and department cards; selecting a department narrows its budgets, categorized spending and expenses. Heads see their department finance and can switch to **My expenses** for their own historical records, including expenses from a previous department. Members see only their expenses.

A company financial authority uses **Set budget** to choose the department, inclusive dates, amount and draft/active status. Every period must fit one company financial year and cannot overlap another envelope for that department. Use **Manage categories** to configure categories and receipt requirements. Budget/category controls are deliberately limited to company financial authorities.

Use **New expense**, enter the incurred date, vendor, invoice reference, category, amount and business purpose, then **Save draft**. Link an accessible task/project when useful. Open the expense, attach its receipts or record a detailed missing-receipt explanation, and choose **Submit for approval**. Reviewers see the budget impact and evidence before deciding. A head can approve a colleague's expense only within an active budget; company Finance or leadership can record a reasoned exception when needed.

After an expense is approved and the real payment has happened, an eligible person chooses **Record payment** and enters its date, method and reference. The tool records the payment; it does not send funds. Paid financial details cannot be rewritten. Later receipts remain append-only and visible in history. See [FINANCE_GUIDE.md](FINANCE_GUIDE.md) for the full operating procedure, formulas and example.
