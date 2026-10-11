# Final whole-branch SeniorCodeReviewer report

**Reviewed range:** actual main `d20063b8063ee1dfd9bec6b4cd7807f4e31bcfa6` → `2e8fb06b5f62abb550df0e7aa8e8de0fac4be028`, all 125 commits. The supplied 45,804,473-byte whole-range package is authoritative. This is the final review of all ten milestones and final integration, not a review of the last commit or only the 13 integration areas.

**Spec compliance: Changes required. Quality: Changes required, with a sound underlying architecture. Ready to merge: No, pending the three Important findings below.** No Critical or Minor findings were established. This is the complete finding set from this review.

I performed the review myself in bounded authority/interface, product/lifecycle, test/configuration, and evidence passes. No helper reviewers were dispatched. No product, Git, database, native runtime, provider, or service was changed, and no stable implementer suite was rerun. Only this report and the reviewer recovery file were written. The review uses the frozen Git range; subsequent root coordination-document edits do not change its verdict.

## Strengths

- Business changes reuse the existing task and finance engines. Captured versions, independent review, original deadlines, immutable acceptance episodes, and exact finance amounts remain distinct from transport retry identity. The historical reducer distinguishes state, acceptance, effort, observed legacy coverage, and gaps rather than inventing past acceptance from current completion fields.
- Current authority is enforced across unusually broad asynchronous boundaries: original session epochs, company/member changes, complete report source manifests, indirect intelligence roots, private conversation intervals, provider waits, leases, publication, and canonical result recovery. The special intelligence company fence has concrete PostgreSQL lock-order tests, including both publication/revocation orderings and compatibility with ordinary authority writers.
- Client recovery distinguishes human-authored RAM input from fetched private output. Source denial, principal changes, and stale completion ownership are treated differently from ordinary reauthorization. Selected original report tokens and already-submitted canonical bodies are preserved without replacing them with newer sources or silently rebasing versions.
- Optional local intelligence is bounded and fail closed. Provider identity, schema/citation validation, deterministic finance/report facts, offline transcription constraints, cancellation, and provider-independent expiry maintenance are implemented. Reviewed publication preserves the existing private-source disclosure preview and normal business approvals.
- Evidence provenance is stronger than a simple list of passing commands. Exact source/input manifests, retained failed attempts, emulator versus physical-device qualifications, and separate normal/demo packaging make the available evidence auditable. The generated preview was assessed through its producer, configuration, hashes, and actual browser evidence, without dumping its minified bundle.

## Issues

### Critical

None established.

### Important

#### I1. Ready report deliveries are excluded from the public Inbox list

**Location:** `backend/platform/attention_scopes.go:36–37`. Related producer: `backend/platform/report_runtime.go:75–82`; consumer: `backend/platform/attention.go:70–98`.

`RunReportDelivery` creates a `report_export` / `report_ready` attention item and marks the intent delivered. However, the exhaustive candidate predicate only admits task, expense, intake, record, bookmark, finance-assistance, and goal sources. It has no `report_export` branch. `listAttention` exclusively reads through that predicate, so its later `attentionSource` projection never receives these items.

**Concrete trigger and effect:** Let an authorized scheduled export finish and its delivery worker mark the intent delivered. Open the recipient's ordinary Inbox, including its all-items view. The ready report is absent even though the item exists and its source could be authorized. Initial scheduled delivery is an in-app link, so this removes the intended user-visible delivery channel. Native routing and the report source projector do not repair an item that cannot enter the list.

**Required correction:** Admit recipient-bound report candidates using the current company, recipient, membership epoch, and report eligibility rules; retain the complete current-source projection checks. Add a public-route regression that runs generation/delivery and then reads `/attention`, including revoked/expired/opposite-recipient cases and deduplication. `TestReportLocalDeliveryDedup` at `report_schedules_test.go:33` currently constructs an item and calls `attentionSource` directly, which does not exercise the missing candidate branch.

**Requirement:** Roadmap Inbox delivery and M6's IDs-only, independently authorized report-ready link (`2026-10-11-historical-saved-reports.md`, Task 5).

#### I2. Current-state CSV keeps emitting cached private rows after access is revoked

**Location:** `backend/platform/report_reads.go:420–435`; initial authorization at `403–407`, whole-source checks at `294–321`, disclosed fields at `442`.

The current-state export calls `readReportSnapshot` once before writing headers. It then writes the frozen rows and flushes every 100 rows, checking only request cancellation and writer errors. Membership removal, session revocation, or loss of an included task/reference does not itself cancel that HTTP request, and no later authority check is performed.

**Concrete trigger and effect:** Start a valid current-state CSV containing more than 100 rows and pause the response after a flushed batch. Commit removal of the requesting member, revoke that session, or reassign an included source so the requester loses access. Resume the response. The remaining batches still disclose cached task titles, descriptions, blockers, and owner email addresses. A new export would fail, but this already-open export continues reading the entire cached output after the revocation.

**Required correction:** Revalidate the same snapshot's current session/member and complete included-source authority before subsequent bounded output chunks, using the established export pattern. Stop later output on denial, preserve already-written-byte qualifications, and keep slow network I/O outside authority locks. Add an owning current-state export test that commits revocation between chunks and verifies that later private rows are not emitted; retain the valid unchanged-scope case. The existing historical artifact midstream test at `report_export_jobs_test.go:227` exercises a different endpoint.

**Scope calibration:** M6 explicitly documents that the inherited current-state CSV only checks before headers and concentrates its new chunk checks on historical artifacts (plan line 55). This report does not misattribute the gap to the historical artifact implementation, which has chunk checks. The current-state endpoint is new within this whole 125-commit branch, and the roadmap's global removed-member/cached-export focus and binding current-permission export control still apply. This is an outstanding whole-branch privacy gap, not a claim that already delivered copies can be recalled or that every single response can eliminate all in-flight bytes.

#### I3. One departed report recipient disables outputs for still-authorized recipients

**Location:** `backend/platform/saved_reports.go:113–118`, reused by `backend/platform/report_export_jobs.go:59–60` and `backend/platform/report_schedules.go:266–270`.

The save-time configuration validator requires every configured recipient to remain an active, nonsuspended company user. The runtime calls that same all-recipient validator before the per-recipient savepoints, and each export authorization calls it again through the definition owner. Thus a change to recipient B becomes a failure of recipient A's otherwise valid report.

**Concrete trigger and effect:** Save an active definition and schedule with recipients A and B while both are eligible. Generate a ready output for A. Then deactivate only B; leave the owner, A, and all of A's included sources authorized. A's existing output is immediately denied through `authorizeReportExportJob`. At the next due tick, the early validator cancels the definition's outputs and pauses the entire schedule with `configuration_unavailable`, so A receives no later occurrences either. This happens before the code intended to isolate individual recipient failures.

**Required correction:** Separate configuration/owner eligibility from runtime eligibility of the particular recipient. Keep full recipient validation on an explicit save, and continue denying or retiring B's output. At generation and read/delivery boundaries, independently validate A without requiring unrelated recipients to remain eligible. Keep owner departure, owner source loss, definition revision changes, and explicit recipient removal from the definition as their existing wider invalidation boundaries. Cover departure/suspension in both ready-output reads and later schedule occurrences. The existing isolation test at `report_schedules_test.go:298` keeps the denied recipient active and only denies its project scope, so it does not reach this failure.

**Requirement:** M6 Task 5 says to validate definition/owner eligibility and then recipient scope independently; the UI likewise promises independently authorized recipient reports. A departed recipient should not cancel other people's authorized outputs.

### Minor

None established. The retained baseline formatting failures and explicitly qualified tool/build warnings are not new code defects in this review.

## Coverage and evidence assessment

| Area | Concrete review coverage and result |
| --- | --- |
| M1–M2 reports and measured reads | Current report predicates, exact deadline semantics, snapshot/cache limits, scope-before-pagination, task/expense evidence projections, bootstrap separation, metrics, targeted reads, and export paths. I2 remains. |
| M3 Connect and mobile flows | Shared opaque-cursor history, reconciliation, source invalidation, drafts and frozen retry intent; web store/selected-source boundaries; native history/viewports, current metadata, read watermarks, capture ownership, picker return, keyboard containers, and notification/source routing. No additional confirmed defect. |
| M4 attention | Candidate queries, exact obligation projection, transitions/retries, quiet windows, reminders, reconciliation and private epochs. I1 is the report-delivery integration gap. |
| M5 execution | Task mutation helpers, templates/checklists, graph validation, schedule preview/apply, dependency impact, project defaults, milestone submission/acceptance and recovery. Independent review and captured commitments remain enforced. |
| M6 historical/saved reports | Writer fact inventory, reducer/coverage, immutable snapshots, all-source reads, comparisons, definitions, schedule resolution, failure savepoints, leases, artifact publication/download/cleanup, and both client recovery flows. Historical chunk authorization is present; I1 and I3 remain. |
| M7 finance | Exact parsers, intake/content generation, scan/OCR boundaries, receipt acceptance, duplicate comparison scope, statement mapping/import, allocation/reversal, dirty attention repair, original-session checks, and unknown import recovery. No additional confirmed defect. |
| M8 planning/goals | Selected-range calendar, civil-period/capacity rules, advisory schedule context, measurement corrections/history, evidence options and complete source validation, reminders, original retry/CAS, and client source-loss recovery. No additional confirmed defect. |
| M9 people | Current membership graph/version rules, complete administrative choices, credential binding and KDF admission/revalidation, onboarding, access review, departure inventory/transfers, direct/global revocation, and output/session invalidation. No additional confirmed defect. |
| M10 intelligence | Explicit selection and indirect roots, jobs/provider identity, strict schemas and deterministic facts, lease/cancel/expiry/scratch ownership, current canonical publication, existing-work outcomes, raw expiry versus independent current proof, and web/native draft lifetimes. All 48 actual requirement mapping rows were considered; no additional confirmed defect. |
| Final integration/configuration | Actual source changes across the 13 mapped areas, packaging symlink exclusions, normal lazy modules versus inline demo, preview producer/browser checks, runtime environment scrubbing, worker startup/shutdown, SQL/model additions, navigation and current screen completion ownership. No additional confirmed defect. |

The binding vision, roadmap, detailed business contracts, prior rulings, final integration report, failure qualifications, mapping records, and relevant tests were inputs, not substitutes for the source traces above. Existing approvals did not preclude new cross-milestone findings. Behavioral tests inspected include real PostgreSQL blocking/overlap assertions, current source-loss and canonical retry cases, delayed client responses and stale completion ownership. Mocked native DOM tests were not treated as physical keyboard evidence.

Independent read-only integrity checks during this review established:

- All 2,010 checkpoint source hashes and all 249 published final safe-artifact records matched the frozen Git blobs. All 254 handoff-freeze records matched their recorded bytes/hashes. All 535 previously published M10 files remained unchanged.
- All 475 backend source records matched both the accepted `98b7fb6` boundary and the final range. All 205 compiled native/shared non-Markdown source records matched the exact `74e6474` binary source boundary. The 23 post-`800457b` files were documentation/evidence only.
- All 116 backend/Encore SQL files matched across the 58 migration pairs. The additive schema/model changes and relevant backfills were inspected, including the separately documented unsupported mixed migration mode.
- All 66 normal/demo/Hermes/preview artifact records matched actual retained files. The actual APK was 98,206,840 bytes with SHA-256 `b6418f127e03b8dec0ba2bccb550cf305c807ee95cd2261e489b7924b2e5e3a5`; its 4,618,132-byte embedded Hermes bundle matched `b78fe096f4a810d45e5de10674417be5b81fa1721a205319a030b8eb6218e994` and the recorded Hermes magic/dual ABI inventory.
- A selected set of 206 web/shared/configuration inputs matched the final web, normal build, demo build, preview, and browser invocation manifests. This independently supports the recorded source-equivalence claim; it is not a newly executed test suite.
- All 27 supplied current Goal owning-control intersections recomputed correctly against their ancestor bounds and met 44dp. The release/Auth report, keyboard viewport evidence, restoration, installed-artifact derivation, and aggregate observation qualifications were read. The release/Auth evidence covers 24 Sign in intersections, eight input phases and eight Back returns; its deliberately narrower unauthenticated scope is retained.

The recorded current web result is 348 tests in 71 files; the stable native result is 352 tests in 52 files with later owning source/geometry checks. Backend Go/PostgreSQL/race/Encore results are tied to the unchanged backend boundary rather than falsely presented as new runs at the final metadata commit. Normal/demo builds, type checks, native lint, selected format checks, both Hermes exports, 14 preview checks, and actual Chromium normal-route/file-preview evidence have recorded results. Full web formatting still has 13 accepted-base unchanged failures. Demo bundle size, Hermes color warnings, APK tool/quota retries, preliminary harness failures, and the original QEMU failure remain qualified. These checks did not cover the three paths identified above sufficiently to exclude their defects.

## Recommendations

Apply one consolidated correction for I1–I3, with owning public-route and revocation tests. Review the resulting delta and its source-bound evidence once. Preserve existing all-source authorization, current actor/owner fences, canonical identity, historical/current report meanings, and the current artifact/OS-handoff qualifications. No broad test rerun or provider generation is warranted merely to restamp unchanged source; run checks affected by the actual fixes and any required integration checks.

## Declined to judge

Each item below is separate and remains for executor disposition; none is silently promoted to completed acceptance.

- **Authenticated exact-release Android Goal/private-source/call behavior over protected HTTPS:** the exact release APK was launched on a fresh unauthenticated AVD; no trusted authenticated release target was available. Development-shell composite evidence does not prove this behavior.
- **Successful release MFA challenge, account recovery, or login:** Auth focus/cursor/Back checks deliberately never submitted Sign in. They prove input behavior, not authentication success.
- **Physical Android camera, permission denial/return, keyboard, focus, Back, and background recovery:** implementation and emulator/source evidence exist, but physical hardware/provider behavior is an explicit rollout gate.
- **Physical iOS UI, keyboard, accessibility, camera, and background behavior:** Hermes iOS export is not an iOS binary or device run.
- **Screen-reader and broader assistive-technology behavior on devices:** labels and structural tests are useful, but the supplied emulator geometry does not establish real screen-reader acceptance.
- **Organization/store signing and distribution:** the retained APK uses the Android Debug evaluation certificate; organization signing and store distribution are not established.
- **India production hosting and protected HTTPS:** local adapters/configuration do not demonstrate the final deployed region, certificates, or hosted network environment.
- **Production LiveKit/TURN and real incoming/background calls:** no such production/device matrix was established by this whole-branch review.
- **Real APNS/FCM background push delivery:** local IDs-only delivery and revocation logic do not certify provider/device delivery.
- **Backup retention, successful disaster recovery, RPO 15 minutes and RTO 4 hours:** these are documented unmeasured objectives; no production restore exercise was supplied.
- **Hindi or representative private-business transcription/model quality:** deterministic schema/source controls and bounded local provider proofs do not establish domain accuracy or acceptable error rates on representative data.
- **Production latency, concurrency, provider capacity and multi-replica admission:** owned fixture measurements and process-local admission are not a production capacity certification; shared-host multi-process inference is separately constrained.
- **Natural full-TTL expiry timing:** the native raw-expiry acceptance used a disclosed controlled expiry of its owned job. It proves the changed client/server path, not a natural 24-hour wall-clock run.
- **Wall-clock deletion of an already published OS share copy while the app is suspended/killed:** the explicit handoff exception provides cleanup on execution/resume/startup, not guaranteed JavaScript-timer execution during suspension. Unpublished downloads retain their immediate barriers.
- **Unsupported numbered PostgreSQL migration followed by GORM AutoMigrate:** the documented mixed-mode finance `42704` limitation was not treated as a failure of the separately tested supported deployment modes. No compatibility claim for that mixed mode is made.
- **Original retained QEMU SIGABRT cause and absent fixture-process cause:** the supplied evidence qualifies these causes as unproven. They were not reclassified as an application crash or rerun during review.
- **Final preservation of the running main database, fast-forward cutover, normal-runtime restart, and private push:** these are root-owned later actions; this read-only review cannot certify actions that have not occurred. The frozen branch/proof checks do not waive the fresh cutover preservation comparison.

## Assessment

**Spec compliance:** Changes required. The ten feature areas and final integration are substantially implemented, but report discovery, valid-recipient isolation, and the global current-export revocation behavior have concrete gaps.

**Code quality:** Changes required. Shared authority, version/retry separation, deterministic reducers, bounded providers, and source-bound evidence are strong. The remaining defects arise at integration boundaries that the existing tests do not exercise: producer-to-public Inbox listing, revocation during the current CSV stream, and a departed co-recipient entering a reused save-time validator.

**Ready to merge? No.** Resolve or explicitly adjudicate all three Important findings in the single final fix wave and scoped review. Deployment and device qualifications remain distinct from code approval.
