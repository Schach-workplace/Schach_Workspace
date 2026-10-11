# M9 fixround5 scoped independent re-review

BASE `af39129c2be682aad39087dfc383d3215e1b6dd8` → frozen HEAD `f2d39bf7ce3e98f4e6380e746400d6784d09bf27`.

Read the round5 brief first, the latest Fixround5 implementation report, and the complete supplied `review-af39129..f2d39bf.diff` once in bounded portions. This review covers N4 and breakage introduced by the nine-file fix. The three preserved M10 internal commits already in BASE are outside scope and receive no acceptance here.

## Per-finding verdict

1. **Important N4 — ADDRESSED at source.**

   **Current authorization is independent of edit locking.** Both forms now pass ordinary Goal readiness to bound-source reads while separately disabling authoring for busy/unknown attempts (`mobile/src/GoalMeasurementForm.tsx:280`, `frontend/src/components/GoalMeasurementForm.tsx:170`). The pickers fold every live Bound hook result into submission eligibility (`mobile/src/GoalEvidencePicker.tsx:79`, `frontend/src/components/GoalEvidencePicker.tsx:50`). Each subsequent Bound still renders and executes its hook when an earlier result is false; the accumulated boolean does not short-circuit mounting later checks. Save/Retry remains disabled until all bindings are current. Native submission also checks that boolean directly; web form submission checks its current gated submit control. The fold adds no authorization cache, stored authorization boolean, registry or persistence layer.

   **Pending source checks preserve authored editors and withhold fetched projections.** The authored header/editor remains outside the recursive Bound subtree. Existing read hooks withhold data when not current. Native `mobile/src/execution.ts:57` clears loaded state on every scope transition, preventing A→background→A from reviving the prior loaded result before the new GET completes. This is guarded render-time adjustment of fetched state, not authored input. The component tree keeps the editor in place during pending bound reads. Rendered native tests assert node, focus, selection and value; compiled-web checks assert node, selection and geometry. Actual native IME/layout behavior is still an acceptance gate.

   **Exact denial retires the correct dependent recovery and obsolete context.** Native bound URLs at `mobile/src/GoalEvidencePicker.tsx:243` now encode the same query tuple as the registered dependencies. Immediate denial retirement at `mobile/src/execution.ts:115` preserves the full evidence-preview query, retaining existing non-evidence normalization. Shared exact dependency matching is unchanged. Tests distinguish kind, parent and source ID, including a source ID containing a space: the denied dependency is retired while all three unrelated tuples remain. Bound denial clears selected parent/chosen preview context and calls the form's denial handler (`mobile/src/GoalMeasurementForm.tsx:287`, `frontend/src/components/GoalMeasurementForm.tsx:177`) to abandon the dependent attempt and retire its scoped RAM draft. There is no persisted private context or rejoin reconstruction. The tests cover settled cleanup, repeated authority refresh/foreground and remount with blank reason, zero bindings, no old Retry and no extra submission.

   **Old responses cannot retire a newer intent.** The new `currentACK()` guards at `mobile/src/execution.ts:321` and `frontend/src/data/execution.ts:282` apply authorization-error hard clearing only to the current owner/hard generation. Existing successful-response guards and matching-key commit/retirement remain unchanged. The new tests reproduce old404 deleting a newer key before the guard, and verify both old success and old404 preserve the newer key/draft after source retirement. No old success is displayed.

   **Authorized exact recovery remains intact.** Source checking itself neither abandons an authorized attempt nor updates its payload/key/CAS/dependencies. The existing frozen Goal projection and current registry remain authoritative. The opposite tests return current authorized previews with revision r2, then send the exact original body/key/CAS and r1 evidence binding, producing one simulated canonical fact. Explicit Load latest remains human reconciliation. The shared registry, actor/graph recovery, deadlines, task/finance/backend controls are unchanged by the diff.

## New fix-introduced findings

**None.** Counts: 0 Critical, 0 Important, 0 Minor. No focused probe was needed after source and existing meaningful coverage resolved the reviewed questions; no suite was rerun.

The recursive Bound structure was checked for all-source execution, current-state derivation and editor placement. Focused unchanged reads were limited to the read lifecycle, frozen Goal projection, RAM retirement semantics, shared exact-source matching and current response guards needed to assess the changed interfaces. Both picker call sites were checked; no other production caller depends on the old footer shape.

## Evidence assessed

Independently verified all **1,252 hash records** reachable from the final manifest, including the **1,153 source-file entries**, current web/Hermes artifacts, safe evidence and original native failure records: no size/hash mismatch. Root separately verified Git blob correspondence, SQL mirrors and aggregate manifest chains; this review does not recast hash integrity as product correctness.

Inspected the original 8f24 native N4 extension and its three safe proofs. They establish the committed-unknown private-source loss, unchanged actor/ordinary Goal, retained enabled retry, bounded absence of preview GET, one eventual POST404 and settled cleanup without a duplicate. These remain historical failure/server-denial facts, not current native success evidence.

Inspected genuine RED evidence for both clients' missing source GETs, stale parent-context cleanup, and late old404 clearing the newer key. Current owning recovery suites pass 4/4 per client. Final complete logs pass frontend **263 tests/67 files** and native **218 tests/49 files**; current typechecks, native lint, normal frontend build and both Hermes exports complete. These are inspections of supplied logs, not reviewer-executed test claims.

Read the current compiled-browser harness and results. It serves actual normal production assets through an owned fictional HTTP boundary, commits an in-memory fact and truncates a declared200 response body. It settles the ordinary Goal change before source-only loss, holds both exact GETs, verifies Retry disabled after only the first resolves, denies the second, and checks scrub/reload/one POST/one fact with actor and Goal unchanged across loss. The opposite case asserts exact original POST body/key/CAS7/r1 evidence after current r2 previews. Safe results contain booleans/counts; original request comparison is in RAM. This proves the compiled web client behavior against that controlled boundary, not Go ACL/canonical storage or actual native behavior.

The equivalence report binds unchanged backend/Encore/shared/verification and all unchanged client files to FIX_BASE af39129. That BASE includes preserved M10 internals/migration57. No unchanged backend, SQL, race, finance, Encore or broad runtime result is re-stamped, and neither M10 implementation nor migration57 is accepted here.

## Out-of-scope minors and acceptance limits

No new out-of-scope minor was identified. Prior closed R1–R6/N1–N3 and prior source-approved picker work were not reopened. Existing bundle/export qualifications remain recorded in their owning reports. M10 internal commits and stashes remain outside this source verdict.

The original native agent must still run the affected current-client/original-backend composite acceptance: proactive exact ALL-source reads while unknown, pending retry/privacy/editor behavior, denied-source retirement, and authorized exact retry with canonical facts. Rendered native primitives and Hermes export cannot satisfy that gate. Controller owns the exact composite provenance and final milestone ruling.

No source, index, HEAD, runtime, device, provider or stash mutation occurred; no helpers were used. This report is the only reviewer write.

## Two verdicts and round ruling

**Spec compliance: PASS for scoped N4 source repair.**

**Code quality: PASS for this nine-file fix.**

**Fixround5 source ruling: APPROVED — N4 addressed, no new findings.** Actual affected native acceptance remains pending. This is not M9 milestone acceptance or M10 acceptance, and does not prejudge the controller's final adjudication.
