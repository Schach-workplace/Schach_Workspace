# Schach Workspace

Package version **1.1.0** (the finance-release version; no new release version has been assigned).

Communication development adds Connect, timed commitments, native clients and self-hosted calls. See [current implementation and verification](docs/COMMUNICATION_IMPLEMENTATION.md) and [rollout operations](docs/COMMUNICATION_OPERATIONS.md) for tested behavior and remaining launch gates.

All ten workspace improvement milestones and the current final client/build checks are recorded in [verification](docs/VERIFICATION.md). The [final evidence publication](verification/workspace-improvements-roadmap/final-integration/publication-report.md) binds the product source, command inputs, bounded runtime checks and Android evaluation APK; physical, protected-TLS and deployment acceptance remain separate.

**A multi-company work and department finance application for founders, CEOs, department heads and their teams.**

**Finance upgrade:** department budgets, categorized expenses, independent review, receipt evidence, payment records and financial-year reporting are now part of each company environment. See [the inspection and design decisions](docs/FINANCE_UPGRADE.md) and [finance guide](docs/FINANCE_GUIDE.md).

The first screen answers: what is late, what is blocked, what needs a decision, and where is delivery slipping? Every figure leads to the underlying work. Departments, reporting lines, owners, deadlines, review decisions and evidence remain connected.

The package contains a React application, a Go/GORM backend, an Encore Go adapter, PostgreSQL migrations, local evaluation with SQLite, and an explicitly labelled browser demonstration. It includes the communication domain, native mobile source and self-hosted call integration alongside the reviewed finance upgrade, with the validation and deployment limits recorded in [VERIFICATION.md](docs/VERIFICATION.md).

## Start here

**Free iPhone testing from Linux:** use the [Expo Go native-screen guide](docs/deploy/EXPO_GO_IPHONE.md). It runs tasks, finance and chat inside Expo Go, with calls and push unavailable; it needs no Apple membership or EAS build.

**For the already-deployed web server:** follow the [native testing and rollout plan](docs/deploy/NATIVE_TESTING_ROLLOUT.md), [Android APK/private Play guide](docs/deploy/ANDROID_TESTING.md) and [iPhone installation from your Mac/TestFlight guide](docs/deploy/IOS_TESTING.md). These connect to the existing HTTPS backend; they do not repeat server setup. Signing accounts and real-device acceptance remain required.

### 1. Explore the interface immediately

Open **`preview.html`** from the extracted ZIP in a current desktop browser. It is a self-contained, interactive demonstration: no Node, Go, database or internet connection is needed. Sample data is fictional. Changes stay in that browser. Uploads stay in that browser's storage.

Start as the founder, switch company from the sidebar, create a task, open Finance, drill into a department budget, inspect an expense receipt, or review work. Sign out to explore the CEO, department-head and team-member perspectives. Settings → Workflow → Reset sample data restores the initial demonstration.

This preview does not share data between employees. Use the server edition below for shared work and server-enforced access controls.

### 2. Run the real application locally

Requirements: **Go 1.26 or later** and a C compiler for the local SQLite driver. The delivered build was verified with the version recorded in the verification report. A recent Chrome, Edge, Firefox or Safari is appropriate for the browser interface. Node **22.12+** is needed only when rebuilding the frontend; Node 24 was used for the supplied builds.

On Linux/macOS:

```sh
./start-demo.sh
```

On Windows PowerShell, with Go and a GCC-compatible C toolchain installed:

```powershell
./start-demo.ps1
```

Open **http://127.0.0.1:8080**. The scripts use the prebuilt API-mode frontend and create a local SQLite database under `data/`. The database remains between restarts. First startup downloads the pinned Go modules if they are not cached. These commands intentionally enable fictional sample accounts; they are for local evaluation.

| Perspective | Email | Local demo password |
| --- | --- | --- |
| Founder | `founder@schach.demo` | `SchachDemo!2026` |
| CEO | `ceo@schach.demo` | `SchachDemo!2026` |
| Finance | `finance@schach.demo` | `SchachDemo!2026` |
| Department head | `head@schach.demo` | `SchachDemo!2026` |
| Team member | `member@schach.demo` | `SchachDemo!2026` |

Demo account creation is explicit. Production mode rejects demo seeding. Do not put confidential employee information in the browser demonstration.

### 3. Develop the frontend and API together

Terminal one, from the repository root:

```sh
cd backend
go run ./cmd/server --demo --addr 127.0.0.1:8080
```

Terminal two:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Vite forwards `/api` requests to the backend. API mode is the default and never silently falls back to sample data when the server is unavailable.

For the browser-only demonstration during frontend development, use `npm run dev -- --mode demo` instead. Keep the distinction visible when gathering stakeholder feedback.

For a guided product walkthrough, read [USER_GUIDE.md](docs/USER_GUIDE.md).

## What is included

| Module | What it does |
| --- | --- |
| Leadership overview | Open commitments, overdue work, review queues, original-deadline acceptance, department comparison, project health and recent activity. |
| My work | Personal ownership and review queues, due-date filters and quick task access. |
| Tasks | Search, intersecting filters, list and board views, ownership, priority, progress, effort, deadlines and task detail sheets. |
| Task governance | Original deadline, revision reason, optimistic version checks, independent review, requests for changes, dependencies and parent tasks. |
| Evidence and conversation | Comments, permission-checked document/image uploads and downloads, actual time entries and activity history. |
| Projects | Separate initiatives with accountable owners, deadlines, department links, status and related tasks. |
| Calendar | Month/week planning, day agendas, filters and deadline drill-downs. |
| Workload | Declared weekly capacity and transparent remaining-effort estimates with individual task drill-downs. |
| Goals | Versioned metadata, append-only observed outcomes/corrections and reviewed evidence; lower-is-better outcomes and owner-only reminder preferences. |
| Reports | Date/person/department filters, original versus revised commitments, accepted work trends, exception tables and CSV export. |
| Department budgets | Financial-year envelopes, draft/active/closed lifecycle, non-overlap, versioned revisions with reasons and visible overruns. |
| Expenses | Company categories, department allocation, vendor/invoice, exact monetary amounts, incurred dates, optional work links, receipts and decision history. |
| Expense controls | Independent approval, receipt-exception review, budget checks and recorded overrides, rejection/resubmission, withdrawal, voiding and external payment records. |
| Finance reports | Financial-year and department drilldowns, pending/approved/paid totals, category spending, budget availability, personal expenses and filtered CSV export. |
| People | Company roles/managers/capacity, onboarding presets and reviewed onboarding, complete access attestation and separately confirmed departure. |
| Inbox | In-app assignment, comment, review, deadline and nudge notifications with read state. |
| Recurring work | Daily/weekly/monthly successor tasks and idempotent deadline reminders; manual processing and a standalone background scheduler. |
| Company administration | Add environments, switch only between authorised memberships, manage company identity, timezone, currency and financial-year start, change password. |
| Bulk tasks | CSV template, proper quoted CSV parsing, row-level validation and an atomic server import of up to 200 tasks. |

The desktop sidebar becomes a compact mobile navigation system; tables remain scrollable within their panels and task details become full-height sheets. The official Schach orange/charcoal palette, logo and self-hosted brand fonts are included with source/license notes.

## The workflow that makes the numbers meaningful

1. A person or manager creates a task with one accountable owner, a commitment date and a clear expected result.
2. The owner records progress, evidence, time and blockers. Dependencies make prerequisites explicit.
3. If the deadline changes, the original date remains and a reason is recorded.
4. Required-review work is submitted as **In review**. The owner cannot accept their own work or remove an existing required review.
5. The assigned reviewer or authorised company leader accepts the result or requests changes. Required checklist items, dependencies and subtasks must be complete before acceptance. Accepted task fields stay frozen until the task is explicitly reopened; reopening requires another acceptance before completion.
6. Reports distinguish accepted work, pending reviews, current deadlines and original commitments. A task count is not presented as an employee performance score.

The system provides rule-based prioritisation and reminders. It does not invent AI predictions, employee ratings, working hours or business outcomes. Goal measurements are explicitly entered by an accountable person; completing related tasks does not automatically prove that a business outcome improved.

## How separate company environments work

There is one application with **separate company memberships and logically isolated data**. The founder/platform owner can create additional companies. The same person may belong to several companies with a different role in each. Every company-scoped request validates membership and its referenced records on the server.

Founder/CEO/admin can oversee the relevant company. Heads see their department, managers see their reporting scope, and members see their own accessible tasks. Finance can manage company financial records while retaining only their normal own-work access. Viewers have read-only company work access and receive no financial records. Heads receive their department finance; managers and members receive their own expenses. There is no unauthenticated role switch in the server application. The browser demo's sample-person selector is only a demonstration.

This release does not provision a separate database/server per company. PostgreSQL composite constraints add tenant consistency to important relationships; application transactions enforce scope. See [SECURITY_AND_LIMITATIONS.md](docs/SECURITY_AND_LIMITATIONS.md) for the exact boundary and [API_CONTRACT.md](docs/API_CONTRACT.md) for endpoint details.

## Encore + Go + GORM

`backend/platform` owns the real domain logic and HTTP API. `backend/cmd/server` serves it directly for local evaluation and self-hosting. `encore/` is a separate Encore Go module importing the same package; it connects GORM to an Encore-managed PostgreSQL database with `sqldb.Stdlib()`.

```sh
cd encore
encore check
encore run
```

Read [encore/README.md](encore/README.md) before running: local PostgreSQL needs Docker, bootstrap secrets/configuration must be set, and Encore cron does not execute automatically in local development. The provided Docker image recipe is the standalone deployment route. The Encore adapter and production configuration instructions provide the Encore route; checks actually run are identified in the verification report.

## Run a full stack with PostgreSQL

The root `compose.yaml` and `Dockerfile` build the frontend and Go service, create a PostgreSQL database, and run the checksummed migration service for all numbered migrations before starting the application. Existing pre-ledger releases require explicit adoption; see the migration guide.

```sh
cp .env.example .env
# Edit .env and set unique database/bootstrap passwords and your founder email.
docker compose up --build
```

This reference Compose configuration starts as **local development** on `127.0.0.1:8080`. It does not create the sample accounts unless you explicitly change the configuration. The bootstrap account and initial company are created only for an empty database.

For deployment, follow [OPERATIONS.md](docs/OPERATIONS.md): TLS/reverse proxy, exact allowed origin, secure cookies, production mode, least-privilege database roles, encrypted backups with a tested restore, monitoring, and your own infrastructure validation. Production startup deliberately refuses SQLite, demo accounts, insecure cookies and non-HTTPS allowed origins. Protect the database and keep the application on the intended private/company network until the deployment is verified.

Compose initialization scripts run only when the database volume is new. For an existing version-1 installation, back up the database, stop writers, and follow the current numbered migration/adoption owner in the [operations guide](docs/OPERATIONS.md). Migration 2 alone does not upgrade the current 58-pair schema. The historical finance-only procedure is in the [upgrade procedure](docs/FINANCE_GUIDE.md#upgrading-an-existing-installation). Keep the database volume intact.

## Build and test

```sh
cd backend
go test ./...
go build ./cmd/server

cd ../frontend
npm ci
npm test
npm run build
npm run build:demo

cd ..
node scripts/make-preview.mjs
```

The frontend suite includes rendered React DOM integration tests using Happy DOM and Testing Library. They verify workflow interactions, not browser layout. After building the standalone preview, run `node frontend/scripts/verify-preview.mjs` from the repository root to verify the compiled artifact and embedded assets. The full API scenario runner and the isolated PostgreSQL schema check are documented in `verification/README.md` and `verification/postgres-compat/README.md`. See the verification record for executed checks and environment limits.

## Project map

```text
backend/platform/       Authentication, access, work, finance, receipts, jobs
backend/cmd/server/     Standalone Go server and local scheduler
backend/cmd/reset-password/  Operator account recovery
backend/migrations/     Versioned PostgreSQL schema
encore/                 Encore service and managed database adapter
frontend/src/           Typed React application, HTTP/demo adapters, tests
frontend/public/        Official logo and licensed self-hosted fonts
frontend/dist/          Prebuilt frontend for the real API
preview.html            Self-contained interactive browser demonstration
scripts/                Reproducible preview and demo-data utilities
docs/                   Product, implementation, API, operation and verification notes
verification/           Reproducible API scenarios and PostgreSQL compatibility checks
```

## Before inviting the team

Use the real server to choose each company’s currency and financial year, create departments and budgets, configure expense categories, and add people with initial passwords through an authorised administrator, set reporting managers/capacity, create projects and import a small set of live tasks. People can change their own passwords after sign-in. An authorised database operator can recover an existing account with `backend/cmd/reset-password`, revoking its active sessions. Account email delivery, self-service forgotten-password recovery, enterprise SSO, WhatsApp/email notifications and operator-provisioned scanner/push delivery are not silently represented as configured integrations; MFA and single-use recovery codes are implemented, with operator key setup required; their status is listed in the security/operations documents.

The fresh fictional fixture contains 2 companies, 44 tasks, 14 department budgets, 19 expenses and 17 downloadable sample receipt files. Existing browser work is preserved on upgrade; use Reset sample data only when you intentionally want to replace local demo changes with this fixture.

This package is ready for technical review and a controlled pilot. It is not a claim of an external security audit, regulatory certification, measured internet-scale capacity or a deployment into your live company environment.

## Communication and native clients

Connect now provides company-scoped private DMs/groups/channels, durable text/media, scoped search and attention, selected publication into tasks/intake/expense drafts, structured acknowledgements/polls/events/decisions, and self-hosted calls. Private chat membership is independent of company leadership and existing task/finance controls. Timed task commitments preserve original instants and zones; added evidence invalidates stale acceptance.

`mobile/` contains Android/iOS React Native clients with secure session storage, communication/media, work and independent finance review, structured responses and call integration. Historical Android artifacts are source-qualified development/evaluation builds. Final integration builds a separate embedded release evaluation APK; protected HTTPS authentication, organizational signing, iOS, physical-device push/background calls and real TLS/TURN remain separate gates. The browser demo continues to label its fictional data and does not simulate shared communication.

Read [implementation evidence and remaining gates](docs/COMMUNICATION_IMPLEMENTATION.md), [communication operations](docs/COMMUNICATION_OPERATIONS.md), and [mobile setup](mobile/README.md). The full implementation sequence remains in [the development plan](docs/superpowers/plans/2026-10-10-communication-implementation.md); its unchecked rollout gates must not be represented as completed adoption.

### Connect interaction update

Connect now separates the conversation list from the chat history and composer on desktop, phone browser and native clients. To send a direct message, choose a person: no conversation name is needed, and the server reopens the same private company-scoped chat. Group and channel creation retain names and explicit audience selection. Details, message actions, threads and selected work publication use contextual dialogs/sheets. See [the interaction and verification record](docs/CONNECT_UX.md).

## Workspace improvement roadmap

The ten [dependency-ordered roadmap milestones](docs/superpowers/plans/2026-10-10-workspace-improvements-roadmap.md) are implemented: exact and historical reporting, bounded data reads, Connect/native usability, attention, execution, finance assistance, planning/outcome facts, People administration and grounded local intelligence. Final integration and deployment acceptance remain separately qualified in [VERIFICATION.md](docs/VERIFICATION.md). Read [People administration](docs/PEOPLE_ADMINISTRATION.md), [private report storage](docs/reports-storage.md), [local intelligence](docs/intelligence-local.md) and [planning and goals](docs/PLANNING_AND_GOALS.md) for operational boundaries. Optional intelligence works on explicit selected sources and opt-in; suggestions never approve work/payments or fabricate observations. The self-contained demo labels shared Connect and local inference unavailable and supports manual work offline.

## Team end-to-end QA pack

[Open the team QA guide](docs/qa/README.md): 224 proposed scenarios, guides for all modules, editable workflow diagrams, a searchable offline guide, Excel/CSV execution templates and a printable workflow PDF. Every manual case starts NOT_RUN; use the isolated fictional test environment and role matrix before testing. Historical automated evidence remains separate in docs/VERIFICATION.md.

The next mobile-first improvement cycle is tracked in [the detailed plan](docs/superpowers/plans/2026-10-18-mobile-experience.md), with [native component layout evidence and device checks](verification/mobile-experience-2026-10-18/README.md).
