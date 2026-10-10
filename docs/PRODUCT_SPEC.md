# Schach Workspace — product and architecture specification

## Intent

Give the CEO and founder a reliable, mobile-friendly view of commitments across companies, departments, managers and employees. Make ownership, delivery dates, blockers, review decisions and supporting evidence visible without asking for repeated status updates. The user authorised brainstorming and a complete implementation in one pass, delivered as a ZIP; no cloud publication is requested.

## Chosen approach

A modular Go application, backed by GORM and PostgreSQL, with an Encore Go entry point for managed infrastructure and a standalone entry point for straightforward self-hosting. Both use the same business logic. React, TypeScript, Vite and accessible UI primitives provide a responsive web application. SQLite is a convenient local evaluation option. An explicitly labelled browser demo uses the same frontend and local storage, and is never used as authentication for the real API.

Alternatives considered: a browser-only tracker cannot provide reliable shared permissions; many microservices add operational complexity before the team needs it. This modular architecture keeps deployment approachable and permits later extraction of services.

## Company boundaries and hierarchy

Users have separate memberships per company. Company context is an explicit path parameter, validated against the authenticated user's active membership on every request. A global platform owner can create companies but cannot bypass membership checks to read an unrelated company's data. Founder/CEO/company admin see their company; a department head sees their department; a manager sees their reports and own work; a member sees assigned, created or collaborated tasks. A viewer has company read-only visibility. Foreign references must resolve inside the current company.

Company → department → manager → employee → project/task → subtask/checklist/evidence/activity. Roles, reporting managers and weekly capacity are configurable. Sample companies, names and tasks are fictional and clearly marked.

## Principal workflows

1. Leadership overview: actionable overdue, blocked, review and due-soon cards; department comparison; project health; personal and company drill-downs.
2. Task creation and bulk CSV upload: title, outcome, one accountable owner, reviewer, department/project, priority, start/deadline, effort, checklist, dependencies, repeat interval and tags.
3. Work views: list, keyboard-usable board, personal work and calendar; search and intersecting filters; details drawer with edits, comments, actual time and evidence.
4. Completion: todo → in progress → in review → accepted/done. A task requiring approval cannot be marked done by its owner. Reviewers can accept or request changes; required dependencies and checklist items must be complete first. Blocked work requires a reason.
5. Governance: original deadline retained; changing a deadline requires a reason; every mutation records actor, timestamp and relevant change. Task and financial-record optimistic version checks prevent silently overwriting another editor's changes to those records. Review and write permissions are checked on the server.
6. Capacity: compare scheduled remaining effort with each person's declared weekly capacity. Display the formula and period. Hours are self-reported; they are not a surveillance or payroll system.
7. Goals: owners, dates, units, baseline/target/current, linked tasks and transparent progress. Work counts are not a substitute for outcome quality.
8. Reports: date range, department/person filters, current and original commitment performance, on-time acceptance, throughput, blocked work, review queues and exportable task data. Empty denominators display no data, never manufactured percentages.
9. Notifications and recurring work: in-app assignments, comments, review requests, nudges and deadline reminders; idempotent recurrence and overdue processing. No external messages are sent without an independently configured provider.
10. Organisation and settings: add companies, departments, employees and projects; change reporting lines and capacity; manage membership and company identity; password change.

## Design system

Brand colours verified from the official website CSS: orange #F97316, zinc #18181B, charcoal #09090B, white #FAFAFA. Orange identifies selected actions and highlights. Light grey/white content surfaces give dense tables and charts clear contrast. Charcoal navigation provides orientation. The official logo can be used as an asset. Status is communicated with words/icons as well as colour.

Desktop has a sidebar and content grid; tablet collapses secondary panels; mobile has a compact header, touch-friendly controls, bottom navigation and full-height task sheets. Critical actions remain available at 360px. Reduced motion, focus visibility, labelled form controls, keyboard dialogs and readable contrast are required. UI is an operational tool, without marketing hero screens or ornamental charts.

## Metric definitions

- Open work: statuses other than done/cancelled.
- Overdue: open task with dueDate before today's calendar date in the company's timezone.
- Due soon: open tasks due today through seven calendar days ahead.
- On time: accepted completion calendar date is on/before originalDueDate; denominator is completed tasks with a deadline in the selected completion period.
- Completion rate: completed tasks divided by non-cancelled tasks in the selected cohort; show denominator.
- Capacity usage: remaining estimated hours for open tasks scheduled in the selected week / employee weekly capacity. Remaining estimate = estimatedHours × (1 − progress/100). It is a planning estimate, not an employee rating.
- Goal attainment: (current − baseline)/(target − baseline), bounded for the progress display, with underlying numbers shown. Lower-is-better targets are supported.
- No automated composite employee score, fabricated AI forecast or forced ranking.

## Security and operations

Password hashes, cryptographically random opaque session tokens stored hashed, expiring HttpOnly cookies, origin checks for unsafe cookie-authenticated requests, login throttling, scoped resource access, validated inputs and safe attachment serving. SQL queries use parameters. Security-sensitive operations produce audit records. Development demo seeding is explicit. Production startup requires deliberate bootstrap credentials and a persistent database; it must not silently create a public demo login.

Uploads are size-limited, filename-sanitised, stored separately from executable content and downloaded with permission checks and attachment disposition. CSV exports neutralise spreadsheet formulas. Dates use date-only commitments and UTC audit timestamps; company timezone governs due-date boundaries. Migrations are versioned for PostgreSQL. Backup, restore, secrets, TLS and release instructions accompany the source.

## Verification and handoff

Run real backend tests covering cross-company denial, role permissions, dependency cycles, approval segregation, stale versions, deadline history, recurrence idempotency and invalid imports. Build/typecheck the frontend, verify representative user workflows and mobile overflow, and distinguish checks actually executed from deployment integrations needing the user's infrastructure. ZIP includes full source, lockfiles, local demo, startup instructions, architecture/API notes and the verification record.


## Reviewed finance extension

The October 2026 upgrade adds company currency/fiscal-year configuration, department allocation envelopes, category-classified gross expenses, independent review, permission-checked receipts, external payment records, financial-event history and financial-year reporting. The detailed decisions and alternatives are frozen in [the finance design](superpowers/specs/2026-10-10-finance-design.md). The implementation and inspected gaps are tracked in [FINANCE_UPGRADE.md](FINANCE_UPGRADE.md).

One department budget is the allocation pool. Categories classify expenses from that pool rather than introduce duplicate allocations. Used budget equals approved unpaid plus paid; submitted requests are separate pending exposure. The company can authorize an overrun with a meaningful reason, while a head cannot. Finance access is separate from ordinary work and people administration. Every company keeps its own currency, periods, categories, budgets, expenses and financial history.
