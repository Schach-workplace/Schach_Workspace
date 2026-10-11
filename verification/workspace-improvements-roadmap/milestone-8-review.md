# Milestone 8 independent task review

## Spec Compliance

**❌ Issues found.** Reviewed BASE `e84d3a3735d57cb0935a04c8a5b89b93d4c2dc92` through HEAD `51dbd8cbc51afc91e28723c6037d24f909b024df` against the task brief, binding amendments, finalized seven-slice plan, and global constraints.

- All seven planned areas have implementation and evidence: planning projections; advisory warnings and M5 schedule handoff; goal metadata/measurement ledger; exact authorized evidence; opt-in attention reminders; web surfaces; native surfaces. No unrelated feature expansion found.
- Missing/broken behavior: native preference saving (R1); recoverable rejected goal edits and deliberate version replacement (R2); authorized transfer of inactive goal ownership (R3); explicit numeric native measurement input (R4); invalid legacy planning numeric coverage (R5). Warning thresholds also use rounded rather than underlying effort (R6).
- ⚠️ Controller-owned Android acceptance remains a separate pending gate. This review did not drive an emulator or runtime. The controller's actual native nested-list observation is recorded in R7 without claiming physical-device acceptance. Physical Android/iOS, screen readers, background push, signing, and rollout remain unverified here, as the contract permits.
- ⚠️ This is the milestone gate, not a fresh verification of every unchanged finance, task-acceptance, deployment-region, or earlier-milestone requirement. The diff does not introduce an alternative task engine or automatic goal updates from task/report/reminder activity.

## Strengths

- The measurement write path separates immutable observations/corrections from the current selector and preserves canonical retry results (`backend/platform/goal_measurements.go:95`, `:138`, `:176`). The supplied retry, correction, and task-independence evidence exercises real backend behavior.
- Evidence bindings avoid copying private content into storage and independently project current source access (`backend/platform/goal_evidence.go:149`, `:166`, `:184`). The report adapter checks the complete source manifest (`backend/platform/report_history_access.go:16`).
- Planning discloses full-per-overlapping-week effort and recorded capacity semantics (`backend/platform/planning.go:123`), and proposal execution reuses the existing M5 schedule workflow (`backend/platform/task_schedule.go:288`, `:354`).
- The current-read fence change has unusually useful failure-before/fix-after PostgreSQL evidence. The supplied RED shows stale planning/private-source disclosure after waiting; final GREEN shows the company/member waits followed by current planning exclusion/private-source denial. The named source-writer and transaction callsite inventories support the concurrency amendment.
- Migrations preserve legacy Current without inventing measurements. Source, SQL, artifact, and evidence manifests matched their recorded hashes when inspected; all 98 backend/Encore migration counterparts matched byte-for-byte, including the 94 predecessor files marked unchanged.

## Issues

### Critical (Must Fix)

None identified.

### Important (Should Fix)

**M8-R1 — Native reminder preference submission includes forbidden response fields.**

Location: `mobile/src/GoalReminderPreferences.tsx:38`, `:53`; `backend/platform/goal_reminders.go:153`, `:169`; `backend/platform/server.go:356`.

The prefill spreads the entire fetched preference into the draft. Save removes only `authored`, then submits the remaining object. The normal fetched preference contains response-only fields including `goalId`, `userId`, `version`, `createdAt`, and `updatedAt`; none belongs to `goalReminderInput`. The shared decoder rejects unknown fields, so the normal native opt-in/change flow returns HTTP 400 `invalid_json`, before saving anything. This is not merely an optional-field validation edge case. The web form already explicitly constructs its mutation payload.

Fix: construct a typed, allowlisted native request with only expectedVersion, reason, enabled, cadence, weekday, monthDay, and localTime; let the mutation layer add the retry key. Add a native form test using a complete real read DTO and strict request validation, including transport retry. The supplied native tests do not cover that full DTO-to-request path.

**M8-R2 — Rejected goal edits cannot reliably recover while retaining scoped RAM state.**

Location: `frontend/src/components/GoalMetadataForm.tsx:72`; `frontend/src/components/GoalReminderPreferences.tsx:70`; `mobile/src/GoalMetadataForm.tsx:89`; `mobile/src/GoalReminderPreferences.tsx:56`; `mobile/src/GoalMeasurementForm.tsx:49`, `:203`. Supporting shared behavior: `frontend/src/data/execution.ts:257` and the corresponding native mutation/attempt implementation.

Metadata and reminder forms always reuse `action.attempt.payload` once an attempt exists. The mutation hooks retain attempts for ordinary 400/409/422 errors. These forms expose no deliberate discard/new-intent or Load latest path. For example, submitting invalid metadata freezes the invalid payload; correcting visible fields still resubmits it. A concurrent version update similarly leaves an unrecoverable stale attempt across close/reopen because the attempt and authored draft intentionally survive in RAM.

Native measurement offers an abandon-and-inspect action, but it only clears the attempt and refreshes the queries. Its prefill refuses to replace an authored draft, so its captured stale expectedVersion remains after refresh/remount and the next submission conflicts again. The web measurement form's explicit Load latest operation correctly demonstrates the needed separate action.

Fix: provide deliberate recovery that retires a rejected/abandoned intent, then replaces the relevant fields **and captured version** from a currently authorized entity when the person chooses Load latest. Preserve an uncertain transport attempt for same-key retries. Verify invalid input → edit → successful new intent and concurrent update → explicit load latest → successful save on web and native; include remount without a JS reload.

**M8-R3 — Metadata transfer rejects the inactive owner it is supposed to replace.**

Location: `backend/platform/goal_measurements.go:383`, `:393`, with `measureAuthority` at `:39`.

The metadata update path calls `measureAuthority(tx, a, old)` before applying the new owner. That helper rejects an inactive old owner with “Transfer inactive ownership before recording a measurement.” Thus even authorized leadership cannot perform the required transfer of a readable inactive-owner goal to an active owner: the transfer itself receives the measurement-only precondition error. The plan explicitly distinguishes validating the active destination for metadata from validating the existing active owner for a measured update (`docs/superpowers/plans/2026-10-11-planning-outcomes.md:108`).

Fix: authorize metadata changes against the old scope without requiring old-owner activity, then validate the active destination/current department and the new scope. Keep the stronger check for measurements. Add an inactive-owner transfer regression proving the authorized transfer succeeds without changing Current or adding a measurement, while unauthorized transfers and measurements before transfer remain denied.

**M8-R4 — Clearing the native measured-value field silently submits zero.**

Location: `mobile/src/GoalMeasurementForm.tsx:80`, `:119`, `:194`; the bundled initial-measurement conversion also occurs at `mobile/src/GoalMetadataForm.tsx:84`.

The native input is a string, but submission uses `Number(draft.value)` and the guard checks only `Number.isFinite(Number(draft.value))`. An empty or whitespace-only field therefore becomes valid numeric zero. With the other fields supplied, clearing the value leaves Save enabled and appends a real zero observation, potentially changing Goal.Current. Backend explicit-value validation cannot detect this because the client has supplied a numeric zero.

Fix: require nonempty trimmed numeric input before conversion and submission, including bundled measurements. Preserve explicit `0` and negative measurements as valid inputs. Add a native regression that clears the input and proves no mutation occurs, then enters `0` and proves the explicit observation can be saved.

**M8-R5 — Invalid legacy numeric rows can fail the whole planning response before coverage classification.**

Location: `backend/platform/planning.go:182`, `:193`, `:206`, `:257`. Concrete predecessor compatibility check: `backend/migrations/1_initial.up.sql:40` permits positive infinity in `estimated_hours`/`actual_hours` through its nonnegative-only checks.

The projection basis first JSON-marshals raw Task and Membership models. Only afterward does it classify nonfinite/invalid task estimates and capacity. A legacy task with positive-infinite estimated hours reaches `encoding/json` and returns an unsupported-value error, so summary/warnings/drill fail instead of excluding the bad numeric value and reporting invalid coverage. Even an invalid ancillary raw numeric field such as ActualHours can break the projection hash although planning does not use it. The explicit finite checks later in the function never run for these rows.

Fix: construct a deterministic, bounded projection basis that represents invalid numbers with explicit nonnumeric markers and includes only relevant fields, or normalize before serialization while preserving invalid-coverage semantics. Add a focused legacy nonfinite-row fixture to prove a finite response with invalid coverage and no fabricated utilization; do not merely reject all planning for that company.

### Minor (Nice to Have)

**M8-R6 — Capacity warning thresholds use rounded displayed effort.**

Location: `backend/platform/planning.go:256`; `backend/platform/planning_suggestions.go:55`, `:59`.

RemainingHours is rounded to one decimal before warning comparisons. Thus 40.04 hours against 40 suppresses a true overcapacity warning, 0.04 against recorded zero suppresses the zero-capacity warning, and 40.06 against 40.07 produces a false warning after rounding to 40.1. Compare unrounded effort and capacity, rounding only display fields. Add threshold cases on both sides of zero and positive capacity. This is a bounded precision defect in the specified advisory calculation, not an automatic allocation risk.

**M8-R7 — Native evidence picker nests a virtualized list inside the measurement sheet's ScrollView.**

Location: `mobile/src/GoalEvidencePicker.tsx:105`; `mobile/src/GoalScreen.tsx:209`; existing wrapper `mobile/src/ConnectUI.tsx:97`.

The measurement sheet uses the default scrolling Sheet, and its child evidence picker renders a same-orientation FlatList. The controller independently observed the resulting React Native VirtualizedLists LogBox on the actual milestone build. The composition defeats the promised list virtualization and adds runtime noise; this review does not claim that every picker gesture is broken. Use a single scroll owner, for example a virtualized sheet body with form header/footer or a separate bounded picker surface, and have the controller verify selection/scroll/focus at the intended phone sizes.

**M8-R8 — Reported verification output is not warning-free.**

Location: `mobile/src/GoalEvidencePicker.tsx:56`, `:204`; `mobile/src/GoalMeasurementForm.tsx:55`; `mobile/src/GoalReminderPreferences.tsx:43`.

`task-8-artifacts/slice7-final-lint.log` contains four new hook dependency warnings at these locations. Correct effect dependencies/structure so source denial, prefill, and callback behavior have explicit dependencies without clobbering authored input. The export log also contains a NO_COLOR/FORCE_COLOR environment warning; clean up the verification environment separately. The report's wider-format/pre-existing PostgreSQL migration diagnostics are acknowledged limitations rather than newly introduced source defects; changed-file formatting and the isolated baseline comparison were supplied.

## Evidence and review boundaries

- Read the complete supplied 9-commit diff in bounded sequential chunks, the brief/plan and amendments, implementer report, named evidence, and manifests. Inspected all seven slices rather than trusting the report's verdicts. No tests were rerun and no source, Git state, database, or runtime was changed.
- Additional targeted context addressed concrete risks: shared access transaction bodies and report capture callsites for changed isolation/fence order; company/session/member/user and communication-retention locks for private-source races; ALL-source report authorization; strict JSON decoder for R1; shared frozen-attempt/RAM lifecycle for R2; existing scope predicates for R3; original numeric SQL constraints for R5; existing Sheet scroll ownership for R7. Cut-off transaction/mutation helper hunks were read through their function boundaries. Small follow-up excerpts/line lookups identified finding locations; there was no second full diff review or general repository crawl.
- Hash verification: final source manifest 100 records (86 source, 12 web build assets, 2 Hermes artifacts), evidence manifest 183 records, SQL manifest 98 records all matched. These checks establish artifact identity, not behavioral proof beyond the logs inspected.
- Backend evidence inspected includes `backend-final-all.log` (all Go packages pass), `m8-pg-final.log`, `m8-sqlite-final.log`, PostgreSQL race evidence, slice RED/GREEN logs, `m8-current-read-app-red.log` and `m8-current-read-app-final-green.log`, two-company checks, explicit-value/UTC-projection regressions, and current-source writer inventories.
- Client evidence inspected includes `slice6-final-test.log` (62 files/224 tests), `slice7-final-test.log` (46 files/185 tests), `native-late-green.log` (3 files/28 tests), type/changed-format output, lint output, native exports, and schedule first-edit regression evidence. These passing tests do not exercise the failing full native preference DTO, rejected-intent recovery, or blank native value cases above.
- Runtime evidence inspected includes the disposable fresh/populated migration checks, repeated full-GORM legacy preservation, actual exported TCP API workflows, and web browser results at 320/375/430 pixels and enlarged text. The recorded web refresh/focus hold, lost-ACK same-payload retry, and older correction checks are positive evidence for those exact paths. Numbered-migration-then-full-GORM finance constraint failure was compared against predecessor 47 and is not attributed to this change.

## Assessment

**Task quality: Needs fixes.**

The ledger, authorization fences, source binding, and verification trail are substantial and well targeted. Native mutation construction and goal-editor recovery still block ordinary user workflows, and the ownership-transfer/invalid-numeric paths miss explicit requirements; fix R1–R5 and validate the targeted cases before approving this milestone gate.
