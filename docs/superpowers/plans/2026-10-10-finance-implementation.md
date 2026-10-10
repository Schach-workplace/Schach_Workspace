# Finance and Application Review Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the assigned independent backend, interface and verification tasks; root integrates shared types, data adapters and existing UI fixes. The user requested complete execution in one pass.

**Goal:** Deliver department budgets, categorised expenses and independently reviewed fixes to confirmed application gaps in an updated ZIP.

**Architecture:** Extend the existing shared Go/GORM domain and company transaction lock. Add an immutable PostgreSQL migration, scoped finance records, typed React finance screens, an exact-money calculation module and a matching local demonstration adapter.

**Tech Stack:** Go, Encore, GORM, PostgreSQL/SQLite, React, TypeScript, Vite, Radix, TanStack Query, Vitest/Happy DOM, PGlite.

**Spec:** [Finance design](../specs/2026-10-10-finance-design.md).

## Global constraints

- Preserve migration 1 and all existing company work; add migration 2 and legacy demo hydration.
- Supported currencies: INR, USD, EUR, GBP, AED, SGD, AUD, CAD; exact integer minor units; maximum 1,000,000,000,000 per amount.
- Fiscal start defaults to April; currency/fiscal month freeze after first financial record.
- Approved-unpaid and paid count once; submitted is a separate pending bucket.
- Immutable creator cannot approve/reject/pay own expense; viewer receives no finance data.
- Backend authoritative permissions; client affordances match them. Never widen task access through finance links.
- Preserve source palette and mobile navigation; no new product dependencies are required.
- Work on `build/schach-workspace-finance`, preserving the prior release commit and saved archive.

## Review focus

| Risk | Test owner and expected behavior |
| --- | --- |
| Decimal rounding, invalid scale and double counting | Root money/summary tests reject extra decimals and count approved versus paid exactly once. |
| Overlapping allocation, FY/date movement and stale budget balance | Backend budget tests reject overlap/frozen period edits and serialize concurrent approvals. |
| Own approval, stale authority, guessed receipt IDs and linked-work leakage | Backend tests plus independent handler scenario deny every unauthorized operation. |
| Upgrade of real existing data | Migration probe upgrades populated v1 and preserves old task rows; demo test hydrates old JSON without resetting tasks. |
| Revocation, partial scope and misleading charts | Root/DOM tests hide a denied company immediately and personal finance never displays incomplete department balances. |

## Task 1: Financial domain and migration — backend owner

Files: new `backend/platform/finance.go`, `finance_test.go`, new finance migrations in backend/Encore; modify models, routing, company configuration, seed, workspace and permissions as specified. Existing backend/Encore README files document migration order and the new role.

- [x] Write failing HTTP tests for currency defaults/locks, precise amounts, budget overlap and immutable boundaries.
- [x] Implement categories/budgets and migration defaults, preserving all existing records.
- [x] Write failing lifecycle tests for submit/approve/reject/pay/void, duplicate invoices, missing receipts/explicit exceptions, versions, cross-company references and budget overrides.
- [x] Implement expense persistence, transitions, receipts, finance events and notifications under the company lock.
- [x] Test and fix recurrence reviewer eligibility and scope task activities before limit.
- [x] Run complete Go tests/race, vet/build and Encore SDK compile; report exact executed scope.

## Task 2: Shared types, calculations and demo adapter — root

Files: modify `frontend/src/types.ts`, `data/demo.ts`, `data/api.ts`, `store.tsx`; create `data/finance.ts`, `data/finance.test.ts`, `data/demo-finance.ts`, `data/demo-finance.test.ts`; update fixture generator and JSON.

Interfaces: `parseMoney(string): number`, `formatMoney(number, currency?): string`, `fiscalYearRange(year, month?): {startDate,endDate}`, `fiscalYearStart(date, month?): number`, `budgetUsage(budget, expenses)`, `financeSummary(workspace,start,end,departmentId?)`. Store adds expense receipt upload/download methods.

- [x] Write and run failing exact-money, fiscal-boundary and mutually-exclusive total tests.
- [x] Implement helpers and shared types against the frozen API contract.
- [x] Test demo lifecycle, personal scope, legacy hydration, duplicate invoices, overlap and payment immutability; implement matching demo behavior.
- [x] Generate internally consistent multi-company finance samples; sync backend fixture.
- [x] Wire receipt store methods and remove denied workspace data on 403; add an API-mode revocation regression.

## Task 3: Finance interface — frontend owner

Files: `pages/Finance.tsx`, `pages/Finance.css`, `components/FinanceForms.tsx`, optional `components/FinanceDetail.tsx`, `finance.ui.test.tsx`.

Consumes shared types/helpers/store. Produces `FinancePage({initialExpenseId?, onOpenTask})`.

- [x] Write failing DOM workflows for Finance navigation, budget totals/drill-down and personal expense scope.
- [x] Implement financial-year overview, budget management and exact period labels.
- [x] Implement category management, ledger filters/export, expense creation and details, receipts, history and transition forms.
- [x] Verify approval amount/budget/exception context, immutable fields, final-state controls, mobile CSS and DOM interactions.

## Task 4: Existing UX and integration fixes — root

Files: `App.tsx`, `pages/Overview.tsx`, `pages/GoalsReports.tsx`, `pages/InboxSettings.tsx`, `pages/Organization.tsx`, `components/TaskDrawer.tsx`, scoped additions in `styles.css`.

- [x] Add Finance navigation, notification deep links, finance role label and company currency/FY controls.
- [x] Add empty-company setup guidance and executive finance entry points using actual scoped data.
- [x] Fix zero-value charts and invalid tab semantics; align report period limits and totals.
- [x] Update representative rendered DOM tests and run the full frontend suite/builds.

## Task 5: Independent verification and release

Files: `verification/finance_flow.py`, `verification/postgres-compat/**`, updated verification/operations/user guides and release notes.

- [x] Execute independent finance HTTP-handler scenarios, report concrete security/state/precision findings and fix them.
- [x] Run versioned PostgreSQL WASM upgrade/down/constraint probes and retain sanitized results.
- [x] Rebuild API/demo UI and standalone preview, verify compiled artifact and archive contents.
- [x] Update the gap register with fixed versus deliberately open boundaries; replace the saved ZIP and deliver it.

## Coordination review

Backend and root share only the JSON/API contract and final sample bytes; backend owns its copy, root owns the generator. Frontend consumes shared types but owns only new Finance view files. Verification reads all code but edits only its isolated harness files. Root alone changes existing UI, shared styles and package files. These ownership boundaries avoid concurrent edits to the same file.

Implementation decisions and verification results are recorded in [FINANCE_UPGRADE.md](../../FINANCE_UPGRADE.md), updated through delivery.

## Completion record

Release 1.1.0 includes the implemented finance design, inspection corrections, upgrade migrations, compiled UI and self-contained preview. The final supported checks passed: 45 Go tests (also with race detection), 63 frontend tests, 53 finance and 38 work HTTP-handler checks, 100 PostgreSQL WASM compatibility checks and 11 compiled-preview checks. The release packager verifies every archived file against its SHA-256 manifest. Native PostgreSQL/Encore operation, Docker deployment and real browser/device rendering remain open deployment checks, explicitly documented in [VERIFICATION.md](../../VERIFICATION.md).
