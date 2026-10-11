# Scoped fix-round verdict

**Approved for the scoped source review. R3 remainder: ADDRESSED.** Open Important findings from R1–R6: 0. New Critical: 0; Important: 0; Minor: 0. Original R7 remains separately qualified for final integration. This verdict does not complete the controller's native acceptance or approve milestone integration.

Reviewed FIX_BASE `d599140fa564d2119b18b88c1f1634e6c2c0bfbf` → HEAD `b62df25dce03adffa2eab2d6f10faef6c956e00b`, the scoped dispatch/controller brief, final report section, complete four-file fix diff and focused owning evidence.

## R3 selected authored option continuity — ADDRESSED

- `frontend/src/components/DepartureHandover.tsx:258` now renders a neutral pending option whose value comes directly from the authored replacement ID. It preserves a nonempty selection, an explicit empty choice and the not-yet-selected sentinel without retaining a fetched label. Current candidate options return only in the ready branch. The existing guarded onChange and preview/apply readiness checks are unchanged; no new authorization inference or CAS rebasing is introduced.
- `frontend/src/components/PeopleMembershipFields.tsx:24`, `:41` and `:61` correct the same option-removal mechanism for authored role, department and manager. Pending/disabled presentation retains each exact value with a neutral checking label, while ready presentation uses current options. This follows the expressly authorized same-mechanism check in the round2 brief.
- `frontend/src/components/PeopleOnboarding.test.tsx:426` selects an eligible person before withholding the read, verifies focus/value and absence of the person label, then checks recovery. `:452` asserts that the subsequent actual preview request retains kind/source ID/version/action/new user ID. `:467` separately verifies the three membership values, retained nodes, disabled state, withheld names and no authored change event.
- `verification/runtime/people_smoke.mjs:22` now chooses a nonempty current replacement **before** the held read and compares the next preview request with the original returned source/version and authored choice. The helper at `:5`–`:10` checks pending and recovery identity/focus/value/geometry, protected descendants and candidate-label absence. Raw comparison values stay in browser RAM; output contains booleans and geometry.

## Evidence read

- `task-9-fix2-red-real.log`: genuine failures show chosen departure value `u-founder` becoming empty and membership values becoming three empty strings; 2 failed/5 passed. The earlier path-error log is not treated as a symptom RED.
- `task-9-fix2-green.log`: 7 tests pass. `task-9-fix2-owning-tests.log`: 14 pass. `task-9-fix2-web-all.log`: 256 tests/66 files pass. These were read, not rerun.
- `task-9-fix2-browser/browser.json`: PASS, 200.866 seconds. The selected replacement's 30.5-second pending hold records `selectedValueNonempty`, `mounted`, `focused`, `valueUnchanged`, `selectionUnchanged`, `candidateLabelsAbsent` and `fetchedDescendantsAbsent` all true, with top/height/scroll deltas exactly zero. Recovery records the same node/focus/value and zero top/height deltas. The recorded following preview preserves the original source/version/action/selected user, and the reviewed departure completes.

## New breakage and out-of-scope qualifications

- No new confirmed defect was found in this fix. It changes only web option presentation, directly covering tests and the actual browser probe; no broad untouched-code review was performed.
- R1/R2/R4/R5/R6 remain closed by the preceding scoped review. Backend/Encore/native/shared/SQL equivalence is separately controller-audited; this web fix does not replace those proofs. Current race PASS993.988s and the successful current namespace Encore check/export are acknowledged; the former Encore environment-blocked qualification is superseded.
- Actual native controller acceptance remains pending. Web browser and component evidence do not establish physical keyboard/screen-reader/iOS/signing/background or deployment acceptance. Original R7 warning qualifications remain deferred, with no pristine-output claim.
- No source/Git/runtime/database/provider/device mutation, helpers or test reruns were used. Only this ignored report was written.

**Final open-list verdict: R1–R6 closed; scoped source fixes approved.** Native acceptance and final integration remain controller gates; original Minor R7 remains separately tracked.
