# API contract — shared by backend and frontend

Prefix `/api`. JSON field names/types are authoritative in `frontend/src/types.ts`. IDs are strings. Date fields `dueDate`, `originalDueDate`, `startDate`, time entry `date` are `YYYY-MM-DD`; timestamps are RFC3339 UTC. Empty optional relationships are `""`, lists are `[]`, never null. Standard errors: HTTP status with `{ "error": { "code": "...", "message": "..." } }`. Mutations return `{ok:true,id?:string}` unless stated. Use HttpOnly session cookies; browser sends credentials. No client-supplied role or company header is trusted.

## Authentication

- POST `/auth/login` `{email,password}` → Session; sets opaque session cookie.
- GET `/auth/session` → Session; 401 when not logged in.
- POST `/auth/logout` → OK; revoke session and clear cookie.
- POST `/auth/password` `{currentPassword,newPassword}` → OK; enforce length >=12, revoke other sessions.

## Companies

- GET `/companies` → `{companies:Company[]}`.
- POST `/companies` `{name,slug,industry,timezone,color,currency?,fiscalYearStartMonth?}` → `{ok:true,id}`; platform owner only; creates founder membership.
- GET `/companies/:cid/workspace` → WorkspaceData, with tasks and related content filtered by role, plus financeScope, expenseCategories, budgets, expenses and financeEvents. Financial references never expand work permissions.
- PATCH `/companies/:cid` company fields → OK; leadership/company admin.

All below are relative to `/companies/:cid` and require a verified membership.

## Organisation

- POST `/departments` and PATCH `/departments/:id` `{name,headId,color,description}`.
- POST `/people` `{name,email,password,role,departmentId,managerId,title,capacityHours}`. Password is required for a new account, ignored/rejected appropriately for an existing account; adding existing account does not reset its password. New account gets hashed password and can change it. No email is sent.
- PATCH `/people/:id` allows role, departmentId, managerId, title, capacityHours, active (id is user ID); only authorised admin roles; self-role escalation and loss of last founder prevented.
- POST `/projects` and PATCH `/projects/:id` `{name,description,departmentId,ownerId,dueDate,color,status}`.

## Tasks

- POST `/tasks` → accepts CreateTaskInput, backend adds immutable id/code/companyId/createdBy/originalDueDate/timestamps/version.
- PATCH `/tasks/:id` → accepts Partial<CreateTaskInput> plus `version` (required), `progress`, `status`, `blockerReason`, `deadlineChangeReason`. Changing dueDate requires a reason; originalDueDate does not change. Backend validates state/owner/reviewer/references/dependencies and performs compare-and-swap on version. 409 means refresh and retry intentionally.
- POST `/tasks/import` `{rows:CreateTaskInput[]}` → atomic validation+creation, max200 rows. All failing rows have an actionable error. No partial import.
- POST `/tasks/:id/comments` `{body}`; appends Comment and audit event.
- POST `/tasks/:id/time` `{hours,date,note}`; hours >0 and <=24; adds TimeEntry and increments actualHours/version.
- POST `/tasks/:id/review` `{decision:"approve"|"request_changes",comment,version}`; assigned reviewer or leadership, never owner; records decision; approval requires dependencies and checklist complete. Request changes goes to in_progress.
- POST `/tasks/:id/nudge` `{message}`; in-app notification to owner, scoped, auditable.
- POST `/tasks/:id/attachments` multipart form field `file`, limit 10MiB; safe allowlist; returns OK with attachment ID.
- GET `/attachments/:id` authenticates and authorizes the associated task, sends bytes as a download.

Task status values: `backlog`, `todo`, `in_progress`, `blocked`, `in_review`, `done`, `cancelled`. Priority: `critical`, `high`, `medium`, `low`. Repeat: `none`, `daily`, `weekly`, `monthly`. Required review defaults true when reviewer is present. Progress is an estimate; submitting sets 100 but does not imply accepted completion. Actual completion is only done. Task references must be within the same company. Dependencies cannot cycle. Parent tasks cannot be their own descendants.

## Goals and inbox

- POST `/goals` and PATCH `/goals/:id` accept reviewed metadata `{name,description,ownerId,departmentId,unit,baseline,target,dueDate,taskIds,retryKey}`; edits capture `version` and a reason. Changing a current outcome requires an explicit observed value/instant/reason through the measurement controls, never a task-count inference. GET `/goals/:id`, `/measurements`, `/evidence-options`, `/evidence-preview` supply current authorized detail/history/evidence. POST `/goals/:id/measurements` appends an observation or correction with captured versions, effective instant and reviewed evidence. GET/PATCH `/goals/:id/reminder-preference` uses personal captured `expectedVersion`; it does not transfer on owner handover.
- POST `/notifications/read` `{ids:string[]}`; empty ids means all current user's notifications.
- POST `/automations/run` → `{ok:true,created?:number,reminders?:number}`; admin/manual run and scheduled Encore job use identical idempotent processing.

## Shared exported Go interface

Backend module: `schach.local/workspace/backend`. Public package: `platform`.
`platform.New(db *gorm.DB, options platform.Options) (*platform.Server, error)`; Server implements `http.Handler`.
`platform.Migrate(db *gorm.DB) error` for standalone/dev.
`platform.SeedDemo(db *gorm.DB) error` uses explicit development sample accounts.
`platform.Bootstrap(db *gorm.DB,email,password,name string) error` initializes only when no users exist.
`(*Server).RunAutomations(ctx context.Context) (created,reminders int,err error)` for cron/standalone jobs.
`Options{AllowedOrigins []string, SecureCookies bool, SessionHours int}`; extend only if needed, document additions.

## Demo and local evaluation

Explicit `--demo` / `SEED_DEMO=true` creates founder@schach.demo, ceo@schach.demo, head@schach.demo, member@schach.demo, finance@schach.demo with local evaluation password `SchachDemo!2026`. All data fictional. Shared sample fixtures: `frontend/src/data/sample.json` and a copied embedded backend fixture. Production mode never auto-seeds these accounts. A second fictional company verifies switching and isolation.

## Department budgets and categorized expenses

Company-relative endpoints share the same session and current-membership checks. `currency` defaults to `INR`; `fiscalYearStartMonth` defaults to `4`. Supported currencies are INR, USD, EUR, GBP, AED, SGD, AUD and CAD, all with two decimal places. Currency and the financial-year start become immutable after the first budget or expense. Amounts are integer minor units: `123456` means `1234.56` in the company's currency. No floats, FX conversion or tax calculation is accepted.

| Method | Route | Input and behavior |
| --- | --- | --- |
| POST | `/expense-categories` | `{name,color,active?,receiptRequired?}`. Company finance authority only. |
| PATCH | `/expense-categories/:id` | Editable category fields plus required `version`. Archive instead of delete. |
| POST | `/budgets` | `{departmentId,name,startDate,endDate,amountMinor,status,notes?}`; initial status draft or active. |
| PATCH | `/budgets/:id` | Editable fields plus required `version` and controlled-change `reason`. Activated department and dates are frozen. |
| POST | `/expenses` | `{departmentId,categoryId,title,description?,vendor,invoiceNumber?,expenseDate,amountMinor,projectId?,taskId?,receiptExceptionReason?}`. Creates the authenticated person's draft. |
| PATCH | `/expenses/:id` | Editable financial fields plus required `version`; creator's draft/rejected expense only. |
| POST | `/expenses/:id/transition` | `{version,action,note?,overrideReason?,paidDate?,paymentMethod?,paymentReference?}`. Actions submit, withdraw, approve, reject, pay, void. |
| POST | `/expenses/:id/receipts` | Multipart `file`; append-only, up to 10 MiB. Returns receipt ID. This additive operation needs no expected version, but increments the expense version. |
| GET | `/expense-receipts/:id` | Authenticated, expense-scoped download bytes; no task visibility is granted by financial access. |

All updates and decisions reject stale versions with HTTP 409. Category and budget names, notes, statuses and relevant amounts are recorded in finance history. Expense history records before/after financial field changes; linked work changes are recorded without leaking hidden identifiers.

Budgets cannot overlap in the same department, including drafts and closed envelopes. The inclusive period must lie in one company financial year. Budget amount allows 0–1,000,000,000,000 minor units. Expenses allow 1–1,000,000,000,000. Expense dates must be valid and no later than company-local today. Vendor+invoice uniqueness is case- and whitespace-normalized within a company among non-void records; a blank invoice number is permitted.

Controlled reasons require 12–4,000 Unicode characters. Required categories need receipt evidence or a recorded exception at both submission and approval. An exception also needs an independent approval note. A head cannot override a missing, inactive or insufficient budget. Company financial authorities may record a reasoned override, but nobody can approve, reject or pay their own expense. Payment method is `bank_transfer`, `upi`, `card`, `cash` or `other`; payment date must be between incurred date and today, with a reference. This records a full external payment; it does not transfer money. Paid and void economic fields are final. Receipts can still be appended by the creator or company financial authority.

Finance scopes are `company`, `department`, `personal`, `none`. Founder/CEO/admin/finance have company finance, heads have department finance plus their own historical expenses, manager/member have personal expenses and no budget balances, and viewer has none. Financial event projection is scoped before its latest-1,000 cap. Notifications may include `expenseId`; use the expense route for those links.

## Communication and native identity

These additions preserve every existing task/finance authorization rule. Communication JSON models live in `backend/platform/communication_*.go`, with browser types in `frontend/src/communication/types.ts`. Private chat is server-readable company-managed storage. Leadership has no ordinary private metadata/content bypass.

Authentication additions (relative to `/api`): POST `/auth/mobile-login` accepts `{email,password,code?,recoveryCode?}` and returns `{session,token}`; native sends `Authorization: Bearer <opaque-session>` over HTTPS, never in URL. Browser login also accepts optional MFA fields. GET `/auth/mfa` returns enrollment/configuration status; POST `/auth/mfa/setup` `{password}`, `/confirm` `{code}`, `/disable` `{password,code}` manage the caller's authenticator. Setup secrets/recovery codes are private. Confirmation invalidates other sessions. Operator lost-MFA recovery is a direct-database command, not an HTTP bypass.

POST `/devices` `{deviceId?,platform,name,pushProvider?,pushToken?}` registers an owned session-bound device; returns `{ok,id}`. GET `/devices` lists only the account's registrations without push tokens/session hashes. POST `/devices/:device/revoke` revokes the owned device's bound session and all registrations bound to it; unknown/foreign IDs return 404. Other sessions remain intact. POST `/admin/users/:user/offboard` (no request body) requires a platform operator other than the target; it refuses with 422 until company ownership and owned active conversations were already transferred or archived, then suspends the account across companies, revokes its sessions and audits `global_offboarding` with "Handover not performed". No reason field is accepted. Company departure remains company-scoped.

All routes below are relative to `/companies/:cid`, with current active company membership and a valid session required. Unknown, foreign or unauthorized private resources return 404 without confirming existence. Viewers cannot post, manage, publish or make decisions.

| Route | Behavior / payload |
| --- | --- |
| POST, GET `/conversations` | Create `{title,kind:dm/group/channel,public?,participantIds,forwarding:deny/selected}`; private default deny. DM fixed-pair uniqueness and blocking. List only current-visible conversations before the 100-row limit; `{conversations,cursor,hasMore}` with company/actor-bound pagination. |
| GET, PATCH `/conversations/:id` | Authorized metadata/active roster; optimistic `{expectedVersion,title?,archived?,forwarding?}`; publication changes require owner authority. |
| POST `/conversations/:id/members` | `{expectedVersion,userId,active,role}`; owner/moderator scope. Private join/rejoin starts with future messages and a fresh epoch. Ownership transfer must precede departure. DM pair cannot be changed. |
| POST `/communication/blocks` | `{userId,blocked}`; deny new/ongoing pair DM posts and calls, including before first DM creation; existing readable history remains. |
| POST, GET `/conversations/:id/messages` | Send `{clientMessageId,body,replyToId?,mediaIds?,mentionIds?,mentionAll?}`. Atomic message/order/revision/event/outbox commit; returns `{message}`. Replay identical payload returns same ID after current authorization; changed payload returns 409. History `{messages,cursor,hasMore}` is newest-page first in retrieval, sorted ascending within the displayed page. |
| PATCH `/conversations/:id/messages/:mid` | Sender edit/removal with `{expectedRevision,body?,removed?}`; removed content is a tombstone. |
| GET `/conversations/:id/stream` | Cookie-authenticated WebSocket, exact origins; no URL session token. Content-free ready/changed/refetch hints. Revocation, 51-event overflow or write timeout requires current reauthorization/refetch. |
| GET `/conversations/:id/sync` | Current authorized event/message sync with scoped cursors/history boundaries; no membership bypass. |
| GET `/communication/search?q=...` | PostgreSQL full-text search under membership/history predicates before ranking/limit; SQLite local fallback. |
| GET `/conversations/:id/messages/:mid/thread` | Authorized root/replies; unreadable root/history is denied. |
| POST `/conversations/:id/messages/:mid/reactions` | `{emoji,active}`; independent communication response, never approval. |
| POST `/conversations/:id/messages/:mid/pin`, GET `/conversations/:id/pins` | Management `{expectedRevision,pinned}`; only readable pins appear. |
| POST `/conversations/:id/read` | `{sequence}`; monotonic current history/read cursor. |
| POST `/conversations/:id/messages/:mid/save`, GET `/communication/saved` | Owner-private `{saved,remindAt?}` absolute-offset reminder; authorized projections on every read. |
| GET `/communication/attention`, `/communication/inbox` | Current authorized unread counts and opaque event targets. POST `/communication/inbox/:event/ack` acknowledges only the caller's event. |
| POST `/devices/:device/preferences` | Owned current-session registration `{muted,mentionsOnly,timezone,quietStart,quietEnd}`; IANA zone and paired HH:MM quiet boundaries. |

### Explicit publication into work

Native push hints (FCM/APNs) are body-free. The visible text is always the generic "Schach Workspace" / "A company update is available."; the custom data is exactly one of two shapes of opaque identifiers: `{eventId,companyId,conversationId}` for an unread Connect inbox event, or `{eventId,companyId,attentionId}` for an open Inbox attention item (task, expense and other attention sources). No title, body, amount, name, item kind/source kind or source/target id is sent; the collapse key is the conversation or attention id. An attention hint is sent at most once per item and registered device (`attention_pushes`, migration 59), only after the local Inbox delivery allowed by the recipient's attention working/quiet hours, due time and snooze, and only for items delivered within the last 24 hours. Immediately before each send the server re-checks the active device, unexpired fenced session, active membership and access epoch, the same SQL scope and source projection as GET `/attention/:item` (current role/source authority; a report-ready item only for its bound recipient), open state, snooze, attention quiet hours and the device's mute/quiet preference (deferred, not dropped). Device `mentionsOnly` does not suppress attention hints, which are already recipient-bound. Clients must resolve an attention hint through authenticated GET `/companies/:cid/attention/:item`; a 404 means the item is no longer available to the caller and the client opens the Inbox.

POST `/conversations/:id/task-conversions/preview` and `/task-conversions` accept `{retryKey,anchorMessageId,actionId?,sources:[{messageId,revision}],expectedPolicyVersion,task,publication:{excerpt,attachmentIds}}`. Preview returns current server `audienceUserIds` and independent-copy notice. Commit acquires the existing business lock and independently checks source history, forwarding policy, exact revisions, current destination authority/references and existing independent task review. Selected titles/summaries/filenames are disclosure too. Private deny policy forbids derived publication. Ordinary current tasks are not a confidential-work model.

A durable retry key binds the actor/company/operation/payload; primary action uniqueness is separate from context selection, so A vs A+B creates one primary work instruction. POST `/conversations/:id/work-actions` declares an explicit reviewed split `{retryKey,anchorMessageId,sourceRevision,expectedPolicyVersion,titles}`; GET the same route with `anchorMessageId` returns current authorized server IDs. Client-invented split identifiers are not accepted. `/work-links` and `/expense-links` disclose only independently readable targets; protected source provenance is separately authorized.

POST `/conversations/:id/requests/preview` and `/requests` publish an explicit triage request `{retryKey,anchorMessageId,sourceRevision,expectedPolicyVersion,title,summary,departmentId}`. GET `/communication/requests` returns currently visible intake. POST `/communication/requests/:request/assign` `{expectedVersion,task}` assigns through the existing task engine/primary claim. PATCH the request `{expectedVersion,state,reason}` handles resolved/cancelled outcomes; resolution requires accepted work. Free text never automatically becomes intake.

POST `/conversations/:id/expense-conversions/preview` and `/expense-conversions` take the selected-source/publication fields plus `expense` with existing incurred-expense fields. They create only an independently reviewed draft, with exact integer minor units and permitted copied evidence. Budget, receipt, duplicate invoice, submission, independent approval and payment controls remain in the original finance workflow.

GET `/communication/briefing` returns current visible work state counts/open intake age. It does not query private DM bodies or score employees. POST `/conversations/:id/exports` is owner-only, requires selected policy, current version, `messageIds`, `purpose` and `acknowledgedIndependentCopy:true`; returns current projected messages with a private audit ID. It excludes historical revisions/media bytes and cannot recall copies.

### Media and calls

POST `/conversations/:id/media` reserves `{clientUploadId,fileName,size,sha256}` with durable payload-bound retry. POST `/:media/upload` sends bounded raw bytes; POST `/:media/finalize` verifies size/hash/type and successful scan. GET `/:media/download` rechecks current membership/history and expiry. Unscanned files are unavailable. Default chat maximum is 25 MiB; selected work/receipt copies retain 10 MiB. No public static or signed-URL bypass is used.

POST, GET `/conversations/:id/calls` creates `{kind:audio/video,retryKey}` or lists authorized records. POST `/calls/:call/token` `{deviceId}` returns a short-lived narrow room token and Schach signaling URL. POST `/calls/:call/end` `{expectedVersion}` ends the call; durable provider cleanup survives outage. `/calls/:call/transport/rtc` and `/calls/:call/transport/rtc/validate` proxy only authorized signaling after checking token claims, current session/device/company/conversation epoch and persisted grant. Provider port 7880 must be unreachable publicly. Refreshed provider tokens still require the original current persisted grant; revocation denies both cached and refreshed rejoin. Missed calls depend on actual provider upgrades, not token issuance. Live-call recording/transcription is disabled. Opted-in selected attached-audio transcription uses the separate local-intelligence API and does not record calls.

### Exact-revision communication records

POST, GET `/conversations/:id/records` create/list `{retryKey,kind:ack/poll/event/decision,anchorMessageId,sourceRevision,title,body,options,recipientIds,reviewerId,dueAt}` with fixed source-authorized recipient audience. PATCH `/:record` with `expectedRevision` and reason publishes a material revision; old responses remain on their old revision. POST `/:record/respond` `{expectedRevision,response}` acknowledges, votes, RSVPs or independently confirms/rejects the decision. It never invokes task or financial acceptance/payment.

### Timed commitments and evidence

Tasks now accept `deadlineMode:all_day/timed`, `dueDate`, and for timed mode `dueAt` with explicit UTC offset plus `dueTimezone` IANA zone. Original mode/instant/zone are immutable. Ambiguous DST input needs a selected offset; nonexistent wall time is rejected. Timed recurrence is explicitly rejected; legacy all-day recurrence remains supported. Imports/exports preserve these fields. Completed exactly at the timed instant is on time; overdue compares absolute instants, while all-day uses the company calendar.

Adding task acceptance evidence bumps its optimistic version. A review inspected at version N cannot accept evidence version N+1. Accepted tasks must reopen before new evidence; ordinary discussion comments remain separate from acceptance evidence. All original finance controls remain unchanged.

## Connect direct messages (10 October 2026)

For `POST /api/companies/{cid}/conversations` with `kind: "dm"`, omit `title` and supply the other participant in `participantIds`. The server ignores DM titles and returns the existing company-scoped pair when present. Group/channel names remain required. Authorized DM list/detail projections include optional `peerId` for the other participant; the internal pair key stays private. This is an additive response field with no SQL migration. See [Connect UX](CONNECT_UX.md).

### Current-state task report input

`GET /api/companies/{cid}/reports/tasks?from=YYYY-MM-DD&to=YYYY-MM-DD&departmentId=&ownerId=&projectId=` authenticates active company membership and applies exactly the existing task read scope. Dates are inclusive; invalid/missing/reversed dates return the standard 422 validation error. Optional identifiers only narrow results and never grant access.

Returns `tasks`, `generatedAt`, `timezone`, and `basis: "current_state"`. Results contain non-cancelled authorized tasks whose current due date or accepted company-calendar date falls in the period. Nested comments, attachments, checklist and time entries are empty and are not loaded; finance and communication records are excluded. Inaccessible parent/dependency IDs are removed. Business fields support the existing report CSV and drilldown.

This is an intermediate lean read model, not a historical snapshot or paginated/aggregated report API. The query scans current company task rows before applying task scope and period filters. Use the additive scoped reads below for aggregated summaries and bounded snapshot rows/export. The broad workspace endpoint remains compatible.

### Scoped workspace reads and consistent report snapshots

These additive authenticated GET routes are relative to `/api/companies/{cid}`; the legacy `/workspace` and `/reports/tasks` remain compatible.

- `/bootstrap` returns authorized `WorkspaceData` directory/metadata with empty task/expense arrays, no nested task evidence or finance history, and `readBasis`, a fingerprint of current user/company/timezone and the entire membership graph. Existing activity and notifications remain bounded to1000 and500 records respectively. Cache keys must bind identity, company and this basis; reauthorize before displaying cached data. A subordinate's reporting/active change can change a manager's basis without changing their role.
- `/tasks` returns `{tasks,cursor,hasMore}`; optional `departmentId`, `ownerId`, `projectId`, `status` narrow the existing task scope. `/expenses` returns `{expenses,cursor,hasMore}`; optional `departmentId`, `status` narrow finance scope. Both use keyset cursors bound to current access and filters, default/maximum `limit=100` (outside1–100 returns422). Authorization precedes pagination; inaccessible work references are removed. Lists preserve all business scalar fields, including task description/blocker/deadline-change reason and expense description/review/receipt-exception/budget-override reason, for existing search, previews and CSV. Task checklist, comments, time entries, attachments and expense receipts are empty on lists; nested evidence is loaded only for selected records.
- `/tasks/{id}` returns `{task,people,evidence}` with the first100 comments/time entries/attachment metadata each; `evidence.{comments,timeEntries,attachments}` contains `{cursor,hasMore}`. Continue with `/tasks/{id}/comments`, `/time`, `/attachments` and scoped `cursor`/`limit`; responses contain the corresponding array (`timeEntries` for `/time`), safe actor `people`, `cursor`, `hasMore`. `/expenses/{id}` returns `{expense,financeEvents,people,evidence:{receipts:{cursor,hasMore}}}`; continue receipt metadata via `/expenses/{id}/receipts`. No file bytes in these JSON reads. Each detail/evidence request reauthorizes its source record; inaccessible records return404. `/finance/events` returns scoped `{financeEvents,people}` bounded to1000 events. Expense detail history is likewise bounded to1000.
- `/reports/tasks/summary` takes required inclusive `from`/`to` and optional `departmentId`, `ownerId`, `projectId`. It returns `{snapshot,summary,timezone,generatedAt,expiresAt,basis:"snapshot_current_state"}`. Full-cohort summary includes rows/cohort/accepted, original/current deadline denominators and met counts, done/blocked/pending/overdue/changed/needsAttention, per-department counts and accepted date buckets. Input is frozen in a read-only repeatable-read PostgreSQL transaction (SQLite transaction in development).
- `/reports/tasks/rows` requires the same filters and `snapshot`; optional `tab=commitments|accepted|exceptions` (omitted means all source rows), `limit` default/maximum100 and `cursor`. It returns `{tasks,cursor,hasMore,snapshot,basis}`; tab/filter selection precedes pagination. `/reports/tasks/export` uses the same filters/snapshot/tab and streams formula-safe CSV for that full selected tab, including exact original/current timed deadline fields. Response headers include `X-Report-Basis`, `X-Report-Rows`, and exact `Content-Length`. The original session, current membership basis, and complete frozen source/reference scope are rechecked before headers and every output chunk of at most64KiB. Authority locks end before network writes. Revocation stops later bytes; an already-started CSV can be truncated and never gains an appended JSON error. Already-written or in-flight bytes cannot be recalled. Summary is independent of row loading; clients load further rows explicitly.

Snapshots are process-local, expire after five minutes, and are bounded to64 snapshots,10,000 source rows,8MiB encoded data per snapshot and32MiB aggregate. Oversized reports return422 and require narrower filters. Evicted/expired/restarted tokens return409; cross-user/company tokens return404; mismatched filters/cursors return422. Every row/export read checks the current membership basis and current visibility of every source task and exposed parent/dependency; deletion or reassignment that loses access invalidates the whole snapshot with409. Frozen metrics never grant continuing access. Refresh the summary to obtain a new token; deployments with multiple instances need sticky routing or a new summary on token rejection.

The current web task/finance boards assemble every bounded authorized list page. Confirmed record absence immediately withholds open details and clears affected RAM drafts; list-version changes reauthorize them, with additional detail polling/event invalidation for evidence changes. A record outside the first page remains available after the complete list is confirmed. Native routes may reauthorize individual details independently. Live task/finance keyset lists do not promise snapshot totals; report rows/export do.

Selected detail reauthorization may temporarily hide fetched content. Only user-authored edits are preserved in mounted RAM across same-scope version changes; they retain the optimistic version inspected when editing began. Task stale-edit/409 handling and finance changed-during-decision gates require deliberate reconciliation. Record exclusion or confirmed detail denial clears both fetched content and affected edits; no automatic replay against a newer version.

## Finance assistance

Ordinary `POST /api/companies/{cid}/expenses` accepts optional `retryKey` for existing clients; first-party creates always supply it. Each new finance mutation requires a nonblank scoped key (maximum100 characters). An identical retry returns its canonical identifiers after current source/actor authorization; changed intent conflicts. A first write uses inspected versions. Retry keys do not extend source expiry or create a new session grant.

All following paths are under `/api/companies/{cid}`:

| Route | Contract |
|---|---|
| POST `/finance/intakes` | Exact `{retryKey,purpose:receipt\|statement,fileName,size,sha256,destinationDepartmentId?}`. Receipt≤10MiB; statement≤8MiB and finance authority. Receipt-only `{retryKey,purpose:receipt,capture:true,destinationDepartmentId}` reserves real zero-byte identity and charges10MiB until bound/cancelled/expired. |
| GET `/finance/intakes`, `/{id}` | Original live session/current owner and destination rights; paged recovery metadata. No quarantined bytes. |
| POST `/finance/intakes/{id}/bind-content` | `{retryKey,expectedVersion,fileName,size,sha256}` binds one real camera return. Canonical replay uses same key and payload, never recaptures/rebinds/renews expiry. |
| POST `/finance/intakes/{id}/upload` | Raw exact bytes; original scope before and after storage, exact hash/size, bounded MIME. Same-content stage recovery only. Unbound capture409. |
| POST `/finance/intakes/{id}/finalize`, `/cancel` | `{retryKey,expectedVersion}`. Finalize queues scanner; clean required before extraction/CSV. Cancel denies scratch immediately. |
| GET `/finance/intakes/{id}/download` | Current clean private source only, attachment/no-store/sandbox and repeated access checks. |
| POST `/expense-receipts/{id}/assessment` | `{retryKey,expectedExpenseVersion}` inspects the actual current parent and asynchronously scans existing independently retained bytes. |
| POST `/finance/receipt-extractions` | `{retryKey,optIn:true,source:{kind:intake\|expense_receipt,id,expectedVersion},destinationDepartmentId,targetExpenseId?,expectedTargetVersion?}`. Both target fields required together; target current own draft/same department. |
| GET `/finance/receipt-extractions`, `/{id}` | Requester/original-session private current-source jobs/results. Failed extraction is recoverable/manual; candidates have no authority. |
| POST `/finance/receipt-extractions/{id}/cancel` | `{retryKey,expectedVersion}`; cancels job and private result disclosure. |
| POST `/finance/receipt-extractions/{id}/accept-preview` | Read-only current source/review validation and current finance audience; no retryKey/business write. |
| POST `/finance/receipt-extractions/{id}/accept` | Key plus `{expectedResultRevision,sourceKind,sourceId,destinationDepartmentId,fields,confirmedUncertainties,copyEvidence:true}`. Explicit original expense fields, exact integer `amountMinor`, actual category/department/date/work links. One unique reviewed-result claim creates/updates a draft and separately retained selected receipt copy atomically. No submit/approve/pay. |
| POST `/finance/duplicates/preview` | Read-only `{sourceExtractionId,expectedResultRevision,fields}`; authorized pair comparison only. |
| POST `/finance/duplicate-candidates/review` | Key plus `{sourceKind:expense\|extraction,sourceId,expectedVersion,fields?,comparisonCursor?}`. Persists deterministic reviewed current pair candidates in current-authorized100-peer batches; `nextComparisonCursor` advances deliberate comparison and remains source/review/basis-bound. |
| GET `/finance/duplicate-candidates`, `/{id}` | Both sources/current basis before paging/detail. No hidden peer data/count/hash. |
| POST `/finance/duplicate-candidates/{id}/dismiss` | Key, inspected candidate version and meaningful12–4000 Unicode reason. Dismissal never waives original exact vendor/invoice validator. |
| POST `/finance/statement-previews` | Key, intake ID/version and explicit zero-based mapping; no inferred locale/date/sign/column defaults. UTF8/RFC4180≤8MiB/10k records/32 columns/4KiB cell/32KiB record. Every error blocks import. Original logical record ordinals preserve equal occurrences. |
| GET `/finance/statement-previews/{id}` | Owner/original live source; bounded normalized rows (`cursor` bound to current principal/company/basis/preview revision, maximum100; `nextPageCursor` advances deliberate review), private errors and exact totals. |
| POST `/finance/statement-previews/{id}/import` | Key, `expectedPreviewRevision`, optional deliberate repeated-file `duplicateReason`. Atomically retained import/rows/audit/claim. Changed accepted intent409; same preview cannot create another import. |
| GET `/finance/statement-imports`, `/{id}`, `/{id}/rows`, `/{id}/export` | Current company finance only. Independent normalized evidence, bounded rows and ≤16MiB formula-safe exact CSV export. |
| GET `/finance/reconciliation` | Current finance rows/import/paid expense projections; filters `state=all\|unmatched\|matched\|dismissed`, `importId`, basis-bound cursor advancing both rows and unallocated paid expenses independently. Deterministic suggestions require deliberate selection. |
| GET `/finance/reconciliation/rows/{id}/history` | Current row/import/finance authorization before independent100-item cursor pages for decisions and retained allocations. Queue embeds only latest20 decisions/allocations; complete history is deliberate selected drilldown. |
| POST `/finance/reconciliation/matches` | Key, row/expense IDs and original versions, meaningful reason. Only one exact full negative row/current paid expense/currency. DB unique active row AND expense. Never invokes payment or changes expense economics. |
| POST `/finance/reconciliation/rows/{id}/dismiss` | Key, inspected row version/suggestion basis/reason; retains accounting totals and discrepancy history. |
| POST `/finance/reconciliation/matches/{id}/unmatch` | Key, allocation version/reason; deactivates association with immutable history, preserves payment. Replay does not reactivate. |

Signed individual amounts remain bounded exact integers≤1e12 minor. Statement debit/credit/net are JSON **decimal integer strings**, checked in int64 and formatted by the shared exact string/BigInt formatter; consumers must not coerce aggregate strings to Number. Company currency is authoritative and no FX inference occurs. Receipt candidates, filenames, source hashes, leases/session references and raw bank cells never enter the company workspace or general communication hints. Source expiry/revocation suppresses detail/export/provider work independently of physical-delete retry.

New attention sources are `finance_extraction/receipt_review` (requester), `finance_duplicate/duplicate_review` (both sources), and `finance_reconciliation/reconciliation_review` (finance). IDs-only intents and current SQL/detail predicates apply. Resolve/snooze changes attention only; domain acceptance/dismiss/match supersedes episodes. There is no route/decide permission for these sources.

## Grounded local intelligence and current client review

The source/operation/job/publication contract, provider pins and limits are in [intelligence-local.md](intelligence-local.md). Capabilities, selection previews, bounded jobs/history/results, cancellation, claim inspection and explicit reviewed publication live under company-relative `/intelligence`; exact canonical task/expense/intake writes retain their existing authority and accept a validated intelligence basis only from explicit review. Suggestions are text/candidates, never financial approval or measured-goal facts. SQL58 adds minimal `existing`/`created` publication outcome for exact replay, without retaining source prose.

Structured recipient/reviewer choices use current company membership, active private conversation/history intervals, public source history and independent non-viewer review. Search and optional company-timezone deadline are client conveniences; backend checks remain authoritative. Deadline freezes as UTC in the canonical unknown request. Goal/preset version conflicts require deliberate current-version review; transport-unknown retries keep the exact submitted key/body. Labels/decimal keyboards do not alter API field keys or minor-unit parsing.

### Saved report recipient eligibility

Explicit definition creation, update, and schedule saves validate every selected recipient's current active, nonsuspended company membership and distinct IDs. Runtime generation, scheduled occurrences, output reads, and delivery independently authorize each actual recipient; another configured recipient's departure or suspension does not disable healthy recipients. The departed or suspended recipient receives no new output or ready-link access. Definition revision, explicit recipient removal, schedule version, artifact expiry, owner eligibility, and complete included-source authorization still invalidate the affected outputs.

Ready report delivery creates a recipient-bound, current-membership-epoch Inbox item available through the ordinary `/attention` list. The link contains only company/job IDs and is projected only while its ready artifact and full report sources remain authorized. Report-ready items cannot be routed or escalated to another person.
