# Verification record

**Local continuation, 10 October 2026:** [Fresh native baseline and failures](LOCAL_BASELINE_2026-10-10.md) records successful PostgreSQL, TCP, browser and Compose checks on the current host, plus three Encore adapter source defects. The original environment limits below are historical; the new record distinguishes the unchanged adapter from its disposable corrected diagnostic copy.

Recorded on **10 October 2026**. This document separates executed checks from deployment checks that remain open. It is a technical delivery record, not an external security audit or production certification.

## Runtime and dependency versions

| Item | Version and evidence |
| --- | --- |
| Go used for independent HTTP probes | `go1.27.2 linux/amd64`, observed with `go version` |
| Node / npm used for the migration probe | Node `24.19.0`, npm `11.9.0`, observed from the installed runtime |
| Python used for the HTTP bridge flow | `3.12.14`, observed from the installed runtime |
| Go module requirement | Go `1.25.0`, in both module files |
| GORM / PostgreSQL driver | GORM `1.31.2`, PostgreSQL driver `1.6.3`, pinned in the module files |
| Local SQLite driver | GORM SQLite driver `1.6.0`, pinned in `backend/go.mod` |
| Encore Go SDK | `1.57.13`, pinned in `encore/go.mod` |
| Encore CLI | `1.58.6` installed, as recorded in the [adapter verification notes](../encore/README.md); native daemon startup blocked |
| PGlite | `@electric-sql/pglite` `0.5.8`, pinned in the isolated verification lockfile |
| PGlite engine | `PostgreSQL 18.3`, WASM target `wasm32-unknown-emscripten`, returned by `SELECT version()` |

Encore's managed/local runtime execution must be assessed separately from its SDK dependency version or installed CLI. [Brand and primary-source notes](BRAND_AND_SOURCES.md) record the upstream references.

## Application integration record

The table records the consolidated release **1.1.0** checks against the completed task-management and finance source. These are reproducible source, HTTP-handler and DOM checks; the environment limits below remain explicit.

| Check | Final result | Scope and evidence |
| --- | --- | --- |
| Backend domain and HTTP tests | **45 tests passed** with `go test -count=1 ./...`; platform result **17.897s**. Root recheck also passed in **17.672s** | Actual shared handlers, authentication cookies, finance controls, GORM transactions and SQLite persistence. |
| Backend race run | **45 tests passed** with `go test -race -count=1 ./...`; platform **180.884s** | Final backend-owner run; coordinated concurrency regressions and Go memory race detection. This does not establish native PostgreSQL locking behavior. |
| Go static analysis and builds | Backend `go vet ./...`, `go build ./...`, and both standalone command builds passed | See the [backend implementation report](../backend/IMPLEMENTATION_REPORT.md). |
| Encore SDK compatibility | `ENCORERUNTIME_NOPANIC=1 go test ./...` and `go vet ./...` passed | The package contains no Encore tests. This checks public Go SDK types and compilation, not the Encore analyzer or runtime. |
| Frontend test suite | **63 tests across 8 files passed**, final run **7.40s** | Metrics, imports, money/fiscal-year calculations, demo finance permissions/concurrency and rendered React DOM workflows in Happy DOM. Includes multilingual/astral text boundaries, company settings/onboarding, finance forms/decisions and preservation of existing version-1 demo work during hydration. See the [frontend report](../frontend/IMPLEMENTATION_REPORT.md). |
| Frontend formatting and builds | `npm run format:check`, `npm run typecheck`, API-mode Vite build and demo-mode Vite build passed | Release 1.1.0: 2,028 modules; API JavaScript 511.98 kB, demo JavaScript 659.71 kB, CSS 145.41 kB. React 19.3.0, TypeScript 7.0.2, Vite 8.3.4; dependencies are locked. |
| HTTP application scenario | **38 checks passed** | Real `platform.Server` through an in-process `httptest` bridge, using real cookies and an isolated SQLite database; [result JSON](../verification/http-result.json) and [instructions](../verification/README.md). No listening TCP server or browser is used. |
| Finance HTTP scenarios | **53 checks passed** | Real `platform.Server` with eight role scenarios, receipt bytes, financial state/version controls and concurrent budget decisions; [result JSON](../verification/finance-result.json), [reproducible flow](../verification/finance_flow.py), and [instructions](../verification/httpbridge/README.md). |
| Compiled standalone preview | **11 checks passed**, artifact **938,332 bytes** | Actual bundled JavaScript mounts the overview and finance view, drills into a department budget, switches companies, and verifies separate task/financial data in Happy DOM. Required fonts, logo, CSS and JavaScript are embedded; [result JSON](../verification/preview-result.json). This does not measure browser layout. |
| PostgreSQL SQL compatibility | **100 checks passed** | Actual ordered versions 1 and 2 SQL migrations, populated upgrade and reverse downgrade in PGlite 0.5.8 / PostgreSQL 18.3 WASM; detailed coverage below. |
| Production startup refusals | **3 expected rejections passed** | Demo mode, insecure cookies, and missing PostgreSQL production configuration were rejected by the standalone binary. |
| Distribution preparation | Source/fixture/migration consistency passed; **24 Markdown documents, zero broken relative links**; shell/Python syntax and Compose YAML parsed | Release selector: **155 files**, zero ELF binaries, required finance source/migrations/docs included. Source archives omit local databases, secrets, dependency directories and caches. Docker/Compose execution remains unverified. |

### Reproduce the application checks

From `backend/`, with Go and a C compiler available:

```sh
go test -count=1 ./...
go test -race -count=1 ./...
go vet ./...
go build ./...
```

From `frontend/`, with Node 22.12 or later (Node 24.19.0 and npm 11.9.0 were used):

```sh
npm ci
npm run format:check
npm test
npm run build
npm run build:demo
```

From the repository root, after those builds:

```sh
node scripts/make-preview.mjs
node frontend/scripts/verify-preview.mjs
```

The full [HTTP scenario instructions](../verification/httpbridge/README.md) build `verification/httpbridge` and run `verification/http_flow.py` plus `verification/finance_flow.py` with the explicit `--allow-demo-mutations` flag. The 38-check snapshot covers company creation, organization setup, task assignment/version conflicts, deadline history, immutable required review, checklist gates, comments, time, evidence bytes and scope, independent acceptance/reopening, atomic imports, automations, notification ownership, audit history and logout-cookie replay rejection. The separate 53-check financial snapshot is detailed below. The static HTTP document check is deliberately skipped in bridge mode.

For the SDK-only Encore check, from `encore/`:

```sh
ENCORERUNTIME_NOPANIC=1 go test ./...
go vet ./...
```

On a supported deployment host, the separate required Encore gate is `encore check` followed by a configured `encore run` and real API flows. For native PostgreSQL, run the backend suite with `TEST_DATABASE_URL` pointing to a disposable database; [backend instructions](../backend/IMPLEMENTATION_REPORT.md) describe schema permissions and cleanup. Neither of these native gates passed in this workspace, because they could not run here.

## PGlite migration compatibility — passed

The original `backend/migrations/1_initial.up.sql` and `.down.sql` remain unchanged. They and `2_department_finance.up.sql` / `.down.sql` were executed in version order and reverse version order in a disposable PGlite database. Both Encore migration pairs were verified byte-identical. **100 checks passed** using PGlite 0.5.8 / PostgreSQL 18.3 WASM. The test upgraded an already-populated version 1 schema; it did not substitute a newly generated schema for the release migration.

| Coverage | Observed result |
| --- | --- |
| Schema | Both up migrations accepted in their own transactions; 14 original tables and five financial tables created |
| Populated upgrade | Every original column/row across all 14 legacy tables preserved; company financial defaults and empty expense-notification links added |
| Company-consistent references | Cross-company task/project/goal owners and comment/time/attachment task links rejected with SQLSTATE `23503` |
| Uniqueness | Duplicate memberships, company task codes, slugs, emails and automation keys rejected with `23505`; identical codes in different companies accepted |
| Validation constraints | Invalid roles, capacity, task status/progress/effort/version, review combinations, time/upload sizes and goal range rejected with `23514` |
| Data types | JSONB arrays/checklists, attachment bytea and session timestamptz round-trips passed; malformed JSON rejected |
| Financial integrity | Cross-company budget/expense/receipt references rejected; Finance role accepted; exact bigint money limits, independent review/payment metadata, unique expense codes and normalized invoice keys enforced |
| Financial evidence | Exact receipt bytea persisted; invalid receipt sizes and invalid financial event type rejected |
| Transactions | Constraint failure rolled back earlier writes in the transaction |
| Reverse downgrade | Version 2 down preserved original rows, removed financial structures and demoted Finance memberships to Member before restoring the old role constraint; version 1 down left no fixture tables |

Reproduce with [verification/postgres-compat/README.md](../verification/postgres-compat/README.md). The [result snapshot](../verification/postgres-compat/result.json) contains all 100 named checks, SQLSTATE evidence, the ordered migration list, versions and hashes. This remains a **PGlite compatibility check**; it does not execute the Go/GORM/pgx stack against native PostgreSQL. Application rules such as budget overlap, financial-year boundaries, optimistic versions, settings immutability, evidence policy and authorized transitions are assessed separately through the HTTP handlers.

From the repository root:

```sh
cd verification/postgres-compat
npm ci
npm test
```

The version 1 up-migration SHA-256 was `4502929647861a5abf59509dda73bc91ac2f847f190a9c37419b5627e361f8b5`; its down migration was `2ef1edfbc7b654d00d84f061f55652fbe93124fe375d1d713c7caf4d9822ebb5`. Version 2 up was `e0c46f3d6db61d4c85450a69314bed36f5caba84b47db4e9b3fc31be96a46646`; version 2 down was `cd2fef467bd3b1124fa441fcd212fd5ffc67e9a335ae57c21ee0645f4bb41432`. A later SQL change requires a fresh run. Destructive downgrade checks touched only this command's in-memory fixture.

## Independent financial HTTP review — 53 checks passed

The independent [finance flow](../verification/finance_flow.py) uses the normal sign-in/session boundary and real shared handlers through the [in-process bridge](../verification/httpbridge/README.md). It creates disposable fictional companies and founder, Finance, department-head, manager, member and viewer accounts. Financial amounts are asserted as exact integer minor units. The result records the relevant source hashes so a later code change cannot silently inherit this evidence.

| Scenario | Observed result |
| --- | --- |
| Financial access | All eight role scenarios matched company/department/personal/none scope; Finance could not manage people/company settings or hidden task content |
| Money and references | Fractional, zero expense, negative and over-limit amounts rejected; zero budget and the exact upper boundary accepted; foreign company/category/department links rejected |
| Dates and multilingual text | Future expense create/edit rejected without a version increment; maximum Unicode title/vendor/invoice/description values persisted and one-character-over-limit values rejected |
| Financial identity | Creator, company currency, expense code and initial status/version came from the server; creator remained immutable |
| Budgets | Inclusive overlap, fiscal-year boundaries and activated-period immutability enforced; controlled amount changes and closure/reopening required reasons |
| Expense lifecycle | Submit/review/pay order enforced; rejected entries could be corrected and resubmitted; creator could withdraw submitted work |
| Independent decisions | Founder and Finance could not approve, reject or pay their own expenses; heads could review eligible in-department requests but could not pay or override budgets |
| Receipt evidence | Exact uploaded/downloaded bytes and attachment headers verified; unsafe extension and unauthorized reads/writes rejected; additive receipt upload advanced the version and invalidated an older approval view |
| Missing receipts | Required evidence or a meaningful exception blocked submission; accepting an exception required an independent meaningful approval note |
| Budget usage | Approved-unpaid plus paid counted once; submitted value stayed separate; paid value retained its expense-date attribution |
| Competing approvals | Two handlers started together with capacity for one expense: exactly one succeeded and the other was rejected; retry required an explicit authorized budget override |
| Final records | Duplicate payment clicks, all paid field changes, paid voids and other final-state transitions rejected; independent approved void released exactly its commitment |
| Audit privacy | Private task/project identifiers remained hidden in expense fields and audit detail; payment references and override notes did not enter broad task activity feeds |
| Current access | Role changes immediately narrowed finance reads/writes; revoked membership could not reuse its existing cookie to read or mutate finance |
| Retention | Category archival preserved prior expenses; receipt, payment and audit history survived actor role changes |

An additional authenticated seed check read both fictional companies and downloaded all **17 seeded expense receipts** through the same shared handler. Every response matched the fixture's readable UTF-8 receipt text and stored size exactly. This observation is separate from the durable 53-check flow count.

The audit-privacy scenario first exposed a concrete defect: a financial field-change event included hidden task/project identifiers. The backend now records those link changes generically. The regression was rerun against a rebuilt bridge and passed.

The competing-approval check runs actual concurrent Go handlers, with SQLite persistence constrained to one connection. It demonstrates the observable budget decision and retained data in that setup. It does not prove isolation across multiple PostgreSQL backend processes; the native PostgreSQL concurrency gate remains open.

### Independent demo adapter review — lost-update correction rechecked

A separate temporary probe called the actual demo adapter without changing frontend source. Before correction, two simultaneous edits using the same expense version both reported success, while only the second title and a single version increment persisted. Two approvals competing for a budget that could fund only one also both reported success, but only one approval and its audit event survived. The adapter loaded a database copy before an asynchronous projection call, then later saved that stale copy.

The corrected adapter calculates scope and applies financial mutations synchronously against one fresh state. The independent probe was rerun: one same-version edit succeeded and the other reported a conflict; one budget approval succeeded and the other reported the required budget override. The retained state contained one approved and one submitted expense, with exactly one successful approval event. Durable regressions are included in the [demo finance tests](../frontend/src/data/demo-finance.test.ts).

The read-only adapter review also led to alignment of financial actor visibility, before/after expense field history, hidden-link redaction, withdrawal metadata, explicit override authorization and retention, receipt-exception validation, project department matching, and Unicode limits. These controls describe the evaluation adapter's behavior; local browser storage remains user-controlled and does not become a shared financial security boundary.

## Independent HTTP security review — rechecked after corrections

A separate Go HTTP probe used the shared `platform.Server`, real session cookies, and a disposable SQLite database. The probe kept the backend code unchanged. GORM query callbacks paused two request snapshots to reproduce concurrent organization edits deterministically; they did not alter application writes. These are observed HTTP outcomes, separate from the final application test-suite count.

| Scenario | Result after correction |
| --- | --- |
| Manager owns required-review task and attempts to remove review while completing it | `403`; bypass denied |
| Member creates task referencing a hidden same-company project | `422`; hidden project absent both before and after the attempt |
| Concurrent A-reports-to-B and B-reports-to-A changes | One `200`, one `422`; final reporting graph remained acyclic |
| Stale lower-admin deactivation after a founder promotes the target | Promotion `200`, deactivation `403`; target remained an active founder |
| Evidence access | Authorized download `200` with attachment disposition; hidden task attachment `404` |
| Comments | Hidden task comment `404`; viewer comment `403` |
| Notification ownership | Read request completed without changing another user's unread notification |
| Moving a previously inaccessible resource into the caller's scope | Project and goal edits `403`; task edit `404` |
| Leadership role protection | Lower-admin self-promotion and founder deactivation attempts both `403` |

The first four scenarios exposed concrete defects during review and were re-executed after the backend owner corrected them. Task parent/dependency edits also now use the company transaction lock and refreshed permissions; simultaneous different-task edge edits on native PostgreSQL remain a deployment test, because the SQLite probe does not exercise multiple PostgreSQL backend processes.

## Environment limits and open deployment checks

Native PostgreSQL initialization was blocked in this environment: `initdb` refused execution as root, and the available privilege-changing path could not create the required process identity. The PGlite run supplied SQL compatibility evidence without bypassing that restriction. It does not verify native PostgreSQL persistence, TLS, credentials, connection pools, concurrent locking, scheduler overlap, or a backup restore.

TCP access to the standalone Go service was unavailable across the execution boundary. The 38-check bridge therefore verifies the shared handler in process, not transport behavior, a reverse proxy, production cookies over TLS, or static-file serving over a real connection.

Browser automation and Encore's native Unix-socket path were also blocked by the execution environment. The Encore diagnostic reported `listen unix .../encored.sock: socket: operation not permitted`. **No mobile screenshots or mobile visual checks were verified.** The source contains responsive layouts, and the rendered/compiled DOM checks passed, but those checks do not prove device rendering or actual browser interactions. A successful ordinary Go SDK compile does not establish that the Encore application boots, provisions Docker/PostgreSQL, compiles under the Encore analyzer, validates generated configuration, or receives managed cron dispatch. Docker/Compose execution, native PostgreSQL integration and real browser testing remain open.

Before real team use, run the complete Go/Encore/PostgreSQL path, verify the production proxy and cookie/origin policy, rehearse restoration, and test scheduler overlap on the target database. Exercise desktop and mobile flows in actual browsers: sign-in, company switching, task creation/edit/review, upload/download, navigation, filters, reports and keyboard focus. Record those results against the deployed revision. [Operations guide](OPERATIONS.md); [security boundaries and limitations](SECURITY_AND_LIMITATIONS.md).

## Release inclusion and documentation audit

Relative Markdown links were checked across the project's **24 Markdown documents**, excluding dependency, Git and generated distribution directories; **zero broken relative links** were found. The release selector included **155 files**, including the required finance source, both migration versions, finance documentation, module/lock files, frontend data adapters and fixtures, compiled API/demo bundles, the self-contained preview, font licenses, configuration examples and verification scripts/results. No ELF binaries, runtime databases, local secret files or dependency directories were selected. Environment-file inclusion was limited to the intentional `.env.example`, frontend `.env.example`, and frontend `.env.demo` configuration files.

The Compose YAML parsed successfully and selects only the ordered version 1 and version 2 up migrations. The startup script passed `bash -n`; Python files compiled successfully. These checks do not establish that Docker/Compose or the production startup sequence can execute on the target host.

The packaging command is `python3 scripts/package_release.py` from the repository root. It excludes local `data/`, dependency/cache directories, runtime database files, `.env`, `.env.local` and Encore's local secret override while retaining intentional example/demo build settings. It writes a SHA-256 manifest, then checks ZIP integrity and every archived file against that manifest. Final archive size and checksum are supplied after this packaging step completes. This inclusion-policy audit is separate from the archive integrity check performed by the packager.

## Communication development verification — 2026-10-10

The original finance/M0 evidence above is historical. Current communication capabilities, fresh command results, discovered defects and environment limitations are recorded separately in [COMMUNICATION_IMPLEMENTATION.md](COMMUNICATION_IMPLEMENTATION.md). That report takes precedence for current code; it does not turn physical-device, provider-push, India deployment or organizational cutover checklists into passed tests.
