# Free local mobile test lab

This lab tests the existing app. No paid service, Expo account, Apple membership, production login or cloud upload is needed for the executed tests.

Read [results and limitations](record.md), [machine results](result.json), [the implementation plan](../../docs/superpowers/plans/2026-10-19-mobile-lab.md), and [handoff section17](../../docs/HANDOFF.md#17-mobile-environment-and-cross-platform-testing--19-october-2026).

## What runs here

| Environment                                                | What it exercises                                                                                      | What it does not certify                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Actual Android API36 emulator, KVM, official Expo Go57.0.9 | Current native React Native screens, real local API, OS keyboard/Back/font scale and scoped navigation | Physical hardware, signed standalone release, calls/push unavailable in Go |
| Actual WebKit26.6, iPhone SE3/15 Pro Max browser profiles  | Current RN Web components, small/large touch viewports, forms, enlarged-text/landscape/empty states    | UIKit/iOS Simulator, real iPhone keyboard/screen reader/safe areas or APNs |
| Actual Chromium, Pixel5/GalaxyS24 browser profiles         | Same component matrix with Android browser behavior                                                    | Native Android widget behavior                                             |
| Compiled web plus real fictional API, both engines         | Sign-in,13module screens, reviewed calendar download                                                   | Full manual QA or native OS sharing/provider delivery                      |

The RN Web fixture intentionally replaces Workspace/client/native boundaries; writes there are disabled. The compiled web and actual Android paths use the new disposable fictional API. Browser device names describe user-agent/touch/viewport profiles; they are not physical phones. Device pixel ratio is explicitly1 for portable evidence screenshots.

## Current installed tools and ownership

- Lab tools/AVD: `/tmp/workspace-mobile-lab-20261019`; WebKit: `/tmp/workspace-mobile-browsers/webkit-2359`.
- Existing Playwright1.63 module: `/home/brahma/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs`.
- Android emulator name: `workspace-qa-api36-20261019`; serial `emulator-5578`; isolated ADB server5039. Scripts deliberately select only this serial/server, never an attached personal phone.
- SDK command-line tools from Google's checksummed repository; emulator37.2.12, platform tools37.0.1, Google APIs x86_64 API36/revision7. Temurin21 JRE and Expo APK URLs/hashes are recorded in environment.json.
- Ports: fictional API/web9092, Metro19019, foundation preview5186, native-component preview5187. Unrelated9400 and existing databases are not owned by this lab.
- Tool downloads live in `/tmp` and may be cleared by reboot. Repository scripts/evidence are durable. The installed SDK can be recreated from the recorded official sources and standard Android SDK setup; do not assume a reboot retains the AVD.

Check current listeners and the handoff before starting anything. Never adopt8080/production or an occupied port. Start a **new** fixture using the repository helper if the recorded server was stopped:

```sh
SCHACH_QA_PORT=9092 bash docs/qa/tools/start-isolated-qa.sh
```

Its private run path is printed. This creates fictional data and must not be pointed at retained workspace databases. `native-fixture.py --allow-demo-mutations` creates controlled fictional task/project/chat/growth/Knowledge records using independent publication; run once per new fixture and retain its generated IDs for that run.

## Browser screen matrix

From the repository root, start both existing fictional component servers in separate terminals:

```sh
node verification/mobile-experience-2026-10-18/preview/serve.mjs
node verification/mobile-premium-2026-10-18/preview/serve.mjs
```

Then run the current installed engine/tool paths:

```sh
export PLAYWRIGHT_MODULE=/home/brahma/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs
export PLAYWRIGHT_BROWSERS_PATH=/tmp/workspace-mobile-browsers
node verification/mobile-lab-2026-10-19/browser-matrix.mjs
SCHACH_SMOKE_URL=http://127.0.0.1:9092 node verification/mobile-lab-2026-10-19/web-api-matrix.mjs --allow-demo-mutations
```

The full component matrix has134cases. `LAB_SCREEN_FILTER=workload` runs six scoped cases without overwriting the full JSON result. Both scripts close only their owned browser contexts/processes, block external requests and save PNG/JSON evidence. Expected anonymous GET/auth/session401 bootstrap responses are recorded explicitly in the actual-API matrix; unexpected HTTP/console/runtime failures remain failures.

On another machine install Playwright1.63 in a separate test-tools directory, set PLAYWRIGHT_MODULE to that package's index.mjs and install its WebKit/Chromium browsers. The app's package files do not need modification. On this Arch host, `setup-webkit-compat.py` extracted checksum-verified public Ubuntu24 ICU74/XML2/Flite libraries into the isolated browser directory, never system libraries or maintainer scripts. Set WORKSPACE_WEBKIT_BUILD if using a different isolated WebKit build path.

## Recreate Android tools after a temporary-directory cleanup

Use the official command-line-tools ZIP, Temurin21 JRE archive and Expo Go APK recorded in environment.json; verify their recorded hashes before extraction/install. Extract the Google tools so the executable is `sdk/cmdline-tools/latest/bin/sdkmanager`, and the JRE into `java/<extracted-JRE-directory>` within WORKSPACE_MOBILE_LAB. This is tool installation, not a generated app ios/android project.

Set JAVA_HOME to that extracted JRE and these isolated directories before invoking the SDK manager:

```sh
export WORKSPACE_MOBILE_LAB=/tmp/workspace-mobile-lab-20261019
export JAVA_HOME="$WORKSPACE_MOBILE_LAB/java/<extracted-JRE-directory>"
export ANDROID_HOME="$WORKSPACE_MOBILE_LAB/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_USER_HOME="$WORKSPACE_MOBILE_LAB/android-user"
export ANDROID_EMULATOR_HOME="$ANDROID_USER_HOME"
export ANDROID_AVD_HOME="$WORKSPACE_MOBILE_LAB/avd"
mkdir -p "$ANDROID_USER_HOME" "$ANDROID_AVD_HOME"
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" 'platform-tools' 'emulator' 'system-images;android-36;google_apis;x86_64'
```

Review/respond to the SDK licence prompts yourself. These are the package IDs actually installed in this lab; future SDK-manager downloads can resolve newer package revisions, so record the new installed versions and requalify them rather than claiming an identical pinned environment. Use create-avd.py/start-android.py only after successful installation. Host KVM access is required by this launcher's explicit `-accel on`; do not claim a native VM run if acceleration/boot fails.

## Actual Android app

On the existing installed lab, create the owned AVD only if it does not already exist, then launch it:

```sh
python3 verification/mobile-lab-2026-10-19/create-avd.py
python3 verification/mobile-lab-2026-10-19/start-android.py
```

The launcher refuses occupied5039/5578/5579 and starts its own ADB server and headless VM. Ctrl+C stops only that VM/server. Do not start another copy when the recorded VM is running. `create-avd.py` needs the SDK, matching system image and JRE at WORKSPACE_MOBILE_LAB (default the path above); it does not download them or overwrite an existing AVD. Current evidence records the successful actual KVM check; the restricted execution sandbox hid /dev/kvm, while the actual host exposed it.

Start Metro in the existing feature checkout's mobile directory, with the same fictional API and a fresh isolated Expo settings directory:

```sh
__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/workspace-mobile-lab-20261019/expo-home EXPO_PUBLIC_SERVER_URL=http://127.0.0.1:9092 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 npm run start:go -- --offline --port 19019
```

That shell-only Expo settings override is supported by the installed CLI and avoids the owner's cached Expo login. Never put it in an app .env file. `--offline` and `--localhost` are mutually exclusive in this CLI; use the tested invocation. The dev API permits this localhost HTTP fixture; distribution builds still require HTTPS.

After the owned VM boots, install only the recorded official Expo Go APK and set two owned reverse ports:

```sh
/tmp/workspace-mobile-lab-20261019/sdk/platform-tools/adb -P 5039 -s emulator-5578 install -r /tmp/workspace-mobile-lab-20261019/expo-go-57.apk
/tmp/workspace-mobile-lab-20261019/sdk/platform-tools/adb -P 5039 -s emulator-5578 reverse tcp:9092 tcp:9092
/tmp/workspace-mobile-lab-20261019/sdk/platform-tools/adb -P 5039 -s emulator-5578 reverse tcp:19019 tcp:19019
/tmp/workspace-mobile-lab-20261019/sdk/platform-tools/adb -P 5039 -s emulator-5578 shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:19019 -p host.exp.exponent
```

Dismiss Go's first-run developer tutorial, verify the sign-in screen says127.0.0.1:9092, and use the public fictional founder account from README. The blue/grey Tools overlay is Expo Go developer chrome, not production Workspace UI. No personal Expo/Apple login is needed for this isolated offline run.

```sh
python3 -m unittest discover -s verification/mobile-lab-2026-10-19 -p test_native_results.py -v
python3 verification/mobile-lab-2026-10-19/native-screens.py --allow-demo-mutations
python3 verification/mobile-lab-2026-10-19/native-interactions.py --allow-demo-mutations
```

Result accounting requires every expected case and retains failures even if diagnostics fail. The six driver tests run without any device. The scripts require the controlled native-fixture.json from the same new API run. A `--only <route>` screen retry or `--only <case-name>` interaction retry retains the previous attempt and must still satisfy the full fixed case matrix; it cannot qualify an incomplete prior run. Native deep links carry the company parameter required by the existing permission guards. Unqualified links correctly redirect; do not change the app to satisfy an incorrectly scoped test URL. Native XML dumps include only fictional app/system data. Font-scale changes apply only to the owned VM and restore their prior value in finally. Assertions, failed attempts and final outcomes remain explicit; do not count a navigation button as proof that its destination loaded.

All original manual QA cases remain separately tracked. Read the record before interpreting these automated results as release approval.
