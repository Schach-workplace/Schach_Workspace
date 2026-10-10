# Reporting and Mobile Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Correct current-state report deadlines, introduce lean authorized report inputs, and simplify native Work capture and navigation.

**Architecture:** A pure browser report model consumes current authorized tasks from either the demo or a new read-only Go report endpoint. Native Work uses the existing task/review API through a focused screen and deterministic company-time deadline helpers. No new permissions, migrations or provider integrations.

**Tech Stack:** Go/GORM, React/TanStack Query, Expo 57/React Native; existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-10-workspace-improvements.md`

## Global Constraints

- Company role never grants unrestricted private conversation access.
- Preserve independent task/finance review, exact amounts, original deadlines and optimistic versions.
- Consequential suggestions require reviewed writes and stable retry keys.
- Keep the running main app and its database intact during isolated development.
- Reports remain explicitly current-state; no historical facts are invented.

## Review Focus

- A denied company/user change must remove stale report rows and prevent exports.
- Same-day timed acceptance after the deadline is late, including original/current comparisons.
- Same-date time/mode/timezone revisions count as deadline changes.
- Mobile request failures preserve form input; repeated taps do not start overlapping writes.
- Daylight-saving gaps/folds and company versus device dates must not silently change commitments.

### Task 1: Deterministic report model

**Files:** Create `frontend/src/data/reports.ts`, `frontend/src/data/reports.test.ts`.
**Interfaces:** `ReportFilters { from, to, departmentId?, ownerId?, projectId? }`; `buildTaskReport(tasks: Task[], filters: ReportFilters, timezone: string, now: Date)` produces cohort/accepted/originals/ontime/currents/currentOnTime/done/changed/overdue/blocked/pending arrays and chart buckets. `reportDeadlineMet(task, timezone, original): boolean | null` distinguishes missing/invalid data.

- [ ] Write tests for late/equal timed instants, local-calendar all-day acceptance, missing/malformed values, same-date deadline revisions, intersecting project/person/department filters, cancelled tasks, empty denominators and a >10-year chart.
- [ ] Run `npm test -- src/data/reports.test.ts`; expect failure before implementation.
- [ ] Implement the pure model using existing date/deadline helpers, a single captured now and at most twelve chart buckets; exclude invalid dates from measured denominators.
- [ ] Run the focused tests and typecheck; expect all passing.
- [ ] Commit model and tests.

### Task 2: Lean authorized report endpoint

**Files:** Create `backend/platform/reports.go`, `backend/platform/reports_test.go`; modify `backend/platform/server.go` and `docs/API_CONTRACT.md`.
**Interfaces:** `GET /api/companies/{cid}/reports/tasks?from=YYYY-MM-DD&to=YYYY-MM-DD&departmentId=&ownerId=&projectId=` returns `{tasks: Task[], generatedAt: RFC3339, timezone: string, basis: "current_state"}`. Task arrays for comments/files/time are empty, never loaded. Other task business fields support the existing CSV and table; parent/dependency references follow current visibility.

- [ ] Write integration tests for unauthorized/company/role/member/collaborator scope, revoked membership, intersecting filters, date validation, acceptance near company-midnight, cancelled exclusion and absence of comments/media/finance/private content.
- [ ] Run `go test ./platform -run TestTaskReport -count=1`; expect 404 before routing.
- [ ] Implement through `Server.access` and `access.canRead`, parameterized company/filter queries and calendar-aware acceptance filtering; normalize empty arrays and prune inaccessible task references as workspace does. Do not widen read authority for filter identifiers.
- [ ] Run tests on SQLite and the owned PostgreSQL test schema; document the intermediate read model and lack of pagination/aggregation/historical snapshots.
- [ ] Commit API and contract changes.

### Task 3: Integrate reports and phone controls

**Files:** Modify `frontend/src/pages/GoalsReports.tsx`; create `frontend/src/data/useTaskReport.ts`, `frontend/src/pages/Reports.test.tsx`; modify report CSS only as needed.
**Interfaces:** `useTaskReport(data, mode, filters)` scopes query key by company/user/role/filters/workspace freshness, cancels old requests and returns current authorized tasks plus loading/error/generatedAt. Demo uses the same pure model with its authorized workspace.

- [ ] Write rendered regressions proving timed aggregate/department figures, project filtering, API endpoint selection, failed request with disabled export, company switch with delayed old response discarded, and date preset controls.
- [ ] Run the focused tests; expect date-level metrics/API integration to fail.
- [ ] Replace duplicate report calculations with Task 1's model; use Task 2's endpoint for API mode, no silent demo fallback. Add project filter and month/7-day/30-day presets, explicit current-state copy and accessible loading/error/retry behavior. Disable export until current query succeeds.
- [ ] Run all web tests plus API/demo builds; expect passing.
- [ ] Commit UI and tests.

### Task 4: Native Work usability

**Files:** Create `mobile/src/WorkScreen.tsx`, `mobile/src/workDates.ts`, `mobile/src/workDates.test.ts`, `mobile/src/WorkScreen.test.tsx`; change `mobile/src/app/(tabs)/work.tsx` to export the focused screen.
**Interfaces:** `companyDate(now: Date, timezone: string): string`; `workDeadline(date: string, time: string, timezone: string, selectedInstant?: string)` returns validated all-day/timed fields or a clear error requiring explicit ambiguous-time selection. Existing task/review endpoints and payload fields retained.

- [ ] Write date tests for Asia/Kolkata at UTC midnight, shortcuts, invalid calendar/time values, nonexistent wall times and explicit fold choices. Write actual screen orchestration tests for search/status filters, create-sheet isolation, deadline shortcuts, network-error input retention, double-tap guard and viewer restrictions.
- [ ] Run `npm test -- src/workDates.test.ts src/WorkScreen.test.tsx`; expect failure before implementation.
- [ ] Implement labelled task cards and list filters; place create/details in existing safe-area Sheet, default to company today, provide Today/Tomorrow/In a week shortcuts and optional HH:mm company-time entry. Preserve independent reviewer selection, versioned review, evidence downloads and existing status actions. Guard mutations with a synchronous pending ref; refresh current task state before consequential detail actions. Never automatically retry task creation without server-supported idempotency.
- [ ] Run native tests, typecheck, lint and Android/iOS exports. Record physical keyboard/device and signed build gates as unverified.
- [ ] Commit native source and tests.

## Integration acceptance

- [ ] Run fresh complete SQLite/backend/web/native suites and focused PostgreSQL report tests; check Encore analyzer/runtime initialization.
- [ ] Exercise rendered reports on an owned fictional server at desktop and 390px; verify export/filter/loading behavior and no horizontal page overflow. Existing live user's data is not mutated.
- [ ] Obtain independent whole-branch review and fix Important/Critical findings with regressions.
- [ ] Record results and remaining gates; keep changes on the feature branch unless an explicitly authorized integration is carried out.
