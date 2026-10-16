# Free Expo Go core-screen mode — 16 October 2026

Source baseline: `4095f0347d5ab45e1575e5267d8ce7f8d24d261e`. Owner explicitly accepted unavailable calls/push and confirmed that actual native screens **inside Expo Go** are sufficient. This supersedes their earlier full-calls/push/standalone requirement. No Apple membership, EAS build or new paid provider is required for this mode.

## Change

`mobile/src/CallRuntime.tsx` defers LiveKit and Calls evaluation to custom-native builds, with global initialization before loading Calls. Root layout and Calls route use that boundary. Workspace imports notification types only and installs native listeners asynchronously only outside Expo Go, with unmount disposal; explicit push opt-in is rejected in Expo Go while authenticated device registration without push remains. Account explains unavailable push while retaining security/device controls. Existing business/API handlers and call implementation remain unchanged.

`npm run start:go` launches local Metro in Expo Go mode, defaults to LAN and supplies the existing public HTTPS origin unless explicitly overridden. No Apple credentials, device registration, tunnel or cloud build is involved. [Phone instructions](../../docs/deploy/EXPO_GO_IPHONE.md) explain Metro/SDK/LAN requirements and physical acceptance limits. Regular native builds retain calls/push and their separate signing requirements.

Six installed SDK57 patches were aligned through `npx expo install --fix`: Expo57.0.30, asset57.0.20, constants57.0.22, linking57.0.13, notifications57.0.23 and router57.0.28. ReactNative remains0.86.3; no direct new dependency, SDK major change or generated native directory edits. Lockfile records the installed graph.

## Executed verification

| Check | Actual result |
| --- | --- |
| Before product changes: `cd mobile && npm test` | PASS67files/450tests |
| New startup tests before implementation | Expected RED3: eager LiveKit/root and Calls route imports; new native initialization-order expectation |
| New push/account cases before implementation | Expected RED2; existing8 cases passed |
| Focused startup/push/account after implementation | PASS3files/13tests |
| Final mobile `npm run typecheck` / `npm run lint` | PASS; corrected initial missing-effect-dependency warning, final lint clean |
| Post-SDK-alignment full `npm test` | PASS68files/455tests |
| `npx expo-doctor` | Baseline main and feature each20/21 with same6pre-existing patch mismatches; after alignment21/21PASS |
| Launcher syntax/help/start | `node --check`, CLI help and actual Expo Go LAN startup PASS |
| Actual owned Metro iOS manifest/bundle | HTTP200/200; SDK57; Workspace; public server origin present;6,748,548-byte development bundle compiled |
| Android/iOS `npm run export` with explicit public origin/private output | PASS: both Hermes exports;34assets; not native binaries/device execution |
| Independent bounded read-only review | Spec PASS / Quality PASS; no critical/important findings |

The component tests simulate Expo Go where importing LiveKit/Calls would throw, and verify the unavailable route instead. Push tests verify no permission request, SDK evaluation/listeners/token registration, plus retained company switching/sign-out. Normal native call and notification paths remain tested. These are component/state tests, **not physical native screenshots**.

## Failures, warnings and limitations

- Initial focused-test/docs helper invocations used the wrong working directory; corrected and rerun. Command-location errors, not application regressions.
- Launcher verification exposed incompatible explicit `--lan` plus `--offline`; corrected to use Expo's LAN default and forward host options. Actual startup then passed.
- SDK drift was reproduced on unchanged main before patch alignment; an environment/dependency compatibility issue rather than a new Expo Go regression.
- An offline Metro manifest probe warned that icon/font asset-schema resolution was aborted. Its manifest and iOS bundle still returned200; the bundled application compiled. Keep that probe qualified; online main startup/assets and physical icon/font display are separate observations.
- SDK/npm install reported **32 unresolved vulnerabilities (12 moderate,20high)**. No forced audit fix, waiver or clean-security claim. Existing dependency exposure/remediation remains a release gate.
- Expo exports printed the existing NO_COLOR/FORCE_COLOR warning. No native compilation, signed IPA/APK, device install, provider acceptance or production business mutation was performed.
- All224 distributed manual QA scenarios remain NOT_RUN. Native permissions, camera/files/voice notes/sharing, actual Expo Go SDK/device compatibility, keyboard/layout and private lifecycle must be checked on the phone. Calls/push are intentionally unavailable in Expo Go, not passed.

## Runtime and recovery

Private temporary manifest, development bundle and exports: `/home/brahma/.local/state/schach-expo-go-20261016/` (0700). No real API login/data was used. The temporary verification Metro on19016 was stopped via its own terminal session. Existing unrelated Encore9400 was observed at PID53856 and left alone;8080/9080/5174 were not listening when checked, and no attempt was made to start/stop them. Stashes/worktrees preserved.

Source is published through the feature branch, fast-forward main and non-force push of both. Inspect live Git for exact HEAD. If a main-checkout Metro is left running for the owner's QR scan, its exact port/process/command and ready-state evidence are recorded in the canonical [handoff](../../docs/HANDOFF.md). Next physical action: install compatible Expo Go on iPhone, use the same trusted LAN, scan the launch QR and execute the phone checklist. No server redeployment or Apple device-registration retry is needed.

## Published main ready session

Product `e62d354` was atomically non-force pushed to main and the feature branch after fast-forward. Main `npm ci` passed (same32 unresolved audit warnings), then its own Metro was started on8081. Online main iOS manifest/bundle returned200/200,6,747,356bytes; configured HTTPS origin present. LAN manifest and PNG icon returned200; `/_expo/loading?platform=ios` returned200 and shows Expo Go. The earlier online asset-schema abort did not recur. The loading page requires platform detection: our probe without a platform header/query returned500 and corrected explicit query returned200. This is a probe-input issue. Main bundle/source and owned PID details are in result/handoff; raw output remains private. Metro remains running for the owner, not an executed physical-phone result.

## Account/network follow-up

16October: LAN connection attempts were directly logged as UFW BLOCK for TCP8081; IP/listener/local HTTP remained correct. Owner was given a narrow local-network firewall command; the agent did not execute a privileged firewall mutation. User later reached the iOS Expo Go account check and signed CLI into their chosen `nishantjaiswal0`; fresh `npx expo whoami` confirmed it. Restarted only the owned Metro via terminal Ctrl+C; replacement PID217158/session87967 listens8081, Using Expo Go, LAN iOS manifest and explicit-platform loading page200/200. No application change or physical-phone success claim.
