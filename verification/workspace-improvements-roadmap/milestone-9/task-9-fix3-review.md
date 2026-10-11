# Finding verdict

**N1 — Native decimal capacity editing, validation and lifecycle: ADDRESSED at source level.** Reviewed `b62df25dce03adffa2eab2d6f10faef6c956e00b` → `334a9ad6be8a53e4870e2691c272cc16781965bd`. Actual Android typing/keyboard/hold acceptance remains controller-owned and pending.

- `mobile/src/PeopleControls.tsx:180` renders the exact authored `capacityInput` rather than stringifying the parsed number on every keystroke. `:181` stores that text through the existing parent draft setter and updates the numeric value only for complete valid input. Intermediate `31.`, blank and invalid values remain editable; no TextInput key or selection rewrite is introduced.
- `mobile/src/peopleCapacity.ts:6` accepts complete decimal values in 0–168 and rejects blank, trailing decimal, nonfinite and out-of-range input. Omitted capacity remains valid for partial membership patches. `:16` validates again and removes the UI-only text before constructing a numeric submission, preventing the retained last finite number from bypassing invalid authored text.
- All four send boundaries use that validation and sanitization: `mobile/src/PeopleOnboarding.tsx:87`, `mobile/src/PeoplePresetEditor.tsx:63`, `mobile/src/AccessReview.tsx:70`/`:82`, and `mobile/src/PeopleMembershipEditor.tsx:36`/`:45`. Their action controls also block invalid new submissions. Preset unknown-outcome retry retains its already-sanitized original frozen payload. The change preserves membership versions and other fields rather than rebasing CAS.
- Exact text is an optional field in the existing scoped RAM object, not a second store or local fetched-data cache. The focused unchanged `useRamInput` setter/clear contract was checked for this new field. Existing deliberate current-membership/preset initialization replaces the object without `capacityInput`, including when its numeric value equals the previously parsed value. Existing scope clearing therefore clears the intermediate text as well.
- `mobile/src/PeopleFlows.test.tsx:341` strengthens the pending-read case to retain incomplete `31.` with the same node, focus and selection before completing `31.5`. The new test beginning at `:479` covers sequential decimal input, blank/range/nonfinite cases, same-numeric `40.` → deliberate current `40`, draft clearing, exact `31.5` submission and unchanged expectedVersion. The three additional entry-point cases verify invalid actions stay disabled and send only a finite number without `capacityInput`.

# New breakage in the fix diff

**None identified.** Critical: 0; Important: 0; Minor: 0. The seven-file native diff is limited to the shared capacity editor, its four callers, the narrow parser/submission helper and covering tests. Prior R1–R6 were not reopened.

# Verification checked

- Read the complete bounded fix diff, controller N1 brief, scoped re-review contract and final report section. No suite was rerun.
- `task-9-fix3-red.log` records the genuine `31.` → `31` failure. `task-9-fix3-validation-red.log` records three invalid-send guard failures; its other seven cases were outside that focused selection, not omitted from the owning suite.
- `task-9-fix3-focused-same-value-load.log`: 10 tests pass, including the final same-numeric reload strengthening. `task-9-fix3-native-all.log`: 208 tests/48 files pass on final production source. The later focused assertion change is explicitly covered by the final focused result. Final typecheck/lint logs were read.
- Independently matched manifest byte lengths and SHA256 values for all 7 changed source files, 37 current fixround3 artifact entries and 18 fixround3 evidence entries: zero mismatches. Manifest HEAD is `334a9ad6be8a53e4870e2691c272cc16781965bd`; the equivalence report names unchanged backend/Encore/frontend/shared groups. Previous equivalent backend/web/runtime proofs were not rerun or presented as new runs.
- No source/Git/runtime/database/provider/device mutation, helper dispatch or additional test execution occurred. Only this ignored review report was written.

# Out-of-scope observations

None newly identified. Prior R7 demo bundle warning remains separately tracked. Component tests and current Hermes artifacts do not establish actual Android input/cursor/keyboard/30-second hold acceptance, physical-device or iOS/signing acceptance.

# Verdict

**Spec compliance for N1: compliant at source level. Task quality: Approved for this scoped fix.**

**Fix round: All findings addressed, no new Critical/Important breakage.** Open scoped findings: none. Controller actual Android typing and affected hold verification remain required before milestone acceptance.
