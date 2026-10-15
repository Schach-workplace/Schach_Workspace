# iPhone: install from your Mac, test and privately deploy Workspace

Updated 15 October 2026. Follow the [shared native rollout plan](NATIVE_TESTING_ROLLOUT.md). Your Mac/iMac can build and install the app on your iPhone while the backend stays at the already-deployed **https://work.schachengineers.com**. You do not need to run the web server on the Mac.

## 1. Check what is ready

| Route | Accounts/tooling | Computer needed after installation? | Use |
| --- | --- | --- | --- |
| Existing HTTPS web app | Browser and app login | No | Immediate access while native accounts are pending |
| USB development install | Compatible Mac, Xcode, Apple signing team with required capabilities | Metro normally needed | Developer testing on your own iPhone |
| EAS preview/ad hoc | Expo account/project, paid Apple membership, registered phone UDID | No | Small native test group |
| TestFlight | Expo build, paid Apple membership, App Store Connect | No | Beta test group; not permanent distribution |
| Custom App | Apple organisation membership and Apple Business Manager, review, distribution arrangement | No | Intended private employee release |

**Current repository caveat:** `expo-notifications` adds an `aps-environment` entitlement. Apple's free **Personal Team** cannot provision the required push capability, so a free Apple ID is **not a reliable signing route for the unchanged app**. A Mac alone does not remove this restriction. Use an active paid team for full native testing. A future test-only build without push would need a reviewed config change and would not qualify notifications; do not delete entitlements or edit generated Xcode files to work around signing. See [Apple capability support](https://developer.apple.com/help/account/reference/supported-capabilities-ios) and [account types](https://developer.apple.com/help/account/basics/about-your-developer-account/).

Owner reported Expo and Apple accounts not ready on 14 October. Start [Apple organisation enrolment](https://developer.apple.com/programs/enroll/) (legal entity/D-U-N-S/company identity) and company-owned Expo setup in parallel. Do not temporarily publish under an unrelated person's permanent app identity.

## 2. Prepare the Mac and iPhone

1. Record Mac model/macOS and iPhone model/iOS. This source uses **Expo SDK57 / React Native0.86**: current SDK requirements include **Node22.13.x+, iOS16.4+ and Xcode26.4+**. Install a supported Node release (Node24 LTS is reasonable), Git and Xcode on a macOS version supported by that Xcode. An older Mac may be unable to run it; verify [Expo's version table](https://docs.expo.dev/versions/v57.0.0/) and [Apple Xcode support](https://developer.apple.com/support/xcode/). Do not downgrade this project merely to fit an old Mac; EAS cloud building is an alternative once accounts are ready.
2. Install/open the **full Xcode application**, finish its first-run components/licence prompts and select its Command Line Tools. Set up CocoaPods as described by [Expo's iOS toolchain guide](https://docs.expo.dev/workflow/ios-simulator/). Check the selected developer directory and versions:

```bash
sw_vers
xcode-select -p
xcodebuild -version
node --version
npm --version
```

3. In Xcode → Settings → Accounts, add the Apple account with access to the intended paid team; verify membership and signing certificate/provisioning permissions. Use normal interactive sign-in/MFA, never passwords in shell commands. Retain existing certificates and keys.
4. Connect the iPhone with a data-capable USB cable. Unlock it, accept **Trust This Computer**, and pair it in Xcode → Devices and Simulators. On the phone enable **Settings → Privacy & Security → Developer Mode** when available after pairing, restart and confirm. See [Apple device running](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices) and [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device). The Mac must support the connected OS/device through its Xcode version.

## 3. Get and verify the existing source

If the repository already exists on the Mac, use it and fast-forward a clean `main`; do not overwrite local work. Otherwise:

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

Run individually and stop on failure. Follow [mobile/AGENTS.md](../../mobile/AGENTS.md). The app is already implemented; do not run `create-expo-app`, change `com.schachengineers.workspace`, install packages with `npm add`, or manually create `ios/`. No Expo login is required just to use the local Expo CLI build route below.

## 4. Install on your connected iPhone from the Mac

From `mobile/`, with the paid team ready:

```bash
EXPO_PUBLIC_SERVER_URL=https://work.schachengineers.com npx expo run:ios --device
```

Select your physical iPhone and correct signing team in the interactive flow. Expo generates the native iOS project when absent, installs Pods, compiles/installs the app and starts Metro. If team selection is ambiguous, configure the actual team through `ios.appleTeamId` in **app.config.ts**, preserving existing iOS fields, then regenerate through Expo and rerun checks. Do not hand-edit generated signing settings. Keep signing credentials outside Git. See [Expo local build workflow](https://docs.expo.dev/guides/local-app-development/).

1. Open the installed **Workspace** development app. If it shows the development launcher, choose the running local Metro server. Keep Mac/iPhone on a trusted reachable network; allow the local connection only on that network. Do not expose Metro publicly.
2. Check the server origin is **https://work.schachengineers.com**. A development build may show an editable server field; preview/production hide it. Sign in with an operator-provided fictional pilot account and exercise navigation, task review, finance, attachments and calls using the shared matrix. Do not use local demo credentials against production.
3. On a later JS-only development session restart Metro from `mobile/`:

```bash
EXPO_PUBLIC_SERVER_URL=https://work.schachengineers.com npx expo start --dev-client
```

4. If the app cannot load with the Mac/Metro off, that is expected for this development route. For a standalone install use section 5. Running `--configuration Release` alone does **not** establish App Store/ad hoc signing or create a distributable release. Test active-call background behavior separately; do not treat a working foreground screen as incoming-call/push acceptance.

## 5. Standalone preview on registered iPhones

Complete the [Expo project association](ANDROID_TESTING.md#2-prepare-the-computer-and-expo-project) once for the shared native project, including the actual `extra.eas.projectId` in the dynamic config if needed. Do not initialise a separate iOS product. From `mobile/`:

```bash
npx eas-cli@latest login
npx eas-cli@latest project:info
npx eas-cli@latest device:create
npx eas-cli@latest device:list
npx eas-cli@latest build --profile preview --platform ios
```

Open the registration link on each test iPhone; treat UDIDs as private device identifiers. In the build prompts select the correct Apple team and all intended registered test phones. EAS must include those devices in Apple's provisioning profile. Adding a device to Expo after a build does not update that build: rebuild or deliberately re-sign with the new profile. Newly enrolled Apple accounts can have device-processing delays. See [Expo ad hoc provisioning](https://docs.expo.dev/build/internal-distribution/).

Restrict EAS internal build link access, open the completed installation link in Safari on a registered phone and install. If iOS requests Developer Mode for this ad hoc signed build, follow section 2. Record source/build/signing/profile/device evidence. Open with Metro and the Mac off: the app should load the bundled UI and connect to the existing backend. Then run the physical matrix. A provisioning failure is not a completed native app test.

## 6. APNs and calls: match the actual signed build

The app explicitly registers a **native APNs device token** after the user opts in through Account. It does not use Expo Push Service. The existing server operator must confirm APNs key/team/topic match `com.schachengineers.workspace`; see [server push settings](MOBILE_APPS.md#part-5-server-settings-that-must-match-the-apps). Never bundle the `.p8`, Apple login or server secrets in the app.

**This backend has one process-wide `APNS_SANDBOX` switch**, with no per-device sandbox/production routing. It cannot simultaneously route development and production APNs tokens correctly. Local Xcode debug builds normally use sandbox; ad hoc/TestFlight/store builds normally use production. Inspect the **actual signed app's `aps-environment`**, rather than assuming the build profile name decides it:

```bash
# Mac only: use the actual signed .app from your own build/archive.
codesign -d --entitlements :- /absolute/path/to/Workspace.app
```

For an IPA, unpack your own build outside the repository and inspect its `Payload/*.app`; keep provisioning/device data private. `development` means sandbox; `production` means production APNs. Missing/mismatched entitlement or profile blocks push acceptance. See [Apple APNs entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment) and the [backend routing](../../backend/platform/push_providers.go).

- **Do not flip the existing live server to sandbox for a debug phone.** Use a production-signed preview/TestFlight build when that server uses production APNs. Sandbox push testing requires a separately owned test backend configured for sandbox, a matching client origin and isolated fictional users.
- After a build/signing/environment change, re-register notifications through Account. Tokens are not interchangeable between environments. Trigger real fictional app events from another authorized actor; do not send a raw token to a public push tester.
- Test normal background/terminated delivery and tap authorization, plus force-quit as a separate OS state. APNs acceptance by the provider does not prove the phone displayed an alert. Revocation tests belong on isolated QA. Hints stay generic and body-free; already-delivered OS hints cannot be unsent.
- Verify audio/video and network/TURN paths with another phone and the web, permissions denied/restored, lock/background and audio interruption/reconnect. **System incoming-call UI/wake-up is not qualified** by current evidence. Call recording and automatic transcription remain disabled.

## 7. TestFlight, then the intended Custom App

1. Activate company Apple Developer membership. In App Store Connect, create or reuse the app record for bundle ID `com.schachengineers.workspace`. Obtain its actual numeric Apple app ID and configure `submit.production.ios.ascAppId` in `mobile/eas.json` if needed (the file currently has an empty production submission object). This is not the bundle ID, team ID or Expo project UUID.
2. Build the selected tested source, then submit the **specific verified build** through interactive EAS prompts:

```bash
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --profile production --platform ios
```

3. Use the correct company App Store Connect API credential via EAS credential management; never commit `.p8` keys. Wait for processing and resolve actual export-compliance/metadata requirements. Uploading is not a public release or proof of App Review approval. See [Expo iOS submission](https://docs.expo.dev/submit/ios/).
4. In App Store Connect → TestFlight, add internal testers who already have suitable team roles, or use external testing with Apple's beta review as required. Do not grant employees App Store Connect privileges just to avoid beta review. Install via Apple's TestFlight app. Test the standalone production-signed build, especially push/background/calls and updates. TestFlight builds expire; this is not permanent employee distribution. See [Apple TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).
5. For private production, enrol/verify **Apple Business Manager** and obtain the intended organization ID. Before approval, choose **Private Distribution** in App Store Connect and add the organization(s). This choice cannot simply be switched between public and private after approval. Do not publish publicly as a temporary shortcut. See [Apple distribution methods](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/set-distribution-methods/).
6. Provide a fictional reviewer account/company, privacy/support URLs, accurate data/privacy and background-audio explanations, screenshots for supported devices and export-compliance answers. `supportsTablet: true` means iPad acceptance/screenshots remain a gate; an iPhone-only test does not qualify tablets. Detailed account/store reference: [MOBILE_APPS.md Part3](MOBILE_APPS.md#part-3-iphone-ios).
7. After review/approval, acquire Custom App licences in Business Manager and assign through the company's agreed MDM or supported redemption-code route. Verify a pilot user can install/update from that actual private channel. MDM/managed-device prerequisites must be ready before promising staff-wide installation. See [Apple Custom Apps](https://developer.apple.com/custom-apps/).

Developer Mode is not required for normal App Store/TestFlight delivery. Preserve distribution certificates, API keys and recovery ownership in approved company secret storage. **Before a subsequent approved store version**, update/commit the user-facing `version` in `mobile/app.config.ts` (currently `1.0.0`) and create the matching App Store Connect version before building/submitting it. EAS production auto-increment advances `ios.buildNumber`, not that marketing version; additional beta builds for the same unreleased version can keep the marketing version. See [Expo version management](https://docs.expo.dev/build-reference/app-versions/). Updates also need checks, review where required and the shared staged [release/rollback procedure](NATIVE_TESTING_ROLLOUT.md#6-record-results-and-release).

## 8. Common failures

| Failure | Next check |
| --- | --- |
| Xcode won't install / device not supported | Mac/macOS and Xcode support matrix; physical phone OS |
| Signing says push unsupported | Personal Team selected or capability/profile missing; paid team required for unchanged app |
| Team/profile won't match | Exact bundle ID, team membership/permissions and generated config; preserve IDs and existing certificates |
| Phone absent from device picker | Cable, unlock/Trust, pairing, Developer Mode and installed Xcode platform support |
| Pods/native compilation fails | Capture first failure/toolchain versions; Expo doctor/lockfile; never blindly edit generated native files |
| Development launcher can't load | Same trusted LAN, Metro running, correct development client; preview works without Metro |
| Ad hoc app cannot install | Correct registered UDID included in built profile; signing expiry/Apple processing/OS; use current build link |
| No notification | Account opt-in, actual entitlement, APNs topic/team/environment, device token and sanitized provider response |
| Foreground call works, locked phone fails | Record OS/build/network/audio state; do not declare background or incoming calling complete |

No Mac build, signed IPA, physical iPhone test or store submission was executed by this documentation change. Record real results in a release run copy of the QA templates.
