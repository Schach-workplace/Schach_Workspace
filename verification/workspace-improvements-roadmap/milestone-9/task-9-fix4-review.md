# M9 fixround4 scoped independent re-review

Reviewed BASE `334a9ad6be8a53e4870e2691c272cc16781965bd` → frozen HEAD `8f24b55ab168fb227cb4efe5915432937f968356` against `task-9-fix-4-brief.md`, the appended Fixround4 report, and the supplied `review-334a9ad..8f24b55.diff`. Scope is N2, N3, the minor picker status, and breakage introduced by this eleven-file diff. Prior R1–R6 and N1 remain closed.

## Finding verdicts

1. **Important N2 — ADDRESSED at source.** `backend/platform/people_models.go:101` supplies a distinct ordered text-only checklist DTO. `backend/platform/people_onboarding.go:190` copies the reviewed template defaults into the stored preview, using an explicit empty array for genuinely empty requirements. It does not allocate checklist IDs or mutate a task. `shared/people/taskReview.ts:38` renders that captured list in order for both clients, independently of `fields`; the real Go POST fixture is consumed by both rendered client tests. Existing description, owner, independent reviewer, project, dates, estimate, approval and grant disclosure remain covered. The regular template engine and actual fresh unchecked-item creation are unchanged.

   Legacy missing/null checklist decodes to nil. `people_onboarding.go:93` visibly marks such captures unresolved; the shared formatter explains that a fresh review is required. The first-application guard at `people_onboarding.go:413` returns conflict before business creation. Its position inside the `businessMutation` apply callback is correct: the unchanged canonical branch at `backend/platform/business_retries.go:85` validates stored intent/current result authority and returns before that callback. Thus old undisclosed first applications fail, while already committed canonical results remain replayable. No current template text is substituted into old captures. The new backend tests exercise unsafe legacy first apply versus completed replay, duplicate-free apply/retry, unchanged original dates/independent reviewer, and template edit/archive rejection. Missing and null display cases are both covered; their backend nil semantics are identical.

   Evidence inspected: server RED reports null instead of the two requirements; both client REDs omit checklist lines. Legacy RED explicitly records first apply 200; current owning SQLite/PG suites pass with the new 409/canonical-200 assertions. Actual normal SQLite/PG and current exported Encore gateway results record ordered disclosure without task/user creation, followed by exactly one task with two fresh unchecked items and preserved requirements. Current compiled web Review separately passes ordered checklist and retained field/label assertions.

2. **Important N3 — ADDRESSED at source.** `mobile/src/execution.ts:267` now passes `existing?.payload ?? payload`, using the same synchronous `readAttempt` result that already governs actor basis and target. After explicit synchronous abandon, the registry is empty and the corrected draft/new key is used even before React renders. If an unknown attempt remains, its payload, key, target, dependencies and source versions remain exact. The unchanged shared `beginAttempt` still checks frozen intent/target; matching-key commit/retirement and current ACK/hard-generation checks remain intact.

   The hook tests use a retained render reference and perform abandon plus corrected execute in the same act/call stack after each of prior 422 and 409 failures. They assert corrected submitted fields, a different key and successful retirement. Opposite tests assert unabandoned retries send identical requests, reject a changed target, and ignore old ACKs after abandon/hard clear without retiring a newer attempt. The RED has precisely the two corrected-reentry failures, with the three opposite cases passing; current focused and complete native logs pass. No shared registry or web adapter changed.

3. **Minor native open-picker pending status — ADDRESSED at source.** `mobile/src/PeopleControls.tsx:118` adds a neutral polite live-region Text inside the open modal and outside the accessibility-hidden fetched projection. The absolute overlay adds no layout height. The search input and measured projection remain mounted; unavailable candidates are unmounted by the existing projection. The rendered hold test checks modal-local status, absent candidate label, and retained authored search/focus/selection. RED lacks the modal status; GREEN passes. Physical layout and screen-reader behavior require the controller's actual native check.

## New breakage

**None found.** New findings: 0 Critical, 0 Important, 0 Minor. No additional test was necessary to resolve a code doubt, and no suites were rerun. Focused unchanged reads were limited to the canonical retry callback ordering, shared attempt registry contract, and native projection ancestry required to validate the modified boundaries. The surrounding execution/apply functions were read where the supplied hunks alone did not establish those boundaries.

## Evidence and scope qualifications

Independently verified all 1,124 source entries against the source manifest and all 165 final-manifest references, including 61 artifacts and the bound evidence/harness/manifest/report records: no byte-size or SHA256 mismatches. Inspected the equivalence report: unchanged engine/SQL scopes remain historical evidence, with only deterministic onboarding capture/legacy handling and the native registry payload source changing in their respective production files. Normal runtime was built before the final metadata commit; its documented source delta is only the uncompiled backend test fixture correction. Current Encore namespace metadata binds the stated HEAD and distinct owned network namespace.

Inspected final owning logs: SQLite 4.307s; PostgreSQL 9.207s; frontend 259 tests/66 files; native 214 tests/48 files; native typecheck/lint; current Android/iOS Hermes exports. Also inspected the named server/client/N3/legacy/picker RED evidence, picker GREEN, normal HTTP results, current Encore results, and compiled browser checklist proof. These are evidence inspections, not reviewer-executed test claims.

The authoritative current browser proof is `task-9-fix4-normal/browser.json`: seven steps, 0.552s, ordered checklist and retained disclosure assertions, `widths: []`. The inherited broader normal-result label about 320/375/430 and ACK/source refresh does not establish those checks for this run. No broad viewport matrix, prolonged holds, unchanged whole race, or whole finance suite is re-stamped here.

Out of scope: prior closed findings, unchanged engines, M10 preparation/stash, and the existing demo bundle warning. Actual affected native Review, synchronous corrected reentry and open-picker pending/layout/accessibility acceptance remain controller gates. Hermes export and rendered mocks do not satisfy them. No product, index, HEAD, runtime, provider or device mutation was performed; this report is the only reviewer write.

## Verdicts

**Spec compliance: PASS for the scoped source fixes.**

**Code quality: PASS for the scoped source fixes.**

**Fixround4 source round: APPROVED — N2, N3 and minor picker status addressed; no new findings.** This is a source handoff verdict. M9 milestone acceptance remains pending the controller's actual affected native acceptance gates.
