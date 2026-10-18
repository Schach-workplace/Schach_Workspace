# Mobile lab execution — 19 October 2026

Source baseline: `206df7ce8bf674d901c376e3016faf4fcdc50cf5`, existing `improve/workspace-improvements` worktree. The owner requested an actual local mobile environment and execution of iOS/Android screen tests, including browser testing where possible. This extends the existing app; it does not restart its roadmap.

## What was created

An actual Android API36 x86_64 virtual phone, accelerated with host KVM12, runs the current React Native application in official Expo Go57.0.9. Its private ADB server5039 selects only `emulator-5578` / `workspace-qa-api36-20261019`. Offline Metro19019 uses an isolated Expo settings directory and targets the new fictional API9092. No Expo account, Apple membership, cloud upload or paid device service was used.

Actual WebKit26.6 and Chromium run under Playwright1.63. iPhone SE3 and15 Pro Max are **browser profiles**, not iOS Simulator or real iPhones. Pixel5 and GalaxyS24 are Chromium browser profiles; the separate Android VM supplies actual Android OS coverage. Screenshots use DPR1 in browsers; native captures are1080×2340. [Environment, official downloads and checksums](environment.json), [reproduction guide](README.md).

The RN Web component fixture uses the application's actual screen components, with explicit fictional Workspace/client/native boundaries and disabled writes. The compiled web and native Android paths use a real new fictional API/database. Their evidence must not be conflated.

## Final checks

| Check                                  | Result                                             | Evidence                                                              |
| -------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| RN Web mobile component matrix         | 134 PASS,0 FAIL/runtime errors/external requests   | [browser-result.json](browser-result.json)                            |
| Compiled web plus actual fictional API | 30 PASS,0 FAIL/unexpected errors/external requests | [web-api-result.json](web-api-result.json)                            |
| Native Android screens                 | 19 PASS; one Requests readiness retry retained     | [native-result.json](native-result.json)                              |
| Native Android interactions            | 11 PASS; warm Development/company retries retained | [native-interaction-result.json](native-interaction-result.json)      |
| Mobile unit/component suite            | 81 files /515 tests PASS,63.97s                    | [test log](checks/mobile-tests.log)                                   |
| Mobile typecheck and lint              | PASS                                               | [types](checks/mobile-types.log), [lint](checks/mobile-lint.log)      |
| Android+iOS Hermes JS export           | PASS,34assets                                      | [export log](checks/native-js-export.log); no signed/native-iOS claim |

The134 component cases comprise72portrait screen/profile pairs,48additional small-phone enlarged-text/landscape/short/empty cases and14touch/form interactions. Eighteen views: sign-in, module directory, Work, Finance, Reports, Inbox, Connect list/chat, Overview, Workload, Planning, Calendar agenda, Goals, People, Account, Project, Development and Knowledge. Enlarged browser text is a DOM-based1.6× rendering probe; it is not Dynamic Type/OS font-scale certification.

The30 actual web/API cases comprise sign-in,13module views and reviewed calendar download in each of two engines. Each destination requires its specific rendered content; Connect also requires the loaded conversation filter, so its loading placeholder cannot pass. Both engines downloaded a valid nonempty ICS. The expected anonymous GET `/api/auth/session`401 is recorded explicitly; other HTTP/console failures are not ignored.

The separate [six driver-accounting tests](checks/native-accounting-tests.log) pass after an independent review found that a diagnostic exception could omit a failure. [Review and corrections](review.md) record the RED/GREEN proof, fixed coverage and scoped re-review.

Native screen acceptance requires current destination content from a **freshly generated** UI hierarchy. Interactions exercise task search/detail/Back, real IME entry/dismissal in task/growth/Knowledge forms, disabled unreviewed submissions, private chat send plus exactly-one canonical API body, module search/Back, company-qualified private-route denial, and four1.6× OS-font views. These are bounded new tests, not an exhaustive release suite.

## Application defects found and corrected

**Workload initial week:** when company data was initially absent, state froze the UTC fallback week. At2026-10-18T18:55Z, Asia/Kolkata is already Monday19 while UTC is Sunday18. The mounted screen kept12October even after company data arrived. A regression failed with expected19/actual12. Initialization now waits for current company data, while preserving a manually selected week and an initialized range through a temporary workspace clear. Eleven focused tests pass. No query authorization, workload formula or85% policy changed.

**Android Send hidden by the IME:** an actual screenshot showed the message field above the keyboard but Send beneath it. Tapping its XML coordinates pressed the keyboard. Instrumentation found the frame at185.09dp using window measurement versus234.55dp using page measurement in the edge-to-edge Android Go host; keyboard screenY was548dp. Re-reading the window offset alone and a window-based padding attempt did not solve the mismatch. The final Android path measures current page overlap on keyboard show/height changes and layout, clears it on hide, ignores delayed measurements after hide and avoids adding space to an already resized window. Existing iOS padding behavior remains. The root-coordinate regression failed before this correction and passes after; four keyboard tests cover coordinates, disable/resize, cleanup and late measurements. Actual post-fix screenshot exposes Send and a fictional message persisted; final exact-body interaction passed its visibility, cleared-composer and exactly-one canonical API-body assertions.

Original failing screenshots/XML are under [regressions](regressions/). No chat mutation/retry payload, task/finance decision, source permission or company authority handler changed. Two test mocks gained the real Keyboard API boundary needed by the frame.

## Other failures and their classification

- **Environment:** the restricted sandbox hides KVM and host sockets; host execution verified `/dev/kvm` and KVM API12. WebKit initially lacked ICU74/XML2/Flite on this Arch host. Checksum-verified public Ubuntu libraries were extracted into isolated test-tool paths, without sudo, system replacement or maintainer scripts.
- **Download/tooling:** Java/Expo metadata requests with a default urllib agent returned403. Official GitHub JRE download and Expo metadata via curl succeeded. SDK's unsolicited suggestion to install skills was ignored. CLI's offline/localhost flags conflict; the guide uses the tested offline invocation. Manifest asset-schema/signing warnings and colour-environment warnings are retained; fresh native bundles did load. No credentials were printed or supplied to these tool downloads.
- **Runtime interruption:** the session interruption stopped owned lab processes. Their ports/identities were rechecked, then only this fictional database and dedicated lab were resumed. The existing API was restarted without reseeding. A launch before Android boot completion failed; subsequent execution waited for `sys.boot_completed=1` and actual bundle/readiness.
- **Harness:** stale UI XML could survive a failed dump. The driver now removes only its own temporary XML first, requires a successful fresh dump, and validates the AVD name. Earlier native results are superseded by the complete fresh rerun. Native input waits for focus/clear and asserts exact field text before actions; a shell-injection timing sample dropped initial characters and is not treated as a successful exact-text send.
- **Fixture/selectors:** an initial timed-task fixture used a UTC offset inconsistent with Asia/Kolkata and correctly received422. The fixture now constructs the timestamp in its selected zone; the app validation was preserved. Native links require the current company parameter. Assertions were corrected to actual native labels, HTML's default input.type and expected anonymous bootstrap denial. Task/growth fields require scrolling past options. Changing Android OS font scale recreates its activity; the first Work check now taps the real Work tab after route readiness. Company-switch checks require a loaded current-company list before testing a wrong-company private link. A Development sheet closed during an externally launched flow; a normal in-app navigation follow-up is recorded separately. That observed interruption is retained as an unqualified resume/deep-link timing case, not silently waived as a permission fix. Cold external-deeplink startup is not certified.
- **Command setup:** initial test commands with the wrong working directory selected no tests/wrote no file; corrected runs observed actual RED assertions and final GREEN suites. They are not counted as regression evidence.

## Screenshot inspection and remaining gates

Native outcomes combine the full fresh-source run with explicitly recorded scoped retries: Requests was visible in the failure capture just after its18s readiness timeout and passed with45s readiness; Development and the company test were rerun through settled internal navigation/current-company lists. Their priorAttempt failures remain in JSON. All current19/11 identities are required. The separate8chat browser checks pass after the final Android-specific change; these overlap the134matrix and are not added to its count.

**Open observation MOBILE-LAB-RESUME-01:** a Development sheet disappeared during an external-link/refresh test; its [capture](regressions/android-growth-interrupted-after-external-link.png) is retained. More → Development → New plan passed with the real keyboard and disabled unreviewed Save. The exact dismissal cause and cold/resume/deep-link behavior remain unqualified. Investigate GrowthHome's readBasis key and Workspace foreground/reauthorization before changing them; do not relax revocation to retain a sheet.

Root inspected real WebKit small-phone Work, enlarged Development and loaded Connect; Chromium Finance; actual Android chat with IME, large-font Workload and native form states. Horizontal company/filter rails intentionally scroll. Browser probes reject uncontained document overflow and heading clipping; they do not prove every scrollable control, screen-reader announcement or keyboard state.

Useful captures: [iPhone browser Work](browser/ios-small-work-portrait.png), [iPhone enlarged Development](browser/ios-small-growth-large.png), [Android browser Finance](browser/android-pixel-finance-portrait.png), [loaded web Connect in WebKit](web-api/webkit-connect.png), [actual Android keyboard correction](native/android-chat-keyboard-root.png). Final native captures are in [native](native/); earlier tooling attempts are kept outside the final screenshot folders under `/tmp/workspace-mobile-lab-prior-attempts`.

**Still unverified:** native iOS/physical iPhone, physical Android, other API/device sizes, VoiceOver/TalkBack, hardware safe areas, OS sharing, real push/calls/background delivery, camera/audio providers, release signing/distribution, performance/load, all employee/mentor pilots and production compatibility of migrations60–61. iOS Simulator requires macOS/Xcode; this Linux lab does not provide it. The owner can continue core-screen testing in Expo Go on an actual iPhone, but this app's custom calls/push remain unavailable there.

The original224 manual scenarios,15M1phone cases and39supplemental procedures remain NOT_RUN. These new automated cases do not silently change their status. No backend/web product source, schemas, packages, lockfiles, generated native projects, credentials, deployed server or deferred product policy changed. Existing four GitHub dependency alerts remain unresolved; no security clearance is inferred.

## Ownership and continuation

See HANDOFF section17 for live process identities. Tool downloads/AVD total about8.3GB plus299MB isolated browsers and may be cleared by reboot. Repository harnesses and evidence are durable. Preserve both stashes, other worktrees, owner browsers/devices, unrelated Encore9400 and existing database containers. Stop only owned sessions or use the documented exact launcher; never broad process patterns.

Final native reruns, quality checks and independent review are complete. Source hashes are recorded in source-hashes.json. The owned fictional lab remains ready; see HANDOFF17 for exact identities. Publish by fast-forward/non-force-push under existing authorization; native iOS, physical/provider acceptance and MOBILE-LAB-RESUME-01 remain open. No production redeployment is implied.

Primary references: [Expo57](https://docs.expo.dev/versions/v57.0.0/), [Expo keyboard handling](https://docs.expo.dev/guides/keyboard-handling/), [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/), [iOS Simulator](https://docs.expo.dev/workflow/ios-simulator/), [Playwright browser emulation](https://playwright.dev/docs/emulation), [Playwright engines](https://playwright.dev/docs/browsers).

## Publication checkpoint

Product/evidence commit `b6db1cf7023320ba453200f8d7b28ca8ef9777b1` was fast-forwarded into clean main and atomically non-force pushed to main and improve/workspace-improvements. Merged main matches all17reviewed source hashes and again passed81files/515mobile tests in64.71s, typecheck/lint and6driver tests. [Main test log](checks/main-mobile-tests.log), [main types](checks/main-mobile-types.log), [main lint](checks/main-mobile-lint.log). GitHub reported the unchanged four dependency alerts (two high/two moderate). This following metadata update adds the checkpoint and tool-recreation instructions; it changes no application source. Live Git gives the latest metadata HEAD.

HTTP9092/5186/5187 and Metro19019/status each returned200 at final ownership check; own ADB5039/emulator5578 and unrelated Encore9400 still listen. No production redeployment or personal runtime action was performed.
