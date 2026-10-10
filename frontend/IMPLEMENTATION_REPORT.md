# Schach Workspace — frontend implementation

Release 1.1.0 includes the reviewed department finance extension.

## Delivered UI

The React 19 / TypeScript application includes these functioning views:

- Leadership overview with real workspace counts, overdue / blocked / review / due-soon drilldowns, original-deadline acceptance, department comparisons, project health, accepted-work history and activity.
- Personal work, searchable task list and a board. Board cards have keyboard-operable status selectors as well as drag movement. Filters intersect across status, department, owner, project, priority, deadline and text. CSV template download, validated preview/import and task export use the shared import utilities.
- Project grid, project details, project editing and creation, and project-linked task creation.
- Month/week commitment calendar, with department/person filters and a selected-day agenda.
- Weekly workload planning from declared capacity and remaining estimated effort. The formula and date-overlap treatment are visible; zero declared capacity is explicitly identified. No employee score is generated.
- Goals with visible baseline, target, current value, units, linked work, accountable owner and outcome editing. Lower-is-better targets are supported.
- Reports with inclusive dates, department/person filters, original/current deadline acceptance, commitment completion, delivery counts, current exceptions, department totals and export of the selected task cohort.
- Department finance with financial-year totals, budget/category management, exact decimal expense capture, independent decisions, receipt upload/download, external payment records and scope-aware historical views.
- People, departments, membership editing and a company → department → reporting-line view.
- Inbox with unread filtering, marking individual/all notifications read and opening the related task or expense.
- Company settings, company creation for platform owners, switching between memberships, profile/password change, workflow processing and explicit demo reset.
- Sign-in, session/workspace loading, visible errors, mutation feedback and sign-out.

The task sheet supports title/context, ownership, reviewer, department/project, dates, original commitment, priority, estimated/actual work, progress, checklist, dependencies, collaborators, parent task, recurring interval, tags, blocked-work reasons, deadline-change reasons, comments, audit history, nudges, evidence upload/download, time entries and independent review. It submits versions for optimistic concurrency, preserves unsaved fields when an updated version arrives, and offers an explicit refresh of stale edits. Approved tasks have an explicit status-only **Reopen task** action before field edits. Review decisions are disabled while unsaved task edits exist.

## Permissions and data

The UI uses `WorkspaceStore` and the company-relative API contract. Backend authorization remains authoritative. UI edit controls follow founder/admin, department, reporting-chain, creator and owner scope. Reviewers/collaborators receive separate participation controls; they do not automatically receive structural editing rights. Members cannot change the structure of existing tasks. Owners cannot change the reviewer on their own existing tasks, and an existing required review cannot be removed. Required approval never becomes a direct “Done” action.

Creating a task for another eligible owner fills their department and reporting reviewer. New tasks start in Backlog or To do, and progress starts at zero. Create payloads contain only the server's accepted create fields. Evidence input is limited to PDF, PNG, JPEG, WebP, TXT and CSV, up to the API's 10 MiB cap.

All demonstration context is visibly labelled **Demo** / **Fictional sample data**. The UI uses the real provider rather than manufacturing task counts, notifications, scores or chart values. Date-only display uses UTC formatting to avoid calendar-date shifts; due boundaries and completion metrics use the company timezone.

## Design and responsive implementation

- Official Schach logo included in `public/schach-logo.webp`.
- Local Chivo and IBM Plex Sans variable fonts in `public/fonts/`, including their OFL licences.
- Charcoal navigation, white/warm-grey content, the specified `#F97316` orange accent, and labelled semantic statuses.
- Dark foreground text on orange primary controls for stronger text contrast; secondary text and status colours tightened in the final readability pass.
- Desktop: persistent sidebar, compact tables and multicolumn operational panels.
- Tablet: icon sidebar, reduced column counts, contained table/board scrolling, narrower secondary panels.
- Mobile (including 360px source review): compact header, bottom navigation, full navigation dialog, full-height task sheets, card rows in task tables, calendar day counts with a full agenda, stacked workload rows, and single-column projects/goals where required.
- Forms have associated labels, visible focus states, native controls and Radix dialog focus handling. Mobile task/dialog controls have 44px minimum heights and 16px text inputs. Long titles can wrap. Reduced-motion preferences are respected.
- Main grids and flex children use minimum-width constraints; wide administrative tables and boards scroll inside their own containers. The footer reserves bottom-navigation space, including device safe-area padding.

### Rendering limitation

Responsive CSS was inspected at the 360px, 768px and 1440px breakpoints by source analysis. **Actual browser rendering, screenshots, pixel overflow measurements and real-device touch interaction were not successfully verified in this environment.** The root agent reported Chromium launch failure with a singleton/socket `EPERM` restriction. No screenshot or visual-browser pass is claimed. The DOM integration tests below do not measure CSS layout.

## Verification executed

On the completed release, `npm test` passed **63 tests across 8 files** in **7.40 seconds**. Strict TypeScript, Prettier checks, the API-mode build and the demo-mode build passed. Both Vite builds transformed 2,028 modules. API JS is 511.98 kB, demo JS is 659.71 kB, and shared CSS is 145.41 kB before compression.

The rendered workflow coverage includes 7 original/extended work UI journeys, 9 finance UI journeys, and 2 access-revocation provider scenarios. It verifies:

- Leadership task drilldowns, creation, independent review/reopening, member edits and company changes while a sheet is open.
- New company currency/financial-year settings and actionable empty-company setup.
- Full-period accepted-work reporting across a range longer than ten years, without silently losing later completions.
- Department finance and personal finance visibility, including a head's own records after changing departments.
- Exact ₹1,234.56 capture, receipt exceptions, independent approval, payment and preservation of the same remaining budget after payment.
- Budget revision history, receipt-appended stale decision invalidation, consistent work references and Unicode character boundaries.
- Cached financial data disappears after HTTP 403; memberships refresh and the app either moves to an allowed company or retains no company snapshot.

Data-layer tests cover metric definitions, CSV validation, ordinary work/demo permissions, preservation of user-edited version-1 demo work during hydration, money parsing and fiscal periods, budget arithmetic, privacy and finance transitions. Legacy hydration adds financial defaults and categories without inventing budgets or expenses. Same-version financial edits and approvals competing for one remaining allocation use concurrent promises; exactly one succeeds, preserving the other record and the audit trail.

The self-contained `preview.html` is **938,332 bytes**. The root compiled-artifact check passes **11 checks**, including embedded assets, overview mounting, company/task navigation, Finance totals, real Engineering allocation drilldown, and second-company finance isolation. It runs the actual built JavaScript in Happy DOM and rejects network requests.

These are DOM simulations and source/build checks. They do not certify real browser rendering, keyboard/device interaction or mobile overflow. Those deployment gates remain open as described above and in `docs/VERIFICATION.md`.

## Files and dependency changes

UI entry points: `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html`.

Shared UI: `src/components/UI.tsx`, `src/components/TaskDrawer.tsx`, `src/components/EntityForm.tsx`, `FinanceForms.tsx` and `FinanceDetail.tsx`.

Views: `src/pages/Overview.tsx`, `Tasks.tsx`, `Projects.tsx`, `CalendarWorkload.tsx`, `GoalsReports.tsx`, `Organization.tsx`, `InboxSettings.tsx`, `Finance.tsx` and the scoped `Finance.css`.

Tests include `src/ui.test.tsx`, `src/finance.ui.test.tsx`, `src/access.ui.test.tsx` and data-layer suites. DOM files select a Happy DOM environment explicitly.

Assets: official logo, favicon and local fonts with licences under `public/`.

With root authorization, added exact development dependencies for `happy-dom`, `@testing-library/react` and `@testing-library/user-event`. Removed unused Zustand, Radix Dropdown Menu and Playwright dependencies and the unimplemented `test:e2e` script. `package-lock.json` reflects the changes. Core UI uses React, Radix Dialog and Lucide; the root-owned provider uses TanStack Query.

No additional frontend dependency was needed for the finance upgrade. The module uses the existing React, TypeScript, Radix, TanStack Query and Lucide stack. No live deployment or external communications were performed.
