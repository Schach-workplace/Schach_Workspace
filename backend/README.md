# Shared Go backend

This module is the real API for Schach Workspace. `platform` holds GORM models, opaque-cookie authentication, permissions, task workflows, department budgets, categorized expenses, administration, evidence, activity and automation logic. `cmd/server` serves it directly; `../encore/api` uses the identical handler through an Encore-managed PostgreSQL connection. The browser demo is a separate, explicitly labelled evaluation mode and is never API authentication.

## Run locally

Install Go 1.26+ and a C compiler for the SQLite driver. From this directory, after building the frontend:

```sh
go run ./cmd/server --demo --addr :8080 --frontend ../frontend/dist
```

Open `http://localhost:8080`. SQLite data persists in `schach.db`; uploaded evidence is included in the database. `--demo` is explicit and only seeds an empty database. Fictional demo accounts include `founder@schach.demo`, `ceo@schach.demo`, `head@schach.demo`, `member@schach.demo`, and `finance@schach.demo`, with password `SchachDemo!2026`. The fixture contains two companies, 44 tasks, 14 department budgets, 19 expenses and 17 downloadable fictional receipts. Tasks, expenses and their timestamps shift from the anchor to the day of first seeding. Budget periods shift by whole financial years to preserve valid boundaries. Subsequent starts preserve your edits. The second company's data is accessible only through a verified membership.

For Vite development, configure the exact browser origins and proxy `/api` to port 8080:

```sh
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 go run ./cmd/server --demo
```

Create a private workspace by omitting `--demo` and supplying `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` and `BOOTSTRAP_NAME` through your environment. Bootstrap creates the initial platform owner, a founder membership and a company named “My company,” editable in Settings. It refuses to run through the exported bootstrap function once users exist; server startup ignores bootstrap values once initialized. A new empty database with neither explicit demo mode nor complete bootstrap values fails rather than inventing credentials.

## Configuration

| Setting | Meaning |
| --- | --- |
| `--addr` | HTTP listen address, default `:8080`. |
| `--db` | SQLite file for local evaluation, default `schach.db`. |
| `--frontend` | Built frontend directory, default `../frontend/dist`. |
| `--demo` / `SEED_DEMO=true` | Explicit fictional seed into an empty local database. |
| `DATABASE_URL` | PostgreSQL URL or pgx connection string; takes precedence over `--db`. pgx also supports `PGPASSWORD`, allowing the password to stay out of the URL. |
| `ENVIRONMENT=production` | Enforces persistent PostgreSQL, secure cookies, explicit HTTPS origins and no demo or AutoMigrate. |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins. No wildcard. Same-origin requests are permitted. |
| `SECURE_COOKIES=true` | Sets Secure on the HttpOnly, SameSite=Lax session cookie. Required in production. |
| `SESSION_HOURS` | Absolute session lifetime, 1–720 hours; default 72. |
| `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD`, `BOOTSTRAP_NAME` | Deliberate first-account initialization; password length at least 12 characters, at most 256 UTF-8 bytes. |
| `DISABLE_SCHEDULER=true` | Disables the standalone five-minute in-process automation scan. |
| `--migrate` | Explicit PostgreSQL development AutoMigrate. Production rejects it; SQLite local schema setup is automatic. |

For production, apply every unapplied numbered up migration in order using a migration role: version 1 followed by `migrations/2_department_finance.up.sql` on a fresh database, or only version 2 on an existing version-1 deployment. Record applied versions and follow `migrations/README.md`. Use a restricted application database role, terminate HTTPS at a trusted reverse proxy and serve the frontend and API under one origin. The standalone binary bundles the IANA timezone database so company date boundaries work in minimal containers. The PostgreSQL driver supports encrypted connections through the URL/pgx configuration. Read the repository operations guide for TLS, backups and release procedures.

## Operator password recovery

User-initiated changes are available at `POST /api/auth/password` and require the current password. An operator with authorized direct database access can recover an existing account using the separate CLI:

```sh
# Supply these through a secret manager or a private shell environment:
# RESET_EMAIL, RESET_PASSWORD, and DATABASE_URL (or a local --db path).
go run ./cmd/reset-password --db schach.db
```

The utility accepts no password command-line argument, validates the new password, changes only an existing account, revokes all its sessions and writes an operator audit event in every company membership. It does not create users or send email. In production it requires `DATABASE_URL`. Clear the recovery environment variables after use. To use the same utility for an Encore deployment, connect it to that deployment's PostgreSQL database with operator authorization.

## Permission and workflow rules

Platform ownership permits company creation, while access to a company's data still requires an active membership. Founder, CEO and company admin see their company. A department head sees their department and directly involved tasks. A manager sees their reporting tree and own work. A member sees owned, created, collaborated or assigned-review tasks. A viewer sees company data and cannot change work. Workspace task-related content is filtered, and hidden references cannot be used to manufacture access to a project or task.

Company administrators manage people, departments and company settings. Heads and managers can manage projects and goals in their permitted scope. A member owning a goal can update its current value. A member can update their task's work details, progress, dates with a reason, comments, time and evidence; structural fields such as owner, reviewer, dependencies, department and recurrence require supervisory permission. A founder membership cannot be removed if that would leave no active founder. Self-role escalation is rejected.

A reviewer must be another active member with permission to review, never the owner or a read-only viewer. Once a task requires review, the requirement cannot be removed, including by a founder who owns the task. The owner cannot change their own assigned reviewer. Submit to `in_review`; the assigned reviewer or a company leader, who must not be the owner, records approval or requests changes. Dependencies must be accepted and checklist items complete before submission or acceptance. In-review progress is 100 as the submitter's estimate; only `done` represents accepted completion.

Accepted task fields are frozen until explicitly reopened. Comments, time and evidence can still be appended without reopening. Reopening clears the current accepted-completion timestamp and leaves the earlier acceptance in the audit history. A deadline change requires a reason and never changes `originalDueDate`. Blocked work requires an explanatory reason.

Task updates require the version last read by the client. A competing update returns HTTP 409 with an instruction to refresh and retry intentionally. Company mutations acquire a company row lock before reloading current memberships and reference graphs. This also prevents stale role authorization and cycles caused by simultaneous edits to different reporting, dependency or parent records. The tradeoff is serialized writes within each company; companies remain independent.

CSV rows arrive through the JSON import contract after client parsing. The backend independently validates every row, reports each failing row number, accepts at most 200 rows and commits all or none. It does not trust CSV values as company or role authority.

## Department budgets and categorized expenses

Each company uses one two-decimal currency: INR by default, or USD, EUR, GBP, AED, SGD, AUD or CAD. The financial year starts in April by default and may use any month from 1 to 12. Both settings freeze after the first budget or expense, preserving historical interpretation. Amounts use exact integer minor units, with a maximum of 1,000,000,000,000; expenses must be positive and budgets may be zero. No exchange conversion, tax calculation or bank transfer is performed.

Founder, CEO, admin and the dedicated `finance` role can manage categories and department budgets, approve other people's expenses and record their external payments. Finance has ordinary own-work permissions and gains no people/company administration or general task editing. Heads read their department's budgets and expenses, plus their own expenses, and may independently approve within an active budget. Managers and members see only their own expenses and no partial department-budget totals. Viewers receive no finance data. These rules govern workspace arrays, financial history, receipt downloads and expense notifications.

A budget is a department envelope within one financial year. Its inclusive dates cannot overlap any other budget for the department, including drafts and closed periods. Draft envelopes may change scope. Once active, the department and dates remain fixed; an amount revision, closure or reopening requires a reason of at least 12 Unicode characters. Lowering an allocation below committed spend is recorded honestly and can produce a negative available amount. Closed budgets can reopen to active; active budgets cannot return to draft. Category spending groups expenses within the same envelope and does not create another allocation pool.

Expenses start as drafts owned by an immutable creator, and their date must be no later than today in the company timezone. This date is checked on creation, correction, submission and approval. That creator may edit draft/rejected entries, submit them, withdraw submitted entries for correction, or void unapproved entries with a reason. Submission freezes decision-relevant fields. Independent authorized approvers may approve, reject with a correction note, or void an approved unpaid expense with a reason. Nobody may approve, reject or record payment on their own expense, including a founder. Paid and void financial records are final. Every edit and transition requires the current version; competing decisions return HTTP 409. Finance text limits count Unicode characters, including the 12–4,000-character controlled reasons and decision notes.

Budget use is approved-unpaid plus paid, counted once and attributed by expense date. Submitted amounts are pending and do not reserve money. Approval rechecks the current active budget under the company lock. Missing/draft/closed budgets or insufficient availability require an explicit override reason of at least 12 characters from a company finance authority. Heads cannot override. Recording payment requires a method, reference and date between the expense date and today in the company timezone; this records an external payment without asserting bank reconciliation.

Seven starter categories require receipts by default and can be customized or archived. A required receipt may be replaced at submission by a documented exception reason of at least 12 characters, but every expense with an exception also requires an independent approval note. Receipt policy is rechecked at approval. Duplicate non-void vendor/invoice combinations are rejected after normalizing whitespace and case; blank invoice numbers are allowed.

Expense receipts use a separate authenticated store, the existing safe formats and 10 MiB maximum. The creator or a company finance authority may append evidence at any stage, including after payment. Each upload increments the expense version, invalidates an earlier decision view and records its uploader; no receipt is replaced or deleted. Receipt bytes are included in database backups. Links to hidden tasks/projects are removed from financial reads, and audit text does not reveal their identifiers. Finance events remain separate from general task activities and are filtered before the latest-1,000 limit.

## Evidence, sessions and automations

Passwords use per-account random salts and PBKDF2-HMAC-SHA256 with 600,000 iterations. Session cookies carry 256-bit cryptographically random opaque tokens; only their SHA-256 hashes are stored. Password changes revoke other sessions, and operator recovery revokes every session. Unsafe browser requests undergo origin checks; sign-in attempts are throttled in process by remote address and email. Apply an ingress-level shared rate limiter when deploying multiple application replicas.

Evidence accepts actual PDF, PNG, JPEG, WebP, plain-text and CSV content with matching extensions, up to 10 MiB per file. File names are sanitized. Bytes are stored as database content and served only through an authenticated task-authorized download, with attachment disposition and `nosniff`/sandbox headers. Office files should be exported to PDF for upload. Include evidence bytes in database backups.

The standalone scheduler scans every five minutes while the server is running. Completion of a daily, weekly or monthly recurring task creates one next occurrence, resets checklist/progress/time and preserves the configuration and original next commitment. A missing, inactive, read-only or self-assigned reviewer pauses recurrence with an actionable audit event and in-app notification; the required review is preserved. Monthly dates clamp to the last valid day in shorter months. A separate reminder pass includes newly created tasks in the same run. Overdue work and work due by tomorrow get at most one reminder per task per company-local calendar day. Unique persisted automation claims and their resulting changes share a transaction, so retries and multiple scanners do not duplicate work.

All notifications are in-app. No email, Slack message, payroll integration, employee scoring or external publishing occurs. Workspace responses include the latest 1,000 accessible activity records and latest 500 personal notifications; the underlying audit records remain persisted. All current company tasks are returned, so pagination and a dedicated reporting warehouse would be appropriate for substantially larger deployments.

## Verification

From this directory:

```sh
go test -race -count=1 ./...
go vet ./...
go build ./...
```

The suite uses actual GORM persistence and HTTP handlers. No business endpoints or database operations are mocked. In addition to task/authentication controls, it exercises financial scopes, exact money bounds, fiscal periods, overlapping budget contention, immutable creators, independent decisions, category/receipt policies, invoice duplication, stale approvals, concurrent budget capacity, payment attribution, protected late receipts, hidden work references and scoped history limits.

To run the same suite against native PostgreSQL and the actual versioned migration, supply a dedicated disposable test database URL:

```sh
TEST_DATABASE_URL='postgres://test_operator@localhost:5432/schach_test?sslmode=disable' go test -race -count=1 ./...
```

Supply a password securely through `PGPASSWORD` when necessary. This opt-in test path creates a randomly named schema per test, applies all numbered up migrations in order in separate transactions, permits multiple connections, and removes only the schemas it created. The test role needs CREATE SCHEMA permission. Do not use a production database for test execution. The native PostgreSQL path is supplied for your deployment gate; it could not be executed in this workspace. The implementation report distinguishes SQLite tests, PostgreSQL WASM migration checks and Encore typechecks from unexecuted native deployment tests.
