# M10 fix round2 — N1 native preview continuity and M1 read retirement

Status: DONE_WITH_CONCERNS — clean committed handoff `5004b5bcbe777d8779287c4c618c344393105529`; source/Git ownership yielded after final manifest verification. BASE88af09b91dcdf0da0e02739b080713e8088b8f74. Same original sole source writer; no subagents, native/device/runtime/provider/fixture/userdatabase actions. Actual native refresh remains controller-owned after written scoped review. This report does not claim installed-native or M10 acceptance.

## Diagnosis and narrow change

N1's actual native preview200/no-ack finding remains preserved in task-10-native-preview-blocker.md (original source88af/client0c64/backend98b7). The observed device samples prove the symptom. Their exact preview/poll timing was not instrumented, so we do not claim every absent native sample was uniquely caused by one specific polling event.

Owning reproduction establishes the suspected chain: actual native useIntelligence five-second interval calls actual useExecutionRead, which properly withholds/clears loaded data during retry, then supplies a fresh parsed equivalent job. The mounted review compared job objects by reference, invalidating inspected preview/ack on pendingundefined and equivalent positive data, and advanced its async response revision. Both a previously inspected preview and a preview200 overlapping the pending read therefore failed. The web counterpart also reproduced both cases. Initial focused suites each had3 meaningful RED failures (two continuity cases plus M1 below) and1 hard-denial opposite PASS.

The change is confined to seven client/shared files. intelligenceReviewIdentity binds job ID/state/result hash/source-set hash, candidate ordinal/kind, publication policy/current source revisions and source identity/version/content-hash metadata. It stores no candidate/source prose. Equivalent new objects retain the local inspected preview and acknowledgement; generic execution reads still discard/withhold raw loaded data. Pending job reads still hide result, source, citation and audience, gate preview/confirm, and keep authored editor RAM mounted. A preview response overlapping an unchanged refresh may settle locally while hidden; only subsequent current positive proof for the same binding reveals it. A changed result/source/candidate, actor/company/read basis/foreground/native policy generation, terminal positive read, genuine denial or unmount invalidates that continuity. Human writes invalidate preview/ack and response revision. Existing current authority and canonical publication validation remain unchanged.

Self-review reproduced another necessary boundary with owning RED: a late preview after the existing global hard retirement could otherwise install when user ID stayed the same. Both reviews now bind preview success/error and local inspected state to the existing businessAttemptGeneration, without changing global retirement semantics or introducing another generation registry. Native uses its existing layout-effect pattern for refs. Source denial effects still retire the appropriate form/attempt. An old preview success/error cannot affect a newer human intent or remounted candidate.

M1 root cause was independently reproduced in both actual read+mutation consumers: a successful canonical ACK held in flight, then actual raw-job GET403/codeexpired, advanced shared hardGeneration through read cleanup even though the frozen attempt depended on independent publication access. Both read hooks now reuse the already-reviewed exact isIntelligenceRawExpiry predicate to skip only authority retirement for that response. Native has two cleanup sites (catch and loaded-denial effect); both honor the exact raw-expiry marker. Error/denied/raw-withholding remain; GET/path/status403/structuredexpired are all required. Real401, other403/access_changed and404/expired still reject the held ACK. No generic skip-on-no-match, generation removal, relaxed currentACK guard, raw prose revival or canonical body substitution.

## Owning evidence

- Initial meaningful RED: task-10-fix2-native-red.log and task-10-fix2-web-red.log, each3failed/1oppositePASS. Actual native interval and parsed/cloned job, mounted screen/review/hooks/registry; mocked HTTP and RN DOM, not physical native proof.
- Initial continuity/M1 GREEN: task-10-fix2-native-green.log and task-10-fix2-web-green.log. Final native continuity case additionally uses a conversation-backed two-candidate job, first candidate, human selected anchor/Primary/owner/reviewer/deadline, real task-conversions/preview-shaped response, held polling read and current confirmation. Generic business-task web chain exercises the same owning lifecycle; existing private action/claim suite remains.
- Final owning names: `retains inspected native review across real cloned polling (preview overlaps=%s)`; `retains inspected web review across cloned pending refresh (preview overlaps=%s)`. The native test waits5100ms for the actual five-second interval, rather than stubbing the read hook or a stable job reference.
- `rejects late native/web inspected preview across %s change`: resultHash, current source revision, human edit, authority, foreground, denial404, explicit second candidate, unmount/remount and hard retirement. Retirement's new RED logs separately preserve the reproduced stale preview before the extra guard.
- `keeps native/web held canonical ACK only for exact raw expiry %s/%s`:403expired succeeds;403access_changed,401expired,404expired remain hard retirement. Current full suites also retain exact transport predicate/opposites, unknown raw403→terminal200, independent publication-access denial, frozen original request/key/target after visible edits, and candidate/lateACK behavior.

An intermediate native expanded-opposite test expected success based on codeexpired alone instead of status403+codeexpired; two401/404 failures were the correct product behavior. The corrected expectation is in final source; intermediate task-10-fix2-native-final-focused.log is retained as a test-expectation error, not a product regression. Initial native lint rejected refs mutated during render; corrected to layout effects before final checks. Earlier before-retirement full/build logs remain historical and are not substituted for final checks.

## Final validation and source qualifications

Final commands were invoked at HEAD88af with bounded dirty round2 source. task-10-fix2-invocation-source.json captured all tracked client/shared file hashes before the last full commands. Final commit equivalence verifies every captured hash. No source was edited during those final commands. Backend and Encore compare exactly with accepted product98b7fb6e6df0b208715bf01f4191b950390750c7. All58 mirrored migration pairs/116SQLfiles compare byte-for-byte with both88af BASE and98b7; next unused59. No Go/race/PostgreSQL/Encore/provider rerun or physical native claim is made.

| Check | Final outcome |
| --- | --- |
| Web full npm test |68files305PASS,7.78s |
| Native full npm test |50files257PASS,64.79s |
| Web npm run build/build:demo |PASS; both include tsc --noEmit |
| Native npm run typecheck / npm run lint |PASS; no lint warning |
| Native npm run export |PASS exit0 Android+iOS Hermes |
| Touched-source Prettier / git diff --check |PASS |

Known build output: normal entry923.97kB, demo973.49kB above900kB warning; native NO_COLOR/FORCE_COLOR warning retained. M2 cleanup remains final-integration work. Historical provider deadlines/context bounds and all initial/fix1 failed browser qualifications remain unchanged. No additional inference was performed or is needed to restore the preserved ready native job after review.

## Handoff artifacts and boundaries

New fix2 manifests preserve original/fix1 manifests and controller freezes: task-10-fix2-source-manifest.json (`trackedFiles` Git blob/current SHA), task-10-fix2-sql-manifest.json (`files` mirrored immutable rows), task-10-fix2-build-manifest.json (`artifacts`), task-10-fix2-checks.json, task-10-fix2-case-mapping.json and task-10-fix2-manifest.json (`files` explicit safe evidence whitelist). Full48 adopted cases and10internal steps are retained; only affected client requirements gain new owning evidence. Full milestone8f24→candidate provenance is preserved, alongside exact88af→candidate fix scope.

No actual private fixture bodies, model prose, cookies, credentials, session data, process environments or private native captures enter this evidence. All new test data is synthetic. Root froze the actual native blocker under task-10-native-preview-blocker-freeze/index.json; it remains unchanged and qualified to old source. This source owner never touched that fixture. Final source commit is5004b5b (seven affected client/shared paths); all current manifest hashes verified before source ownership yielded. Remaining gates: same original reviewer scoped N1/M1/new-fix-breakage review, then original native owner affected same-job refresh and remaining acceptance; controller final integration/rollout work.
