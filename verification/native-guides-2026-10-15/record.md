# Native testing/deployment guides — 15 October 2026

Request: include end-to-end Android/iOS testing and private deployment guides and push to main, with the web application already deployed. Source/documentation baseline: `72c949c475c310dca6f856c322093442720acc05`. Application behavior remains the neutral-web product at `8b8e8df`; this change adds documentation and its validation only.

## Scope and constraints

- Added [native release sequence/acceptance](../../docs/deploy/NATIVE_TESTING_ROLLOUT.md), [Android](../../docs/deploy/ANDROID_TESTING.md) and [iPhone/Mac](../../docs/deploy/IOS_TESTING.md) instructions; updated README, the existing private-store reference and canonical handoff/index.
- Existing live domain stays `https://work.schachengineers.com`. No server bootstrap, seeding, key rotation or application/server deployment was performed. No production authentication, business mutation, provider credential inspection or native build/account/store action was performed.
- Expo/Apple readiness remains owner-reported absent; Mac/device versions unknown. Guide steps are proposed execution instructions, not test results. All224 distributed manual QA scenarios remain NOT_RUN.

## Verification

Run from repository root:

```bash
python3 verification/native-guides-2026-10-15/check_docs.py
git diff --check
```

The [result](result.json) records local Markdown target/anchor existence, balanced fences, `bash -n` on the new guides' shell blocks, actual EAS profile/script/app identity/push routing consistency, unchanged application source and the224 NOT_RUN template rows. Shell syntax validation does not execute a cloud build, signing, device install or provider call. External source pages were read separately; local link checking does not assert their uptime or every Console label.

Fresh checks on unchanged mobile source: `cd mobile && npm run typecheck && npm run lint` **PASS**, exit0. No full web/Go/native unit suites were rerun for this documentation-only change; historical results and known failures remain in [HANDOFF](../../docs/HANDOFF.md). No fresh security-audit clearance is implied.

One bounded independent read-only reviewer assessed the combined guides against current source: Spec PASS; no critical findings. Two important documentation findings were verified and fixed: supporting guide's stale Node20 prerequisite now matches SDK57, and store update steps now distinguish marketing `version` from EAS build-number auto-increment. After reading the corrections, the same reviewer returned **Spec and Quality PASS, ready to merge, no remaining critical or important findings** within this scope. No business behavior or package/config change was requested by the review.

## Primary references checked

Provider instructions were checked on15October2026 against official documentation, with the repository's SDK57/config/source taking precedence for app-specific behavior:

- [Expo SDK57 platform versions](https://docs.expo.dev/versions/v57.0.0/), [documentation index](https://docs.expo.dev/llms.txt), [local compilation](https://docs.expo.dev/guides/local-app-development/), [project setup](https://docs.expo.dev/build/setup/).
- [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/), [APK](https://docs.expo.dev/build-reference/apk/), [environment files](https://docs.expo.dev/eas/environment-variables/), [version management](https://docs.expo.dev/build-reference/app-versions/), [Android submission](https://docs.expo.dev/submit/android/).
- [Apple accounts](https://developer.apple.com/help/account/basics/about-your-developer-account/), [capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios), [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device), [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), [private distribution](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/set-distribution-methods/).
- [Google private apps via Play Console](https://support.google.com/googleplay/work/answer/6145139) and [managed Play/EMM alternatives](https://support.google.com/googleplay/work/answer/9146439).

The web fetcher could not consume Expo's `.md` content type for one page; its equivalent HTML URL was read successfully. This is a reference-fetch tooling limitation, not an application failure. No local application failure occurred during these documentation checks.

## Environment and publication

Existing listeners8080/9080/5174/9400 were observed at the same recorded PIDs and left running. Stashes/worktrees retained. No new persistent app/browser/container process started. Temporary typecheck/lint and documentation checks only.

Publish through the existing feature branch, fast-forward local main, and non-force push both. Verify matching live local/remote refs after publication. The exact commit hash is obtained from Git; the file index's inventory head is the source head before this documentation commit and is not a self-referential publication proof. The final user report supplies the published commit.
