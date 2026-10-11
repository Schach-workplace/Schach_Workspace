# Task 10 review — grounded local intelligence

## Spec compliance

**❌ Issues found. Task quality: Needs fixes.** The raw-expiry/canonical-retry integration, record citations, job-history pagination, deliberate action selection, and current-report explanation contract need correction. These affect adopted requirements 6.1–6.3, 7.2–7.3, 8.1–8.4 and 9.1–9.4; details and line evidence follow. No Critical finding was established.

This is the single Task 10 gate for BASE `8f24b55ab168fb227cb4efe5915432937f968356` through HEAD `4ced618d0a8454bbc1dc339519d9f9f539c73a70`, using `review-8f24b55..4ced618.diff`. It is not the final whole-branch review. The authoritative brief appendices, adopted implementation plan/preflight, current dependency contracts, and global controls bind. There are **48 actual action rows**, with slice counts **3/3/4/6/5/4/5/5/5/8**; neither the historical 49-case shorthand nor the mapping's “implemented” status grants acceptance. All named subrequirements remain binding.

**⚠ Cannot verify / acceptance gates:** installed-native Task 10 acceptance remains pending after this written review. The 32.5-second native component hold is DOM/mocked-RN evidence, not installed-device geometry or lifecycle proof. The mapped evidence also does not identify the specifically mandated PostgreSQL simultaneous source-revoke/publication-write test; see the acceptance section below. These qualifications must remain visible when adjudicating the 48 rows.

## Strengths

- Source capture has a closed operation/source union, typed canonical hashing, company/parent checks, and explicit whole-source authorization (`backend/platform/intelligence_sources.go:43`, `:126`, `:196`, `:525`). Immutable goal measurements authorize every stored evidence binding; report roots expand the complete manifest (`:337`, `:376`, `:508`). This preserves the distinction between immutable facts and current access instead of requiring an old parent version to remain current.
- The private-root concern has a concrete safe boundary: goal/report facts cannot enter `action_draft` through the operation switch (`intelligence_sources.go:75`). Narrative publication flattens transcript roots, rejects cross-conversation composites, and requires complete contributing messages (`backend/platform/intelligence_publication.go:18`, `:87`). I found no basis to claim an indirect goal-evidence route around that boundary.
- Raw disclosure and committed publication have separate backend lifecycles. Raw GET omits result JSON until current checks succeed (`backend/platform/intelligence_reads.go:39`); publication access can use minimal committed provenance and current source/destination ACL after raw expiry (`backend/platform/intelligence_publication.go:302`). First-write review validation remains inside canonical apply (`backend/platform/communication_conversion.go:268`). R1 is a client integration failure across this otherwise useful separation.
- Provider admission uses the shared budget before the worker claim, outside SQL (`backend/platform/intelligence_runtime.go:293`). The worker rechecks lease/cancellation/source authority before committing, under the company/current-actor fence (`:18`, `:78`, `:204`). Local-provider URL/identity checks, bounded subprocess cancellation/cleanup, strict recursive JSON parsing, closed output schemas, and citation validation have separate implementation units (`backend/platform/intelligence_ollama.go:29`, `:107`; `intelligence_whisper.go:24`, `:68`; `intelligence_schema.go:16`, `:82`).
- Historical metrics, exact expense formatting, goal attainment and planning coverage are server-rendered; the model selects permitted fact/code relationships (`backend/platform/intelligence_facts.go:11`, `:45`, `:82`). No model money approval or Goal.Current mutation was introduced. Both client trees contain actual selection, result, review, cancellation and recovery flows, rather than routes or reducers alone.
- The handoff preserves unsuccessful provider evidence and distinguishes configured capacity from measured use. The isolated explanation success at 116.788 seconds is reported against the unchanged 120-second deadline; the prior timeout is retained. That is appropriately narrower than a latency or near-capacity guarantee (`task-10-checks.json`, `task-10-real-head.log`, `task-10-real-isolated-final.log`).

## Issues

### Critical

None established in this review.

### Important

**R1 — The first expired raw-job GET deletes an independently recoverable canonical attempt in both clients.**

`frontend/src/data/useIntelligence.ts:5` and `mobile/src/intelligenceClient.ts:19` reuse the generic execution read hook. Both review forms register their mutation with the raw job path as a source (`frontend/src/components/IntelligenceDraftReview.tsx:37`; `mobile/src/IntelligenceDraftReview.tsx:53`). A GET that first discovers TTL expiry returns **403**, while a later GET of the already-retired row returns **200 neutral metadata** (`backend/platform/intelligence_reads.go:43`, `:47`, `:50`).

The generic web denial effect and native denial handling call `clearAttemptsForSource` on that raw path (`frontend/src/data/execution.ts:142`; `mobile/src/execution.ts:101`, `:195`). The shared function deletes the matching frozen attempt and advances `hardGeneration` (`shared/business/attempts.ts:157`). Consequently, after a committed write with a lost acknowledgement, the first raw-expiry poll can destroy the frozen key/body even when POST `/intelligence/jobs/{id}/publication-access` would authorize the committed result. The review forms' `unknown ? proof.denied : denied` check cannot protect an attempt already erased by the underlying read hook (`frontend/.../IntelligenceDraftReview.tsx:49`; `mobile/src/IntelligenceDraftReview.tsx:65`).

The recovery test supplies 200 already-expired metadata (`frontend/src/components/IntelligencePanel.test.tsx:174`, `:190`), so it misses the actual first-expiry transition. Backend raw-TTL replay success does not exercise this owning-client cleanup.

Separate raw disclosure retirement from canonical unknown-attempt retirement. Preserve the exact frozen key/body/target only while independent publication access authorizes it; keep retry disabled while that proof is pending. Genuine source/destination denial, actor/company/epoch retirement and matching-current-ACK ownership must still clear/retire correctly. Add both owning-client tests for the actual first 403 → terminal 200 transition, independent allowed publication proof, opposite source/destination denial, and a late old ACK/error after a newer intent. Do not restore expired raw prose or weaken global source-denial handling to fix this.

**R2 — Every structured-record citation targets an unregistered GET endpoint.**

`shared/intelligence/resultLifecycle.ts:14` builds `/conversations/{conversationId}/records/{recordId}`. Both result components read that path before navigation (`frontend/src/components/IntelligenceResult.tsx:26`; `mobile/src/IntelligenceResult.tsx:28`). The actual structured routes register GET only for the collection; the item path supports PATCH, not GET (`backend/platform/communication_structured.go:263`). Thus a valid cited record cannot be opened through either result UI. This breaks the explicit requirement that every displayed unit can open authorized selected provenance.

Use an existing authorized exact-record resolution flow or add a narrow item read with the same record audience/history/removal rules, then navigate to the selected record. Test the real registered endpoint contract in both consumers. The collection's recipient/response rules were inspected for this risk; they do not justify assuming an item GET exists.

**R3 — History silently loses all job pages after the first page.**

The web panel and native screen use generic cursor traversal for `{jobs, cursor}` (`frontend/src/components/IntelligencePanel.tsx:47`; `mobile/src/IntelligenceScreen.tsx:58`). The server defaults to 20 jobs per page and returns a cursor (`backend/platform/intelligence_reads.go:95`, `:118`, `:133`). Both execution readers consume later cursors through `mergeExecutionPage` (`frontend/src/data/execution.ts:67`; `mobile/src/execution.ts:79`), whose recognized arrays exclude `jobs`, and whose item identity does not include `jobId` (`shared/business/pagination.ts:6`, `:33`). It discards later job arrays while advancing the cursor to completion. The UIs then render only the retained first-page array (`frontend/.../IntelligencePanel.tsx:285`; `mobile/src/IntelligenceScreen.tsx:282`).

A focused pure-function probe against the actual helper produced `expectedJobs: 2, actualJobs: 1, remainingCursor: ""`. Add a supported jobs merge keyed by `jobId`, or explicit accessible history pagination. Merely adding the array name without its identity would deduplicate multiple jobs under `undefined`. Cover 21+ jobs through both actual history consumers.

**R4 — Conversation task candidates always claim `primary`; the user cannot deliberately select another supported action, and the existing-claim path has no M10 publication provenance.**

`shared/intelligence/publication.ts:81` always chooses the first publication message as anchor and `:85` always sends `actionId: "primary"`. Neither intelligence review form provides the existing instruction-action choice. The established conversion contract allows separate existing instruction actions and otherwise deduplicates on company/anchor/action (`backend/platform/communication_conversion.go:234`; existing manual picker `frontend/src/components/MessageTaskConversion.tsx:111`).

With two task candidates for one selection, or a primary action already converted manually, the later reviewed candidate returns the previously claimed task without applying the newly reviewed fields (`communication_conversion.go:239`). The M10 UI reports “Created work successfully” (`frontend/src/components/IntelligenceDraftReview.tsx:160`), although that candidate was not created. This is exactly the deliberate-separate-action requirement in adopted row 7.3, not permission for the model to invent action IDs.

There is also a retry consequence: the existing-claim branch creates `CommunicationRetry` and returns at `communication_conversion.go:245`, before `recordIntelligencePublication` at `:278`. For this newly acknowledged M10 retry key, publication-access therefore finds no minimal provenance and falls back to an exact raw-job check (`backend/platform/intelligence_publication.go:321`). A lost ACK on that branch cannot receive the intended independent TTL-expired canonical recovery.

Expose the human's current supported anchor/action choice and bind it to the preview/frozen payload; distinguish opening an already claimed result from creating the reviewed candidate. Preserve the existing no-duplicate claim rule. Make the M10 existing-claim outcome carry the appropriate authorized minimal provenance or an equally explicit canonical recovery contract. Cover multiple candidates, a preclaimed primary action, deliberate supported alternate action, and lost ACK after the existing-claim outcome.

**R5 — Current-state report explanations omit the selected period and metric semantics required by the fact contract.**

The current-report branch serializes every scalar summary entry as `Current-state <key>: <value>` (`backend/platform/intelligence_facts.go:70`). It includes internal `valid: true`, but provides no original/current deadline numerator/denominator/rate or null-rate interpretation, no selected reporting period, and no corresponding coverage/definition facts. In contrast, the historical branch carries period, basis, numerator, denominator, rate and coverage (`:45`).

This cannot be fixed by a prompt: the producer snapshot retains only a hash of the requested filter dates (`backend/platform/report_reads.go:17`, `:35`); its summary contains the separate `ontime/originals` and `currentOnTime/currents` counts (`:63`, `:97`) that the generic scalar adapter never interprets. A generated-at timestamp is not the selected reporting period. Adopted rows 6.1 and 6.3 expressly require exact metric relationships/null availability and period/zone/coverage/limitations in the renderer.

Carry the actual frozen current-report period in the source adapter and use an allowlisted semantic template registry for its supported metrics. Calculate any rates in server code from the correct separate denominators, retain unavailable/zero cases and original/current deadline definitions, and exclude internal transport flags from explanatory facts. Add current-state positive/zero-denominator and period tests; historical-only fact coverage does not establish this branch.

### Minor

**M1 — Retained build-output warning.** `task-10-web-final-build.log:14` reports a 920.92 kB entry chunk and `:17` emits the configured 900 kB warning. This is a real non-pristine build qualification, already identified for integration cleanup; it is not evidence that R1–R5 may be deferred. Assess splitting based on the final bundle and preserve the warning until resolved. No new Critical severity is inferred from size alone.

## Requirement and evidence disposition

| Adopted slice / actual rows | Review disposition |
| --- | --- |
| 1 — 1.1–1.3 (3) | Closed typed selection, exact nested bindings, immutable/current distinction and expanded-root limits inspected in `intelligence_sources.go:43`, `:196`, `:337`, `:508`. No additional implementation defect established. |
| 2 — 2.1–2.3 (3) | Durable owner/original authority, strict enqueue and raw withholding inspected in `intelligence_jobs.go:11` and `intelligence_reads.go:29`. Full named adversarial acceptance is not inferred from a test name; see gates below. |
| 3 — 3.1–3.4 (4) | Shared admission, maintenance, lease/current-final fences and cancellation inspected in `intelligence_runtime.go:18`, `:78`, `:204`, `:265`. Existing full/race results are source-qualified evidence, not rerun here. |
| 4 — 4.1–4.6 (6) | Local model identity, audio validation/bounded decode, subprocess cleanup and provider limits inspected in `intelligence_ollama.go:29`, `:107`, `:205` and `intelligence_whisper.go:24`, `:68`. Measured context/latency limitations remain. |
| 5 — 5.1–5.5 (5) | Strict duplicate-key/schema/citation/output rejection and pre/final/read authority inspected in `intelligence_schema.go:16`, `:82`, `intelligence_runtime.go:204`, `intelligence_reads.go:29`. Citation navigation still fails R2. |
| 6 — 6.1–6.4 (4) | Exact deterministic finance/goal/historical/planning branches inspected; current-state adapter incomplete under R5 (`intelligence_facts.go:70`). |
| 7 — 7.1–7.5 (5) | Existing task/expense/intake and ordinary-task canonical integration inspected. R1/R4 block complete retry/action acceptance. Required simultaneous revoke/write proof needs a precise evidence pointer or completion. |
| 8 — 8.1–8.5 (5) | Actual web integrations and owning tests inspected. R1–R4 affect recovery, citations, history and deliberate conversion behavior. |
| 9 — 9.1–9.5 (5) | Actual native integrations and owning tests inspected. Same shared/consumer findings apply; installed-device geometry/lifecycle remains a later explicit gate. |
| 10 — 10.1–10.8 (8) | SQL57/mirrors, standalone/Encore/provider/browser/runtime scripts and safe evidence qualifications inspected. Controller byte/source equivalence proof accepted as provenance; deployment/device/operational gates are not stamped complete. |

The 45 dependency pairs and 17 shared groups were considered through the adopted preflight and exact producer/consumer contracts. No feature expansion, cloud fallback, auto-publication, automatic approval, or raw-result export was identified. The table is a review disposition of every action-row range, not a replacement acceptance matrix or a claim that every named scenario was executed.

### Cannot-verify gates and evidence limits

- **Mandated consumer race/adversarial cases:** mapping row 7.5 points to `backend/platform/intelligence_publication_test.go:16` and `intelligence_real_provider_test.go:18`; the inspected publication cases perform sequential source changes and the real-provider application is a success flow. They do not identify the required **PostgreSQL simultaneous source revoke/write** interleaving. Likewise, row 3.1's two-worker claim coverage (`intelligence_runtime_test.go:69`) is sequential, and row 2.2's cited jobs/lifecycle files do not establish every named off-page/indirect-root reassignment scenario. Existing producer tests and the full race pass support their own contracts but do not by themselves exercise these new M10 consumer compositions. The controller/writer should supply the exact already-existing source-qualified scenario if present, or complete the specifically mandated missing scenario; do not treat an unavailable pointer as a failing run or duplicate whole suites.
- **Installed native:** pending and accurately qualified. Actual foreground/background/focus, keyboard, selected labels, scroll/control geometry, ≥30-second held authorization, frozen retry and opposite hard retirement must be exercised on the reviewed fixed source. Native owner preparation is read-only and is not acceptance. Physical-device/iOS/signing remain separate stated gates.
- **Provider capacity and quality:** 2155 measured input tokens is not near-6144 success. Keep the retained larger/overflow/timeout results and 116.788/120-second headroom visible. Current local English/public-speech/provider success does not establish broad language quality, sustained concurrent throughput, supply-chain/license closure or production capacity.
- **Operations:** real India TLS/TURN, production monitoring/recovery/backup and remaining rollout qualifications remain as reported; this source review does not establish them or authorize deployment.
- **Evidence provenance:** controller reports 1213 source records, 114 SQL entries, 65 build artifacts and 114 safe evidence hashes with zero mismatches; controller source-equivalence proof reports unchanged backend/Encore from `1396eef` and client/shared source from `8beed85` to final HEAD. These support the reported invocation qualifications rather than changing old invocation SHAs. Reported full backend/race/PG, web270/native222, build/type/lint/Hermes, compiled runtime, Encore, browser and isolated-provider evidence were inspected at their supplied paths; they were not regenerated.

## Review checks and bounds

The full multi-commit M10 diff was reviewed in manageable passes, including the three early M10 commits before the accepted f2 overlay. The separately accepted M9-only fix/proof-publication inventory was excluded from a second unrelated M9 verdict. The tracked plan/preflight copies were compared to their adopted bodies; count/status/current-contract amendments were accounted for. No Git command, product/index/HEAD edit, provider/browser/device execution, broad suite/race rerun or helper reviewer was used. The only written artifact is this requested review.

Focused outside-diff checks were confined to concrete interfaces:

- Raw denial cleanup, current ACK ownership and pagination: the surrounding web/native execution-hook functions, `shared/business/attempts.ts:157`, and `shared/business/pagination.ts:1` — R1/R3. Execution-hook diff hunks did not include the full relevant read functions, so those surrounding functions were read.
- Structured-record recipient/response authority and registered citation routes: `backend/platform/communication_structured.go:162`, `:242`, `:263` — R2; collection visibility did not establish an item GET.
- Existing action-claim/retry contract: surrounding `communication_conversion.go:70`, `:205` (changed hunks cut off the full apply branch) and existing manual action picker `MessageTaskConversion.tsx:111` — R4.
- Current report period/summary producer: `backend/platform/report_reads.go:17`, `:35`, `:61` — R5.
- Indirect private/report-root and lock risks: `goal_evidence.go:166`, `report_history_access.go:16`, `attention_access.go:14`, `finance_receipt_intakes.go:44` — current evidence/history authority and explicit worker company fence resolved the inspected interface concerns; no additional defect asserted.
- Current scope-event and source navigation wiring: `frontend/src/communication/store.tsx:275`, goal route parameter use in `MeasuredGoals.tsx:19`, and native chat route parameter handling — event invalidation/goal route existence checked; no extra authorization claim inferred from navigation alone.

One focused read-only probe was run because the new `{jobs, cursor}` response shape had no demonstrated merge coverage: Node's type-stripping loader imported the actual `mergeExecutionPage` and merged two one-job pages. It returned one job and an empty final cursor, confirming R3. The same probe printed the shared record citation target for R2; the registered-route inspection establishes its mismatch. No backend, database, provider, UI suite or device test was run to duplicate existing evidence.

## Assessment

**Task quality: Needs fixes.** The backend establishes substantial source, provider and publication safeguards, but five concrete consumer/fact-contract defects prevent Task 10 acceptance. Correct them in one consolidated writer round, provide focused owning regressions and precise outstanding acceptance evidence, then retain the separate installed-native and final integration gates.
