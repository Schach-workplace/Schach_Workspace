# Task 10 — formal fix round 4 review

## Per-finding verdicts

**Important N2 — ADDRESSED.** The report assistance owner now survives ordinary report refresh on both clients: `mobile/src/ReportScreen.tsx:85` keeps `CurrentReportAssistance` and its launcher mounted, and `frontend/src/pages/GoalsReports.tsx:111` keeps the web launcher mounted. Pending or denied source reads are passed separately from available choices. Consequently, a refreshed report does not implicitly close the human-opened Sheet/Modal or discard its original running job, Close/Recheck/Cancel controls, or frozen enqueue intent.

The fix also addresses the named web same-query stale-content path. `frontend/src/data/useTaskReport.ts:114` exposes current checking/denial state; `frontend/src/components/IntelligencePanel.tsx:57` and `mobile/src/IntelligenceScreen.tsx:77` independently reauthorize the **original selected report token** through the existing selection-preview endpoint. Pending proof withholds the selected-source label, inspected preview, and fresh Generate action. A positive proof restores the existing inspection/opt-in only when its selection hash and policy still match. A newly issued latest-report nonce is not substituted merely because its displayed metrics look equal.

The proof and action fences are present at `frontend/src/components/IntelligencePanel.tsx:118` and `mobile/src/IntelligenceScreen.tsx:154`. The expiry timer retires visible proof at its original deadline; the imperative expiry check also prevents an enqueue if the wall clock has passed that deadline before the timer runs. Explicit “latest report” selection resets the inspection and consent (`frontend/src/components/IntelligencePanel.tsx:143`, `mobile/src/IntelligenceScreen.tsx:185`). It does not rewrite an already-owned job or an unknown enqueue attempt. Inspection callbacks are scoped to their current revision/authority, including local hard-retirement generation (`frontend/src/components/IntelligencePanel.tsx:173`, `mobile/src/IntelligenceScreen.tsx:202`).

Owning regression evidence is substantive: `mobile/src/IntelligenceLifetime.test.tsx:423` drives the actual Workspace/ReportScreen/launcher/Sheet through enqueue refresh, the real 15-second Workspace refresh, pending job reads, and the same original running-to-ready job. `frontend/src/pages/Reports.intelligence.test.tsx:350` covers same-query pending withholding; `:449` covers report query replacement with the original job retained. Rotating-nonce tests at native `:481` and web `:369` require proof of the original token and preserve the original enqueue source. Native `:556`, `:589`, and `:596` cover changed/expired proof and both action-time and scheduled expiry. Web `:405` covers the opposite proof outcomes and deliberate latest-source selection. These tests do not treat equal visible report values as authorization.

**Important N2b — ADDRESSED.** `mobile/src/IntelligenceDraftReview.tsx:79` and `frontend/src/components/IntelligenceDraftReview.tsx:59` retain only the nonsensitive private-review layout mode across a temporary raw-read gap. The first, still-unchosen Source anchor picker no longer depends on a currently returned job object or an already-selected anchor. Its options and private candidate content still come from the current authorized raw read.

The picker interaction owner is explicitly replaced for genuine scope, source/candidate binding, denial, or hard-generation changes (`mobile/src/IntelligenceDraftReview.tsx:332`, `frontend/src/components/IntelligenceDraftReview.tsx:292`). The new local generation subscription also catches an empty-registry hard clear (`mobile/src/IntelligenceDraftReview.tsx:156`, web `:120`). Retaining the layout boolean does not retain a private job, anchor list, audience, or authority to Preview/Confirm.

`mobile/src/IntelligenceLifetime.test.tsx:521` exercises the real `ReportChoice` Sheet: its first open picker remains mounted through the owning poll/read transition while the options and private prose disappear, then current options return and a human can make the first selection. The test also checks the preserved amount input/focus/value and absence of an unsolicited enqueue. The twelve genuine picker-retirement opposites are at `:800`. `frontend/src/pages/Reports.intelligence.test.tsx:246` verifies the corresponding actual HTML select keeps its DOM identity while pending, has no usable options, and is replaced when source identity or hard generation genuinely changes. This is DOM evidence, not proof that an operating-system dropdown remains open.

## New breakage

**No new Critical, Important, or Minor code findings identified in this scoped package.**

The added state separates human interaction lifetime from current source authority. Both clients continue to gate fresh generation on a current inspection and explicit consent. The existing unknown-attempt branch remains ahead of fresh-generation handling (`frontend/src/components/IntelligencePanel.tsx:201`, `mobile/src/IntelligenceScreen.tsx:229`), so a report refresh or explicit latest selection does not substitute the body/period/target of the already-frozen retry. Native `mobile/src/IntelligenceLifetime.test.tsx:769` verifies the exact original unknown enqueue body/key through pending reads and latest-source choice.

The late-success/late-error matrices are meaningful rather than mere happy-path snapshots: native `mobile/src/IntelligenceLifetime.test.tsx:699` covers seventeen authority/source/lifecycle opposites; web `frontend/src/pages/Reports.intelligence.test.tsx:170` covers twelve. The final web tests wait for the positive changed proof before asserting retirement and releasing obsolete callbacks. That correctly distinguishes a known change in authority from an ordinary outstanding proof request. The visibility/event retirement path now also clears the busy flag, closing the separately retained failing regression.

## Spec compliance

**Spec PASS for the authorized round-4 source and automated-evidence gate.** N2 and N2b are addressed, including the binding original-token proof ruling, pending-content withholding, changed-authority retirement, original-owned-job preservation, explicit latest selection, and frozen unknown-attempt retry. No required change in this scope is missing and no unrelated feature was added.

**Cannot verify here: installed affected-client acceptance remains pending.** This written approval authorizes the next separately controlled acceptance step; it does not claim that either finding has already passed on the refreshed installed client. The original native report4 expired naturally and cannot be revived, backdated, or used as current proof. The recorded manual-disabled state and six-generation cap remain binding. Fresh actual report selection/inspection/consent/container observations can be made without another generation, alongside the retained automated running-to-ready proof. Private5 can be used only if it remains genuinely current. No new provider inference, fixture restoration, TTL extension, or device mutation was performed for this review.

The original native evidence remains qualified: report4's assistance Sheet disappeared during ordinary refresh and the same job later became ready; private5's first picker disappeared without a human selection or dismissal. Earlier N1 success and the development-shell observations do not themselves close these two affected installed-client gates. Physical-device/iOS/final-package acceptance and the final whole-branch review remain separate.

## Strengths and code quality

The persistent launcher is a small ownership correction at the actual parent boundary, and the private-mode latch stores only the minimum nonsensitive state needed to keep a human-opened picker alive. Fresh source content continues to use the existing authorization reader. The implementation does not broaden the shared registry or add a second report-token lifetime policy.

The test additions exercise real parent components, actual Workspace notifications, launchers, Sheet/Modal owners, raw readers, and the actual native picker. Network/native adapter seams are mocked, but the components whose lifetime failed are not replaced with stand-ins. The new native file is large because it contains both owning sequences and their authority matrices; its cases remain tied to the two scoped failures and the introduced proof/retirement fences.

**Quality Approved.** The ownership changes, error/busy handling, proof expiry, and late-response guards are coherent and covered by the supplied final runs. No source change is requested by this review.

## Evidence and source qualification

Reviewed the full one-commit package `review-b6ba0e2..4420ed5.diff` from `b6ba0e2260de7c1219387006b6b5b8ab5ca55aab` to `4420ed540dc253ad024ecb61b343be97b57b5b68`: 188,448 bytes, SHA-256 `d9fa19cc5ab3f4b4973e0d1af180e7103b3ce0443dcc00236e44246926508669`. It was read once in manageable passes. One truncated output portion in the coordination-document hunk was recovered; no product file was repeatedly rescanned and no replacement Git diff was generated.

Read the binding preparation and brief/root rulings, full fix4 report, the original affected native reports, current checks/source-equivalence/controller proof, complete added and changed covering test bodies, all ten final check outputs, and the retained owning/retirement/rotating-nonce/busy regressions and final-run failure explanations. The implementer's claims were checked against source and assertions, not adopted as design verdicts.

The ten final invocations record successful native tests (52 files, **347 tests**), web tests (69 files, **339 tests**), both type checks, native lint, Android/iOS Hermes export, normal and demo web builds, formatting, and diff whitespace checking. These runs were invoked on the recorded dirty precommit source. The supplied equivalence proof and independent controller verification bind their 392 client/shared input files to the final source: **3,920 comparisons, zero mismatch**. They are source-qualified runs, not postcommit reruns.

The controller's frozen boundary records **1,227 source, 232 SQL-file, 61 build, and 89 safe-evidence hash comparisons with zero mismatch**, followed by the build/evidence freeze. These are provenance checks, not additional behavioral executions. The report's subsequent live coordination-doc updates are explicitly outside that frozen commit and do not change the reviewed product source.

The earlier web full run of 337 passing and two failing tests remains failed, with its timing problem and subsequent test correction disclosed. Intermediate native counts and the refresh-coupled hard-clear case are not substituted for the final standalone hard-retirement coverage. The earlier lint failure from reading `Date.now()` during render and the initial lint warnings remain in the history; the final code uses the timer/action checks and the final lint run is clean. Earlier RED runs were not relabeled as passing.

No reviewer tests were run. Reading raised no specific unanswered doubt requiring a focused execution, and repeating suites, inference, browser/device runs, or SQL mutation was outside this gate.

## Focused checks outside the diff

These were limited to concrete contracts newly consumed by this fix:

- **Does the added ready/checking gate accidentally expose stale authorization data?** Checked `frontend/src/data/execution.ts:87` and `:198`. Its existing reader requires the enabled, current, post-mount, nonfetching, error-free authorization result before exposing ready data. The additional report flags retain that contract.
- **Can the real native picker remain open while withholding its options?** Checked `mobile/src/ReportControls.tsx:62`. `ReportChoice` owns its open state independently; an open Sheet can remain present with an empty current option list and disabled choices while authorization is pending. The new parent key supplies genuine retirement.
- **Does an empty-registry hard clear actually notify the local subscription?** Checked `shared/business/attempts.ts:130`. `clearAllBusinessAttempts` advances generation and emits even when the map is empty; the new local subscriptions consume that signal. No shared-registry redesign was needed.
- **Does rechecking an original report token extend its TTL or bypass current roots/versions?** Checked `backend/platform/intelligence_sources.go:410` and `:585`. The existing report resolver binds the exact token to actor/company, keeps original generation time plus five-minute expiry, and checks current row versions and the complete source-root access requirements. Existing selection-preview returns the corresponding selection hash, expiry, and policy. This was a narrow M10 consumer-contract check, not a renewed backend/M9 review.

## Out of scope and carried-forward observations

Accepted M9/backend behavior and the earlier N1/M1 and round1–3 dispositions are not reopened. The source review does not grant automatic approvals, cloud use, or automatic writes. Existing task/finance controls were not changed by this package.

The web build warnings are retained observations for the already assigned final integration gate: normal output is approximately 926.08 kB and demo output 975.60 kB against the unchanged 900 kB warning threshold. Export color-output noise and the build's dedicated external-output-directory warning are also disclosed in the evidence. They are not new lifetime defects or a reason to claim pristine build output. No new warning-driven product defect was identified in this package.

The original 539-artifact native boundary freeze, the new source/build/evidence hashes, and DOM retention tests establish their stated boundaries only. They do not convert historical native failures into current installed-client passes. The controller should retain this distinction when recording the next affected native observations and the later whole-branch verdict.
