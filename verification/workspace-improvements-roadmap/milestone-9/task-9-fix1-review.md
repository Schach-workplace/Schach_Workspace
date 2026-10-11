# Scoped fix-round verdict

**Needs fixes.** R1, R2, R4, R5 and R6 are ADDRESSED. R3 is NOT ADDRESSED in full: the selected web departure replacement loses its DOM value during pending authorization. Open Important findings: 1 (remaining R3). No new Critical/Important/Minor finding is counted separately. Original Minor R7 remains deferred by the controller.

Reviewed FIX_BASE `43700705bf30fbefcee0fb5363eebc60def58ddd` → HEAD `d599140fa564d2119b18b88c1f1634e6c2c0bfbf`, using the scoped dispatch, controller rulings, complete bounded fix diff and owning evidence. This is not a fresh milestone or whole-branch review.

## Finding dispositions

1. **R1 — ADDRESSED.** `backend/platform/finance_assistance_models.go:49` adds an invocation-only, nonserialized/nonpersistent producer epoch. `backend/platform/finance_assistance_jobs.go:146` captures it under the current source/User fence before reading bytes; `:25` rejects a mismatch in subsequent claim/source/provider/final phases, with the same claimed job passed by pointer through the reads at `:195`, `:212` and `:228`. It does not revoke the deliberately preserved authenticated session or impose a new durable raw-handle lifetime. `backend/platform/finance_provider_boundaries_test.go:153` exercises a paused real OCR callback crossing the actual password-change endpoint, verifies the preserved session remains usable, denies result publication, retires the job as stale and preserves the independent expense. Read evidence: `task-9-fix1-r1-red-real.log` fails specifically for pre-change publication; `task-9-fix1-r1-green.log` passes, and `task-9-fix1-r1-r2-pg.log` passes the PostgreSQL selection. The cut-off failure path was checked: existing `publishFinanceFailure` can retire only the still-owned claim after authorization loss.

2. **R2 — ADDRESSED.** `backend/platform/permission_revocation.go:172` finds definitions owned by every scope-changed principal, then retires their artifacts (`:174`), pending delivery intents (`:177`) and queued/running/ready jobs (`:180`) under the existing Company transaction. `backend/platform/report_export_jobs.go:32` denies the persistent `access_changed` retirement before ordinary result authorization, so rejoin cannot restore that consumable. No independent historical snapshot/fact is rewritten. `backend/platform/people_output_lifecycle_test.go:77` covers owner distinct from recipient for scheduled/manual exports, role change, departure/rejoin, store-Put→final publication and first→next stream chunk; manual canonical replay is also denied while snapshot reads survive. Read RED `task-9-fix1-r2-red-complete.log`, GREEN `task-9-fix1-r2-green.log`, and PostgreSQL `task-9-fix1-r1-r2-pg.log`. The fix reuses persistent retirement instead of introducing another epoch schema, as permitted by the ruling.

3. **R3 — NOT ADDRESSED completely (Important).** The text/password/editor improvements are real: web/native People projections retain measured numeric geometry and render no fetched descendants while pending; editor basis treats a temporarily absent bootstrap basis as pending; the named title/capacity/password/review controls remain mounted. The current browser evidence records five 30.5-second holds with stable geometry and `fetchedDescendantsAbsent=true`.

   **Remaining selected-replacement defect:** `frontend/src/components/DepartureHandover.tsx:231` keeps the authored selected user ID as the controlled select value, but `:264` removes every candidate option when `ready` becomes false. No neutral option preserves the selected value. For an already-chosen person, the DOM control therefore no longer has an option matching its value and becomes empty (or falls back to a different remaining option), despite the draft still retaining the original ID. On returning to ready it restores the choice. This violates the same authored value/selection continuity requested by R3; retained RAM intent alone does not satisfy that control contract. The new browser probe at `verification/runtime/people_smoke.mjs:22` holds `Replacement for task owner` **before** selecting a replacement, so its passing `valueUnchanged` assertion covers only `__choose`. The component hold likewise never selects a candidate before withholding access.

   Preserve a neutral, non-source-label option with the exact authored selected value while pending, keep the write/eligibility gate, and extend the actual compiled browser case to select a nonempty eligible person **before** the held read. Verify same node/focus/value through the complete hold and recovery, original replacement/CAS retained, and no candidate/person label or other fetched descendants exposed. Do not recover the fetched display label from a side cache. The focused semantic probe and its exact output are recorded below.

4. **R4 — ADDRESSED.** `frontend/src/data/demo-people.ts:89` separates graph validation from mutation-rank validation; `:115` skips the rank ceiling only for unchanged rows while the full founder/manager graph validation still runs. The prior explicit old-row rank check remains. The added CEO/admin regression preserves the founder and changes an eligible lower member. Read `task-9-fix1-demo-expanded.log`: seven tests pass, including this case. No higher-ranked mutation bypass was introduced in the changed branch.

5. **R5 — ADDRESSED.** `frontend/src/data/demo-people.ts:150` filters preset lists by current rank, `:155` authorizes detail, and `:294`/`:299`–`:305` validate the current original preset for update/use/apply and canonical replay before returning a stored result. Existing validation still checks the newly supplied grant. The added tests deny list/detail/edit/use of a founder preset and replay after its grant is raised. Read `task-9-fix1-demo-expanded.log` and the corresponding changed test source.

6. **R6 — ADDRESSED.** `frontend/src/data/demo-people.ts:364` rejects an existing membership by normalized email regardless of active state; the apply branch at `:416` also rejects an existing member instead of setting `active:true`. Both direct the user to explicit reactivation/edit. The founder-driven inactive-member regression verifies rejection and unchanged inactive state; it is included in `task-9-fix1-demo-expanded.log`.

## Focused remaining-R3 probe

The exact command/output is preserved **in this report**; no separate probe log or product test file was written. It ran once from `frontend`, with the installed React and happy-dom dependencies, to resolve the previously untested controlled-select behavior. It is a DOM semantic probe, not a claim that the real browser/device scenario was executed.

```sh
node --input-type=module <<'JS'
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const window = new Window();
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
const tree=ready=>React.createElement('select',{value:'fictional-selected',onChange:()=>{},'aria-disabled':!ready},React.createElement('option',{value:'__choose',disabled:true},'Choose eligible replacement'),...(ready?[React.createElement('option',{key:'fictional-selected',value:'fictional-selected'},'Fictional selected person')]:[]));
await act(async()=>root.render(tree(true)));const select=host.querySelector('select');select.focus();const before=select.value;
await act(async()=>root.render(tree(false)));const during=select.value;
await act(async()=>root.render(tree(true)));const after=select.value;
console.log(JSON.stringify({focused:document.activeElement===select,sameNode:host.querySelector('select')===select,before,during,after,valueSurvived:before===during}));
await act(async()=>root.unmount());
JS
```

Exit 0; output:

```json
{"focused":true,"sameNode":true,"before":"fictional-selected","during":"","after":"fictional-selected","valueSurvived":false}
```

## New breakage and acceptance qualifications

- No additional confirmed Critical/Important/Minor regression is counted beyond the R3 remainder. The selected-value defect is a remaining part of the original fix request, not a second duplicate finding.
- The current `task-9-fix1-race.log` now records PASS `993.988s`; the report's post-freeze amendment and controller independently confirm it supersedes the former pending status. No race suite was rerun by this reviewer.
- Current Encore export/check and actual native controller acceptance remain unresolved acceptance gates. Historical Encore success and current Hermes/component results do not replace those gates. The native open-picker tests mock React Native layout; the actual native matrix should include a populated, scrollable replacement picker and held search/focus/geometry through current-source checks, including the new projection wrapper in `mobile/src/PeopleControls.tsx:98`.
- Original R7 warning disposition remains outside this Important fix round: the demo bundle warning and Expo color warnings remain explicitly qualified; no pristine-output claim is made.
- Read current browser JSON, focused RED/GREEN logs, PostgreSQL R1/R2 result, expanded demo result, web/native owning result summaries and current race output. The R3 browser JSON's five successful holds are genuine for their exercised states; the selected-state gap is established by comparing the probe's order with the changed source and the focused semantic check.
- Focused unchanged-code reads were limited to the finance failure path cut off by the diff and caller/layout contracts affected by the changed native helper. No broad untouched-code review, subagents, product/Git/database/provider/device mutation, application runtime work or suite reruns occurred. Only this ignored review report was written.

**Open-list verdict: Needs fixes — remaining R3 selected-value continuity.** R1/R2/R4/R5/R6 are closed for this scoped source review; controller runtime gates and deferred R7 remain separately qualified.
