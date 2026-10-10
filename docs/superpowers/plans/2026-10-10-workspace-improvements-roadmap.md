# Workspace Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement each milestone's detailed plan task-by-task, with independent read-only preparation and review. This roadmap tracks independently releasable milestones; unchecked work is not complete.

**Goal:** Make Connect and every business module faster to use, more dependable and supported by permission-aware assistance.

**Architecture:** Retain the modular backend and existing authorization engines. Introduce lean read models and event-driven updates before historical reporting and intelligence. Share deterministic business semantics across server, browser demonstration and native clients.

**Tech Stack:** Go/GORM/PostgreSQL/Encore, React/TanStack Query, Expo 57/React Native, self-hosted LiveKit.

**Spec:** `docs/superpowers/specs/2026-10-10-workspace-improvements.md`

## Global Constraints

- Company role never grants unrestricted private conversation access.
- Preserve independent task/finance review, exact amounts, original deadlines and optimistic versions.
- Consequential suggestions require reviewed writes and stable retry keys.
- India remains the deployment region; provider and physical-device gates are explicit.
- Keep the running main app and its database intact during isolated development.

## Review Focus

- A removed member must not retrieve or export stale cached or queued outputs.
- A timed task accepted five minutes after its original deadline is late even on the same date.
- A historical report must distinguish its snapshot from current reopened/reassigned work.
- Reconnect and repeated actions must not duplicate messages, tasks, expenses or notifications.
- A phone keyboard, enlarged text or back gesture must not conceal actions or discard recoverable input.

## Dependency-ordered milestones

### Milestone 1: Report correctness and mobile Work basics
- [x] Execute `2026-10-10-reporting-mobile-foundation.md` (four detailed tasks).
- Files: `backend/platform/reports.go`, `frontend/src/data/reports.ts`, `frontend/src/pages/GoalsReports.tsx`, `mobile/src/WorkScreen.tsx`, associated tests.
- Acceptance: exact timed/all-day metrics, same-date revision detection, project filtering, API/demo parity, no private/finance payload, source permissions, company-switch cancellation, due shortcuts, local time ambiguity handling and guarded mobile submission.

### Milestone 2: Measured data efficiency
- [x] Add server request/query timing and sanitized endpoint metrics in `backend/platform/server.go`; add a repeatable load fixture under `verification/runtime/`.
- [x] Separate bootstrap, task list/detail and finance list/detail APIs in `workspace.go`, `tasks.go`, `finance_workspace.go`; introduce report summaries plus cursor-paginated rows and streamed safe CSV export in `reports.go`.
- [x] Split `frontend/src/store.tsx` and `mobile/src/Workspace.tsx` query scopes; invalidate affected record/list/summary keys from existing outbox events.
- [x] Analyze representative PostgreSQL plans; add only measured company/filter indexes through matching backend/Encore migrations.
- Acceptance: summary/row/export totals agree under a consistent read; scoped rows before pagination; bounded payloads; no cross-role cache reuse; reduced bytes/query work compared with recorded baseline. Report p95 results, not assumed capacity.

### Milestone 3: Connect and native usability
- [x] Update `frontend/src/communication/store.tsx` and native client sync to apply authorized event changes while preserving loaded pages and scroll; retain permission heartbeats and overflow/refetch handling.
- [x] Add isolated conversation drafts, mention navigation and contextual linked-work updates in web/native Connect.
- [x] Add Expo-compatible calendar/person pickers, virtualized work/chat histories, camera/receipt capture, accessible keyboard-safe sheets and routed task detail.
- [ ] Exercise Android/iOS devices for foreground/background, large text, voice, push and LiveKit audio/video/TURN.
- Acceptance: old history remains visible after new messages; cursor/permission epochs invalidate correctly; transport failure preserves pending input; repeated sends are canonical; keyboard/back/safe-area behavior passes actual device scripts. Device gates remain unchecked without devices.

- Reviewed code evidence: `verification/workspace-improvements-roadmap/milestone-3.md`. Physical-device checkbox remains unchecked.

### Milestone 4: Unified attention and decisions
- [ ] Add typed action items in `communication_notifications.go`, `automations.go` and `workspace.go`; project them into web/native Inbox and leadership overview.
- [ ] Implement explicit resolve/snooze/owner routing and deduplicated working-hours-aware escalation.
- Acceptance: one actionable item per event; read does not imply resolved; failed/retried delivery does not duplicate; no private-source preview after revocation.

### Milestone 5: Tasks and project execution
- [ ] Add permission-scoped templates, reusable checklists and milestone records through new migrations and `tasks.go`/`organization.go` APIs.
- [ ] Extend task/project UI with owner defaults, blocker routing and dependency impact; offer reviewed schedule proposals.
- Acceptance: templates cannot suppress review/evidence; cycles rejected; source links authorized separately; repeated application yields no duplicate work.

### Milestone 6: Historical and saved reports
- [ ] Add immutable acceptance/deadline/ownership facts and explicit versioned snapshots; legacy records show history coverage instead of invented facts.
- [ ] Add saved definitions, period comparisons and asynchronous CSV generation; recheck access before scheduled exports/delivery.
- Acceptance: reopen/reassign cannot rewrite an existing snapshot; current-state reports remain labelled; revoked users cannot fetch output; all figures drill down to included facts.

### Milestone 7: Finance assistance
- [ ] Add reviewed receipt extraction into expense drafts, exact normalized duplicate-invoice candidates and payment reconciliation queues in finance APIs and forms.
- Acceptance: extraction never approves/pays; exact minor-unit amounts retained; review separation and budget exceptions preserved; false-positive duplicate flags are dismissible and audited; retry yields one draft.

### Milestone 8: Planning and outcomes
- [ ] Extend calendar/workload with transparent capacity/dependency conflict suggestions; add goal measurement history, evidence and update reminders.
- Acceptance: estimated capacity is labelled; suggestions never silently revise commitments; goal outcomes do not advance from task completion alone; company timezone used at date boundaries.

### Milestone 9: People and administration
- [ ] Add guided onboarding, reviewed company-scoped permission presets, access reviews and departure handover extending `offboarding.go` and People/Settings.
- Acceptance: reassignment is explicit; role changes revoke relevant sessions/caches/queued delivery; depart/rejoin private history boundaries remain correct; existing task/finance histories persist.

### Milestone 10: Grounded intelligence
- [ ] Select and configure transcription/model processing suitable for India hosting and approved data handling; add narrowly scoped provider interfaces.
- [ ] Implement opt-in transcript, thread summary, action draft and report explanation jobs using authorized sources and deterministic tools.
- Acceptance: every answer has source references; inaccessible/revised sources invalidate outputs; missing owners/dates stay unresolved; quoted malicious instructions do not authorize tools; model failure retains manual workflow; reviewed retry creates one business record.

## Delivery discipline

For each milestone: write its concrete tests first, record RED, implement and record GREEN, run relevant backend/PostgreSQL/web/native checks, perform independent code review, and update verification evidence. Draft later subsystem plans only after their dependency interfaces exist. This avoids treating aspirational paths as approved final interfaces. Commit on the development branch; merge/push and restart only within the user's existing authorization and after verification. No production provisioning or external message delivery is implied by local implementation.
