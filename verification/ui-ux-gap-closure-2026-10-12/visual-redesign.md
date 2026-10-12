# Web visual UI/UX pass — 2026-10-12

Base d5eccc9. Web frontend presentation only (frontend/src). No backend, mobile, migration or retained-runtime change; the 8080 app was not touched and does not serve this.

## Method
Disposable fictional QA instance built from current source (docs/qa/tools/start-isolated-qa.sh, port 9080, own SQLite, demo accounts) plus a Vite dev server on 127.0.0.1:5174 proxying to it (QA allowlist extended to that origin). All 13 views and their pop-ups were screenshotted at 1440 and 390 (some at 320) via headless Chromium/CDP before and after, and inspected. Six area agents (shell/Overview/Inbox/Settings; Calendar/Workload; Goals/Reports; Tasks/Projects; Finance/People; Connect) worked in disjoint files with new scoped CSS under frontend/src/styles/.

## Main problems found
Newer milestone features were never styled: Overview business decisions (browser-default heading/paragraphs), stray "Local assistance history" text in the top bar, the planning view on Calendar/Workload (raw buttons, run-on text, ~30 identical advisory blocks), measured goals, historical/saved reports, task drawer templates/impact/schedule review, project milestones, people onboarding/presets/access review/departure, message-to-task and Connect dialogs. Finance dialogs opened off-screen at 390px because a hidden ledger header escaped its scroll container (page 831px wide).

## Changes (highlights)
- Overview decisions panel with filter, rows and empty state; history icon button in top bar; balanced card rows.
- Planning: filter bar, metric cards, person×week capacity table with utilization bars (under 85 / 85–100 / over 100%, icon not colour-only), coverage-gap panel, advisories grouped with counts, "How this is calculated" disclosure retaining all qualifications, inspect dialog; Calendar shows a compact summary with link to Workload.
- Goals cards (current value, bounded attainment bar, direction, baseline/target), goal dialogs; Reports segmented tabs and restyled historical/saved reports.
- Task drawer: review decision first with who-can-accept explanation, owner sees "Waiting for independent review", blocker banner, planning tools as disclosures that auto-open with "Needs attention" when a frozen attempt is unresolved.
- Milestones list/detail, other submitted statements shown to reviewers.
- Finance off-screen fix and assistance tabs; People toolbar, stacked cards on phones, onboarding/preset/access/departure dialogs, danger styling.
- Connect: prominent message-to-task disclosure block, grouped message actions, members/search/new conversation dialogs.
- Shared: consistent "Explain…" launcher button; 137 dead CSS rules removed; checkboxes no longer forced to 44px.

## Verification
- Fresh: `tsc --noEmit` pass; vitest 85 files / 393 tests pass (from 82/387 at d5eccc9 plus new tests). `git diff --check` pass. Final screenshots of all 13 views at 1440/390: no horizontal overflow, no off-screen elements, no runtime exceptions.
- Independent behaviour-preservation review: API paths/bodies, retry payloads, version fields, 409 handling, permission and disclosure gates unchanged or stricter; no effect dependency changes. Its findings fixed with tests: hidden recovery notices in collapsed drawer panels, planning dialog dismissible mid-request, inbox filter leaving hidden selection open, reviewer not seeing orphaned milestone statements. Accepted: extraction-request list shown only on the receipt tab (receipt-only data). Removed: an N+1 per-goal measurements read added for a "last observed" line.

## Not covered / open
- Mobile app was not part of this visual pass.
- Populated states without QA data were styled from code only: historical report snapshots, onboarding stages 2–4, captured access decisions, departure responsibilities, assistance history entries.
- CSS load order (styles.css after App) left unchanged after a pixel comparison showed layout shifts.
- Visual checks are headless Chromium at fixed widths; not other browsers, zoom levels or screen readers.
