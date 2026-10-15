# Android: install, test and privately deploy Workspace

Updated 15 October 2026. Follow the shared [native rollout plan](NATIVE_TESTING_ROLLOUT.md) first. The web/backend is already deployed at **https://work.schachengineers.com**; these steps build a client for it. No server bootstrap or demo seeding is needed.

## 1. Choose the first testing route

**Recommended first deliverable: a standalone preview APK.** It runs without your computer and needs an Expo account/project but no Play Console account. Firebase can follow for push acceptance. This app uses custom native LiveKit/WebRTC modules; Expo Go is not the testing client.

For local developer iteration, Android Studio/SDK and a compatible JDK are an alternative (section 6). Store deployment comes after physical testing. APKs install directly; AABs are for Play distribution. See [Expo APK builds](https://docs.expo.dev/build-reference/apk/).

## 2. Prepare the computer and Expo project

Use macOS, Linux or Windows with Git and Node compatible with SDK 57 (minimum Node22.13.x; Node24 LTS is a reasonable choice). Obtain access to the private repository. Start from a clean checkout; if it already exists, fetch and fast-forward instead of cloning over it.

```bash
git clone https://github.com/Schach-workplace/Schach_Workspace.git
cd Schach_Workspace
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
cd mobile
npm ci
npm run typecheck
npm run lint
npm test
npx expo-doctor
```

Record results and stop on errors. Do not run these as a semicolon chain that continues after a failed check. Check current [SDK 57 requirements](https://docs.expo.dev/versions/v57.0.0/) before choosing a local toolchain.

Create a **company-owned Expo account/organisation**, protect it with MFA and grant the builder access. From `mobile/`:

```bash
npx eas-cli@latest login
npx eas-cli@latest whoami
npx eas-cli@latest init
```

Select the company-owned project. The repository uses dynamic `app.config.ts`: if EAS cannot write the project association automatically, put the **actual project UUID** returned by EAS into the object returned by that config, preserving all existing fields:

```typescript
extra: {
  ...config.extra,
  eas: {
    ...config.extra?.eas,
    projectId: "ACTUAL_EAS_PROJECT_UUID",
  },
},
```

This is an integration snippet, not a second config file. Do not paste the placeholder literally. Review/commit that project association through the normal branch workflow, then rerun checks. The UUID is project metadata, not a signing key. Never replace `name`, `slug`, bundle/package IDs or the existing build profiles just to satisfy an init prompt. Verify the selected project and resolved public config:

```bash
npx eas-cli@latest project:info
EXPO_PUBLIC_SERVER_URL=https://work.schachengineers.com npx expo config --type public
```

Expected: **Workspace**, slug `workspace`, Android package and iOS bundle ID both **com.schachengineers.workspace**. Do not publish complete config output if it includes environment details. The `preview` profile already sets `environment: preview`, `distribution: internal`, Android `buildType: apk` and the live HTTPS origin. The development profile is a Metro-dependent dev client; production produces a store AAB. See [EAS project setup](https://docs.expo.dev/build/setup/).

## 3. Build and install the APK

From `mobile/`:

```bash
npx eas-cli@latest build --profile preview --platform android
```

Review the cloud source upload and credentials prompts. Let the company project generate/store the **first** Android keystore only if no existing key must be reused. Preserve existing keys and keep an encrypted recovery copy in the company vault, never Git. Record the build ID, source SHA, package, versionCode, keystore certificate alias/fingerprint and artifact SHA256. EAS manages remote build versions; production auto-increments, but preview does not promise a new versionCode on every rebuild.

1. Restrict unauthenticated internal-build access in Expo project settings before sharing with testers. Share only through the approved private channel.
2. Open the completed build's install link/QR on the Android phone, download the APK, and allow **Install unknown apps** for that specific browser/file source if requested. Do not disable Play Protect. Disable that installation permission again after installing.
3. Open **Workspace**. The preview build has the HTTPS server built in and no editable server field. Sign in with a **fictional pilot user supplied privately by the operator**, not the local demo logins. Stop if it reaches an unexpected company/server.
4. Turn off the build computer/Metro. Reopen the app and verify sign-in/data access still work. Internet to the existing backend is required; offline mode is not a substitute backend.
5. Run the [acceptance matrix](NATIVE_TESTING_ROLLOUT.md#4-end-to-end-acceptance-matrix), including cross-device chat/calls and exact money/deadline/review controls. Record denied permissions and recovery through Android Settings.

Optional USB install, after installing Android platform tools and accepting the phone's USB debugging prompt:

```bash
adb devices
adb install -r /absolute/path/to/Workspace-preview.apk
```

Use `adb -s DEVICE_SERIAL ...` if multiple devices are attached. An existing install needs compatible signing and a non-downgraded versionCode. Do not reflexively uninstall: it may discard local drafts and session information. See [Android device setup](https://developer.android.com/studio/run/device).

## 4. Add native push acceptance

The client calls `getDevicePushTokenAsync()` and the backend sends **directly through FCM HTTP v1**; Expo push tokens/relay are not used. Push opt-in is an explicit **Account** action after login. No notification on initial sign-in alone is not proof of a provider fault. See [Workspace device registration](../../mobile/src/Workspace.tsx) and [provider implementation](../../backend/platform/push_providers.go).

1. In the company Firebase project, register Android package `com.schachengineers.workspace`. Download its **client** `google-services.json`.
2. In the Expo project's environment variables, add **GOOGLE_SERVICES_JSON**, type **File**, visibility **Secret**, for **preview** and **production**. The existing app config consumes its file path. For a local build, set that environment variable to an absolute local file path. Do not commit the file.
3. Ask the existing server operator to confirm the matching Firebase project is configured through **FCM_SERVICE_ACCOUNT_FILE**. That server **service-account JSON** is different from `google-services.json` and must never be bundled into the app. This is a readiness check; do not rotate/redeploy existing configuration just to follow the guide.
4. Rebuild after adding client configuration; installing a previous APK will not acquire it. Sign in and explicitly enable notifications in Account. Trigger a normal fictional message/task/expense event from a second authorized user. Test foreground, background, normal terminated state, and tapping the hint into current authorized content. Record force-stop separately; Android can suppress delivery until the app is reopened.
5. Confirm hints reveal no private body/title/amount and no delivery after authority revocation at send time. Exercise revocation/fault cases on the isolated fixture only. Re-register through Account after reinstall/signing/token changes as needed.

File variables are scoped to the selected EAS environment; see [Expo environment variables](https://docs.expo.dev/eas/environment-variables/). Missing Firebase blocks **push qualification**, while initial non-push testing can proceed with the optional config absent. Real FCM delivery needs a compatible physical device with Google services/network access.

## 5. Private Play deployment after acceptance

1. Set up the company **Play Console organisation** and Managed Google Play/EMM enterprise. Use the existing app record if one exists. Keep permanent package `com.schachengineers.workspace`.
2. Agree signing continuity before the first Play release. **Play App Signing's device signing key can differ from the EAS APK/upload key.** An APK pilot may therefore not update in-place to Play; test this transition with expendable fictional data and a planned reinstall only when necessary. Never lose the upload key or change identity to bypass a conflict. See [Play App Signing](https://developer.android.com/studio/publish/app-signing#app-signing-google-play).
3. Build the AAB from the tested source:

```bash
npx eas-cli@latest build --profile production --platform android
```

4. For the first release, **manually upload the selected AAB** to Play Console's internal testing track, review the package/version/signing and draft release, complete the required setup forms, add named testers and share the opt-in link. Manual first upload is the chosen inspectable route, **not a universal API requirement**. Current [EAS Android submission docs](https://docs.expo.dev/submit/android/) also support a first submission after the app record and service-account prerequisites are ready. Follow the actual Console's account-specific gates.
5. Test the Play-installed build again, especially session restoration, camera/receipts, call audio, push and upgrade. It is a different delivered artifact from the preview APK. Internal/closed tracks are test distribution, not the final employee channel.
6. Before production release, set **Managed Google Play → Organizations** to the approved enterprise Organization ID(s). Verify restriction on the app record; do not accidentally publish publicly. Release to the restricted production audience, approve/assign through EMM and verify installation in a managed work profile. Personal phones need the agreed work-profile/management arrangement for this final channel. See [Google's private Play Console publication guide](https://support.google.com/googleplay/work/answer/6145139).
7. Complete applicable privacy/data safety, app access/reviewer account, content rating and foreground-service declarations using actual app/provider behavior. Provide a fictional reviewer environment/login privately, current policy/support URLs and relevant screenshots. See [store reference](MOBILE_APPS.md#23-play-console-create-the-app). Do not promise approval dates or use a real employee account.

For later automated uploads, configure the Play submission service account in EAS credentials with the correct app permissions; this is distinct from server FCM credentials. The existing `submit.production` has no hard-coded app/track settings: review prompts and select the exact qualified build, then verify the resulting Console track/release before promotion.

```bash
npx eas-cli@latest submit --profile production --platform android
```

For a new user-facing release, update/commit `version` in `mobile/app.config.ts` before building; EAS production auto-increment advances `android.versionCode`, not the marketing version. See [Expo version management](https://docs.expo.dev/build-reference/app-versions/). Do not use `--latest` or automatic production rollout without checking artifact provenance. Keep the staged rollout/rollback procedure in [the shared plan](NATIVE_TESTING_ROLLOUT.md#6-record-results-and-release).

## 6. Optional local developer build

Install Android Studio, platform tools, the SDK/JDK required by this project's generated Gradle configuration, and configure the environment following [Expo Android Studio setup](https://docs.expo.dev/workflow/android-studio-emulator/). Attach a debug-enabled test phone. From checked/installed `mobile/` source:

```bash
EXPO_PUBLIC_SERVER_URL=https://work.schachengineers.com npx expo run:android --device
```

Expo generates `android/` when absent, builds, installs and starts Metro. Never hand-edit that generated directory. Rebuild through Expo after native/config changes. A subsequent JS-only session can use:

```bash
EXPO_PUBLIC_SERVER_URL=https://work.schachengineers.com npx expo start --dev-client
```

Keep the phone connected to the trusted development LAN/USB debugging route and Metro available. A development build can edit the server origin at sign-in; its successful debug test is not standalone production acceptance. See [Expo local compilation](https://docs.expo.dev/guides/local-app-development/).

## 7. Common failures

| Failure | Check before changing code |
| --- | --- |
| Not authorised for EAS project | `whoami`, company membership, actual project UUID; do not create a duplicate project |
| Install conflict / package invalid | File is APK; supported OS/architecture; actual signing fingerprint/versionCode |
| Can't connect to server | Trusted HTTPS on phone browser; no `/api` suffix; correct build profile; server release/routes |
| Metro connection error | This is a development build; use the preview APK for computer-independent testing |
| Notifications missing | Permission/Account opt-in, selected EAS environment file, FCM project match, token registration and sanitized provider error |
| Call connects without audio/video | OS mic/camera permission, output route, both peers, LiveKit/TURN/network; a token isn't media proof |
| Play rejects release | Exact Console policy/account/signing/version message; do not alter IDs or blindly upgrade SDK |

Record actual results; builds and physical Android tests remain unexecuted by this documentation change.
