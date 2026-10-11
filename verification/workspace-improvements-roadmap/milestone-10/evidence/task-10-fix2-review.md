# M10 fix round 2 — scoped review

**Spec: PASS within the dispatched N1/M1 and fix-introduced-breakage scope. Quality: Approved.** Both findings are addressed in the reviewed source. No new Critical, Important, or Minor finding was identified. Installed-native acceptance remains pending; this written approval permits the controller's separately owned affected-native refresh and acceptance work, and does not certify that work as complete.

## Reviewed boundary

- BASE `88af09b91dcdf0da0e02739b080713e8088b8f74` → HEAD `5004b5bcbe777d8779287c4c618c344393105529`: one commit, seven client/shared paths.
- Read the complete supplied `review-88af09b..5004b5b.diff` once in manageable passes. Independently checked its bytes: 37,406 bytes, SHA256 `71be696fdd117afa26a3cbf6a02a75c309b931ef3af97846ce2684c22e193c75`.
- Applied `task-10-fix2-rereview-preparation.md`, `task-10-fix2-brief.md`, the adopted current contracts, the preserved initial/fix1 review dispositions, and the task reviewer instructions. Read the fix2 report, original report's round2 appendix, native blocker, current verification records, covering test bodies, and supporting final/RED outputs. Reports and case mappings were evidence, not substitutes for source review.
- No product, Git/index/HEAD, database, provider, runtime, or device changes; no helpers and no test reruns. Reading resolved the concrete questions, so an additional focused execution was unnecessary.

## Finding dispositions

### Important N1 — ADDRESSED in source; installed-native acceptance still pending

The old dependence on fetched-object identity/pending transitions could discard a deliberately inspected audience during the real native five-second read cycle. A preview could also finish successfully while the read was pending and then be discarded by the equivalent positive read. That is sufficient to explain the reproduced missing acknowledgement/disabled Confirm sequence; the original installed-device HTTP200 observation alone did not establish the exact timing of every invalidation.

`shared/intelligence/publication.ts:173` now computes a stable review identity from the job/state, result and source hashes, selected candidate/action, publication metadata, and source identity/version/hash/field metadata. Equivalent freshly parsed responses have the same identity. The identity does not duplicate candidate or source prose; the result hash binds the candidate content.

Both consumers distinguish a temporarily absent pending value from a changed positive binding: `frontend/src/components/IntelligenceDraftReview.tsx:107` and `mobile/src/IntelligenceDraftReview.tsx:138`. Pending reads preserve the local review state and human editor, while the existing current-job render and authorization gates withhold fetched result/source/citation/audience content and prevent new creation. A positive equivalent read can restore the already inspected audience and acknowledgement. A changed binding, terminal authorized absence, changed authority scope, or hard retirement clears them. Human edits still invalidate preview and acknowledgement.

The preview response guards additionally compare the captured global retirement generation for both success and error (`frontend/src/components/IntelligenceDraftReview.tsx:167`, `mobile/src/IntelligenceDraftReview.tsx:210`). Existing scope/revision and unmount guards remain. This closes the concrete late-preview-after-hard-retirement gap even when that retirement has not yet produced a component render.

The covering native tests at `mobile/src/IntelligenceScreen.test.tsx:796` use the owning screen/hooks, conversation-backed task-conversion preview, separately cloned responses, and the actual five-second poll (a 5,100 ms wait). They cover an already acknowledged preview and a preview response overlapping the pending read, verify withholding and the same editor node during pending, then complete deliberate acknowledgement/creation after equivalent current proof. The web counterpart at `frontend/src/components/IntelligencePanel.test.tsx:670` drives the owning manual recheck path. Opposite tests at native line 932 and web line 753 cover result/source change, human edit, authority change, foreground loss, denial, candidate change, unmount/remount, and global retirement; obsolete private audience content does not reappear and Confirm remains unavailable. Native authority and foreground tests exercise the native scope inputs; the web equivalents exercise actor and document visibility changes.

The initial RED logs reproduce both refresh variants in both clients. The retained retirement RED logs independently demonstrate the late response defect before its guard was added. Final full client results cover the corrected implementations. These tests support closing the source finding; they are not installed-device/IME/iOS proof.

### Original fix1 Minor M1 — ADDRESSED

The exact raw-handle expiration no longer advances the hard retirement generation through generic execution-read cleanup. Web skips that cleanup only through the existing exact predicate at `frontend/src/data/execution.ts:147`. Native computes the same predicate at `mobile/src/execution.ts:104`, skips retirement in the catch cleanup, records `rawExpired`, and also excludes that case from the second denial cleanup at line 209. Both native cleanup sites now agree.

The predicate remains specifically raw-job **GET + HTTP403 + code `expired`**. It does not exempt POST/cancel/publication-access failures or arbitrary denials. The raw error, denied status, and withholding of raw data remain; this exemption does not grant raw access or current publication access. It only prevents raw TTL from falsely invalidating a separately current canonical acknowledgement. Other 401/403/404 and authority retirements still invalidate the generation, and the canonical mutation's matching-current-generation guard remains in force.

Held-response tests at `frontend/src/components/IntelligencePanel.test.tsx:722` and `mobile/src/IntelligenceScreen.test.tsx:890` release a canonical ACK after the owning raw read has failed. They observe creation success only for 403/`expired`; 403/`access_changed`, 401/`expired`, and 404/`expired` reject stale success. Raw source content remains withheld. This directly addresses the original recoverable false rejection; it is not evidence of former attempt loss, body substitution, or a privacy disclosure.

The existing unknown-attempt path continues to use the original frozen key, payload, and target plus independent current publication-access proof. Visible authored-title edits do not silently become a new intent or replace the frozen retry body. Preview stays unavailable for that frozen attempt, and retry remains explicitly the original submission. This round changes neither canonical replay semantics nor backend source/destination authorization.

## Fix-introduced breakage and quality

**Critical: none. Important: none. Minor: none newly identified.** The relevant boundaries checked were pending-versus-current authorization, cloned response identity, preview success/error after retirement, candidate/remount intent separation, both native denial cleanup sites, exact status/code/method narrowing, and frozen retry/current-ACK ownership. No new bypass or task/finance control regression was found in this package.

The shared identity function keeps the two consumers aligned. The changes avoid treating a transport refresh as a new human review while retaining explicit invalidation for real changes. The tests exercise owning client transitions and meaningful opposite cases rather than only the helper output. No broad registry exception, persistent private-result cache, automatic acknowledgement, cloud/provider change, or new backend behavior was introduced.

## Verification and limits

Read the current complete outputs and recorded exits in `task-10-fix2-checks.json`: full web **305 passed**, full native **257 passed**, web typecheck/normal build/demo build, native typecheck/lint, Android and iOS Hermes export, and formatting all succeeded. These invocations were made against the dirty BASE worktree whose source bytes were subsequently committed as HEAD; they are source-equivalent results, not claims that the commands were invoked after the final commit. The controller's `task-10-fix2-controller-handoff-hash-proof.json` independently records zero mismatches across 1,221 source records, 232 physical SQL comparison entries, 61 build artifacts, and 29 safe evidence records. Backend/Encore remain equivalent to `98b7fb6`; all 58 migrations remain unchanged from BASE. I verified the supplied diff hash independently and relied on the controller's independently generated inventory proof for those broader byte counts.

Historical RED and intermediate failures remain failures. In particular, the retained intermediate native focused run had two incorrect expectations that treated 401/404 with code `expired` as the allowed case; the final test bodies require both status 403 and code `expired`, and final full suites pass. Those intermediate results have not been relabeled as product success. Build chunk-size and color-environment warnings remain visible.

No newly discovered untouched-code issue is added to the out-of-scope ledger. The previously recorded bundle/color warning cleanup remains final-integration scope. Initial/fix1 reports, the R2 route-diagnosis correction, accepted M9 review, backend/PG/provider evidence, and prior browser geometry/invocation qualifications remain unchanged; this is not a repeat approval of their entire scope. No whole-browser PASS or additional provider-capacity/headroom claim is made.

**Cannot verify in this gate:** the refreshed installed native client's deliberate preview → audience inspection → acknowledgement → Confirm flow, native sustained geometry/IME behavior, and actual platform acceptance. The native owner must complete that separately against the reviewed source, using the retained ready job as authorized. Final whole-branch review is also a later gate. These limitations do not leave a source fix outstanding in N1 or M1.
