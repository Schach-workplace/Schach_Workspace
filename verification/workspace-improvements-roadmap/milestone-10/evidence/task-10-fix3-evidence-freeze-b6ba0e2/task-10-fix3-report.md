# Task 10 fix round 3 — native review continuity through ordinary refresh

Status: DONE_WITH_CONCERNS — clean source handoff; final client verification passed. Scoped written review and actual native acceptance remain pending. BASE `5004b5bcbe777d8779287c4c618c344393105529`; final source `b6ba0e2260de7c1219387006b6b5b8ab5ca55aab`. Product commit `ca13ef32702bd583f9d90603eb84bbf205c4738b` is followed only by a coordination-doc status commit; final client bytes are identical. Backend/Encore remain exact `98b7fb6e6df0b208715bf01f4191b950390750c7` and all 58 SQL pairs remain immutable. No device, runtime, database, provider or inference actions occurred in this round.

## Finding and diagnosed correction

The preserved actual native observation is reported in `task-10-native-fix2-refresh-blocker.md`: preview returned 200, acknowledgement appeared then disappeared while ten raw reads returned 200 and RAM comparisons showed unchanged job/result/source/actor/readBasis/current record. The original runtime did not record precise per-render scope correlation. This round establishes the causal producer-to-consumer failure in an owning test using the actual `WorkspaceProvider.refresh`, actual mounted `IntelligenceScreen`, read hooks and review. Only HTTP/platform adapters are synthetic. Before the fix, three owning continuity cases failed after unchanged actual fifteen-second refresh; they passed after the minimal scope correction.

Actual Workspace unconditionally increments attentionEpoch and executionEpoch after a positive ordinary refresh; recordEpoch advances for business notifications that require reauthorization. These are read triggers, so they remain in `useExecutionRead` and continue withholding current private data and gating writes while reads are pending. They no longer reset the inspected human review by themselves. Current positive semantic binding, genuine authority loss and hard retirement still determine whether that review can survive.

| Scope/control | Actual producer semantics and retained behavior |
| --- | --- |
| recordEpoch | Business notification invalidation; retained read trigger, removed only from review identity. A changed source/result still retires review after current proof. |
| attentionEpoch, executionEpoch | Ordinary successful refresh counters; retained read triggers, removed only from review identity. |
| policyEpoch | Genuine confirmed bootstrap authority changes or explicit private invalidation; retained review retirement. |
| readBasis | Confirmed current authorization basis; retained scope and semantic binding. |
| client.generation | Session/private/client lifetime; retained scope guard. |
| endpoint, company, actor | Retained semantic scope, attempt registry and read controls. |
| foreground | Background invalidates review; returning requires current proof. |
| hard retirement generation | Retained shared attempt-generation binding and late-preview guard. |
| job/result/source/version/candidate/human fields | Retained semantic inspected binding and late success/error rejection. |

No Workspace, generic cache, global bootstrap-pending state, shared registry, read-cleanup site or backend was changed. Ordinary bootstrap start is not new global authority loss; the overlapping-preview regression holds the selected raw read and bootstrap, proving fetched/private output withheld until the selected current read becomes positive.

Self-review found a concrete related gap: with review continuity restored, supported-actions GET could still be pending while raw job was current, exposing the old audience and enabling Confirm. Both actual native consumer and web consumer produced meaningful RED. Both now require a current supported chosen action before showing a private preview or allowing fresh Preview/Confirm. Current action removal withholds the old review. This gate does not constrain an unknown original canonical retry, which continues to require independently current publication-access and retains the original body/key/target.

## Owning verification and qualifications

`mobile/src/IntelligenceWorkspace.test.tsx` contains 30 tests using the real Workspace producer:

- Ordinary 15-second refresh and 5-second polling preserve inspected acknowledgement, including an overlapping preview response, then another complete refresh and exactly one canonical submission. During the held selected raw read, the same human editor remains mounted/focused with its value; private result/source/audience are hidden and Preview/Confirm gated.
- An actual inbox business event advances recordEpoch and reauthorizes the source without inventing new human intent.
- Twelve source/result/basis/policy/actor/client/hard/candidate/edit/foreground/unmount/denial changes each reject late preview success and late preview error (24 cases), with no stale acknowledgement or canonical publication.
- Unknown canonical submission after synthetic ACK loss keeps its exact original body through refresh and later visible edits. Retry stays disabled while independent proof is pending, and succeeds with the original body after proof even while fresh supported-actions reads remain pending.
- Held supported-actions proof gates audience/Preview/Confirm; equivalent positive proof restores the inspected review. Removal of a selected supported action keeps the review withheld.

Web adds its own held supported-actions consumer regression. Full prior owning client tests retain raw-expiry versus genuine denial, late ACK, source/private retirement and canonical replay coverage. These are synthetic React/DOM adapter tests, not installed Android geometry or a fresh native acceptance claim.

| Final command | Result |
| --- | --- |
| mobile `npm run typecheck` / `npm run lint` | PASS |
| mobile `npm test` | 51 files, 287 tests PASS; 64.11s |
| mobile `npm run export` | Android+iOS Hermes PASS; existing NO_COLOR/FORCE_COLOR warning |
| frontend `npm test` | 68 files, 306 tests PASS; 7.08s |
| frontend `npm run build` / `npm run build:demo` | TypeScript and builds PASS; existing large-bundle warnings now 924.04/973.57kB |
| Prettier check on four changed client/test paths; `git diff --check` | PASS |

The invocation-source manifest captures final dirty client/shared bytes at BASE5004; final source-equivalence verifies those exact bytes at b6ba0e2260de7c1219387006b6b5b8ab5ca55aab. Earlier native full/export results under `before-actions-*` are intermediate and are not substituted for the final checks. The initial new test had four implicit-any callback typing errors, retained in `test-types-failure.log`; these are harness typing failures, corrected before final checks. Genuine product RED logs are separately named producer-red/actions-red/web-actions-red. Earlier proof qualifications, failures, provider deadline limits and native blockers remain historical at their original sources.

No Go/race/PostgreSQL/Encore/provider rerun occurred: exact unchanged backend/Encore and 116 mirrored migration files bind their accepted previous proof. Source manifests retain the full multi-commit milestone provenance from reviewed M9 backend 8f24 through the f2 client overlay and M10, plus the exact 5004-to-final round diff. All 48 adopted action rows, ten slices, 45 dependency pairs and 17 groups remain; no fabricated forty-ninth action row.

## Handoff and remaining gates

Root authored only `docs/AI_HANDOFF.md`, `docs/AI_CHECKLIST.md`, and `docs/AI_FILE_INDEX.json` under the explicit coordination-document exception requested by the user. The sole product/Git writer waited for completion and committed those documents with this round. They do not alter client compilation inputs. Source manifests include them.

Separate manifests are `task-10-fix3-source-manifest.json` (`trackedFiles`), `task-10-fix3-sql-manifest.json` (`files`), `task-10-fix3-build-manifest.json` (`artifacts`), and `task-10-fix3-manifest.json` (`files`, safe evidence whitelist). Supporting `checks`, `source-equivalence`, `case-mapping`, and `invocation-source` JSON files bind checks and coverage. Previous fix1/fix2 manifests and native freezes remain untouched.

Privacy boundary: published evidence contains synthetic test output and safe source/build/hash metadata only. No actual model/source prose, canonical bodies/digests, tokens, environment/store files, device captures or private native runtime artifacts are copied. The prior blocker report remains controller-sanitized and explicitly historical. There was no additional inference.

SAME original reviewer must assess scoped N1 and new-fix breakage, including action-proof gating. After written approval, the original native owner must refresh current clients and reuse the SAME retained one-generation ready job to prove acknowledgement stability and final canonical publication. Milestone 10/controller acceptance, final integration and private push remain pending. No device success is inferred from these tests.
