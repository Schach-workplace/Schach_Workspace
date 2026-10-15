# Expo dynamic project association — 15 October 2026

Source baseline: `290546598a0245fcd57c617275ff60755f577e3c`.

The owner supplied EAS CLI24.14.0 logs: browser login and project creation succeeded twice, first under a personal account and then under `nishantjaiswals-team`. Both `init` commands failed only when EAS could not automatically write the project ID into `mobile/app.config.ts`. The owner previously requested zero-cost phone access and now confirms Linux/Windows only; no paid Apple membership is established.

## Fix and evidence

- Added `owner: nishantjaiswals-team` and `extra.eas.projectId: 84ab66ee-3a5a-487b-8612-12fac0454b1c` to the existing dynamic config, preserving `config.extra`/`extra.eas`. This selects the latest team project supplied by the owner. The personal project is unused and was not deleted or changed.
- Before the change, actual `expo config --type public --json` resolution returned null owner/project ID; the expected-project check exited1. After the change the same actual resolver and assertions passed, exit0, with Workspace/slug/scheme/native IDs and built-in server profiles preserved.
- **Read-only authenticated verification:** `npx --yes eas-cli@24.14.0 project:info` returned exit0, fullName `@nishantjaiswals-team/workspace` and the matching ID. This did not create an external project, submit a build or change cloud credentials. CLI dependency deprecation warnings also appeared during this successful command; they are tool dependency warnings, not the cause of the dynamic-config failure. No dependency safety clearance is claimed and no package/lockfile changes were made.
- One bounded independent read-only reviewer: **Spec/Quality PASS**, no critical/important findings; independently resolved the same metadata and unchanged identities.
- Fresh mobile typecheck, lint and test results are in [result.json](result.json). `git diff --check` is the final whitespace gate. No UI/backend/shared/domain behavior changes; no generated iOS/Android edits.

Expo instructions were checked against [dynamic app configuration](https://docs.expo.dev/workflow/configuration/) and the [SDK57 reference](https://docs.expo.dev/versions/v57.0.0/). The UUID is project metadata, not a secret; login URL state/code-challenge values, credentials and device identifiers were not committed.

## Remaining gates

Do not rerun `eas init` to fix this association; use `project:info` to inspect it. Linking this project starts no build and changes no provider/server configuration. The owner's zero-cost requirement still rules out the paid-membership EAS ad hoc iPhone route; the existing HTTPS web app/Home Screen route remains available. A local Android build is a separate free native route if an Android device/toolchain is available.

No cloud/native build, phone install, store submission, production business mutation or runtime restart was performed. All224 distributed manual cases remain NOT_RUN. Existing processes, two stashes and worktrees were left intact. The 15October native-guide documentation validator is qualified to its own historical documentation-only source boundary; it is not evidence of unchanged app config after this fix.

Publish through the existing feature branch, fast-forward main and non-force push both branches. Inspect live Git refs for exact publication HEAD. Next owner action: run `npx eas-cli@latest project:info` from the main checkout's `mobile/`; do not trigger an iOS build while the zero-cost constraint and absent paid membership remain.
