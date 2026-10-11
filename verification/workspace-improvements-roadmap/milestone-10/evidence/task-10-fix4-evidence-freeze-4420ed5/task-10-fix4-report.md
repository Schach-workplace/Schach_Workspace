# Task 10 formal fix round 4 — report and first-anchor container lifetime

Status: DONE_WITH_CONCERNS — final source checks pass; final clean source is recorded below and in the source manifest. SAME scoped written review, controller verification and affected actual native acceptance remain pending. This is escalation round 4 of 5, bounded to Important N2/N2b and demonstrated counterpart/fix-introduced breakage. No milestone 10 acceptance or integration/push is claimed.

BASE is `b6ba0e2260de7c1219387006b6b5b8ab5ca55aab`. Final source: `4420ed540dc253ad024ecb61b343be97b57b5b68`. Backend/Encore remain exact `98b7fb6e6df0b208715bf01f4191b950390750c7`; all 58 SQL migration pairs are unchanged. This writer performed no device, application runtime, database, provider, fixture, root-user or inference actions. Local test/build processes are separately documented below.

## Actual observations and causal owning RED

The frozen native observation established N2: actual report generation 4 enqueued successfully, but its still-running Local assistance Sheet vanished without human dismissal. The same original report later became ready and was recovered through history, without a replacement generation. Its actual five-minute source TTL has since expired and remains expired. This report does not restamp or extend that proof.

N2b is the separate first-anchor lifetime failure: actual private generation 5 retained focused authored amount 31.50 during pending reads, but the first open Source anchor picker disappeared before any anchor had been chosen. The original native owner yielded all writes, left the fixture manual-disabled and reached the six-inference cap. Root independently verified/froze 537 safe artifacts plus two reports. The native acceptance manifest remains SHA-256 `ca2219c95679a031dc65a62de5bb9c25c72ffca3c00ab7f786d4b75bfd256453`.

`mobile/src/IntelligenceLifetime.test.tsx` mounts the real WorkspaceProvider, ReportScreen, IntelligenceLauncher, ConnectUI Sheet, IntelligenceScreen, read hooks, DraftReview and ReportChoice. Only HTTP/native adapters are synthetic. The FlatList adapter renders its header and actual report launcher. Actual Workspace fifteen-second refresh and actual five-second raw-job polling produce pending reads; tests do not fabricate a context counter to mimic them.

Before product changes, `lifetime-red` failed all three owning cases: enqueue's own successful Workspace refresh already destroyed the report Sheet; ordinary fifteen-second refresh destroyed an inspected/consented Sheet; pending raw-job proof destroyed the first unchosen Source anchor Sheet. `opposites-red` retained the wider original-source failures. Each log has its original invocation source hashes.

Source causes and corrections:

| Owner | Cause | Bounded correction |
| --- | --- | --- |
| Native CurrentReportAssistance | Conditional `q.ready && q.data` mounted the entire Launcher. Pending resets inside the real read hook destroyed local open state and the Sheet subtree. | Mount the Launcher persistently; pass current readiness separately and withhold fetched source choices while pending. The selected snapshot and original owned job remain separate. |
| Native first Source anchor | `privateReview` depended only on the current raw job or an already-authored anchor. Pending removed the job before the first anchor existed, removing the entire ReportChoice subtree. | Remember only the non-sensitive private layout mode; derive options/labels/prose/write permissions from current proof. Key the interaction subtree on genuine semantic scope/binding/retirement/denial changes. |
| Existing hard-clear producer | `clearAllBusinessAttempts()` emits a new hard generation even with no attempt. The old component's undefined business-attempt snapshot did not change, so the active picker did not render/retire. | Subscribe locally through existing `subscribeAttempts` and `businessAttemptGeneration` in owning intelligence components. No shared registry or generic invalidation rewrite. |
| Named web report counterpart | A real task-version replacement changes the report query key, removing the conditional Launcher. Same-query refetch instead retains cached data, exposing old source choices and inspected preview while pending. | Persistent Launcher plus additive `checking`/`denied` report-read status consumed only at the intelligence source-selection boundary. Ordinary report data/cache behavior is unchanged. |
| Named web private counterpart | The same `privateReview` expression removed an unchosen HTML anchor select while the actual raw read was pending. | The same non-sensitive layout latch and semantic interaction key preserve the DOM selector, with current options withheld. This proves DOM element lifetime, not browser OS-popup retention. |

`web-owning-red` proves both named report failures with the real Store, ReportsPage, report queries, Modal and raw reader, mocking only fetch. `web-anchor-red` proves the private select disappearance on that owning path. Root explicitly authorized these demonstrated web counterparts; no other milestone was reopened.

The standalone `hard-retirement-red` is retained. An earlier intermediate native-focused invocation coupled hard clear to a subsequent Workspace refresh; it is explicitly not standalone retirement proof. The final tests call the actual hard-clear producer alone, verify retirement before late callbacks and retain all ordinary-refresh opposites.

## Deliberately selected report versus latest summary nonce

Backend source inspection showed that `report_reads.go` issues a new report token on every summary GET, even if facts are identical. It retains prior snapshots for their original five-minute lifetime subject to bounded eviction. `intelligence_sources.go` validates the exact original snapshot's company/actor/TTL, every selected row's current version, and its complete root ACL set; the selection hash includes its original immutable token, generation time, period, metrics, rows and summary. Equality of visible summary metrics alone is not authorization.

An intermediate implementation reset inspection whenever the latest token rotated. The preserved `native-rotating-red` and `web-rotating-red` expose that usability failure. Root amended the brief to approve the exact-selected proof design:

- The human-selected original snapshot stays selected. Parent refresh hides its source choices, inspected preview and fresh Generate; the existing no-inference selection-preview endpoint independently reauthorizes that exact original selection.
- Existing human inspection/consent is restored only when positive current proof has the original selectionHash and policyVersion. It is not automatically inspected or acknowledged again. Temporary read readiness does not retire human intent.
- Choose latest report facts is an explicit action. It replaces the selected handle, clears inspection/consent, and requires another human review/opt-in. Original snapshot expiry, removal, changed version/root ACL or denied access never substitutes a newer snapshot automatically.
- Hash or policy changes retire the inspected preview and consent. Actor/company/session/client generation/read basis/policy/background/unmount/operation/selection and standalone hard retirement fence late success and late error callbacks. A timer withholds expired inspected proof without waiting for polling; the action checks expiry again immediately before a fresh enqueue.
- The original already-enqueued job is independent: only its current raw-job/source proof can show its frozen facts. Its body, period, selection and request identity are never rewritten to the latest summary. A frozen unknown enqueue still uses its exact original body/key.

No backend, token TTL, global cache, Workspace bootstrap semantics, generic read readiness or registry behavior changed. This adds bounded read-like preview revalidation, not inference. Original report source errors conservatively retire inspection; a user can explicitly choose current latest facts. Generic task/finance and unknown-publication controls remain covered by the complete pre-existing suites.

## Coverage and precise qualifications

The new native owning file has 60 cases:

- Same open report Sheet and original running-to-ready job through the real ordinary refresh, including enqueue's own refresh; current raw proof may expose that same job while the live report remains pending.
- Inspected/consented continuity, three successive rotating summary nonce cycles, independently held original-selection proof, explicit latest choice, genuine original hash/policy/expiry/removal/ACL changes, scheduled expiry, and immediate enqueue expiry guard.
- Overlapping inspection stays hidden until equivalent current proof; unknown enqueue retains its original body/key through pending reads and deliberate latest selection.
- Seventeen genuine report source/authority/intent/retirement changes each reject late success and late error (34 cases).
- First private picker retains the same Sheet while current options/prose are withheld; authored amount node, focus and value survive. Twelve source/result/candidate/company/actor/policy/read-basis/client/session/foreground/denial/hard changes retire the picker.

The new web owning file has 33 cases: both current-report query lifetime paths, rotating nonce with held exact-original proof, explicit latest selection after five proof opposites, original running/ready job separation, twelve late-response opposites each with success/error (24 cases), and the first private anchor select's pending/equivalent/source-change/standalone-hard behavior. Existing component cases retain broader company/session/foreground/private canonical replay coverage. Actual browser OS-dropdown retention is not inferred.

All 48 adopted action rows remain in `task-10-fix4-case-mapping.json`; the relevant 8.3/8.4/9.2/9.4 rows add round-4 evidence without inventing a forty-ninth action. Existing N1 real-Workspace tests, raw-expiry versus genuine denial, supported-action withholding, task/expense/intake reviewed publication and unknown exact retry are retained in the full suites.

## Final verification

All final invocations began at BASE with dirty client bytes now identical to the final committed client/shared inputs. Each invocation records UTC times, actual argv/cwd, exit code, duration and all 392 client/shared SHA-256 values in its own `task-10-fix4-<label>-source.json`. Source equivalence verifies every final invocation independently. Root coordination docs are outside compilation inputs and included in the final clean source manifest.

| Label / working directory / command | Final result |
| --- | --- |
| native-full-final / mobile / `npm test` | Exit 0; 52 files, 347 tests, 66.59s Vitest duration |
| web-full-final / frontend / `npm test` | Exit 0; 69 files, 339 tests, 10.61s Vitest duration |
| native-types-final / mobile / `npm run typecheck` | Exit 0 |
| web-types-complete / frontend / `npm run typecheck` | Exit 0 |
| native-lint-complete / mobile / `npm run lint` | Exit 0; no warnings/errors |
| native-export / mobile / `npm run export -- --output-dir <evidence>/task-10-fix4-mobile-export` | Exit 0; Android and iOS Hermes bundles; 37.372s wrapper elapsed |
| web-build / frontend / `npm run build -- --outDir <evidence>/task-10-fix4-web-dist` | Exit 0; TypeScript and normal build |
| web-demo / frontend / `npm run build:demo -- --outDir <evidence>/task-10-fix4-web-demo-dist` | Exit 0; TypeScript and demo build |
| format / frontend / installed Prettier `--check` on all eleven changed client/test paths | Exit 0 |
| diff-check / repository / `git diff --check` | Exit 0 |

`<evidence>` is the absolute worktree `.superpowers/sdd/2026-10-10-workspace-improvements-roadmap` directory; exact unabridged argv are in checks/invocation manifests. Dedicated ignored build outputs preserve prior build artifacts. Build warnings are retained: existing large-chunk warnings at 926.08 kB normal / 975.60 kB demo, intentional external-outDir non-emptying notice, and Expo NO_COLOR/FORCE_COLOR notice. No runtime or device acceptance is inferred from Hermes export.

Earlier results are not substituted for these checks:

| Retained evidence | Qualification |
| --- | --- |
| lifetime-red, opposites-red | Untouched owning native failures at BASE; source hashes retained. |
| lifetime-first-green, hard-retirement-red | Standalone hard-clear failure retained; the first label is historical and does not mean exit 0. |
| native-focused, native-lifetime-green | Intermediate 114/72 passes, before exact-selected proof; the earlier hard case required explicit refresh and is separately superseded. |
| web-owning-red, web-anchor-red | Actual owning web counterpart product failures before respective fixes. |
| web-notification-red / green | A fix-introduced pending inspection busy flag stayed set after event invalidation. Owning RED preceded adding busy reset at that existing invalidation boundary; both success/error opposites passed afterward. |
| native-rotating-red, web-rotating-red | Intermediate latest-token reset failed real rotating-nonce behavior; exact-selected architecture ruling followed source/API inspection. |
| native-selected-first, web-selected-first | Old token-change expectations plus held mock proof, not final acceptance; adjusted to genuine original proof changes and explicit latest selection. |
| native-selected-opposites, web-selected-opposites | New fixture issued another nonce during enqueue's own refresh; assertion incorrectly compared submitted selection to that later nonce. Capture the deliberate selected handle instead. Web notification test also released the new independent proof as an obsolete error; now its current proof succeeds separately. |
| web-full | Initial full run exited 1: 337 passed / 2 failed. Hash/policy late-error cases settled the obsolete callback while the replacement proof was still pending. They now wait for the actual positive changed proof and its retired busy state, then settle both late outcomes. No fabricated rerender or denial substitution. Final full rerun is separate. |
| native-lint-initial, native-lint | Intermediate warnings were corrected; later render-time Date.now violated purity. The timer moves expiry to a state transition and the action retains its wall-clock guard. Final clean lint is separate. |
| native-full | Intermediate 346 passes before scheduled-expiry addition; final full run has 347 and exact final hashes. |

The expected-failure and intermediate sections of checks.json retain every invocation, not only those summarized above. No Go, race, PostgreSQL, Encore, provider or actual native reruns occurred. Their accepted previous evidence remains historical and applicable only through exact unchanged backend/Encore/SQL equivalence; no repeat twenty-minute race or new inference was used for client fixes.

## Self-review, source ownership and remaining gates

Self-review checked the BASE-to-final diff against the binding brief and actual producers: no shared invalidation changes, pending privacy gates remain, the first-picker latch contains no raw job/options/prose/audience, exact selected report proof is separate from latest nonce, original owned/unknown requests remain frozen, and standalone hard clear produces a render before late callbacks. Types, lint, both full suites, both web builds and both Hermes exports are complete. No subagent/helper/reviewer was spawned by this writer.

Root owns only `docs/AI_HANDOFF.md`, `docs/AI_CHECKLIST.md` and `docs/AI_FILE_INDEX.json` under the explicit live-coordination exception. This writer requested the final capture/yield handshake after source checks stabilized and preserves/includes all three in the natural clean commit. Final source manifest binds all tracked paths, Git blobs, SHA-256 values, source provenance and the full BASE-to-final package.

Named outputs are `task-10-fix4-source-manifest.json`, `task-10-fix4-sql-manifest.json`, `task-10-fix4-build-manifest.json`, `task-10-fix4-checks.json`, `task-10-fix4-source-equivalence.json`, `task-10-fix4-case-mapping.json`, `task-10-fix4-safe-evidence.json` and the aggregate `task-10-fix4-manifest.json`. Original `task-10-report.md` has a round-4 appendix. Previous proof/failure logs, native freezes and provider qualifications remain untouched.

The first manifest whitelist scan rejected a generic root-coordination metadata field name matching its credential-key pattern. The value contained only the root yield ruling; the field was renamed `coordinationRuling`, preserving all captured document hashes. This metadata-only audit correction is retained in `task-10-fix4-manifest-audit.json`; no client bytes or test invocation changed.

Published evidence is an explicit whitelist of synthetic test logs, safe reports and source/build/hash metadata. No actual private source/model prose, request bodies/digests, credentials, environments, stores or native device captures were copied. Build binaries are hash-referenced only. The prior safe native reports retain their original qualification and hashes.

After root's independent source/manifests verification, the SAME scoped reviewer must review N2/N2b and new-fix breakage. Only after written approval may the original native owner refresh affected JS and prove a fresh actual current-report selection/preview/consent/open Sheet across refresh **without generation**. Report 4 remains naturally expired; original running-to-ready observation stays historical and separate from automated owning coverage. Native N2b may use SAME existing private 5 only while genuinely authorized/current, without TTL extension or another generation. Browser DOM tests and exports do not replace these device observations. Controller acceptance, final integration/main and push remain gated.
