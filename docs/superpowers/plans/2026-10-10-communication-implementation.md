# Schach Communication Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task after design review. Steps use checkbox syntax for tracking. This is a proposed plan requested by the user, not approval of every blueprint option or an instruction to delegate.

**Goal:** Add dependable company-owned communication and safe message-to-work conversion while retaining the existing task and finance controls.

**Architecture:** Extend the shared Go application with a separate communication domain, authoritative PostgreSQL history and a GORM transactional outbox. Conversation permissions are independent of business-record permissions; realtime carries revocable hints and HTTP resolves current authorized content. Preserve the existing business transaction discipline for conversions and keep ordinary message traffic off the company-wide lock.

**Tech Stack:** Existing Go/GORM/PostgreSQL, Encore and standalone adapters, React/TypeScript/TanStack Query; private object storage for new chat media; native mobile and a specialist call provider after their separate gates.

**Spec:** [Proposed communication blueprint](../../Schach_Communication_Blueprint.md). [Fresh baseline](../../LOCAL_BASELINE_2026-10-10.md). API/security contracts remain authoritative for existing work/finance behavior.

**Status (2026-10-10 execution):** User authorized the full roadmap, selected self-hosted LiveKit/native Android+iOS/India hosting and delegated remaining policy defaults. M0 is verified; M1–M10 source capabilities and local regression gates are implemented. M8/M9 physical-device/signing/push/TURN gates and M11 production deployment, capacity, recovery-objective/adoption/cutover gates remain outstanding. See [current evidence/status](../../COMMUNICATION_IMPLEMENTATION.md). Initial task checkboxes below remain an acceptance inventory, not a claim that every rollout condition was executed. Their proposed test names may differ from the final behavioral regressions; the evidence report names the actual checks.

| Milestone | Current result |
| --- | --- |
| M0 | Analyzer/SDK, real native SQL, original APIs, raw adapter/proxy sockets, bootstrap baseline and restart verified; new exported Encore runtime also verified |
| M1–M2 | Independent conversation permissions/history, company revocation, durable send/retry/order/outbox/sync and scoped sockets implemented/tested |
| M3–M5 | Timed/original commitments, evidence versioning and explicit safe work publication/primary claims implemented/tested |
| M6–M7 | Browser/native daily flows, private media/voice/scanning/retention implemented; actual scanner tested |
| M8 | Device/push adapters, MFA/recovery, offboarding/ownership and attention implemented/tested; real push/device delivery pending |
| M9 | Private self-hosted provider integration, narrow grants, revocable gateway, call states/cleanup implemented; real two-browser audio/revocation tested; physical/mobile/screen/TURN gates pending, recording off |
| M10 | Fixed-audience exact revisions, acknowledgements/polls/events/decisions, intake and expense bridge implemented/tested |
| M11 | Migration/deployment/backup/restore/load/device/pilot runbooks and local crash/restore/load fixtures implemented; real pilot/cutover not executed |

## Global constraints

- Every conversation belongs to exactly one company environment.
- Company role and conversation role are different. Leadership receives no ordinary private-chat bypass, including private metadata.
- Source-message access, publication permission and destination task/finance authority are independent checks at commit.
- Keep independent review, original commitments, reasons, optimistic versions, atomic imports, exact money, budgets, receipt policy and hidden-work-link filtering.
- Add numbered SQL migrations in both runtime locations; never rewrite versions 1/2 or use AutoMigrate as production upgrade.
- Acknowledged sends commit message/order/outbox atomically. Idempotency keys are durable, payload-bound and authorization-checked on replay.
- Date-only legacy tasks remain all-day. Do not invent historical times or silently discard extracted times.
- Read/list/search authorization precedes limits. Downloads, notifications, sync and derived content enforce the same scope/history boundary.
- Private content goes into scoped communication events, not generic taskless Activity/Notification text.
- No claims of immediate offline erasure, production certification or full WhatsApp replacement from a text/browser pilot.

## Review focus

1. Authorization changes during writes/delivery: tests in M1/M2 must define removal ordering and stop later disclosure, including stale retry results.
2. A newly joined/rejoined participant seeing quotes/search/thread roots: M1/M6 tests apply history boundaries to every derived view.
3. Private filenames/derived titles leaking into broader work audiences: M5 tests require explicit publication and filter badges/events/cards.
4. DST gaps/folds and changed company timezone: M3 tests preserve absolute/original commitments and reject ambiguous input without a choice.
5. Lost responses, repeated workers and different context selection for one instruction: M2/M5 tests prove both retry and primary-action uniqueness.

## Decisions to record before their owning milestone

| Decision | Recommendation grounded in current code | Remaining choice / gate |
| --- | --- | --- |
| Product/backend integration | Integrated Go domain in `backend/platform`, shared by both adapters. Reuses task/finance helpers and one identity | Confirm integrated direction before M1. Separate chat product or managed chat provider are alternatives if operational ownership is unacceptable; each needs an ACL integration design |
| Privacy/encryption | Company-managed server-readable storage/search; private membership checks, no leadership bypass | Confirm before M1. E2EE would change key recovery, search, media and AI architecture; do not bolt it on silently |
| Conversation roles/history | Fixed-pair DMs; owner/moderator/member; viewer read-only. Private groups join-forward, rejoin resets boundary; public company channels retained history | Confirm private history, DM blocking/moderation and admin exception policy before M1. Department/project roster source needs explicit rules rather than assuming task access is channel membership |
| Publication | `deny` or explicit `selected` forwarding policy; private defaults deny. No restricted-task promise under current broad task ACL | Confirm allowed publication policy before M5. Confidential shared tasks require a separate model audited across reports/exports |
| Delivery/concurrency | PostgreSQL ordering + outbox. HTTP commands/history; WebSocket hints. Conversation locks and membership shared locks, not company locks for sends | Accept the lock order below before M1; validate the actual gateway/proxy in M2. Redis only when multiple gateways require fanout |
| Idempotency | Persist request hash and result per company/actor/operation/retry key; separate primary action uniqueness | Do not expire retry records while an offline retry can still occur. Retention after message purge must keep a non-content tombstone or explicitly reject expired keys; decide storage retention before pilot |
| Timed deadlines | Explicit mode, absolute instant, IANA zone, immutable original tuple; user selects DST offset | M3 defines all-day/timed transitions. Initially reject timed+recurring combinations explicitly; keep existing all-day recurrence. Add a separately tested wall-clock recurrence policy before enabling timed repetition |
| Task evidence | Attachments/new published evidence bump version; stale review conflicts. Discussion comments alone are not approval evidence | Confirm M4 policy for accepted tasks: new evidence requires reopening; comments can remain discussion |
| Media/retention | Private object store, quarantine/scan, authorized download gateway, explicit published copy | Host/residency, size/quota/type limits, scanner, retention/deletion/export authority and backup expiry required before M7. Existing task/receipt bytes stay on current paths |
| Sessions/devices | Company departure revokes that company's delivery/grants; global offboarding revokes sessions/devices everywhere | Identity provider, SSO/MFA/recovery, shared-device support and launch owner required before M8. Do not revoke a person's other-company work merely on one company departure |
| Calls/native | Native mobile target with specialist media; room/token authorization owned by Schach | LiveKit is blueprint's candidate, not a purchased service. Hosting/TURN, OS inventory, strict token rejoin prevention, recording notice/retention and device gates required before M9 |
| Capacity/operations | Start one gateway/worker topology with measured limits; PostgreSQL search initially | Employee/device/company counts, concurrent load, languages, latency objective, offline window, RPO/RTO, adoption target and support owner need pilot inventory. No dates/costs invented |

The alternatives above are product decisions, not reasons to block M0. M0 can be implemented without choosing media providers or a mobile framework.

## Dependency order and boundaries

`M0 → M1 → M2`; `M0 → M3 → M4`; `M1 + M2 + M3 + M4 → M5`; `M2 + M5 → M6`; `M1 + M2 → M7`; `M6 + M7 → M8 → M9`; `M5 + M7 → M10`; `M8 + M9 + M10 → M11`.

Each task is a separately reviewable deliverable. M3 can proceed independently of durable messaging after M0, but this plan does not prescribe parallel agents.

### M0 / Task 1: Repair and enforce the real runtime baseline

**Files:** Modify `encore/api/api.go`, `encore/README.md`, `backend/migrations/README.md`, `verification/postgres-compat/check.mjs`, `docs/VERIFICATION.md`; move `encore/db/migrations/*.sql` unchanged to `encore/api/migrations/`; create `verification/runtime/README.md`, `verification/runtime/encore-smoke.sh`, `verification/runtime/tcp_scenarios.py`. Use this baseline's TCP adapter as the starting point for the latter. Update every reference to the moved SQL path, including operations/package checks.

**Consumes:** `platform.New`, `Server.ServeHTTP`, `Server.RunAutomations(ctx)`; numbered migrations 1/2 and existing scenarios.
**Produces:** A booting shared adapter and repeatable native runtime gate, no new public authorization path.

- [ ] Capture the current failing `encore check` as the red test. Assert E1371/E1288/E1796 causes in the failure record; SDK-only compilation does not satisfy it.
- [ ] In `api.go`, use `method=GET,POST,PATCH,OPTIONS,HEAD`; `Endpoint: RunScheduled` (generated package-level service wrapper); `Migrations: "./migrations"`. Move SQL without changing bytes and update consistency checks.
- [ ] Implement `encore-smoke.sh` around a disposable namespace, configured local bootstrap secret, `SEED_DEMO=true encore check` and `encore run --watch=false --browser never`. Poll actual `/api/health`; always terminate owned processes. Keep credentials out of logs.
- [ ] Run shared TCP scenarios: **38 workspace + 53 finance** for API-only Encore; standalone also checks the React document (**39 + 53**). Include normal session cookies, origins, independent decisions, stale versions, hidden links and revoked membership.
- [ ] Exercise PATCH and multipart upload/download through Encore. Verify direct unauthenticated scheduled-route invocation is denied, including a spoofed cron header; do not describe local metadata refusal as deployed private-service authentication.
- [ ] Configure a separate empty namespace for non-demo bootstrap; assert strong bootstrap credentials are required and existing accounts are not reset on restart. Correct the local undefined-secret documentation based on observed CLI behavior.
- [ ] Run all 45 backend tests on SQLite and native PostgreSQL, both race runs, 63 frontend tests/builds, 100 migration checks, and compile-only Encore SDK test after generated wrappers exist. Confirm migration hashes remain paired; populated upgrade retains original rows.
- [ ] Verify manual automations twice and concurrent scans on native PostgreSQL create one successor/reminder per claim. Local cron scheduling remains intentionally absent.
- [ ] Review and save fresh evidence before marking M0 complete. Production managed cron/TLS/private ingress remain deployment gates.

**M0 acceptance:** Unchanged-checkout failure is replaced by exit-0 `encore check`; configured Encore boots real native SQL, survives restart and passes 91 API assertions. All existing work/finance regressions pass; no route bypass, migration rewrite or demo production path is introduced. The disposable corrected copy already passed the 91 assertions, so these are grounded acceptance tests rather than speculative feasibility.

### M1 / Task 2: Conversation identity, history and revocation boundary

**Files:** Create `backend/platform/communication_models.go`, `communication_access.go`, `conversations.go`, `communication_access_test.go`; modify `server.go`, `organization.go`; add `backend/migrations/3_communication_core.{up,down}.sql` and matching `encore/api/migrations` copies; update `docs/API_CONTRACT.md`.

**Consumes:** Session authentication, Company/Membership identity. Reuses current task ACL only for business links, never for private conversation access.
**Produces:** `conversationAccess(tx *gorm.DB, userID, companyID, conversationID string) (*conversationScope, error)`; `conversationScope{CompanyID, UserID, Role, HistoryFromSequence, Version}`; company-relative `POST/GET /conversations`, `GET /conversations/:id`, membership/archive mutation routes with expected version.

- [ ] Write `TestConversationCompanyAndPrivateMetadataIsolation`, `TestViewerCannotPostOrManage`, `TestDMCompanyPairUnique`, `TestJoinRejoinHistoryBoundary`, `TestRevocationWinsAfterCommit`. Assert foreign/nonparticipant lookup returns indistinguishable 404 without names/counts/previews, including founder/admin/viewer nonparticipants.
- [ ] Run targeted tests and confirm failure before creating tables/handlers.
- [ ] Add tenant-composite constraints: conversation `(company_id,id)`, unique canonical DM participant pair per company, membership references to `(company_id,user_id)`, durable join/leave intervals and sequence history boundary. Version roster/policy edits; archive stops sends.
- [ ] Separate lightweight current membership lookup from `access()`'s full company directory load. Lists paginate within authorized SQL predicates; cursors bind company/user/conversation and policy version, and never grant access themselves.
- [ ] Establish global lock order: optional company business lock → current session row → company membership rows sorted by ID → conversation rows sorted by ID → conversation-membership/message/action rows. Ordinary chat omits the company lock. Send/read holds shared session/company-membership locks through its authorization transaction; revocation updates conflict on those rows. Conversation removal and send both lock the conversation row before checking participant state.
- [ ] Update membership mutations to use the same ordering and append a scoped revocation intent. A send committed before removal can remain history; one ordered after removal must fail. Revalidate active session and membership inside the transaction, not from `s.access` snapshots. Do not acquire a company lock while already holding a conversation lock.
- [ ] Test both deterministic lock orderings using barriers/separate native connections; hold company A's business row lock and prove permitted chat traffic need not wait on it. Check company B is independent and no deadlocks arise across conversion/removal.
- [ ] Run native/SQLite tests, migrate a populated v2 fixture and prove all work/finance records unchanged. Review policy before enabling private conversations.

### M2 / Task 3: Durable messages, replay and realtime transport

**Files:** Create `messages.go`, `communication_outbox.go`, `communication_sync.go`, `communication_stream.go`, corresponding `_test.go` files; modify standalone streaming route setup and Encore raw adapter; extend migration 3 before it is released, or add a new numbered migration once M1 has shipped. Never amend an already-applied migration.

**Consumes:** M1 access/lock order. **Produces:** `SendMessageInput{ClientMessageID, Body, ReplyToID}` → `Message{ID, Sequence, Revision, CreatedAt}`; `GET /conversations/:id/messages`, `GET /conversations/:id/sync`; `RunCommunicationOutbox(ctx context.Context, limit int) (int,error)`; `/communication/stream` hints containing authorized event/conversation identity, without message/task/expense content.

- [ ] Write `TestMessageRetryPayloadConflict`, `TestAcceptedSendSurvivesRestart`, `TestConversationSequenceConcurrentSend`, `TestOutboxCommitRollbackAndWorkerRetry`, `TestSyncEditsRemovalsAndStaleCursor`, `TestStreamRevocationAndOrigin`. Assert same actor/key/body returns one ID after lost response; changed body gives 409; revoked actors cannot replay a formerly successful result.
- [ ] Persist unique `(company,conversation,sender,client_message_id)` request hash and result; allocate sequence under conversation lock; message/revision/event/outbox commit in the same GORM transaction. Reject empty or >10,000 Unicode-scalar bodies, validate same-conversation reply parents and authorized history. Never ACK before commit.
- [ ] Maintain an event cursor for edits/deletes/membership events separately from message order. Durable tombstones, revisions and monotonically increasing read cursors survive restart. Expired cursors explicitly request a full authorized refetch; authorization filters precede page limits.
- [ ] Implement leased outbox claims with retry/backoff and event-ID deduplication; dead workers can be reclaimed. Reauthorize recipients at delivery and content fetch. Subscription membership cached at socket join is insufficient. Bound slow-client queues and disconnect/refetch on overflow.
- [ ] Use exact origin allowlists on socket handshakes, even though existing `ServeHTTP` permits GET handling. Cookie/session expiry/revocation must stop delivery; no credentials in URL. Recheck before enqueue, with defined ordering against revocation; already authorized bytes in transit cannot be recalled.
- [ ] Give streaming routes their own timeout/heartbeat configuration while preserving ordinary HTTP limits. Test actual standalone and Encore through a local reverse proxy, disconnect/reconnect, process restart, response loss and backpressure.
- [ ] Verify no ordinary send/read-cursor/typing operation acquires `lockCompany`; test finance/task traffic continues while another conversation is busy. Gate multi-instance fanout separately; PostgreSQL remains the replay authority.

### M3 / Task 4: Timed deadline semantics across the existing product

**Files:** Create `backend/platform/deadlines.go`, `deadlines_test.go`, `frontend/src/data/deadlines.ts`, `deadlines.test.ts`; modify `models.go`, `tasks.go`, `automations.go`, `types.ts`, `TaskDrawer.tsx`, `metrics.ts`, `imports.ts`, `CalendarWorkload.tsx`, `GoalsReports.tsx`, `demo.ts`, existing tests; add the next numbered paired deadline migration (planned version 4 if 3 is released first).

**Consumes:** Existing task creation/edit/import/review/recurrence. **Produces:** API `deadlineMode: "all_day"|"timed"`, `dueAt` UTC RFC3339 or `""`, `dueTimezone` IANA or `""`, plus immutable `originalDeadlineMode`, `originalDueAt`, `originalDueTimezone` and existing `originalDueDate`; Go `validateDeadline(t *Task) error`, `taskOverdue(t Task, now time.Time, companyZone string) bool`; frontend `isTaskOverdue(task: Task, now: Date, companyZone: string): boolean`.

- [ ] Write legacy-all-day preservation, deadline-at-16:00, original-instant, stale-edit, bulk-import/export-roundtrip, company-timezone-change and DST tests. Use fixed clocks. `2026-10-14T16:00:00+05:30` must normalize to `10:30:00Z`; completion at that instant is on time, later is late.
- [ ] Add nullable native instants and zone/mode constraints; serialize absent values as existing API conventions require. Backfill legacy mode only; all historical original instants stay empty. Enforce `dueDate == dueAt in dueTimezone` for timed commitments.
- [ ] For all-day mode use company-local date semantics. For timed mode compare instants; keep its timezone snapshot when company timezone changes. Require a reason for any mode/date/instant/zone change; preserve the entire original tuple. An all-day-to-timed edit must not invent an original historical instant.
- [ ] Reject local-time gaps; folds require explicit UTC offset. Test `America/New_York` 2026-03-08 02:30 gap and 2026-11-01 01:30 fold (UTC−04:00 and UTC−05:00 give different instants). Reject incompatible zone/offset pairs. Initially reject timed recurrence explicitly, preserving every all-day recurrence path.
- [ ] Extend forms, filters, calendars, original-commitment acceptance metrics, reports and CSV together. Group timed calendar entries by display company timezone while displaying the commitment timezone; calculate original all-day acceptance using original date semantics and original timed acceptance against original instant.
- [ ] Keep existing all-day reminders; for timed work issue one approaching reminder within 24 hours and one overdue event per deadline revision, then at most one late reminder per company-local day. Persist claims and skip revoked owners; rescheduling must not reuse the former commitment's claim.
- [ ] Run backend/frontend targeted tests, full current suites and real HTTP/browser creation/edit/import checks. No conversion UI advertises time support before this gate passes.

### M4 / Task 5: Evidence invalidates stale task decisions

**Files:** Modify `collaboration.go`, `tasks.go`, `frontend/src/components/TaskDrawer.tsx`, `frontend/src/store.tsx`, demo upload behavior; add `backend/platform/task_evidence_test.go` and rendered frontend tests; update API/security documentation.

**Consumes:** Existing upload validator and expected-version review. **Produces:** `appendTaskEvidence(tx *gorm.DB, a *access, taskID string, file Attachment) error`, usable by uploads and conversions; atomic evidence append + task version increment + authorized reviewer notification.

- [ ] Write `TestTaskEvidenceInvalidatesOpenReview`, `TestAcceptedTaskRequiresReopenForEvidence`, `TestDiscussionDoesNotApproveTask`, and publication rollback tests. Reviewer at version N must receive 409 after new evidence at N+1; current reviewer can then inspect and decide.
- [ ] Implement evidence version bump in the company-locked transaction. Accepted work must explicitly reopen before adding decision evidence; ordinary comments remain discussion. A conversion attachment must use this helper rather than directly inserting rows.
- [ ] Preserve safe-file allowlist, viewer denial and scoped downloads; keep expense receipt behavior and independent finance transitions unchanged. Refresh rendered reviewer state and mirror semantics in explicitly labeled demo.
- [ ] Verify native concurrency: upload vs approve has a serialized, reviewable result; no newly added evidence is silently accepted under an old view. Run existing task/finance suites and receipt-stale-decision tests.

### M5 / Task 6: Explicit, atomic message-to-task publication

**Files:** Create `communication_conversion.go`, `communication_projection.go`, corresponding tests, `frontend/src/components/MessageTaskConversion.tsx`; modify task drawer initialization and business-link projections; add paired work-link/action migration (next unused version); update API contract.

**Consumes:** M1 access/forwarding policy, M2 exact message revision, M3 deadline validation, M4 evidence helper; existing `makeTask`, `validateTask`, `a.canCreate`, `setWorkflow`, `insertTask` under business transaction.
**Produces:** `POST /conversations/:id/task-conversions/preview` and `/task-conversions`; `ConversionInput{retryKey, anchorMessageId, actionId, sources:[{messageId,revision}], task:CreateTaskInput, publication:{excerpt,attachmentIds}, expectedPolicyVersion}`; result returns a task only when current task access permits it. Preview reports current task audience and publication consequences, not authorization.

- [ ] Write `TestConversionSourceAndAssignmentAreIndependent`, `TestPrivateConversionPublicationDenied`, `TestSourceRevisionConflict`, `TestConversionRetriesAndPrimaryAnchor`, `TestHiddenLinkedTaskProjection`, `TestConversionRollback`. Assert a chat reader cannot assign outside existing authority; viewers cannot convert; source readers lacking task access receive no task ID/title/count.
- [ ] Preview the broader existing audience: leadership/viewers, owner/creator/reviewer/collaborators and applicable department/manager scope. Disclose that future roles/reporting changes can change this audience. A personal reminder remains private; current tasks are not confidential records.
- [ ] At commit acquire the company business lock before session/membership/conversation locks; reload role, source revisions/history/forwarding policy, active owner/reviewer and destination references. Reject changed revisions/policy with 409; do not trust preview, supplied source author or client-computed audience.
- [ ] Persist separate unique retry `(company,actor,operation,retryKey)` + canonical payload hash and primary `(company,anchorMessageId,serverActionId)` claims. Default action is `primary`; splitting gets explicit server-created bundle action IDs. A vs A+B context selection must still claim A's same primary action. Concurrent colleagues create one primary task; changed retry payload conflicts. Do not disclose inaccessible linked task existence through deduplication replies.
- [ ] One transaction records claims, existing-engine task, immutable provenance revisions, selected permitted excerpt/evidence and scoped outbox events. Protected source context is accessed through a separate authorized endpoint, not serialized into broad workspace/activity. Titles, summaries and filenames are publication too; a deny policy forbids conversion that publishes any derived source content.
- [ ] Render task cards per current viewer via `a.canRead`; finance cards use finance authorization separately. Late source edits show an authorized indicator and never change commitments. Source deletion removes normal access; published excerpt remains an independent declared work record, with that consequence shown before creation.
- [ ] Test response loss, replay after removal, two converters, rollback after evidence failure, source edit/removal during preview, changed audience and no-self-review preservation on native PostgreSQL. Run all task/finance regressions and rendered conversion tests.

### M6 / Task 7: Usable daily text communication

**Files:** Create `frontend/src/communication/types.ts`, `api.ts`, `store.tsx`, `Connect.tsx`, `MessageList.tsx`, `Composer.tsx`, `Connect.test.tsx`; modify `App.tsx`, `types.ts` navigation; create backend reaction/thread/search/save/reminder modules and tests; add versioned migrations as needed.

**Consumes:** M2 paginated history/events and M5 conversion. **Produces:** DMs/groups/channels, quote/thread/reaction/edit/remove, draft/queued/accepted states, mentions, unread/read cursors, private save/remind, PostgreSQL authorized search and task discussion links to existing comments.

- [ ] Write rendered tests for company switch during fetch, old response after logout/removal, optimistic-send retry and reconciliation, visible source revisions, source/task audience mismatch, rejoin quote filtering and safe formatting.
- [ ] Keep communication query keys scoped by user/company/conversation/history epoch. Cancel/drop prior generations on logout/company switch/revocation; do not merge messages into the full-workspace polling response. Disable private/finance offline content caches initially; ordinary future managed caching uses the blueprint's at-most-24-hour check window only after explicit policy support.
- [ ] Add server-authorized thread/reaction/search/read/save/reminder APIs. Search predicates include current membership/history before ranking/limit/snippets; hidden roots and filenames stay hidden. Thread access never exceeds parent access. Private saves/reminders are owner-only and do not create taskless broad activity text.
- [ ] Give edits/deletes optimistic versions and immutable sender; pin/moderation rules use conversation role. Group-wide mentions are permissioned/rate-limited. Queue failures show explicit reason and preserve draft, not false acceptance.
- [ ] Test independent browser sessions, reconnect, refresh, new/rejoined member windows, blocked DMs, archive, keyboard focus and responsive navigation. Acknowledge this is text pilot capability, not full replacement.

### M7 / Task 8: Media lifecycle and explicit publication

**Files:** Create `communication_media.go`, `media_storage.go`, `media_jobs.go`, tests, frontend media/voice components; add media/grant migration and private storage/scanner deployment configuration.

**Consumes:** M1 authorization, M2 outbox, M4 evidence versioning, M5 publication. **Produces:** `MediaStore` operations for quarantine/read/published-copy/delete; reserve/upload/finalize/download endpoints, scan-state metadata and explicit audience grants.

- [ ] Write cross-company/private/history-revocation download, renamed-type, size/quota, scanner-failure, abandoned-upload cleanup and publication tests. Unscanned/quarantined media must never render/download normally.
- [ ] Finalize only verified type/size/hash + successful scan; expiration cleans unused objects. Set product limits after inventory; preserve current 10 MiB task/receipt controls. Photos/voice/video introduce a new tested allowlist and cannot reuse the existing PDF/image/text validator unchanged.
- [ ] Authorize at download, including thumbnail/transcode paths; use a gateway for sensitive bytes. Signed URLs have declared residual lifetime if allowed; they do not prove immediate revocation. Publish a selected immutable copy/version to work only through M5, with safe filename/provenance.
- [ ] Add recording preview/cancel/playback and media progress/retry controls; test interrupted uploads, repeated finalize, removal during scan and review invalidation. Keep existing task/finance database blobs compatible.

### M8 / Task 9: Devices, attention and organization lifecycle

**Files:** Create `communication_devices.go`, `communication_notifications.go`, `offboarding.go`, tests, native client foundation and push adapters; modify membership/password/session lifecycle hooks; add device/preferences migration and operations runbooks.

**Consumes:** M1 revocation, M2 events, M6/M7 daily flows. **Produces:** Session-bound device registration; minimal push hints; current-authorized inbox projections; company/global offboarding workflows with ownership handover.

- [ ] Test company-only removal preserves other memberships; global departure revokes all sessions/devices; stale push jobs and cached tokens cannot retrieve private content. Session expiry/password reset also disconnect delivery paths.
- [ ] Push contains minimal private/finance previews and does not assert device delivery. Honor working hours, mute/mention policies, monotonically tracked recipient acknowledgements and cross-device deduplication. Notification targets are typed/scoped, never unguarded generic text.
- [ ] Implement join/provision/owner handover/archive/recovery and audited exports; define retention across revisions, derived indexes, grants and backups. Select and test identity/recovery/MFA before team launch.
- [ ] Test real Android/iOS foreground/background/locked/disabled-notification/network-loss states. Record cooperative offline-access limitations and clear managed caches at the next policy contact; do not claim remote erasure of copied files.

### M9 / Task 10: Calls and full daily replacement gate

**Files:** Create `communication_calls.go`, `call_provider.go`, tests, native/web call UI; provider/TURN configuration and device-validation runbook.

**Consumes:** M8 identity/devices and M1 conversation scope. **Produces:** Call records, authorized token issuance/removal, audio/video/screenshare/missed-call outcomes and explicit recording controls.

- [ ] Before selecting provider deployment, demonstrate removal plus cached/refreshed-token rejoin denial with its actual semantics. Short expiry alone is insufficient. Avoid opaque but accessible foreign room identifiers.
- [ ] Grant only necessary publish/subscribe rights; moderator/recording permissions are separate. Test founder nonparticipant denial, departed device, interrupted call, headset/Bluetooth, OS call integration, native background restrictions, TURN networks and desktop screen sharing.
- [ ] Recordings/transcripts are opt-in with visible notice, correct audience and retention. Do not infer text persistence or searchable messaging from the media transport.
- [ ] Gate cutover on actual physical-device/network results and fallback reasons, not a provider accepting tokens.

### M10 / Task 11: Structured communication and finance bridge

**Files:** Create `communication_acknowledgements.go`, `communication_polls.go`, `communication_decisions.go`, `communication_requests.go`, `communication_finance.go`, tests and associated frontend forms; add versioned audience/action tables.

**Consumes:** M5 disclosure/deduplication and M7 media grants; existing finance creation/transition engines. **Produces:** Exact-revision acknowledgement requests with fixed recipient audience, polls/events/RSVPs, reviewed decisions, explicit operational intake, safe expense-draft/link actions and permission-filtered leadership summaries.

- [ ] Material edits require new acknowledgement revision; roster changes do not rewrite historical recipients. Poll votes/reactions/read receipts never call approval/payment/review endpoints.
- [ ] Expense conversion creates only a user-reviewed draft with permitted evidence. Revalidate finance scope, amount/date/category, current expense version and independent authority at existing decision screens. Future requested cost is not an incurred expense.
- [ ] Test foreign/hidden expense cards, receipts, invoice duplicates, budget overrides, stale evidence and no-self-approval/pay. Company leadership summaries use structured authorized work/decisions, not private DM harvesting.
- [ ] Add an explicit intake request with `open`, `assigned`, `resolved`, `cancelled` states, a responsible triage department and expected version. Creating one publishes only permitted selected content under M5 policy; free text does not become a request automatically. Assigning converts through the existing task engine and primary-action claim. Test unauthorized assignment, stale triage and duplicate processing; leadership's unowned-request age derives from visible open requests and their server creation times.
- [ ] Retain owner-only saves/reminders and safe publication for decision records; no generated summary bypasses source policy.

### M11 / Task 12: Operational cutover and later expansion

**Files:** Update operations, security, verification and user guides; create communication backup/restore/load/device/pilot runbooks and scenario fixtures. AI/guest/E2EE features need separate approved designs and plans.

**Consumes:** M8/M9/M10 production-like evidence. **Produces:** A measured pilot exit decision, repeatable operations/recovery and documented support/fallback ownership.

- [ ] Inventory internal groups/owners/media/device needs, provision destinations, move active commitments/files and nominate a source of truth per workflow. Agree an adoption target from measured baseline; do not report the blueprint's example 90% as current evidence.
- [ ] Load-test selected latency/concurrency quotas and multi-instance fanout, outbox-worker failure, acknowledged-message crash recovery and full backup restore of messages/memberships/links/media. Apply retention again to restored/derived data.
- [ ] Verify production TLS/origin/session/socket proxy, least-privilege database/object roles, configured cron/outbox workers, monitoring without private content and recovery objectives.
- [ ] Resolve real fallback reasons before internal group retirement; keep an outage support/phone route. Historical imports require authorized exports, preview/dedup and imported labels, not invented original delivery/read receipts.
- [ ] Evaluate optional transcription/reviewed AI, workflow builder, guests or E2EE separately with source/audience controls, consent, measurable quality and cost. Baseline task counts never become employee scores.

## Blueprint acceptance coverage

| Blueprint criterion | Owning tasks |
| --- | --- |
| 1–2 tenant/private existence and content | M1, M2, M7, M9 |
| 3–5 task authority/publication/derived leakage | M5, M6, M10 |
| 6–8 primary-action/retry/restart/replay | M2, M5 |
| 9–10 removal races/history/cache/derived scope | M1, M2, M6, M8 |
| 11–12 source revision and independently authorized cards | M5, M10 |
| 13–14 upload lifecycle and stale reviewer evidence | M4, M7 |
| 15–16 exact-revision acknowledgement and timezone/dedup | M3, M8, M10 |
| 17–18 narrow locks and actual runtime/proxy streams | M0, M1, M2 |
| 19–22 native delivery/calls/recordings/offboarding | M8, M9 |
| 23–24 restore/retention and honest demo claims | M6, M7, M11 |
| 25 timed deadlines end to end | M3, M5 |

## Review and handoff

One fresh-context whole-implementation review identified six Important issues, all reproduced and fixed in one pass with subsequent full regression checks. No Critical/Minor findings were reported. The original extraction had no Git metadata. The user subsequently requested a running app and a push to Schach-workplace; a new private source repository was initialized for that delivery, without fabricating prior history. Source changes and verification evidence remain in this workspace and the source release, with original migration hashes preserved. No production deployment or real-company migration was performed. External launch gates remain explicit in the implementation report and operations/native runbooks. The blueprint's advanced AI/guests/recording/transcription/E2EE/import features are separate expansion designs, not silently enabled product behavior.
