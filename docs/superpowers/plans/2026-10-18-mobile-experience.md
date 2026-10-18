# Mobile Experience Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The owner explicitly requested planning followed by execution. Preserve the existing feature worktree; one independent final review, no parallel implementers.

**Goal:** Make Workspace comfortable and understandable on iOS and Android, then build employee development on the proven daily workflows.

**Architecture:** Retain the current Go APIs and native authorization/retry state. Introduce small presentational components and common tokens around the existing controller; improve journeys incrementally. New growth/knowledge capabilities are separate later subsystems, not fields bolted onto permission roles.

**Tech Stack:** Expo SDK57, React Native0.86.3, Expo Router, existing safe-area/keyboard modules, TypeScript/Vitest; existing Go/PostgreSQL and shared business logic for later stages.

**Spec:** `docs/superpowers/specs/2026-10-18-mobile-experience.md`.

## Global Constraints

- Neutral Workspace branding; iOS and Android first, no generated native edits or new dependency in the foundation slice.
- Minimum shared action target48x48, input height52; body16/support14/meta>=13; native scaling/wrapping, no fixed tab height.
- Preserve company/private authority, independent review/payment, exact money/timed commitments, versions, original retry targets and revocation.
- Preserve Expo Go boundaries and custom-native calls/push. No production mutation, account transfer, server redeployment or protected runtime restart.
- Continue updating this checklist, docs/HANDOFF.md and verification/mobile-experience-2026-10-18/record.md. Unexecuted device checks stay NOT_RUN.

## Review Focus

1. Long company/person/module names and enlarged text at320 width must wrap without hiding controls.
2. Multiple taps during a slow sign-in must create one in-flight call and retain failure recovery.
3. Background preserved content must be invisible, noninteractive and inaccessible to screen readers.
4. Company/actor/policy change must reset directory search and retain company-qualified destinations; missing work must not expose role-gated destinations.
5. Styling must not change busy close guards, selected/disabled semantics, badges, deep links or API request construction.

## Dependency-ordered roadmap

| Milestone | Depends on | Deliverable / code anchors | Acceptance / evidence |
| --- | --- | --- | --- |
| M1 Mobile foundation | Baseline | Tasks1–3 below; mobileTheme, WorkspaceFrame, LoginFrame, ConnectUI, login route, More, tabs | Unit/component behavior, full mobile suite, tsc/lint, screenshots and native JS exports; physical gates separate |
| M2 Work and Inbox | M1 | WorkScreen.tsx, TaskDetailScreen.tsx, TaskCollaboration.tsx, AttentionInbox.tsx, deadline components | Readable task cards and priority reasons, filters, empty/error/loading, independent review, exact deadlines and frozen unknown retries; keyboard/Back/device checks |
| M3 Connect | M1, M2 form conventions | ConnectList.tsx, NativeConversation.tsx, ChatControls.tsx, Media.tsx, Publication.tsx | DM reuse, stable composer, search/thread context, attachment progress, disclosure/re-preview reset, revoke/resume, custom-native calls separately |
| M4 Finance and reports | M1, M2 | FinanceScreen.tsx, ExpenseDecision.tsx, FinanceAssistance*, ReportScreen.tsx, HistoricalReports.tsx | Progressive data entry, exact amounts, explicit independent decisions, receipt/reconcile recovery, consistent snapshots/CSV and current-authority output |
| M5 Remaining phone journeys | M2–M4 patterns | OverviewScreen, PlanningScreen, WorkloadScreen, DeadlineAgenda, Goal*, People*, AccountScreen | Purpose-led layouts, company timezone, known/unknown capacity, independent goal observations, onboarding/access/departure confirmation and security controls |
| M6 Device qualification and pilot | M1–M5 incrementally | QA run copy and mobile device matrix; deploy guides | iOS/Android text/keyboard/navigation/accessibility, permissions and current access; core Expo Go pilot and separately signed native calls/push; no assumed provider results |
| M7 Employee development | M6 usage findings | New shared/growth contracts, backend/platform growth service + mirrored migrations; mobile/web growth screens | One job-family pilot; career role != permission role, explicit skill rubric, employee-owned plan, reviewed evidence, mentor actions; no auto promotion or task-count rating |
| M8 Knowledge and assistance | M7 evidence/visibility decisions | New maintained-guidance records; extend current intelligence source adapters | Owned/versioned guidance, source citations, opt-in assistance, reauthorization/invalidation, employee correction; no private harvesting or automatic decisions |
| M9 Policy/integrations | Demonstrated pilot needs | Canonical API adapters/outbox; scoped finance approvals only after policy design | Least-privilege connector, idempotency/reconciliation and deletion/revocation; quantify administrative time saved; specialist payroll/tax systems remain explicit |

M2–M9 each receives its own detailed implementation plan before code. This document defines sequencing, boundaries and acceptance, not a claim that those features are implemented. The executable initial slice is Tasks1–3.

## Task 1: Shared mobile presentation and company frame

**Files:** create `mobile/src/mobileTheme.ts`, `mobile/src/WorkspaceFrame.tsx`, `mobile/src/WorkspaceFrame.test.tsx`; modify `mobile/src/ConnectUI.tsx`, `mobile/src/Workspace.tsx`, `mobile/src/ConnectUIContrast.test.ts`.

**Interfaces:** theme exports `colors`, `metrics`, `typeScale`. `WorkspaceFrame(props)` accepts children, userName, companies `{id,name}[]`, company, scopeKey, foreground, preserveMounted, scroll, safeBottom, error, onSwitchCompany and onDismissError. Workspace.Page maps existing controller values to those props. Existing Action/Sheet/ui exports remain compatible.

- [x] Write behavioral tests: company chips announce selection and invoke the original id; error dismiss callback; safe bottom edges; foreground changes hide/unmount appropriately, including preserved scroll children; switching scope resets the body; shared actions keep busy/selected semantics and48 targets.
- [x] Run `npx vitest run src/WorkspaceFrame.test.tsx src/ConnectUIContrast.test.ts --maxWorkers=2 --pool=threads`; observe missing/new contract failures before implementation.
- [x] Implement tokens and frame; retain Page's current source of authority and controller. Update shared typography/action/input styles without changing writes or ownership.
- [x] Rerun focused tests, `npm run typecheck`, `npm run lint`; inspect source diff for forbidden authority/state changes.
- [x] Commit after verification; keep a durable evidence checkpoint if sandbox Git permissions require a separate approval.

## Task 2: Comfortable sign-in and consistent tabs

**Files:** create `mobile/src/LoginFrame.tsx`; modify `mobile/src/app/login.tsx`, `mobile/src/Login.test.tsx`, `mobile/src/app/(tabs)/_layout.tsx`; create `mobile/src/LoginFrame.test.tsx`.

**Interfaces:** `LoginFrame({children})` supplies safe-area keyboard-aware scroll and neutral heading. Existing signIn(server,email,password,code,recovery) stays authoritative. Existing tab names and access-remount key are retained; visual options use Task1 tokens.

- [x] Test visible labels, keyboard-safe scroll settings, password visibility, autofill hints, exactly one pending submission, error then retry, correct MFA/recovery arguments, secret clearing on success and unchanged configured-server/development behavior.
- [x] Run `npx vitest run src/Login.test.tsx src/LoginFrame.test.tsx --maxWorkers=2 --pool=threads`; observe new assertions fail.
- [x] Implement the frame, labeled fields and pending guard. Keep MFA/recovery available, preserve error handling and configured origin. Style tabs without fixed height; keep badges and accessibility labels.
- [x] Rerun focused tests and existing Expo Go startup/push tests. Commit after checks.

## Task 3: Findable modules and visual verification

**Files:** create `mobile/src/ModuleDirectory.tsx`; modify `mobile/src/app/(tabs)/more.tsx`, `mobile/src/ModuleNavigation.test.tsx`; add explicit fictional rendered-component preview under `verification/mobile-experience-2026-10-18/` with no real authentication/provider/data.

**Interfaces:** `ModuleDirectory({workReady,role,onOpen,onAccount})` renders grouped searchable destinations; `onOpen(path)` is adapted to current company-qualified router calls in More. Account stays account-scoped. Search resets through a company/user/policy key.

- [ ] Test all retained destinations plus Calendar/Workload/authorized Overview, purpose/heading search, empty/clear search, viewer Finance omission, missing-work omission, Account/history availability, actor/company/policy search reset, exact route destinations.
- [ ] Run `npx vitest run src/ModuleNavigation.test.tsx --maxWorkers=2 --pool=threads`; observe failures before implementation.
- [ ] Implement grouped full-width rows and search; keep route authorities/guards intact.
- [ ] Render actual components with synthetic fictional props in React Native Web. Capture and inspect320/390/430 layouts, long labels, enlarged text, sign-in/error, directory/search-empty and company frame. Record browser-proxy limits explicitly. No screenshots of live company data.
- [ ] Run full `npm test -- --maxWorkers=2 --pool=threads`, typecheck/lint, native Android/iOS JS exports, changed-file formatting and diff checks. Classify environment/tooling failures separately.
- [ ] Independent whole-diff review for behavior/privacy regressions, fix findings, update handoff/index/QA phone checklist; commit, fast-forward main and non-force push both branches if Git/network access permits. Preserve stashes/worktrees/processes. Device checks remain pending.

## Physical acceptance checklist (NOT_RUN until observed)

- [ ] iOS: small-screen portrait/landscape, keyboard open, safe top/bottom, password manager, MFA, VoiceOver and enlarged text.
- [ ] Android: small display/edge-to-edge navigation, keyboard resize, hardware Back, TalkBack and large font/display settings.
- [ ] Both: long names, several companies, offline/error/loading, permission denial, background/resume, actor switch/revocation, unknown retries and company-qualified deep links.
- [ ] Custom signed builds: calls/push/provider/background behavior; Expo Go unavailable explanations tested separately.

## Measuring value

Record observed baseline task completion and errors for sign-in, find module, create task, review work, send attachment and submit receipt. Compare the same fictional scenarios after each relevant milestone. Interview employees about priority clarity and growth expectations. Set numeric targets only after baseline measurement; do not present a proposed target as an achieved result or use activity counts as employee-quality scores.
