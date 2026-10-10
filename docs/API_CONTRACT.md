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

- POST `/goals` and PATCH `/goals/:id` `{name,description,ownerId,departmentId,unit,baseline,target,current,dueDate,taskIds}`.
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

POST `/devices` `{deviceId?,platform,name,pushProvider?,pushToken?}` registers an owned session-bound device; returns `{ok,id}`. GET `/devices` lists only the account's registrations without push tokens/session hashes. POST `/devices/:device/revoke` revokes the owned device's bound session and all registrations bound to it; unknown/foreign IDs return 404. Other sessions remain intact. POST `/admin/users/:user/offboard` requires a platform operator, reason and current ownership handover; it suspends the account across companies. Company departure remains company-scoped.

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

POST `/conversations/:id/task-conversions/preview` and `/task-conversions` accept `{retryKey,anchorMessageId,actionId?,sources:[{messageId,revision}],expectedPolicyVersion,task,publication:{excerpt,attachmentIds}}`. Preview returns current server `audienceUserIds` and independent-copy notice. Commit acquires the existing business lock and independently checks source history, forwarding policy, exact revisions, current destination authority/references and existing independent task review. Selected titles/summaries/filenames are disclosure too. Private deny policy forbids derived publication. Ordinary current tasks are not a confidential-work model.

A durable retry key binds the actor/company/operation/payload; primary action uniqueness is separate from context selection, so A vs A+B creates one primary work instruction. POST `/conversations/:id/work-actions` declares an explicit reviewed split `{retryKey,anchorMessageId,sourceRevision,expectedPolicyVersion,titles}`; GET the same route with `anchorMessageId` returns current authorized server IDs. Client-invented split identifiers are not accepted. `/work-links` and `/expense-links` disclose only independently readable targets; protected source provenance is separately authorized.

POST `/conversations/:id/requests/preview` and `/requests` publish an explicit triage request `{retryKey,anchorMessageId,sourceRevision,expectedPolicyVersion,title,summary,departmentId}`. GET `/communication/requests` returns currently visible intake. POST `/communication/requests/:request/assign` `{expectedVersion,task}` assigns through the existing task engine/primary claim. PATCH the request `{expectedVersion,state,reason}` handles resolved/cancelled outcomes; resolution requires accepted work. Free text never automatically becomes intake.

POST `/conversations/:id/expense-conversions/preview` and `/expense-conversions` take the selected-source/publication fields plus `expense` with existing incurred-expense fields. They create only an independently reviewed draft, with exact integer minor units and permitted copied evidence. Budget, receipt, duplicate invoice, submission, independent approval and payment controls remain in the original finance workflow.

GET `/communication/briefing` returns current visible work state counts/open intake age. It does not query private DM bodies or score employees. POST `/conversations/:id/exports` is owner-only, requires selected policy, current version, `messageIds`, `purpose` and `acknowledgedIndependentCopy:true`; returns current projected messages with a private audit ID. It excludes historical revisions/media bytes and cannot recall copies.

### Media and calls

POST `/conversations/:id/media` reserves `{clientUploadId,fileName,size,sha256}` with durable payload-bound retry. POST `/:media/upload` sends bounded raw bytes; POST `/:media/finalize` verifies size/hash/type and successful scan. GET `/:media/download` rechecks current membership/history and expiry. Unscanned files are unavailable. Default chat maximum is 25 MiB; selected work/receipt copies retain 10 MiB. No public static or signed-URL bypass is used.

POST, GET `/conversations/:id/calls` creates `{kind:audio/video,retryKey}` or lists authorized records. POST `/calls/:call/token` `{deviceId}` returns a short-lived narrow room token and Schach signaling URL. POST `/calls/:call/end` `{expectedVersion}` ends the call; durable provider cleanup survives outage. `/calls/:call/transport/rtc` and `/calls/:call/transport/rtc/validate` proxy only authorized signaling after checking token claims, current session/device/company/conversation epoch and persisted grant. Provider port 7880 must be unreachable publicly. Refreshed provider tokens still require the original current persisted grant; revocation denies both cached and refreshed rejoin. Missed calls depend on actual provider upgrades, not token issuance. Recording/transcription is disabled.

### Exact-revision communication records

POST, GET `/conversations/:id/records` create/list `{retryKey,kind:ack/poll/event/decision,anchorMessageId,sourceRevision,title,body,options,recipientIds,reviewerId,dueAt}` with fixed source-authorized recipient audience. PATCH `/:record` with `expectedRevision` and reason publishes a material revision; old responses remain on their old revision. POST `/:record/respond` `{expectedRevision,response}` acknowledges, votes, RSVPs or independently confirms/rejects the decision. It never invokes task or financial acceptance/payment.

### Timed commitments and evidence

Tasks now accept `deadlineMode:all_day/timed`, `dueDate`, and for timed mode `dueAt` with explicit UTC offset plus `dueTimezone` IANA zone. Original mode/instant/zone are immutable. Ambiguous DST input needs a selected offset; nonexistent wall time is rejected. Timed recurrence is explicitly rejected; legacy all-day recurrence remains supported. Imports/exports preserve these fields. Completed exactly at the timed instant is on time; overdue compares absolute instants, while all-day uses the company calendar.

Adding task acceptance evidence bumps its optimistic version. A review inspected at version N cannot accept evidence version N+1. Accepted tasks must reopen before new evidence; ordinary discussion comments remain separate from acceptance evidence. All original finance controls remain unchanged.
