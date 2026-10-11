# M6 FIX3 scoped re-review

FIX_BASE: `85b17e57e04a880a547e4d7c506f4f38e12b24f2`
Reviewed HEAD: `96f7240273510abf04ef8ec9fb8000f8e3aa3282`
Package: complete supplied `review-85b17e5..96f7240.diff`, read once; one commit, one production file, three insertions.

## Verdicts

**Spec: PASS for the scoped source correction.**
**Quality: APPROVED for the scoped source correction.**

The sole original Saved viewport finding is **ADDRESSED at source/controlled diagnostic level**, with final exact-commit native acceptance still a controller gate. No new Critical, Important, or Minor fix defects were found. This review does not complete M6 or authorize M7.

## Original finding

**Saved Reports jumps back to the authored form after ordinary refresh — ADDRESSED, subject to the native acceptance qualification below.**

The original exact85b no-action hold remains valid RED: `m6-fix2-saved-scroll-hold.json` shows Review at `[50,2045][1031,2166]` at1.97s, absent at8.01 through31.97s, and the fixed date form returned. Its metadata identifies85b and qualifies backend production/SQL equivalence; no extra setup-only repeat is counted as a completed hold.

The controller's chronological investigation supports the selected mechanism. The fully parsed55-event `m6-fix3-phase-live-events.json` records full accepted height1528.727, a pending hold retaining that height, readiness returning at1791681057082, and offset falling from987.272 to532.363 then521.454 while reported content height1528.727 and viewport541.454 stay constant. This defeats the missing-height explanation for that reproduced failure. The clipping-only diagnostic fails all six samples. The default-focus-disabled diagnostic holds all six anchors, identifying native focus/caret visibility scrolling without proving which of its two entry points fired. Earlier timing-perturbed stable traces and truncated gesture batches are not treated as complete causal proof.

The narrower zero-log85b plus only `keyboardDismissMode="on-drag"` diagnostic holds Review at the same2045..2166 bounds at1.97/7.97/13.96/19.96/25.97/31.99s with no actions during the hold (`m6-fix3-drag-hold.json`). These observed anchors establish controlled GREEN; the diagnostic sampler's exit0 alone is not a success assertion. This remains diagnostic evidence, not final96f native acceptance.

Final `mobile/src/SavedReports.tsx:95` adds the purpose comment and its own FlatList's `keyboardDismissMode="on-drag"` at101. It implements the explicit progress.md Ruling: intentional human scrolling ends editing; an ordinary no-drag check retains focus/authored RAM; subsequent normal focus navigation stays available. The code difference from the isolated drag experiment is explanatory comments.

## Installed behavior and new-breakage review

Installed React Native is0.86.3. Local implementations establish the following:

- FlatList forwards remaining props to VirtualizedList; VirtualizedList forwards `keyboardDismissMode` to the default ScrollView. No custom/nested scroll replacement appears in this Saved list.
- `ScrollView.js:1284–1293` calls `dismissKeyboard()` on Android begin-drag with this prop. `ReactScrollView.java:607–640` emits begin-drag from intercepted touch interaction, not ordinary source readiness or automatic child visibility scrolling. RN documents that stopping a scrolling animation can also produce begin-drag; this is still a user touch interaction, not a no-drag poll.
- `dismissKeyboard.js:18–20` blurs `currentlyFocusedInput()`. `TextInputState.js:116–138` clears its focus reference and sends the native blur command independently of whether the keyboard is currently visible. Thus the correction also covers the observed keyboard-closed stale editor focus.
- `ReactScrollView.java:136` retains the default `mScrollsChildToFocus=true`; requestChildFocus516–520 and requestChildRectangleOnScreen533–537 remain enabled. The product does not add the diagnostic `scrollsChildToFocus={false}` or override keyboard/tab/caret behavior.
- ReportField has controlled value/onChangeText and no blur-triggered authored-data purge. DeadlinePicker likewise has no onBlur handler. This fix adds no state, effect, timer, request, authorization condition, persistence, offset restoration, or diagnostic instrumentation.

The complete diff leaves finite scoped geometry, fetched-choice/output withholding, denial/background/unmount/principal/company boundaries, authored RAM recovery, source-gated writes, original CAS basis and canonical retry intent unchanged. This conclusion concerns the fix's delta; accepted fixes1/2 and the complete M6 implementation were not reopened. The deliberate-drag blur is authorized by the chronological controller Ruling and is not a violation of the no-drag focus requirement.

No specific unresolved code doubt required an additional proof command or test. No new prop-mirroring/model test was invented and no passing suite was rerun.

## Covering evidence inspected

Only the appended M6 fixround3 report section and its named covering logs were read, alongside the brief/finding/relevant chronological Rulings and scoped source/installed handlers.

- `/tmp/task6-fix3-native-cover.log`: SavedReports.test.tsx,1file/9tests passed,1.32s. Existing real provider/read-adapter coverage is supporting protection for retained inputs/picker, pending geometry/choices/writes, scope lifecycle and exact retry/CAS; it is not proof of native caret behavior.
- `/tmp/task6-fix3-native-types.log`: `tsc --noEmit`, reported exit0; no errors in the log.
- `/tmp/task6-fix3-native-lint.log`: empty successful lint output, report records exit0.
- `/tmp/task6-fix3-format.log`: all matched files use Prettier style.
- `/tmp/task6-fix3-native-export.log`: Android and iOS bundles exported, matching reported Android `entry-f3634486246d161523473f16c4388c7b.hbc` and iOS `entry-579d6cd148a195265800ed852ed164ae.hbc`. Export does not prove native interaction acceptance.

Read-only identity checks confirmed current HEAD96f7240 and clean tracked working tree. SavedReports.tsx SHA256 is `6900a481366f7969346bb8ef18d81f73723ddfc092cf02020b501e9f46a55a1c`; unchanged SavedReports.test.tsx SHA256 is `20a515dfd7d077f2f477048a94fc99edad94959cb478c529b5419e88b808fe53`, both matching the report. The review output path is ignored. No Git/source/runtime/database/config/dependency mutation was performed; this report is the sole write.

## New findings and out-of-scope observations

New fix defects: none. Out-of-scope observations requiring follow-up: none identified. Original full M6 review and accepted fixes1/2 remain outside this review.

## CannotVerify / controller acceptance gates

This read-only review cannot verify final exact96f Android no-action viewport stability, actual no-drag IME typing/focus continuity during ordinary reauthorization, or explicit saved review → confirmation → canonical definition → schedule/generate business flow. These remain controller-owned gates. Source preserves normal focus/caret/tab behavior; actual accessibility/device interaction is not established by source inspection or the DOM tests. Physical-device/iOS interaction, distribution signing, hosting/provider delivery and capacity retain their separate rollout gates.

Controlled diagnostic GREEN and source approval do not establish that M6 is complete. Native gates are recorded separately from source-review defect counts.

## Open counts

Original scoped findings:1 ADDRESSED at source/diagnostic level;0 NOT ADDRESSED source findings.
Open review defects: **Critical0 / Important0 / Minor0**.
Pending controller acceptance categories: **3** (exact final viewport, no-drag IME continuity, Saved business flow).
