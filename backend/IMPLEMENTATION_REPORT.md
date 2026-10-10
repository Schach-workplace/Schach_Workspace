# Backend and Encore implementation report

Verification date: 10 October 2026. This report covers `backend/` and `encore/`. Frontend, browser-preview and packaging verification are recorded separately in the repository documentation.

## Delivery status

All routes in `docs/API_CONTRACT.md`, including the department finance extension in `docs/superpowers/specs/2026-10-10-finance-design.md`, are implemented with real GORM persistence and the shared JSON structures in `frontend/src/types.ts`. The standalone server and Encore adapter execute the same authentication, authorization, workflow, persistence and automation code. There are no mocked business endpoints or placeholder storage implementations.

The final backend suite contains **45 tests and passes in regular and race-detector runs**. Both standalone commands build, both modules pass `go vet`, and the Encore module compiles against the pinned published SDK. Independent checks pass 53 finance HTTP scenarios, 38 existing workspace HTTP scenarios and 100 PostgreSQL WASM migration checks. Native PostgreSQL integration and a full Encore application run remain explicit deployment gates; the limitations below distinguish these from completed checks.

### Shared interfaces

The contract's exported interface is unchanged:

```go
platform.New(db *gorm.DB, options platform.Options) (*platform.Server, error)
platform.Migrate(db *gorm.DB) error
platform.SeedDemo(db *gorm.DB) error
platform.Bootstrap(db *gorm.DB, email, password, name string) error
(*platform.Server).RunAutomations(ctx context.Context) (created, reminders int, err error)
```

`platform.Server` implements `http.Handler`. `Options` retains `AllowedOrigins []string`, `SecureCookies bool` and `SessionHours int`. The additional exported `ResetPassword(db, email, newPassword)` supports the operator CLI; it creates no HTTP endpoint and requires direct database access. The standalone public `/api/health` route performs a database ping.

## Implemented scope

| Area | Delivered behavior |
| --- | --- |
| Authentication | Login, current session, logout and password change; salted PBKDF2-HMAC-SHA256 password hashes; opaque random cookies with only token hashes stored; session revocation; origin validation and in-process login throttling. |
| Companies | Membership-scoped listing and workspaces, platform-owner creation, leadership settings, timezone validation and independent task numbering. Platform ownership does not bypass company membership. |
| Organization | Persistent people, memberships, roles, reporting lines, departments, projects and goals; current target-role checks, last-founder protection and reporting-cycle rejection. Existing-account membership creation cannot reset that account's password. |
| Task planning | Creation, assignment, scope validation, dependencies, parents, checklist, collaborators, priority, effort and recurrence. Dependency and parent cycles are rejected. Hidden projects cannot be revealed by linking a new task. |
| Task workflow | Optimistic version checks, explicit review decisions, owner/reviewer separation at every role, completion gates and accepted-content freezing until reopening. Required approval cannot be removed to bypass review. |
| Commitments | Immutable original deadline; every changed deadline requires a reason and an audit event containing the old and new dates. Blocked work requires a reason. |
| Import | Backend revalidation of up to 200 task rows, actionable errors for every failing row and a single atomic transaction. Invalid imports create no tasks. |
| Collaboration | Comments, time entries, in-app nudges and notifications, personal inbox reads and persistent audit records. Time entries atomically update actual hours and task versions. |
| Evidence | Authenticated, task-authorized upload and download; 10 MiB maximum, content/extension allowlist, sanitized names, database bytes, attachment disposition and no-sniff/sandbox response headers. |
| Financial settings and scope | Company currency and financial-year start month freeze after the first budget or expense. Dedicated finance role has company finance access without company/people administration. Heads receive department finance plus their own expenses; managers/members receive personal expenses; viewers receive no finance data. |
| Categories and budgets | Seven customizable receipt-required starter categories. Versioned category archival. Department budget envelopes fit one financial year, never overlap any budget state, and freeze department/date scope after activation. Amount revisions, closing and reopening require a recorded reason. |
| Expense workflow | Exact integer minor units, immutable creator and currency snapshot, company-local incurred date, scoped work references, normalized duplicate vendor/invoice rejection, draft/submitted/approved/rejected/paid/void lifecycle and independent approval/payment at every role. |
| Financial controls | Approval rechecks active budget capacity under the company lock; only a company finance authority can use an explicit override. Submitted amounts do not reserve funds. Approved-unpaid plus paid consume the envelope once by expense date. Paid/void financial fields are final. |
| Financial evidence and history | Separate authorized receipt store with real bytes, receipt policy rechecked at approval and documented exceptions needing an independent note. Append-only receipts remain possible in final states and invalidate stale decisions. Scoped finance events retain decisions and changes without leaking hidden work links into finance reads or money into general task activity. |
| Automations | Idempotent daily, weekly and monthly recurrence; company-local deadline reminders; persisted uniqueness claims committed with their effects; new recurring tasks included in the same reminder pass; invalidated reviewers pause recurrence with an actionable, deduplicated audit and notification while preserving required review. |
| Operations | Deliberate empty-database bootstrap, explicit local demo seeding, production startup checks, operator password recovery, standalone scheduler, PostgreSQL migrations, SQLite quickstart and graceful HTTP shutdown. |

Company mutations serialize through a company row lock and reload the current actor and membership graph within the transaction. Task graph checks and financial approval capacity consequently see earlier committed mutations in the company. Administrative edits merge only supplied fields into a freshly loaded target. The same principle applies to financial decisions and the manual automation action: an administrator or finance member revoked after the request's initial read cannot continue with stale authority. The regression suite exercises these request orderings using real HTTP handlers and GORM callbacks to coordinate them. Versioned updates return HTTP 409 for stale decisions; receipt uploads deliberately use an additive lock-and-increment operation rather than a client-supplied version.

Accepted task fields cannot be silently edited while retaining `done`. An explicit reopening clears the current completion timestamp while preserving the prior acceptance in history. Comments, time and evidence remain appendable. Submission progress of 100 remains an estimate until the required reviewer accepts completion.

## Persistence and fixtures

The immutable version-1 PostgreSQL migration creates the original 14 tables. Version 2 upgrades a populated version-1 database with five finance tables, company settings and numbering, the finance role and expense notification references, for 19 tables in total. Both versions include tenant-composite foreign keys where applicable, uniqueness constraints, enumerated-value and numeric checks, JSONB collections, bytea evidence and timestamptz sessions. Finance SQL adds exact money bounds, version/state checks, independent reviewer/payment actor constraints, decision metadata checks and a partial unique normalized invoice key for non-void expenses. Optional empty-string relationships and JSON graph relationships also receive application validation. Budget overlap/FY validation, date restrictions, active membership, authorization, currency freezing and workflow capacity remain application-enforced under the company lock; no PostgreSQL RLS is claimed.

Fresh PostgreSQL installations apply version 1 then version 2. Existing version-1 deployments apply only version 2 and retain their users, tasks, evidence, notifications and audit history. SQLite development setup uses GORM migration; production standalone startup rejects AutoMigrate and requires deliberate versioned SQL deployment. Down migrations are destructive disposable-test tools, applied in reverse order; version-2 down removes finance data and converts finance memberships to member before reinstating the old role constraint. Production rollback requires a verified backup and a deliberate recovery plan.

The embedded demo fixture is copied from the final frontend fixture: two companies, 44 tasks, 14 categories, 14 department budgets, 19 expenses, 17 downloadable fictional receipts and matching account identifiers, including `finance@schach.demo`. First seeding moves task/expense dates and timestamps from the fixture anchor. Budget periods instead move by whole company financial years, preserving valid month/day boundaries and handling timezone/FY changes. Each receipt persists the exact UTF-8 bytes supplied in `receiptContents`; unavailable placeholder files are not inserted. Company expense numbering advances beyond the highest seeded numeric suffix. Initialization is idempotent and never replaces existing user data. Time-entry totals agree with task actual hours. Demo accounts exist only after explicit local demo initialization; production startup rejects demo mode.

Final matching SHA-256 values:

| Content | SHA-256 |
| --- | --- |
| Frontend and backend sample JSON | `c030eb6317a5a8f4972c851679325fc9ee7ffb0e47e7003d780bce1ae2280661` |
| Backend and Encore version-1 up migration | `4502929647861a5abf59509dda73bc91ac2f847f190a9c37419b5627e361f8b5` |
| Backend and Encore version-1 down migration | `2ef1edfbc7b654d00d84f061f55652fbe93124fe375d1d713c7caf4d9822ebb5` |
| Backend and Encore version-2 up migration | `e0c46f3d6db61d4c85450a69314bed36f5caba84b47db4e9b3fc31be96a46646` |
| Backend and Encore version-2 down migration | `cd2fef467bd3b1124fa441fcd212fd5ffc67e9a335ae57c21ee0645f4bb41432` |

## Executed verification

Commands below use the ordinary `go` and `encore` executables on PATH. The installed verification toolchain was **Go 1.27.2**, **Encore CLI 1.58.6**, **Encore SDK 1.57.13**, **GORM 1.31.2**, PostgreSQL driver **1.6.3** and SQLite driver **1.6.0**. Both modules declare Go 1.25.0 as their minimum.

| Directory | Command/check | Observed result |
| --- | --- | --- |
| `backend` | `go test -count=1 ./...` | Passed all 45 tests; final platform result `ok schach.local/workspace/backend/platform 17.897s`. Both command packages compiled and contain no tests. |
| `backend` | `go test -race -count=1 ./...` | Passed all 45 tests; final platform result `ok schach.local/workspace/backend/platform 180.884s`. Both command packages compiled and contain no tests. |
| `backend` | `go vet ./...` | Passed, exit 0, after the final code change. |
| `backend` | `go build ./...` | Passed, exit 0, after the final code change. |
| `backend` | Explicit builds of `./cmd/server` and `./cmd/reset-password` | Passed, exit 0; both standalone executables produced for local verification. |
| `encore` | `ENCORERUNTIME_NOPANIC=1 go test ./...` | Passed, exit 0; package reports `[no test files]`. This verifies Go SDK compatibility only. |
| `encore` | `go vet ./...` | Passed, exit 0, after the final adapter/configuration work. |
| Standalone binary | Three production startup refusal probes | All correctly exited 1: demo mode in production, insecure cookies in production, and production without PostgreSQL configuration. |
| Migration/fixture pairs | SHA-256 comparisons | Both migration copies and both final fixture copies are byte-identical. |

### Test coverage

The suite contains 45 named tests using actual GORM databases and HTTP requests. The 25 original tests in `platform/platform_test.go` cover:

1. Authentication cookie properties and cross-company boundaries.
2. Member visibility and viewer write denial.
3. Reviewer/owner separation and stale task versions.
4. Deadline reasons and the immutable baseline.
5. Dependency cycles, parent cycles and foreign-company references.
6. Atomic import with all failing row errors.
7. Concurrent task updates with exactly one winner.
8. Recurrence and reminder idempotency.
9. Cross-site mutation rejection.
10. Founder task owners cannot remove required approval.
11. Hidden projects cannot be exposed through task creation.
12. A newly recurring task receives its reminder in the first scan; repeat scan creates none.
13. Concurrent reporting edits cannot create a cycle.
14. An administrator's stale snapshot cannot overwrite a newly promoted founder.
15. Safe evidence content and task-scoped downloads.
16. Password change revokes other sessions.
17. Time logging updates hours and versions atomically.
18. Checklist and dependency completion gate submission.
19. Last-founder preservation and existing-account password protection.
20. Explicit shared demo fixture consistency and idempotent initialization.
21. Operator reset revokes all sessions and never creates an account.
22. Accepted content requires explicit reopening before editing.
23. Read-only viewers cannot be assigned required review.
24. Password minimum length counts Unicode characters, with a separate byte maximum.
25. A revoked administrator cannot run automations using a stale request snapshot.

The 20 additional tests in `platform/finance_test.go` cover:

1. Company financial defaults, seven starter categories and frozen currency/FY settings.
2. Budget financial-year boundaries, inclusive overlap, immutable activated scope, controlled revisions and stale versions.
3. Exact minor-unit bounds, category archival and normalized duplicate invoices.
4. Independent expense approval/payment, required fields and final financial records.
5. Receipt exceptions, independent notes and current receipt-policy rechecks.
6. Concurrent approvals competing for one budget and explicit authorized overrides.
7. Company/department/personal/no-finance scopes and hidden work-reference removal.
8. Tenant-scoped financial references and immutable expense creator.
9. Hidden task/project identifiers never appearing in financial change-event text.
10. Receipt content, tenant/role authorization, version invalidation and late evidence.
11. Rejection, correction, withdrawal, voiding and valid external payment dates.
12. Recurrence pausing when its reviewer becomes a viewer, with one actionable audit/notification.
13. Simultaneous overlapping budget creation producing one success.
14. Payment consuming the existing approved commitment exactly once.
15. Revoked finance authority failing a delayed approval after membership reload.
16. Task and finance history filtering before the latest-record limit.
17. Seeded receipt bytes, finance data and budget dates matching the shared fixture.
18. Financial-year shifting, including a company timezone boundary.
19. Future expense dates rejected at creation, correction, submission and approval.
20. Unicode character maxima and meaningful reasons preserving Hindi inputs exactly at their documented limits and rejecting over-limit values.

New financial text limits count Unicode characters: category name 120, budget name 160, expense title/vendor 240, invoice 160, description 8,000, payment reference 240 and notes/reasons 4,000. Required controlled reasons and notes also need at least 12 characters. Financial validation uses local helpers, preserving established work-field behavior.

Default execution uses SQLite with real transactions. The race detector checks Go memory access and the coordinated tests check the relevant HTTP outcomes; SQLite's single-connection behavior does not establish PostgreSQL multi-connection locking correctness.

### Independent review and SQL compatibility

A separate reviewer reran 38 original workspace HTTP checks and added 53 financial HTTP checks against the real shared Go handler, normal session cookies, GORM and a disposable SQLite database. All passed against the final runtime. The financial flow exercises every role, independent decisions, concurrent capacity outcomes, receipt-driven stale decisions, immutable active budget scope, exact amount/text/date boundaries, exceptions/overrides, lifecycle and duplicate-payment boundaries, role/membership revocation, scoped history and protected receipt bytes. The review caught a raw hidden task/project ID in financial change history; a targeted regression reproduced it, the event formatter now uses generic link-change text, and the independent probe passes. Source/module/fixture and bridge hashes are recorded in `verification/finance-result.json`; the original results are in `verification/http-result.json`.

The independent SQL check used **PGlite 0.5.8 / PostgreSQL 18.3 WASM / Node 24.19.0** and passed **100 checks**. It applies ordered version-1/version-2 upgrades, verifies every populated version-1 row/field survives, checks the five financial tables and defaults, exercises tenant-composite foreign keys and finance constraints, round-trips JSONB/bytea/timestamptz and maximum exact money, verifies transactional rollback and applies reverse-order down migrations only to its disposable database. Both migration pairs are byte-identical between standalone and Encore. The stored result in `verification/postgres-compat/result.json` was inspected during backend verification. This is PostgreSQL SQL compatibility evidence; it does not execute the Go, GORM or pgx application stack.

## Encore and production verification limits

Encore CLI installation and version verification succeeded. `encore check` could not start its required daemon in this workspace; a foreground diagnostic reported `listen unix .../encored.sock: socket: operation not permitted`. The SDK-only Go command was used to check public type signatures, and is explicitly not an Encore application build, generated-code/configuration validation, Docker run or cloud deployment. No deployment was attempted.

The adapter includes an Encore database, raw API handler, typed CUE configuration, declared bootstrap secret and private managed cron endpoint. The cron method checks Encore's cron idempotency metadata, and the self-host infrastructure template retains top-level incoming private-service authentication. These are separate controls: cron metadata does not replace authentication. Local, preview and arbitrary self-hosted images do not acquire a scheduler merely from a cron declaration. The standalone process has its own five-minute scheduler, and the shared cookie-authenticated company action is available for manual runs.

Native PostgreSQL could not run under this workspace's process permissions: initialization as root was rejected, while switching to a service user and changing file ownership were unavailable. Consequently native PostgreSQL/pgx integration, separate-connection graph serialization, connection pools, TLS, restart durability, failover and restore have not been verified here.

The complete backend suite has an opt-in native PostgreSQL mode for the next gate:

```sh
TEST_DATABASE_URL='postgres://test_operator@localhost:5432/schach_test?sslmode=disable' go test -race -count=1 ./...
```

Use a dedicated disposable database, supply any password through `PGPASSWORD`, and use a test role that can create schemas. Each test creates a random schema, applies all numbered up migrations in order in separate transactions, allows multiple connections and drops its own schema afterward. This path is supplied and compiled but was not executed in this workspace. Before a production release, run it and the normal Encore build/run gate on a machine with supported PostgreSQL and Docker infrastructure, then verify real HTTPS cookies, backup/restore, deployment secrets and scheduled execution in the chosen environment.

## Practical operating limits

Writes within a company are serialized to make mutable membership, task-graph and budget-capacity invariants explicit. Large write volumes should be measured before relaxing that locking strategy. Workspaces currently return all visible current tasks and financial records, at most 1,000 accessible entries in each task/finance history and at most 500 personal notifications; full audit rows remain stored. Scope filtering occurs before the history limit. There is no pagination or reporting warehouse. Login throttling is process-local; multi-replica deployments need an ingress-level shared limiter. Evidence is held in database backups and is limited to the documented safe file types; no antivirus engine or external object-storage integration is claimed. Notifications are in-app, with no email or Slack delivery. Financial payments record external payment evidence; no actual transfer, partial payment, refund, exchange conversion, tax calculation, reconciliation or general ledger is implemented.

These are documented product and deployment boundaries, not inactive endpoints. The local quickstart, bootstrap and recovery commands, configuration values, migration procedure and Encore environment distinctions are described in `backend/README.md`, `backend/migrations/README.md`, `encore/README.md` and the repository operations/security guides.
