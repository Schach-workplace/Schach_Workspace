# M10 reconciled preparation preflight

2026-10-11. Implementation preflight reconciled to accepted M8 `05159ea505e13e9a332ad4d2afaacd495d0cce1a`, reviewed M9 backend `8f24b55ab168fb227cb4efe5915432937f968356`, and reviewed client overlay `f2d39bf7ce3e98f4e6380e746400d6784d09bf27`. The controller explicitly authorized sole-writer implementation; independent whole-milestone review and native device acceptance remain separate gates.

## Authority and producer gates

Product decisions are resolved by `task-10-controller-product-freeze.md` and accepted Rulings: selected audio opt-in/audio-only, closed source modes, single-conversation complete-source reviewed publication, owner-only cross-private composite, no raw exports/copy convenience, lifetime/quotas and local resources. Earlier provisional defaults and M5/M6/M7 dependency claims are REPLACED in the candidate, not competing appended overrides. No genuinely missing product decision was found; controller action is producer acceptance/reconciliation, not an inferred new approval flow.

| Producer gate | Concrete binding to record before tracked final plan/dispatch | Current evidence/status |
| --- | --- | --- |
| M1–M7 accepted base | `e84d3a3`; actual source via gitshow; M7 interface/SQL47 included | Reconciled, no code acceptance newly asserted. |
| M8 | `05159ea505e13e9a332ad4d2afaacd495d0cce1a`, exact goal scope/version metadata helper, immutable ledger/correction/evidence hash/schema/ACL and planning projectionBasis/method/DTO/reminder producers | Accepted exact source contracts in the implementation plan. |
| M9 | reviewed backend `8f24b55` / client `f2d39bf`, exact original sessionRef/UserEpoch fields/helper/lock entry/company epoch/cancellation hooks; original/current different-session fencing and all output/read/worker SQL changes | Reviewed exact original-session/UserEpoch and complete output-retirement contracts; actual device gate remains controller-owned. |
| SQL | reviewed SQL56; next unused M10 mirrored SQL allocation after accepted predecessor migration inventories | M10 SQL57 already preserved in both mirrors; next unused58. Applied SQL1–56 remain immutable. |
| Producer helper reconciliation | Actual accepted M8/M9 names/signatures/DTOs plus accepted callback lock prerequisites in both standalone and Encore | Required before publication/dispatch; test names below are intended M10 acceptance, not run results. |

Actual accepted producers inspected: `Options`/`New`/`Migrate`; `LocalProviderBudget.Acquire` and same injected option default; `businessMutation` callback order and `BusinessResult`/`BusinessMutationRetry`; `shared/business/attempts.ts`; M6 historical models/reads/facts/access and current snapshot reads; M7 extraction acceptance/runtime/model/original-session helper; communication media sniffer/runtime; native `Media.tsx`; spec and Rulings. `task-10-provider-preparation.md` does not exist; the available exact reference is `provider-reproducibility-preparation.md` with `task-10-runtime-fixture-reconciliation-preparation.md` for prepared WAV/session limits.

## Ten internal slice checks

| Slice | Internal closure and exact risk | Acceptance evidence required after authorization | Preparation finding |
| --- | --- | --- | --- |
| 1 Selection/binding | Closed operations/fields/modes; server-only canonical request/source/result hashes; exact selected nested comment/record response bindings; no source expansion | Selection/NestedEvidence tests: stale same-Task.Version comment, independent record response/removal/purge, old immutable fact after readable parent edit, all-source evidence denial | Requirements retained; M8/M9 exact adapters gated. |
| 2 Enqueue/access | Durable company/actor/operation/key uniqueness; client intent vs frozen effective settings; original sessionRef/UserEpoch; owner-only no-store/status without snippets; bounded quotas/TTL; mirrored SQL | Enqueue/SourceAuthorization/Migration tests, PostgreSQL concurrent same key/lostACK/conflict, removed/quarantined/unattached source/ALL offpage report ACL | M5 canonical engine actual; no alternate retry table; SQL57 implemented and mirrored. |
| 3 Worker | Short claim/lease renew/final token; no transaction around provider/budget; cancel joins scratch cleanup; independent from communication serial tick | Lease/Worker races and both startup/Stop adapters; OCR+Whisper+Ollama SAME instance observed max1, cancel while waiting; changed original epoch before/after budget acquisition | Actual budget is interface via Options; no second NewLocalProviderBudget. Reviewed M9 company/current-user/original-session fences retained. |
| 4 Provider adapters | Fixed configured offline models/paths; literal loopback no proxies/redirects/URLs/tools/pull; bounded ffprobe then audio-only WAV/M4A/WebM; strict IO/deadlines/temp modes/hash/context | Whisper/Ollama/Temp/Context fake process/HTTP tests plus actual fixed adapter cancellation/timeout/temp and real overflow mapping | Exact package/model/WAV pins recorded; no current provider run/download. |
| 5 Validation/reads/retention | Strict keys/shape/numeric/citation/segment limits; final original/current/session/source/cancel/lease check; ALL output read; content scrub separate bounded file cleanup | Schema/Grounding/Read/Retention/Invalidation; source revocation beyond page, immutable ACL loss, rejoin, missed hint, no title/snippet/log/notification leaks | Immutable semantics differ from live freshness; ordinary readable parent edit alone keeps frozen fact; no resurrection. |
| 6 Deterministic explanations | Accepted M6 schema/metric values/fact IDs/coverage, M7 minor units, M8 measurement/capacity labels; allowlisted codes/templates, no arithmetic authority | DeterministicFacts/Explanation: exact-boundary original/current, missing denominators, episodes vs tasks, INR130050→1300.50, missing/zero/undated effort, malicious numeric output | M6 actual `ContentHash`+`authorizeHistoricalSources`; old TaskVersion/current equality forbidden. Accepted M8 exact producer DTOs retained. |
| 7 Publication/replay | Complete roots from one conversation; business-only M5 canonical; human audience/fields/review; exact validation in SAME first-write apply, current ACL prelookup/replay/result | ReviewedPublication/PublishedRetry; zero records before confirm; lostACK/concurrent exactly one task/draft expense/intake; changed key intent conflicts; source edit after committed write returns same current-authorized result | `businessMutation` calls authorizeIntent before lookup, so unconditional raw-ready exact check there would break replay; corrected. No raw output export/copy/post/goal/approval/payment. |
| 8 Web | Real selectors/media/transcript/task/report/goal entry; current fetch hides private details/actions; scoped authored RAM/frozen attempt and finite geometry preserve focus; no ID fallback | Actual components/hooks tests, existing publication/report/Connect suites, typecheck/build/demo; ≥30s held-fetch keyboard/focus/scroll trace and desktop/320/390/430 browser runtime | UI path retained; no claim reducer/static check proves real current fetch or geometry. |
| 9 Native | Actual company-qualified route/back/focus/foreground; `useAudioRecorder` supported installed Expo57; picker/review/44px/keyboard/large-text; no raw RN text | Actual route/client/provider/Publication/Media tests; typecheck/lint/Android+iOS export, available emulator; ≥30s current-fetch keyboard/focus/scroll trace with fetched result hidden | Native source uses Voice note.m4a/audio/mp4 while sniffer says video/mp4; no inferred consent. Both call UIs recording off. Physical/signing gates distinct. |
| 10 App+provider acceptance | Reuse prepared public JFK WAV; actual reserve/upload/scanner/finalize/attach/preview/opt-in→local worker→authorized result→summary/fact/action→human canonical write | Controlled malicious quoted sources/schema/citations/grounding, concurrent shared budget, cancel/temp/privacy/manual fallback; actual pinned providers and both standalone/Encore TCP/migrations; web/native end-to-end and retained retry | Historical CLI/schema/overflow preflight ≠ app adapter proof, private speech/accuracy/capacity claim. All future evidence unfinished. |

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
| 1–6 | Fact keys and producer schema | Ordered: Use real M6 fact/metric IDs and ALL roles; accepted M8 exact helpers reconciled; never old/current TaskVersion compare. |
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

Implementation preflight retains all10 slices,48 actual action-checkbox steps (the former 49 count included introductory syntax),17 shared ownership/interface groups and all45 slice pairs. Producer placeholders are resolved by the reviewed source binding and concrete contracts in the implementation plan. Provider preparation does not establish current application acceptance; each execution result is separately recorded with current source provenance.


Current resume: reviewed backend8f24, clientf2, restored M10 source/runtime commits598080e/3b76a96/af39129, and mirroredSQL57. Historical next57/pendingM9 descriptions are superseded by the reviewed round5 contracts. Provider provisioning evidence remains preparation only; current M10 application/runtime evidence is separately source-bound in task-10-report.md. Both bounded WIP stashes remain retained.
