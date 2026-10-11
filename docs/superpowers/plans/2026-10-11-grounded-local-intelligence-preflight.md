# Adopted M10 implementation preflight

Current baseline `8f24b55ab168fb227cb4efe5915432937f968356`; SQL through 56, next 57. The dependency contracts below replace historical preparation placeholders. No acceptance completion asserted.

# M10 concrete dependency contracts on source-reviewed M9

Immutable M9 source8f24b55ab168fb227cb4efe5915432937f968356; acceptedM8 source05159ea505e13e9a332ad4d2afaacd495d0cce1a. Source-review gate task-9-fix4-review.md approves N2/N3/picker/no new findings; N1 remains closed in task-9-fix3-review.md and originalR1–R6 in task-9-fix2-review.md. M9 actual native matrix remains independently executing; no milestone9 acceptance is asserted. Root may pause M10 writer for any load-bearing native9 defect, assign sole source ownership to appropriate fixwriter, review/reconcile, then resume. Source development can overlap frozenfixture acceptance; merge/publication/main restart remain gated on all10 actual owning checks.

## Source producer → consumer compatibility

Use exact immutable M8 table from task-10-final-m8-binding-preparation.md as binding replacement for the candidate's guessed measurement/hash/schema/evidence/planning rows. Preserve all10 slices/49 unchecked cases; do not consume provisional M9 claims from that old note. M8 measurements have NO persisted ContentHash/SchemaVersion: new M10 adapter canonical hash/schema covers exact selected immutable fields and evidence. Redacted goal history is NOT ALL root authorization. Snapshot picker hash differs from wrapped goal_evidence_v1. Planning projectionBasis binds all actual tasks/references/capacity including outside filters; Calendar readBasis is authority only and Calendar is no new source kind. Goal.Current has no inference write.

Actual M9 private User.SessionEpoch/SessionRecord.SessionEpoch are positive; Membership.Version/AccessEpoch public memberAccessEpoch and Company.PermissionEpoch separate. M10 immutable durable capturedUserEpoch binds private actualUser epoch, never memberAccessEpoch/readBasis. withPeopleAccessTransaction/withCompanyAccessFence in permissions.go take actual Company UPDATE→sorted captured Sessions→complete Membership UPDATE→strongest complete sorted Users→Conversations/calls→dependents. Predeclare current/original lock sets; no late earlier-class lock/SHARE→UPDATE widening. Fenced PG requested RepeatableRead converts ReadCommitted only within that entry.

currentAttentionActorLocked in attention_access.go takes NO Company lock. Worker explicitly lockCompany first, then sorted Membership/User fences. financeOriginalSession in finance_receipt_intakes.go reads fresh nonlocking actual Session→User→activeMembership under already-heldUser fence; session deletion/revocation writers lock User UPDATE. Reuse proven no-lateSession strategy, not fabricated HTTPworker/auth role.

M9 R1 FinanceAssistanceJob.ProducerSessionEpoch is invocation-local gorm:-/json:-, captured once before source byte fetch and carried through provider/final fences, including preserved currentSession hash after password epoch update. It resolves a phase interleaving; it is NOT M10 durable capturedUserEpoch and does not retroactively redefine readyM7 preservation semantics. M10 independently validates originalsession expiry/revocation AND durable capturedUserEpoch across queued/ready/pre-input/final/read/replay/new publication. NewSession/rejoin cannot revive raw intelligence.

invalidatePeopleOutputs in permission_revocation.go holds Company fence and permanently retires recipient AND SavedReportDefinition-owner queued/running/ready ReportExportJobs, ready artifacts, pending intents, pauses departing-owner schedules. Persistent access_changed plus current chunk/final canonical denial ensure nonrevival. Independent immutable snapshots/retained business records preserve ordinary current ACL. Add M10 cancellation/output retirement to that actual adapter and separate account/session-only originalepoch predicate; do not erase independent task/finance/goal histories.

One shared/business/attempts.ts existing scoped map, begin/read/mark/retire/filterBusinessAttemptsForGraph/hard generation and positive actual ActorBasis. Qualifying submitted unknown canonical attempts alone survive graph-only invalidation with exact original target/dependencies/body/key/CAS; undefined actor quarantines/blocks send; actual actor/source/interval loss hard-clears and fences delayed callbacks. Matching mark clears payload BEFORE callback. Register new intelligence and actual ordinary/tasks canonical adapters explicitly, no second store. tasks.go createTask already has optional retryKey→businessMutation task_create with authorizeIntent BEFORE canonical lookup, exact first-write checks inside apply and result ACL; don't duplicate task engine. Native capacityInput is UI-only authored text in existing scopedRAM, stripped before frozen/API payload, not a global DTO producer.

M9 SQL inventory through56:112 paired up/down files per mirror, exact backend/Encore equality,1–49 immutable. task-10-m9-reviewed-source-binding.json checks immutable head and allhashes. M10 starts unused57 after inspecting current filenames; never edits applied SQL. M9 device-only checks will not modify source; if a bug requires source correction root controls ownership pause.

## Resolved product/protocol ambiguities

RawTTL min24h and all source effective content/retention/capability expiry. A business timed TaskDueDate is NOT raw-content expiry. Preserve original task deadlines separately.

The candidate Task1 says commit aftercontrollerreview while laterinternals saycommit independently. Adopt one sole M10writer executing10dependency-orderedslices, focusedgenuineRED/GREEN+selfreview/internalcommits, ONE independent wholemilestone cleanhandoffreview. No helpers/reviewers/parallel productwriters. All49cases remain binding, finalbroad branchreview separate.

Prepared providers already installed/pinned; reuse provider-reproducibility-preparation.md and candidate exact manifests. Python3.14.7 /tmp/schach-improvements-ai-venv/bin/python, faster-whisper1.2.1 int8CPU/beam5/VADfalse/offline tiny fixedmodel /tmp/schach-improvements-ai-models/whisper-direct; Ollama0.40.2 loopback11435 qwen3:4b pinnedmanifest/GGUF; same injected Options.LocalProviderBudget as OCR. No download/cloudfallback/second semaphore. Selected audio WAV/M4A/WebM exactlyone cleanattached explicitoptin+bounded ffprobeaudio-only/decode; no livecalls/video extraction/historical consent. Fixedprovider realapplication acceptance remains M10 requirement; oldpreflight is no newproof.

## Reviewed M9 fixround4 producer reconciliation
Onboarding TemplateTaskPreview captures ordered checklist:string[] independently of fields. Explicit[] means no requirements; missing/nulllegacy capture is unresolved and requires deliberate freshreview. The firstapply callback rejects undisclosedlegacy409 before businesscreation; alreadycommittedcanonical replay remains currentACL-authorized. No previewchecklistIDs/currenttemplate substitution/SQLbackfill/secondengine. Existing regulartemplatefields/application unchanged.
Nativeexecution reads actual existing=readAttempt(registry) then beginAttempt(existing?.payload??payload). Explicit synchronous abandon clears registry and correctednewpayload/key is captured; unabandonedunknown frozenintent/key/target/dependencies/CAS remains exact. SharedbeginAttempt rejects changedintent, notsilentlyreplace; staleReactbusiness.attempt is never frozenauthority afterabandon. Oneexistingmap/hardgeneration/currentACK unchanged. Webadapterunchanged.
PeopleChoice inmodal neutralpendingstatus is a siblingoverlay outsidewithheldprojection with zeroheight contribution, preserving search/geometry and withholding fetchedlabels. Actualaffectednative8f24 checks pending; prior334matrixsourcequalified. M10solewriter mayoverlap reviewedfrozenfixtureacceptance but bothmilestoneacceptance/mainintegration remaingated.


## Shared file ownership and interface compatibility

Every entry below is an integration point with a named owning slice. Sole implementation writer applies sequentially; overlap is coordination, not authorization for concurrent writers or duplicate engines.

| Shared file/interface group | Slices | Required consistency/order |
| --- | --- | --- |
| `intelligence_models.go`, request/result/source types; `shared/intelligence/types.ts` | 1,2,3,4,5,6,7,8,9,10 | T1 defines discriminants/hash/schema, T2 persists; adapters never trust provider-final objects; T5 validates; all clients consume same union. |
| `intelligence_sources.go`, SourceManifest, SourceCheckMode | 1,2,3,5,6,7,10 | Exact-current for raw/live/new writes; current-ACL replay preserves minimal provenance; immutable IDs/hash do not compare current parent versions; ALL expanded roots ≤1000. |
| `intelligence_jobs.go`, reads, lease/cancel/result | 2,3,5,7,8,9,10 | One durable canonical job engine; owner scope/current original sessionRef/UserEpoch; no raw read before complete authorization; T7 replay uses publication metadata after scrub. |
| `server.go` Options/routes/Migrate; both migrations; standalone/Encore startup/Stop | 1,2,3,4,5,7,10 | Next SQL after M9; shared configured budget option exactly once; distinct worker; unavailable provider leaves manual app usable; both adapter lifecycle proofs. |
| `local_provider_budget.go`, M7 finance OCR/runtime | 3,4,10 | Reuse actual `LocalProviderBudget` interface and Options instance, no new semaphore or transaction across admission wait; stop joins; multi-process gate open. |
| Provider DTOs/fixed Python/Whisper/Ollama, scratch lifecycle | 3,4,5,10 | Trusted manifest keys only, bounded candidates; cancellation and lease loss cleanup; no source retriever/tool authority/provider paths from text; real provider evidence separated from controlled fakes. |
| `intelligence_schema.go`, facts/templates | 1,4,5,6,7,8,9,10 | Output bounds and citation enum exact, strict decode before commit, server-rendered math/labels, never nullable missing fields guessed by current user/time. |
| M6 `report_history*`, `report_facts.go`, `report_reads.go`, `shared/reports/types.ts` | 1,2,5,6,8,9,10 | Bind exact actual ContentHash/fact/row/metric/request schema; source roles all pages; current snapshot separate5min TTL; not rebuild historical facts from current task data. |
| M7 `finance_assistance*`, receipt acceptance/intakes/evidence/retries | 1,2,3,5,6,7,8,9,10 | Source owner/sessionRef/generation/hash/current finance scope plus M9 epochs; explanation only, existing extraction human acceptance owned by finance; independently retained evidence intact. |
| M8 goal ledger/planning/method/reminder helpers and UI | 1,2,5,6,8,9,10 | Exact accepted names after M8; immutable measurement and independent evidence ACL, live projectionBasis; no Goal.Current or task acceptance mutation. |
| M9 current actor/session/User/company epoch/lock entry and departure invalidation | 1,2,3,5,7,8,9,10 | Different current/original session keys predeclared; no late Session lock; ALL ready/export/intake/evidence SQL filters before LIMIT; current sources remain authoritative. |
| Existing communication conversion/finance/intake/export and M5 businessMutation/attempts | 1,2,5,7,8,9,10 | Source current ACL prelookup and exact basis in first apply; full roots and fresh audience human review; source-derived seed never detached via manual toggle; successful published business survives raw TTL only by ordinary ACL. |
| Communication retention/message/record/comment/task/expense/live goal mutation hooks | 1,3,5,7,8,9,10 | Cheap reverse-index invalidation is mode-aware; purge/removal and ACL loss always win, immutable parent edits do not destroy historical meaning; authoritative reads backstop missing hints. |
| Shared selection/resultLifecycle, scoped RAM/attempts | 1,2,5,7,8,9,10 | Frozen known/unknown intent, abort/generation scope, hide pending fetched result, do not silently rebase expected versions; geometry retains numbers only; no private text persistence. |
| Web Connect/Media/task/report/goal forms and actual query hooks | 8,10 | No technical-ID fallback/HTML-generated arbitrary navigation; both normal and withheld/manual/error flows usable; current source navigation and explicit human confirm. |
| Native Workspace/Page/useRamInput/Publication/Media/routes/More | 9,10 | Expo major docs at implementation, app/ only routes; real current-query ownership, background clears fetched output/geometry, scoped authored draft recovery per accepted rules; no raw Text/whitespace. |
| Operator/verification docs, reproducibility/evidence/rulings | 3,4,10 | Fixed manifests, actual commands/exits/identity/settings, no stderr/prompt/audio/private output/secrets in logs; historical preflight explicitly labelled; physical/privacy/license/India/quality/capacity/recovery gates open. |

## All slice-pair preflight

All45 unordered pairs are checked. “Ordered” means later slice consumes the earlier reviewed contract under one writer; no stale draft alternative is kept. The contract/file group table above resolves all common source files, even when the pair table names one representative surface.

| Pair | Shared interface/file or independent boundary | Preflight resolution |
| --- | --- | --- |
| 1–2 | Selection/SourceManifest; models/schema | Ordered: T1 capture/hash/preview before T2 enqueue; same expected values and closed source modes. |
| 1–3 | SourceManifest/current authorization | Ordered: Claim/pre-input/final reuse same capture/authorize semantics with accepted M9 lock entry. |
| 1–4 | Selected audio/text keys | Ordered: Provider receives bounded authorized bytes/data only, no DB/retrieval; audio exactly WAV/M4A/WebM ffprobe audio-only. |
| 1–5 | Source modes/hash/reverse index | Ordered: Mode-aware invalidation/ALL current ACL; immutable parent edits kept, changed immutable artifact or private ACL denied. |
| 1–6 | Fact keys and producer schema | Ordered: Use real M6 fact/metric IDs and ALL roles; M8 exact helpers pending; never old/current TaskVersion compare. |
| 1–7 | Complete roots/current-ACL replay | Ordered: No source/citation removal sanitizes prose; only single conversation or business-only publishable. |
| 1–8 | shared DTO/selection and preview | Ordered: Actual picker/source revisions; no auto expansion, ID field or client-authored manifest trust. |
| 1–9 | Same shared DTO/selection | Ordered: Company-qualified native route; app source scope independent of current chat/bootstrap. |
| 1–10 | Selection/source fixture basis | Ordered: Actual owned app upload/preview/opt-in observes exact parent/media hashes; public speech provenance remains public. |
| 2–3 | Jobs/leases/options/migrations | Ordered: Enqueue durable schema before claim; owner original sessionRef/UserEpoch and quotas verified each phase. |
| 2–4 | Provider identity/effective request hash | Ordered: Freeze server settings per job; config/model drift unavailable, never rebind same key or autodownload. |
| 2–5 | Job result/read routes/status | Ordered: Safe no-store owner status without snippets; raw result load only after ALL current authorization and expiry. |
| 2–6 | Fact selection/job bindings | Ordered: Current snapshot5min inherited TTL separate immutable snapshot identities and current ALL ACL. |
| 2–7 | Canonical job vs business retry | Ordered: One source job identity; accepted M5 businessMutation/communication retry creates business only after reviewed confirm. |
| 2–8 | API/client enqueue/status | Ordered: Unknown transport retry retains key/intent; changed payload conflicts, stale/source denial hides output. |
| 2–9 | API/native client route | Ordered: Same contract and scoped query AbortSignal; no stale company response or remount duplicate. |
| 2–10 | SQL/API/runtime acceptance | Ordered: Both standalone/Encore real isolated migrations+TCP; actual uniqueness/rollback, not fake-only proof. |
| 3–4 | Budget/provider/cancel/runtime | Ordered: SAME Options.LocalProviderBudget shared OCR/Whisper/Ollama; no lock during budget/inference, Stop joins wait and subprocess. |
| 3–5 | Lease final compare/cancellation | Ordered: Lease token/cancel/source+epoch authorizes commit; old worker cannot persist; raw scrub and temp cleanup bounded. |
| 3–6 | Worker facts capture/render | Ordered: Facts authorized before input/final commit; model cannot query broader company or calculate authoritative money. |
| 3–7 | Ready vs published result | Ordered: Fresh first write requires exact ready result; canonical replay never waits for/recreates provider output. |
| 3–8 | Job polling/cancel/availability | Ordered: Poll active scoped view only, disabled provider/manual states; pending fetched text hidden. |
| 3–9 | Native active route/cancel/background | Ordered: Focus/foreground/epoch cancel/hide; original captured session checks not replaced by newer session. |
| 3–10 | Both runtime adapters/budget races | Ordered: Block provider while communication progresses; actual concurrent max1 shared slot, cancel during wait/real infer and temp cleanup. |
| 4–5 | Raw candidate/strict decoder | Ordered: Adapter bounds before schema validation; duplicate keys/trailing fields/IDs/unsafe numbers reject, no ready/business leak. |
| 4–6 | Explanatory candidate codes | Ordered: Provider selects allowlisted fact/relation/code; templates use deterministic exact numeric facts only. |
| 4–7 | No action/tool authority | Ordered: Provider DTO lacks writes/tools; action candidate inert until existing human review. |
| 4–8 | Safe provider status/manual UI | Ordered: No path/stderr/secrets/raw HTML; unavailable/overflow manual/reselect path remains functional. |
| 4–9 | Same native safe status | Ordered: No technical-ID fallback or native share bypass; local opt-in separate recorder permission. |
| 4–10 | Real pinned provider/compatibility | Ordered: Revalidate all hashes/versions; actual app adapter controlled JSON/citation/full context/overflow/cancel evidence, no download. |
| 5–6 | Schema/facts/ALL source read | Ordered: Historical immutable hash + current ACL; unsupported causal/numeric claims reject, no denominator invention. |
| 5–7 | Result scrub/publication provenance | Ordered: Scrub raw ready text; retain minimal source/canonical metadata; replay current original source/result ACL only, exact first-write apply. |
| 5–8 | Result invalidation/query lifecycle | Ordered: Whole output hidden pending/current denial/outside page; no snippets/persisted text; scoped authored RAM distinct. |
| 5–9 | Native source withholding/RAM | Ordered: Whole raw output unavailable offpage revocation; background/resume epoch gates; no raw RN text or native export bypass. |
| 5–10 | End-to-end revocation/temp privacy | Ordered: Before input/final/read races incl original session+rejoin, retention no revision bump and malicious source; inspect sanitized logs/scratch. |
| 6–7 | Deterministic facts versus business intents | Ordered: Explanation no goal/finance/task acceptance writes; labelled candidate fields remain human reviewed with normal validators. |
| 6–8 | Web fact/citation UI | Ordered: Period/zone/coverage/current vs historical/method labels visible; exact authorized provenance opens via existing route. |
| 6–9 | Native selected facts/citations | Ordered: Actual report/goal entry route and readable labels/pickers; no technical-ID selection fallback. |
| 6–10 | Actual producer fact fixture | Ordered: Accepted M6 fictional snapshot money/report facts and M8 goal/capacity semantics byte-equivalent; no provider arithmetic assertion. |
| 7–8 | Web human draft seed/attempt | Ordered: Complete source-bound seed into real audience preview; no unresolved owner defaults; committed result before refresh, unknown retry frozen. |
| 7–9 | Native Publication/ordinary form | Ordered: Same current audience and explicit confirm; scoped remount/background unknown attempt, real person/date/money controls. |
| 7–10 | Canonical application proof | Ordered: Human task/draft expense/intake flows+lost ACK/concurrent same key exactly one business result; source changes after success vs before first write. |
| 8–9 | Shared DTO/lifecycle/attempts | Ordered: Neutral shared reducer/DTO reused with both actual platform hook/route integration coverage, no duplicate business logic. |
| 8–10 | Browser acceptance script/screenshots | Ordered: Desktop320/390/430, real selection→provider→review→retry/manual path; ≥30s withheld-fetch editor focus/keyboard/geometry and no private text. |
| 9–10 | Native export/runtime acceptance | Ordered: Actual route/available emulator/≥30s keyboard-current-fetch evidence; Android+iOS exports; physical/iOS behavior/signing remains separate rollout gate. |

## Acceptance limits that cannot be collapsed

- Provider fixture preflight validates loading/schema/decoding only. Actual app flow must observe current source/session fences, scanner attachment, validated JSON/citations/manual fallback, malicious quoted source with no tools/write/extra retrieval, deterministic facts, human audience publication and canonical retry. At least real provider cancellation/timeout/temp evidence complements controlled provider races.
- Prepared JFK WAV is a public test excerpt, not fictional private speech, company-language/Hindi production accuracy, microphone consent or actual app inference. Original public FLAC is not an accepted app voice upload. The prepared WAV is not currently uploaded/clean-scanned/attached/enqueued. Existing Ollama0.40.2 HTTP400 `exceed_context_size_error` is historical provider evidence; actual app mapping/full8192 context success needs fresh authorized M10 code proof.
- Strict bounds: audio25MiB/600s; text64KiB UTF8/20000scalars including labels; output64KiB/20000scalars; context8192/input6144/output1024; summary120s/voice180s; lease240s/renew15s; attempts3/backoff5s/30s; TTL24h/min source; actor10/company100 pending; selected50/expanded1000. Character counts are not token proofs. No truncation/chunk/drop/cloud fallback and `truncate:false`/`shift:false` remain authoritative.
- Current ALL-source ACL applies to immutable old facts and consumed private evidence. Original sessionRef+UserEpoch/current owner/company/expiry apply throughout M9 exact result/export/ready/intake/evidence integration. A rejoin/new session cannot restore old output. Independent retained published work uses its own current business ACL with source links independently scoped.
- No raw export/download/share/direct-copy convenience, cross-private business-create seed, automatic summary disclosure/post/notification, cloud model/tool execution, Goal.Current mutation, task independent acceptance or finance accept/submit/approve/pay/reconcile authority.
- Native/frontend gate requires usable explicit selectors/human review/current fetch withholding/scoped RAM/frozen intent/finite neutral geometry and ≥30s actual keyboard/focus/scroll evidence, no technical-ID fallback or RN raw Text/whitespace. Keep both call interfaces recording off.
- Physical Android/iOS microphone/focus/keyboard/screen reader/back/background behavior, signed distribution, India deployment/TLS/TURN/push/provider privacy/terms/license, package wheel/base-image provenance, Hindi/company-language grounding, measured context/RAM/CPU/p95/fleet capacity, backup/restore/recovery and production rollout are separate outstanding gates. Local one-worker process is not multi-instance coordination or production readiness.

## Review disposition

Preparation self-review retains all10 slices and49 unchecked acceptance steps; no checked step, implementation result or provider/application/test pass is invented. Source decisions were reconciled in the candidate's primary rows/mandates rather than appended alternatives. This preflight covers10 internals,17 shared ownership/interface groups and all45 slice pairs. No unresolved product-choice conflict remains. Required unresolved producer placeholders: `M8_IMPLEMENTATION_HEAD`, `M9_IMPLEMENTATION_HEAD`, `M9_LAST_SQL` and exact M8/M9 helper/DTO/lock/session/epoch reconciliation. Controller must fill those from final independent acceptance, then publish tracked plan and dispatch through the existing execution method; current preparation authorizes none of that work.
