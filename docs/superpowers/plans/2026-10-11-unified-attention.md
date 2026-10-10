# Milestone 4: Unified Attention and Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Milestones2–3 must be reviewed before dispatch; the controller records that dependency acceptance in release evidence.

**Goal:** Give web/native users one authorized actionable Inbox, with separate read/resolution, reviewed routing, snooze and deduplicated reminders, and a leadership queue of decisions they can actually perform.

**Architecture:** Add typed, IDs-only attention intents to the existing modular platform; project display content through current task, finance, conversation and published-intake authorization. Existing business handlers remain authoritative. Persist payload-bound action retries and local reminder intents in the same database, using current transaction order and final milestone-2 `readBasis` for client cache ownership.

**Tech Stack:** Go/GORM/PostgreSQL/Encore, React/TanStack Query, Expo 57/React Native/Expo Router.

**Spec:** `docs/superpowers/specs/2026-10-10-workspace-improvements.md`; roadmap milestone 4; dependency contracts and actual hook map below.

## Global Constraints

- Company role never grants unrestricted private conversation access.
- Preserve independent task/finance review, exact amounts, original deadlines and optimistic versions.
- Consequential suggestions require reviewed writes and stable retry keys.
- India remains the deployment region; provider and physical-device gates are explicit.
- Keep the running main app and its database intact during isolated development.
- Task audience changes independently of membership: recheck owner/reviewer/collaborators/department plus parent/dependency reference access. `readBasis` alone is never proof of current source access.
- No second task engine, autonomous approval, private text in taskless company Activity/Notification, or automatic external message delivery. Existing communication notifications/read markers retain their contract.

## Review Focus

- A source becomes inaccessible after Inbox load without a membership change: clear its preview/action immediately on refreshed access and deny its transition/reminder.
- A successful transition response is lost: the same key/payload returns one canonical result; a changed payload conflicts even if its expected version is old.
- A private record is revised or a departed user rejoins: old action content and eligibility do not survive the new revision/history boundary.
- A quiet-hours window crosses midnight or a DST change: one reminder is scheduled in the next allowed window, without affecting the due commitment.
- A phone keyboard/network failure or company switch interrupts routing: preserve authorized pending input on retry, clear another company's data, and keep the primary action reachable.

## File map and interfaces

Proposed files: `backend/platform/attention_models.go` (models/DTOs), `attention_access.go` (source projection/eligibility), `attention.go` (list/detail/transition/preferences), `attention_producers.go` (atomic producer functions), `attention_jobs.go` (deduplicated scheduled attention); respective `attention*_test.go`; `frontend/src/data/attention.ts`, `components/AttentionInbox.tsx` and tests; `mobile/src/AttentionInbox.tsx` and tests. Modify existing modules only at named hooks below. Add the next available paired numbered migration in `backend/migrations` and `encore/api/migrations`, and register models in `Migrate`; choose the number after reviewed milestone-2/3 migrations, never overwrite existing migrations.

All interfaces below are **proposed**, except helper/handler names explicitly called existing. Keep these names consistent across tasks:

- `AttentionItem`: `ID`, `CompanyID`, `RecipientID`, `SourceKind` (`task|expense|record|intake|bookmark`), `SourceID`, `SourceRevision int64`, `OccurrenceKey`, `Kind` (`task_review|expense_review|decision|intake_triage|deadline|saved_reminder|blocker|update`), `ConversationID`, `AnchorMessageID`, `MessageSequence int64`, `State` (`open|resolved|routed|superseded`), `Version int64`, `SnoozedUntil *time.Time`, `DueAt *time.Time`, `RoutedToID`, `ResolvedBy`, `ResolvedAt *time.Time`, `ResolutionReason`, `CreatedAt`, `UpdatedAt`. Persist no source title/body/excerpt. Unique `(CompanyID,RecipientID,SourceKind,SourceID,OccurrenceKey,Kind)`; source revision is checked before projection and is not a substitute for current business visibility.
- `AttentionRetry`: primary `(CompanyID,ActorID,Operation,RetryKey)`, `RequestHash`, `ItemID`, `ResultItemID`, `ResultVersion`, `CreatedAt`. Preserve a canonical transition result without returning unauthorized stale source content.
- `AttentionPreference`: primary `(CompanyID,UserID)`, `Version`, `WorkingHoursEnabled`, ISO weekday integers `WorkingDays`, `WorkingStart/End` local HH:MM, optional `QuietStart/End`, `EscalationEnabled`, `EscalationAfterMinutes`, `EscalationUserID`. Company timezone is authoritative; default disabled working-hour/quiet/escalation configuration. Reject enabled policies with empty allowed windows, invalid clocks, or an inactive/non-company escalation target. A preference never grants that target source access.
- `AttentionReminder`: unique `(CompanyID,ItemID,RecipientID,Stage,WindowKey)`, `ID`, `AvailableAt time.Time`, `LeaseToken`, `LeaseUntil *time.Time`, `Attempts`, `DeliveredAt *time.Time`, `CancelledAt *time.Time`. IDs-only local delivery intent, no private preview. One initial/reminder/escalation stage per explicit source obligation and window; retries update the same row.
- `AttentionView`: authorized current `AttentionItem`, current source title/summary/link, `SourceVersion`, `CanDecide`, `CanRoute`, supported attention actions and reminder state. Strip inaccessible task parent/dependency/source references; never synthesize private metadata from an intake item.
- `AttentionTransitionInput`: `ExpectedVersion int64`, `RetryKey`, `Action` (`resolve|snooze|unsnooze|route`), `Reason`, optional `SnoozedUntil` RFC3339 instant and `RecipientID`. Reject irrelevant/unknown/null fields and bound reason to 1–4000 characters. Snooze must be future and no more than 90 days; route requires a reason and different active target; resolve requires reason. No approval/status/payment fields.
- `ensureAttentionItem(tx *gorm.DB, item AttentionItem) error`: atomically inserts a unique intent with `OnConflict DoNothing`; a producer passes IDs and its already verified recipient set.
- `attentionSource(tx *gorm.DB, a *access, item AttentionItem) (AttentionView, error)`: authorizes and projects a current source for actor `a`; missing/revoked/superseded returns `missing()` with no preview.
- `attentionCanRoute(tx *gorm.DB, actor *access, item AttentionItem, targetID string) error`: checks actor route permission and target active/current source eligibility, without changing source owners/reviewers/record recipients.
- `nextAttentionWindow(pref AttentionPreference, companyTimezone string, now time.Time) (time.Time, error)`: first allowed UTC instant at or after now, respecting local weekdays, working hours and quiet hours, inclusive start/exclusive end; validates no allowed window and bounds search to 14 local days. Overnight working windows belong to their start weekday; scan actual UTC minutes to make repeated/nonexistent local minutes explicit.
- `Server.RunAttention(ctx context.Context, now time.Time, limit int) (int,error)`: bounded worker that reauthorizes, schedules and claims reminder intents, inserts local delivery once, completes/cancels using its lease token. Limit default/max 100. Runtime calls it with a controlled clock, no external provider requirement.

New routes, rooted at `/api/companies/{cid}`: `GET .../attention?state=open|resolved|all&decisionsOnly=true|false&limit=1..100&cursor=...`, `GET .../attention/{item}`, `POST .../attention/{item}/transition`, `GET/PATCH .../attention/preferences`. Response list includes `items`, cursor/hasMore, final milestone-2 `readBasis`; bind cursor to company, actor, access/read basis and filters. When `decisionsOnly=true`, select current pending source decisions regardless of attention resolution/snooze, ignore the state filter and explain that behavior in UI; business completion still removes the decision. Attention is recipient-private: leadership overview fetches the actor's decision-eligible items, not every employee's private items. Registered in `server.go` through proposed `attentionRoutes()`. Existing business links below remain unchanged.

## Task 1: Typed action persistence and live source authorization

**Files:** Create models/access/API files and `attention_access_test.go`; modify `server.go` routes/Migrate and paired next migration. Consume reviewed milestone-2 access/read-basis helpers without rewriting them.

**Source rules:** Task: `scopedTask`/`a.canRead` every time; `CanDecide` matches existing `reviewTask` (in_review, non-owner, assigned reviewer or leadership, non-viewer). Expense: `scopedExpense`/`canReadExpense`; `CanDecide` matches `canApproveExpense` and submitted status. Record: `conversationAccess` + `scopedMessage` + `Server.record`, nonremoved anchor, `HistoryFromSequence`, captured message revision and current `CommunicationRecord.Revision`; only the current revision's explicit `CommunicationRecipient`/creator may see it, and only designated independent reviewer can decide. Intake: `canReadIntake`/`canTriageIntake` over the intentionally published fields only; source conversation IDs/anchor remain internal. Bookmark: owning user plus `conversationAccess`/`scopedMessage`, current history/source state; reminder time must still match the bookmark. Never use leadership to bypass record/bookmark membership. For task/expense live revisions differing from captured version, retain only if the same obligation is still relevant; return current version for business navigation. Check action-kind recipient eligibility independently of source readability: a former reviewer who can still read work does not retain its pending review action or reminder. For exact private source/record revision mismatch, supersede and require a new authorized item.

- [ ] Write `TestAttentionScopesAndRevocation` with task/expense/record/intake/bookmark fixtures: unauthorized/cross-company/other-recipient access returns 404; leadership without private membership cannot see record; triage sees only published intake; changing task collaborator/owner/department hides item without membership change; hidden task references are absent. `TestAttentionPaginationScopesBeforeLimit` places 101 inaccessible rows before an accessible row and requires the accessible row to remain reachable.
- [ ] Run `go test ./platform -run 'TestAttention(Scope|Pagination)' -count=1` from backend; record RED (new handler missing or assertions fail).
- [ ] Implement models/migration and source-authorized list/detail. Use `withAccessTransaction` for consistency with task writers; acquire conversations only after business/session/member locks. Filter recipient/source scope before pagination, with current-source predicates and bounded projected rows; no blanket in-memory post-LIMIT filtering. Bind to final reviewed `readBasis`; membership fingerprints do not replace source checks. `CanDecide` is presentation, never authorization for business writes.
- [ ] Rerun focused tests GREEN; run migration checksum/mirror checks and PostgreSQL authorization fixtures. Commit scoped deliverable as `feat: add authorized attention read models`.

## Task 2: Independent resolution, snooze and reviewed routing with retries

**Files:** `attention.go`, `attention_access.go`, `attention_transitions_test.go`; no source workflow changes.

**Semantics:** Mark-read continues `readNotifications`/`ackCommunicationInbox` only. Resolve records user's attention outcome, does not change task/expense/record/intake status, approval or response; UI states this explicitly. A business obligation still open can remain visible in source-derived decision badges even when attention is resolved; leadership decisions are calculated from current source pending state, not suppressed by resolution. Snooze only affects attention timing. Route creates/reuses a target intent and marks origin routed atomically; no source ownership/reviewer change. For task-review routing, target must be current designated reviewer or independent authorized leader. Expense-review target must currently `canApproveExpense`. Private decision target must already be its designated reviewer; ack/event target must already be current recipient. Intake-triage target must `canTriageIntake`. Deadline/blocker/update target needs source read access and relevant business authority; bookmark reminders cannot route another user's saved item.

`CanRoute` also requires the actor be the item's current recipient. Task-review/expense-review actors must currently be able to decide; intake actors must be able to triage. Task deadline/blocker/update actors must be owner/creator or `canStructure`; targets must `canRead` and be owner/reviewer/collaborator or `canStructure`. Private record actors must be the source creator or current recipient with posting permission; target must already be a current recipient of that revision. A fixed single-reviewer private decision therefore exposes no useful route target and disables route. Resolve/snooze never expands readership.

- [ ] Write `TestAttentionTransitionRetryAndSeparation`: resolve leaves business pending and notification unread; read leaves attention open; same key/payload returns canonical result after lost response; changed reason/target/time/expected version on reused key yields 409; a new key with stale version yields 409; revoked source retry yields 404 even though retry row exists. `TestAttentionRoutingEligibility` denies owner-as-task-reviewer, finance creator, private nonrecipient, inactive/cross-company target and bookmark routing; concurrent routing creates one target item.
- [ ] Run `go test ./platform -run 'TestAttention(Transition|Routing)' -count=1`; record RED.
- [ ] Implement transition in `withAccessTransaction`, refreshing source authorization before lookup/replay; hash validated raw intent fields excluding server timestamps/IDs. Check existing retry hash before expected-version rejection, reauthorize canonical result, and return canonical action metadata with freshly authorized view. Changed payload never silently creates a new key. Persist origin/target/retry/audit together. Private audit stays in an IDs-only dedicated action record/reminder metadata; do not write private preview/reason into taskless company Activity. Business actions keep source-scoped audits.
- [ ] Rerun GREEN and PostgreSQL concurrent retry tests. Commit `feat: add retryable attention resolution and routing`.

## Task 3: Atomic producers for existing business and conversation workflows

**Files:** Create `attention_producers.go`, `attention_producers_test.go`; modify narrow hooks in `tasks.go`, `task_evidence.go`, `expenses.go`, `communication_structured.go`, `communication_record_revisions.go`, `communication_requests.go`, `communication_daily.go`, `automations.go`, `deadlines.go`.

**Actual hook map:**

| Existing helper/handler | Required intent and lifecycle |
| --- | --- |
| `insertTask`, `patchTask`, `reviewTask` in `tasks.go` | Review request on entry/reviewer change for assigned reviewer and current independent eligible company leaders; blocker action for current owner and explicitly configured eligible route owner; assignment/update attention to actual accountable owner when actionable. Review decision or status leaving review supersedes obsolete review intents. Reopen is a new obligation episode. |
| `appendTaskEvidence` in `task_evidence.go` | Evidence while in review advances version and creates a fresh review-evidence obligation/supersedes outdated one. |
| `transitionExpense`, `notifyExpenseApprovers` in `expenses.go` | Submitted review items for independently eligible approvers; withdraw/approve/reject/void supersede the pending obligation. Retain `expenseNotification` behavior. |
| `createCommunicationRecord`, `respondCommunicationRecord` in `communication_structured.go`; `editCommunicationRecord` in `communication_record_revisions.go` | Explicit current recipients receive decision/response intent; answered/closed revision supersedes matching pending actions; edited revision gets a new unique obligation and source revision. |
| `createCommunicationRequest`, `assignCommunicationRequest`, `patchCommunicationRequest` in `communication_requests.go` | Published intake triage for current eligible leaders/department heads; assigned task uses `insertTask`; resolved/cancelled supersedes pending triage. Never disclose underlying source to triage. |
| `saveCommunicationMessage` in `communication_daily.go` | Saved reminder anchored to exact bookmark remindAt/source state; remove/change supersedes old reminder. Saved without remindAt is not an actionable reminder. |
| `runCompanyAutomations` in `automations.go`; `timedDeadlineReminder` in `deadlines.go` | Upcoming/overdue intent keyed by deadline fingerprint and explicit period/stage, with company identity. Recurrence direct create also produces its applicable task intent. |

Add proposed `syncTaskAttention(tx *gorm.DB,a *access,before *Task,after Task) error`, `syncExpenseAttention(tx *gorm.DB,a *access,before Expense,after Expense) error`, `syncRecordAttention(tx *gorm.DB,scope *conversationScope,record CommunicationRecord) error`, `syncIntakeAttention(tx *gorm.DB,a *access,item CommunicationRequest) error`, `syncBookmarkAttention(tx *gorm.DB,scope *conversationScope,bookmark CommunicationBookmark) error`. Source-specific callers already hold their transaction; these functions must not obtain company locks from chat or perform an HTTP request. Private record producers use explicit verified recipient rows and their existing conversation transaction; business producers use current access. Ensure source occurrence keys are deterministic (entry/revision/deadline fingerprint/remindAt), so daily delivery retries do not mint new obligations. No title/body-based event classification.

- [ ] Write `TestAttentionProducerAtomicityAndDedup` for create/enter review, evidence revision, expense submit/withdraw, record revision/response, published intake assignment/closure, bookmark change/removal, deadline rerun and recurrence; rollback source write rolls back intent. Repeated/conflicting business requests remain subject to current existing handler contracts. `TestAttentionRecordRejoinBoundary` proves rejoin does not resurrect earlier private actions.
- [ ] Run `go test ./platform -run 'TestAttention(Producer|RecordRejoin)' -count=1`; record RED.
- [ ] Implement producers and hook them before transaction commit. Add a bounded idempotent reconciliation pass for preexisting pending work, using source natural keys and current scopes; do not invent historical event dates. Task POST durable creation remains a broader roadmap prerequisite; do not claim this action-intent dedup makes task POST retry-safe.
- [ ] Rerun GREEN plus existing task/finance/communication conversion/intake/evidence/concurrency suites; commit `feat: project workflow obligations into attention`.

## Task 4: Working hours, quiet hours and durable local reminders/escalation

**Files:** `attention_jobs.go`, `attention.go` preference handlers, `attention_jobs_test.go`; narrow call in `communication_runtime.go` worker and `automations.go` existing explicit run flow.

External push remains the existing IDs-only `CommunicationPush` flow, independent of attention read/resolution. This slice delivers deduplicated in-app reminder/escalation rows: no new email/Slack/provider send is implied. Failed/expired local leases retry the same reminder. A future push adapter must use the same ID and current source checks and must describe provider acknowledgement ambiguity honestly.

- [ ] Write `TestAttentionWindows`: disabled hours return now; Monday 09:00–18:00 includes 09:00/excludes 18:00; weekend advances to Monday; overnight windows belong to start weekday; quiet 22:00–07:00; equal quiet start/end means all-day quiet and invalid enabled policy; invalid timezone/no allowed overlap fail; real DST repeated/skipped local minutes use valid UTC instants. `TestAttentionReminderLeaseAndEscalation` proves snooze/quiet deferral, one item/stage/window after concurrent workers, lease expiry, failure retry, resolve cancels unsent reminders, disabled escalation sends none, unauthorized escalation target receives no item, source revoked before delivery cancels safely.
- [ ] Run `go test ./platform -run 'TestAttention(Window|Reminder)' -count=1`; record RED.
- [ ] Implement `nextAttentionWindow` and preference optimistic updates. `RunAttention` uses current active/suspended user/member/access under company lock, then private conversation locks as needed; no fake request/session. Scan bounded source/item batches, claim with PostgreSQL `SKIP LOCKED` and unique rows, complete/cancel only with matching lease token. Use `claimAutomation` for stage scheduling keys containing company/item/stage/window; claiming and reminder creation commit together. Escalation is an IDs-only attention item to configured currently eligible recipient, not a reviewer/owner reassignment. Muted/inactive/invalid policies do not trigger unbounded minute polling or permanently claimed unsent events.
- [ ] Rerun GREEN, PostgreSQL concurrent worker/clock fixtures and existing communication push/automation suites; commit `feat: schedule scoped attention reminders in working hours`.

## Task 5: Web Inbox and leadership decisions with scoped queries

**Files:** Create `data/attention.ts`, `components/AttentionInbox.tsx`, `pages/Attention.test.tsx`; modify `pages/InboxSettings.tsx`, `pages/Overview.tsx`, `types.ts`, scoped query/invalidation integration in final milestone-2 `store.tsx`, and `data/demo.ts` for parity. Reuse existing task/expense/Connect navigation and `Structured.tsx`/`WorkflowTools.tsx` business decisions.

Proposed `useAttention` query consumes company/user/final `readBasis`/filters, cancels previous requests on scope change, exposes loading/error/retry/data and invalidates item/list/decision counts after attention or linked business mutations and existing authorized communication events. Add no new global workspace poll. Decision cards link to the current business detail for approval; resolve has copy “Resolve this Inbox item; this does not approve the work.” Pending source decision badges remain accurate after attention resolve. Filter updates versus action-required; display snoozed date, current owner and typed source link, not technical IDs.

- [ ] Write `Attention.test.tsx`: updates/read versus action/resolve stay separate; route/snooze double-click submits once and lost response retry reuses key; changed draft clears stale confirmation/key only on deliberate new intent; business approval uses existing detail handler/version, never transition resolve. Test leadership without membership, live source revocation without membership fingerprint change, company switch during response and denied refresh clearing old preview, network error without fictional data, pending business decision count after attention resolve, and demo parity.
- [ ] Run `npm test -- src/pages/Attention.test.tsx` from frontend; record RED.
- [ ] Implement accessible 44px controls, labelled filters, one primary action per sheet, human owner picker with eligible choices, reviewed route confirmation, company-local snooze shortcuts, optimistic preference form and server error display; avoid browser prompt for reasons. Preserve authorized draft on transport failure, purge it on access/company change. Render the same query/action component in Inbox and a decisions-only actor-scoped section in Overview.
- [ ] Rerun GREEN; run `npm test`, `npm run typecheck`, `npm run build`, and changed-file formatting check. Commit `feat: add actionable web inbox and decision queue`.

## Task 6: Native Inbox, full regression and release evidence

**Files:** Create `mobile/src/AttentionInbox.tsx`, `AttentionInbox.test.tsx`; modify `mobile/src/app/(tabs)/inbox.tsx`, `Workspace.tsx` scoped attention invalidation and eligible picker/sheet components from reviewed milestone 3. Record evidence in `task-4-report.md` and controller-owned roadmap/progress files only when instructed.

- [ ] Write native tests for updates/action tabs, labelled human owner selection, separate read/resolve/approval, keyboard-safe route/snooze reason sheet, guarded duplicate submit and retained retry key/input after failure, current source removal, delayed old-company response rejection, accessible loading/recoverable errors, large-text layout and dismissal preserving recoverable input. Existing chat navigation remains Expo Router.
- [ ] Run `npm test -- src/AttentionInbox.test.tsx` from mobile; record RED. Before any new Expo/React Native API work, follow `mobile/AGENTS.md` and read matching Expo 57 official docs; use reviewed milestone-3 UI primitives where possible.
- [ ] Implement native component against Task-5 query/DTO semantics without a second attention store, maintaining clearPrivate/company-switch cancellation. Source-decision opens existing task/expense/record/intake detail workflow; Inbox actions only call attention transition. Current source failures purge previews; transport failures keep authorized drafts.
- [ ] Rerun GREEN; run backend `go test ./...`, owned PostgreSQL tests using controller-provided disposable schema fixture, frontend `npm test`/typecheck/build, mobile `npm test`/typecheck/lint/export, mirrored migration and Encore checks prescribed by reviewed earlier milestones. Record exact commands/output and any unavailable checks, not assumed passes.
- [ ] Self-review code and spec coverage; document RED/GREEN per task, route/source semantics, retry/worker evidence and changed files. Commit `feat: add native actionable inbox`; controller requests independent review. Physical Android/iOS keyboard/back/screen-reader/background push remain unchecked unless actual device evidence exists. No main-app restart, merge, push, production provisioning or external delivery in this milestone brief.

## Completion criteria

All six tasks pass focused and relevant full checks; independent controller review accepts the diff. Task/expense/private record/intake/bookmark source access is current at list/detail/transition/retry/reminder, one item per recipient obligation and one delivery intent per stage/window, read never resolves, resolve never approves, pending decisions remain visible, current authority controls routing, retries are payload-bound and canonical, timing is company-local, web/native reuse scoped reads and recover safely. External push/device results are labelled rollout gates rather than counted as local acceptance.

## Controller transition-state clarification

New attention actions resolve/route/snooze/unsnooze require an open current item; identical stored retries still return their canonical metadata after current source authorization. Resolved/routed/superseded items are final for that attention episode; pending business decision navigation remains available through decisionsOnly regardless. New source obligation/revision can create a new episode, never silently approve business work.

Routing may reuse a currently open, eligible target item for the same obligation. If target already resolved/routed its earlier episode, an explicit route must create one fresh open route-event episode bound to origin/action identity rather than reuse a closed item and silently lose the route. Stable action retry and unique route occurrence prevent another item on duplicate submission. Add target-previously-resolved and concurrent-route tests. Do not create two open target cards when an applicable open item already exists. These rules settle unspecified state details; source owner/reviewer stays unchanged.

## Final dependency clarification for dispatch

Use the accepted milestone3 interfaces recorded in `verification/workspace-improvements-roadmap/milestone-3-fix-1-implementation.md`; fix2 changes only internal NativeConversation request ownership. Native actual routes are under `mobile/src/app/`; `PersonPicker`, `DeadlinePicker`, `ConnectUI.Sheet`, `Workspace.Page`, `useRamInput` retire/matches and typed `NativeApiError` are existing exports to reuse. `refresh` currently supports all/tasks/finance only; extend narrowly for attention rather than assuming a missing scope. Canonical shared conversation RAM/history stays owned by milestone3.

`AttentionView` must be an explicit DTO, not serialization of a raw persistence `AttentionItem`. Published intake authorization intentionally permits triage without source conversation membership; omit its internal conversation ID, anchor message ID, sequence and private source revision even for an authorized leader. Expose the independently published request version. Private edit/removal does not retract or reveal the independently published intake. Add exact JSON non-disclosure assertions.

Existing `withAccessTransaction` is HTTP/session-bound. Extract/add a narrow independently current active actor constructor for jobs/target checks using company→active-user/member locks and a fresh scoped directory, without a fabricated request/session. Record its actual reviewed signature for later workers. Respect conversation/dependent lock ordering and job final-check ordering company→session→sorted members→conversation→dependents; producers already holding chat transactions never reacquire company locks. No source accessibility is inferred from readBasis alone.

### Bounded operator reconciliation

After applying the attention migrations, an operator can project existing current
work with `go run ./cmd/reconcile-attention --company COMPANY_ID --limit 100`
from `backend/`, using its explicit `DATABASE_URL`. For an owned SQLite evaluation
file, unset `DATABASE_URL` and supply `--db /absolute/path/evaluation.db` instead.
The command never migrates, seeds, creates a default database, starts a worker, or
loops over a full company. Each invocation processes at most 100 source IDs in
one transaction and prints `{"nextCursor":"...","complete":false}`. Invoke it
again with `--cursor` set to that exact returned value. Persist progress only after
a successful invocation; repeating the preceding cursor after interruption is
idempotent. `complete:true` and an empty cursor finish this pass. Restart from an
empty cursor for a later explicit pass if source work changed during traversal.
Current source eligibility is checked under company → sorted member → conversation
→ dependent locks; a revoked private creator does not block a current fixed
recipient, and inaccessible sources do not generate attention. This entry point
performs local IDs-only projection and sends no external delivery.
