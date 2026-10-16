# Expo Go core mobile testing implementation plan

> **For agentic workers:** Use superpowers:executing-plans to execute this bounded change. Preserve the existing feature worktree and branches.

**Goal:** Run the existing native tasks, finance and chat screens inside Expo Go on an iPhone from Linux, with calls and push explicitly unavailable in that runtime.

**Approved scope:** Owner accepted unavailable calls/push and confirmed that native screens inside Expo Go are sufficient. This supersedes their earlier requirement for calls/push and a standalone application. They require zero additional account/build fees and have Linux/Windows only.

**Architecture:** Detect Expo Go using SDK57's actual runtime API. Keep custom call modules behind a native-only loader and gate native push side effects/opt-in; retain all source authorization, privacy invalidation, device registration without push and business flows. Add a Linux start command selecting Expo Go and the existing HTTPS backend. Normal native builds retain their call/push path.

**Constraints:** Expo57; ReactNative0.86; no new dependency or major/minor SDK change; no hand-edited generated native projects; no server deployment/data change, external account mutation, cloud build, paid action or tunnel by default. A physical iPhone run remains required and cannot be inferred from automated tests.

## Task 1: Runtime boundary and launch workflow

- [x] Establish the current450-test baseline (67 files PASS).
- [x] Write failing startup tests: Expo Go must load the root and Calls destination without evaluating LiveKit; native runtime still initializes and renders calls.
- [x] Write failing push/account tests: Expo Go never requests/registers push or attaches native push listeners; unavailable controls explain their limitation; normal native opt-in stays covered.
- [x] Implement focused runtime/call adapters, Workspace gating, Account disclosure and launcher. Files: mobile/src/app/_layout.tsx, app/(tabs)/calls.tsx, Calls.tsx entry boundary, Workspace.tsx, AccountScreen.tsx, package.json and focused new tests/runtime helper as needed.
- [x] Run focused tests, mobile typecheck/lint and full suite. Fix regressions before integration.
- [x] Verify actual iOS Metro bundle/start metadata using owned temporary outputs and a free test port; no physical-device success claim. Inspect rendered unavailable states through the component harness.
- [x] Document Linux/iPhone instructions, limitations and next device checks; update canonical handoff/index and verification evidence.
- [x] Obtain one bounded independent behavior/security review of the combined diff, fix findings, commit, fast-forward main and non-force push both branches. Preserve stashes/worktrees and existing servers.

## Acceptance focus

Expo Go has no call SDK startup evaluation, permission/token calls or notification opt-in pretending to work. Native builds keep their original call behavior and explicit push opt-in. Sign-in, company switches, revocation, private history, tasks/finance retry identities, review independence and money/deadline semantics remain governed by existing code/tests. Expo Go uses real server data, not demo fallback. Document SDK-version compatibility, same-Wi-Fi/Metro requirement, no separate Workspace icon and absent background push/calls.

## Execution rulings

- Current main and feature both reproduce doctor20/21 with the same six pre-existing SDK57 patch mismatches. Align those six packages through `npx expo install --fix` so the new Expo Go launch has current compatible patches; no SDK/RN major change or new native package. Cost if wrong: native patch regression, covered by fresh full tests, typecheck/lint, doctor and actual iOS Metro compilation. This is a scoped exception to the initial no-version-change preference.
- New launcher verification exposed Expo's mutually exclusive `--offline`/`--lan` flags. Rely on Expo's default LAN host while forwarding explicit user options, preserving offline/localhost testing. No tunnel is started.
- Initial focused-test command used the repository root instead of mobile/ and collected no files; rerun from mobile/ passed. This was a command-working-directory issue, not a product failure.

## Publication and ready session

Product commit `e62d354` was fast-forwarded into main and atomically pushed to both branches. Main mobile dependencies were freshly installed with `npm ci`. Main Metro was started on8081 in Expo Go mode; manifest/iOS bundle and LAN icon returned200. The canonical handoff records the owned process and next phone action. Physical iPhone execution is still NOT_RUN.
