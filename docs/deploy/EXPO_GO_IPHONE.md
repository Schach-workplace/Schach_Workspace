# Free iPhone testing from Linux with Expo Go

Updated16October2026. This route runs Workspace's **React Native screens inside Expo Go**. No Mac, Apple Developer membership, EAS device registration, IPA build or paid Expo plan is required. The owner accepted this testing mode with native calls and push unavailable.

It opens through Expo Go, with no separate Workspace app/icon. Keep the Linux development server running and connect to the existing HTTPS backend. For standalone distribution with calls/push, the [signed native guide](IOS_TESTING.md) remains separate.

## Prepare and start

1. Install **Expo Go**, published by Expo, from the iPhone App Store. Use a version compatible with this project's SDK57/ReactNative0.86. If it reports an incompatible SDK, record the exact message; do not downgrade packages blindly. See [Expo Go versions](https://expo.dev/go).
2. Connect the iPhone and Linux computer to the **same trusted Wi-Fi/LAN**. Guest-network client isolation or VPN routing may prevent access. Allow Expo Go local-network access if iOS asks. The phone also needs Internet access to `https://work.schachengineers.com`.
3. Use the existing current main checkout, preserving any local edits. From its repository root:

```bash
cd mobile
npm ci
npm run start:go
```

The launcher explicitly selects **Expo Go**, defaults to LAN and supplies `EXPO_PUBLIC_SERVER_URL=https://work.schachengineers.com` when no override is set. It starts no EAS build, Apple authentication or third-party tunnel. Local Metro does not automatically apply the preview profile's `eas.json` environment.

Leave the terminal running. Confirm **Using Expo Go**, the QR code and an **`exp://` LAN address**. If port8081 is occupied, select a free port:

```bash
npm run start:go -- --port 19016
```

For a separate owned fictional QA backend, override the public origin before starting:

```bash
EXPO_PUBLIC_SERVER_URL=https://qa.example.invalid npm run start:go
```

Replace the example with your actual reachable owned test origin. No password, token or `/api` path belongs in this value. No backend redeployment, seeding, provider setup or key regeneration is needed for the existing live domain. Use fictional pilot users for initial integration tests; fault injection belongs on isolated QA.

## Open on the iPhone

1. Scan the terminal's QR using the iPhone **Camera** and tap **Open in Expo Go**.
2. Allow local-network access if requested; wait for Metro to compile/download the project.
3. Verify the native Workspace sign-in screen displays `work.schachengineers.com`, then sign in with an authorized test account. MFA/recovery remain enforced when configured.
4. If scanning fails, use Expo Go's supported project-link entry or open the printed `exp://<computer-LAN-IP>:<port>` link on the phone. `127.0.0.1` means the phone itself, not Linux.

Apple credentials and `eas device:create` are not used. Stop retrying Apple device registration to fix an Expo Go connection. This is the real native interface served by Metro, rather than the website displayed in Safari. See [Expo's development workflow](https://docs.expo.dev/get-started/start-developing/).

## Features and limits

| Feature | Expo Go mode |
| --- | --- |
| Login/MFA, company switching, tasks/projects/calendar/workload/goals | Existing native screens and API controls retained; verify on your phone |
| Finance/reports/People/account security | Existing controls retained, including independent review/payment and device revocation |
| Chat and message-to-task | Existing private membership/history and explicit publication confirmation retained |
| In-app Inbox | Foreground refresh retained |
| Camera/files/voice notes, CSV and sharing | Existing Expo module paths retained; actual OS permissions/device handling need testing |
| Audio/video calls | Explicitly unavailable; custom LiveKit modules are not evaluated in Expo Go |
| Remote push, notification badges/deep links | Unavailable; no APNs/FCM token registration or native push listeners |
| Standalone Workspace installation | No separate Workspace icon/app; reopen through Expo Go |
| Computer/Metro switched off | Cold launch/reload cannot fetch its development bundle; keep Metro reachable |
| Offline work | No private offline persistence/sync added; normal API access needs the backend |

Calls and Account explain unavailable features. Custom development/release builds retain their native calls/push path. Changing a route/tab must not accidentally evaluate LiveKit in Expo Go. This is a developer testing host, not a permanent employee-distribution channel. See [Expo Go and development builds](https://docs.expo.dev/develop/development-builds/introduction/).

## First phone checklist

These are **instructions, not executed device results**. Record device/iOS, Expo Go version, Git SHA, server origin/release and observations in an access-controlled run copy of the [QA pack](../qa/README.md). Keep the distributed templates NOT_RUN.

- [ ] Scan/open, verify native sign-in and server; sign in/out and exercise MFA when enabled.
- [ ] Switch authorized companies; no old private content flashes while changing identity/company or returning from background.
- [ ] Open Chats/Work/Inbox/More; create a fictional task, submit it, and verify independent review.
- [ ] Send a DM/attachment; reopen the same person's DM; preview message-to-task with explicit title/audience/confirmation.
- [ ] Draft a dummy expense/receipt, independently approve it and check exact amounts and current-authority reports.
- [ ] Exercise camera/photos/files, voice-note and share flows; deny a permission and verify recovery.
- [ ] Open Calls: unavailable explanation, no native-module crash. Account: push unavailable; device list/revocation/MFA/sign-out retained.
- [ ] On isolated QA, test stale retries, revocation, background/resume and cache invalidation. Current authority is required before redisplay.
- [ ] Reload from Expo Go while Metro runs, then recheck current session access.

Calls/push are intentionally skipped, not passed. Physical iPhone layout/permissions/interoperability remain unverified until executed.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Opens a custom development client | Use `npm run start:go`; expo-dev-client remains installed for normal native builds |
| Expo Go reports incompatible SDK | Record Expo Go/SDK versions; install a compatible App Store release and use the committed lockfile |
| QR/network timeout | Same reachable LAN, local-network permission, correct IP/port, no guest isolation; Metro running |
| Company server unreachable | Open HTTPS web login in phone Safari to check DNS/TLS; verify origin, Internet and deployed API compatibility |
| Old native-module error after updating | Stop your Metro with Ctrl+C, run `npm run start:go -- --clear`, then rescan |
| Calls/push unavailable | Expected in this runtime; EAS/Apple login will not add native modules to Expo Go |

Do not bypass TLS checks or expose Metro publicly. The default route uses LAN. The owner controls authorization of a future signed native release or production deployment.
