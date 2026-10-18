# Mobile test environment implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Continue the existing worktree; do not repeat completed application implementation.

**Goal:** Execute current screens in a real local Android emulator and mobile browser profiles for both iOS and Android, with reproducible fictional-only evidence.

**Architecture:** Own one Android SDK/AVD/ADB/Metro environment and a new disposable API fixture. Use Playwright WebKit for iPhone browser profiles and Chromium for Android profiles, testing both actual React Native Web components and the compiled web app where useful. Browser profiles are not native iOS acceptance.

**Tech stack:** Existing Expo SDK57/RN0.86, Android API36 x86_64/KVM, Playwright1.63/WebKit26.6/Chromium, owned loopback fictional backend.

**Spec:** User request to create and execute a mobile environment, including browser testing of iOS/Android screens; docs/HANDOFF.md section16 and docs/qa/PREMIUM_MOBILE_GROWTH.md define the preserved controls and previous evidence.

## Global constraints

- Preserve company/source authorization, private history, explicit publication, independent decisions, exact money/timed commitments and original retries.
- No production login/data mutation/deployment, paid build/account, real-phone control, generated native edits or application package changes.
- Start only owned ports/processes/AVD/ADB; preserve existing9400 and unrelated containers/devices/stashes/worktrees.
- Install public testing tools in isolated local directories; record versions, download provenance and failures. Do not inspect private signing keys or existing ADB identities.
- Distinguish native Android, mobile browser profiles, RN Web fixture rendering and unavailable native iOS. Keep unexecuted QA cases NOT_RUN.

## Review focus

- Profile labels must match the actual engine; browser viewport/UA must never be called an iOS Simulator.
- Failed/offline/unsupported capabilities must not become false PASS results.
- Modal/composer/large-text/short-screen controls must remain reachable, beyond horizontal-overflow probes.
- Native scripts must select only the newly owned emulator serial and preserve original company/actor scopes.
- Cleanup must identify owned process/container/device resources explicitly.

## Task1: Build the isolated test environment

- [x] Verify clean Git/worktree/listeners, host KVM and installed browser tools.
- [x] Download pinned official Android SDK/emulator/API36 image and Java only if missing; create a new AVD with isolated user/ADB paths. Launch with a unique serial/port, assert boot and package versions.
- [x] Install official WebKit in an isolated path and resolve host compatibility dependencies without system-wide changes; launch both actual engines and record versions.
- [x] Start a new fictional API fixture and offline Expo Go Metro targeting it. Install matching official Expo Go on the owned emulator, with owned reverse ports.

## Task2: Execute screens and fix observed application defects

- [x] Add a reusable browser matrix under verification/mobile-lab-2026-10-19 using actual current native components, existing explicit fixture boundaries and multiple iPhone/Android device profiles.
- [x] Assert rendered screen identity, runtime/console/network errors, overflow/clipping, touch interactions/search/filter/modal forms and enlarged/short/landscape states; save top/bottom screenshots and results. Do not qualify mocked writes as domain acceptance.
- [x] Use actual Android UI hierarchy/input/screenshots against the real fictional API for sign-in, module navigation, Work/task detail, Connect/composer, Finance/Reports, Calendar/Workload, Growth/Knowledge and Account. Include keyboard/back/large-font checks where executable.
- [x] For actual defects, reproduce first, add an appropriate regression and fix minimally; run affected tests/types/lint and recapture. Classify environment/harness failures separately.

## Task3: Evidence and handoff

- [x] Inspect real screenshots from both browser engines and the native emulator. Publish exact case matrix, versions/source hashes, failures, limitations and reproduction commands.
- [x] Update HANDOFF and AI index, preserve original manual case statuses and list exact remaining native iOS/physical/provider gates.
- [x] Obtain one read-only scoped review of new harness/fixes, verify affected checks, then commit/fast-forward/nonforce-push under existing authorization. Preserve the worktree and stashes.
- [x] Stop owned test processes or record exact safe resume commands if retaining an owner-ready environment.

Ruling: the user explicitly requests setup and execution now; proceed with reversible fictional testing without another design/approval pause. Public free tool installation is authorized by the requested environment. No production/paid/native-iOS claim is inferred.

Execution ledger: Task1 complete with isolated host tools/AVD/engines; Task2 complete with134browser,30actualwebAPI,19native screen/11interaction current-case PASS, retained retries,2app fixes and515unit tests. Task3 evidence/review complete; publication recorded in HANDOFF17. Ruling: warm internal navigation is qualified separately from external-link/resume interruptions (MOBILE-LAB-RESUME-01 OPEN); do not count this as physical/native-iOS or release acceptance.
