# Native testing and rollout against the deployed web server

Updated 15 October 2026. Start here, then follow the [Android guide](ANDROID_TESTING.md) or [iPhone/Mac guide](IOS_TESTING.md). [MOBILE_APPS.md](MOBILE_APPS.md) retains the private-store account and configuration reference.

The owner confirms the web application is already deployed at **https://work.schachengineers.com**. Native clients connect to that same backend; they do not need another copy of the web application. **Do not repeat server bootstrap, demo seeding, database creation or key generation.** A Git push does not update the running server. Coordinate a separate, backed-up server release only if a reproducible API incompatibility requires one.

For the owner-approved **free Expo Go core-screen route from Linux**, start with [EXPO_GO_IPHONE.md](EXPO_GO_IPHONE.md). Calls/push are unavailable in that mode. The signed standalone release gates below remain in force for full native builds.

## 1. Route and dependencies

| Order | Deliverable | Prerequisites | Exit condition |
| --- | --- | --- | --- |
| 1 | Record the deployed API and test scope | Operator, HTTPS domain, approved fictional QA environment | Trusted TLS; known server image/release; accounts and cleanup owner identified |
| 2 | Android standalone preview APK | Company-owned Expo account/project; signing keystore | Installs and signs in without Metro; Firebase optional for this first step |
| 3 | iPhone development test from owner's Mac | Compatible Mac/Xcode/iPhone; active Apple team supporting push | USB install and functional test; development build needs Metro |
| 4 | iPhone standalone preview or TestFlight | Expo project and paid Apple membership; UDIDs for ad hoc or App Store Connect for TestFlight | Opens with Mac/Metro off; correct signed APNs environment |
| 5 | Physical-device acceptance | Two independent users/devices; configured FCM/APNs and LiveKit/TURN | Recorded cross-platform workflows, privacy, retry and network results |
| 6 | Private production distribution | Store prerequisites and release signoff | Managed Google Play and Apple Business Manager Custom App installed by pilot users |

**Current gates:** Expo/EAS and Apple Developer accounts were reported not ready on 14 October. Mac model, macOS and iPhone OS are unknown. The owner reports server configuration complete; native calls/push/signing are still unverified. No new phone build or store submission was performed for these guides. Use the deployed HTTPS web app while accounts are being prepared. Account approval, cloud queues and store review times are outside this repository's control.

## 2. Prepare the release and test environment

1. Record the client Git SHA, branch, clean/dirty state, build profile, EAS build ID, version/build number, artifact hash, signing identity, OS/device model and tester. Never put passwords, tokens, UDIDs or private keys in a committed report.
2. Ask the server operator to record the **running image digest/release and migration level**, not just the source checkout SHA. Source migrations currently end at **59**. A health response does not prove that the deployed API includes them. Verify app flows against the actual release before inviting employees.
3. Use an isolated fictional QA server for permission, retry, revocation, expiry and destructive scenarios: [QA environment](../qa/TEST_ENVIRONMENT.md), [data/roles](../qa/TEST_DATA.md), [fault injection](../qa/FAULT_INJECTION.md). Existing scripts refuse protected port 8080. A phone cannot use the developer machine's `localhost`; expose an owned test origin securely, with its own provider configuration.
4. The `preview` and `production` profiles currently target the **live domain**. For staging, create a reviewed separate EAS build profile with its own `env.EXPO_PUBLIC_SERVER_URL` and matching EAS environment; do not assume a shell variable overrides the profile's built-in value. Development builds can use a different origin at sign-in. Release origins require HTTPS and no `/api` suffix.
5. Only after isolated QA passes, have the operator create **fictional, clearly labelled pilot companies/accounts** on the live server for a narrow integration smoke test. Use a member, independent reviewer, finance reviewer/payer and a second-company outsider. Use dummy money/evidence; an expense payment record must never trigger a real bank transfer. Keep the founder's real login out of screenshots and review credentials. Do not run fault injection, mass imports, offboarding or broad negative-access probes against production.
6. From the test phone, open the existing web login in its browser and check trusted HTTPS. Optional read-only terminal probe:

```bash
curl --fail --show-error --silent https://work.schachengineers.com/api/health
```

Expect `{"ok":true}`. A failure is a network/TLS/server-readiness issue to investigate before client debugging; never bypass certificate validation. Success is only a liveness check. On 14 October this endpoint passed trusted TLS; authenticated production workflows were not tested by the agent.

## 3. Build and evidence rules

The permanent native identity is **Workspace**, `com.schachengineers.workspace`, URI scheme `workspace`. Configuration lives in [app.config.ts](../../mobile/app.config.ts), [eas.json](../../mobile/eas.json) and [serverConfig.ts](../../mobile/src/serverConfig.ts). Follow [mobile/AGENTS.md](../../mobile/AGENTS.md). Use the lockfile, SDK 57 documentation and `npx expo install` for new dependencies. Do not hand-edit generated `mobile/ios` or `mobile/android`.

Run these in `mobile/` on the selected release source before building:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npx expo-doctor
```

Stop on failure; save the command, exit code and sanitized output. Historical 450 tests/67 files and doctor21/21 are **not** a fresh device release result. The existing [limitations](../SECURITY_AND_LIMITATIONS.md) and [implementation verification](../COMMUNICATION_IMPLEMENTATION.md) retain open dependency/security and runtime gates; resolve or explicitly assess applicable findings before production signoff. Do not use forced package upgrades to bypass SDK compatibility.

EAS cloud builds upload build source to Expo; use the company account and review the build upload contents. Keep `.env`, key files, server data and private archives out of the checkout/upload. Only the public HTTPS origin belongs in `EXPO_PUBLIC_*`. APNs, Firebase service-account and store submission keys stay in approved secret storage. EAS internal build links can be accessible to anyone holding the link by default; restrict project access before sharing. See [Expo build access](https://docs.expo.dev/build/internal-distribution/).

## 4. End-to-end acceptance matrix

Execute on **physical Android and iPhone**, initially with two fictional users, then Android↔iPhone and phone↔web. Include Wi-Fi, mobile data, a restricted network that requires TURN, cold launch, foreground/background and locked-screen states. Development and standalone/store builds are different rows in the device matrix. A simulator, successful token mint or web screenshot does not qualify real media/push.

The detailed numbered steps/expected results already exist in the [224-case QA pack](../qa/README.md), [module index](../qa/MODULE_INDEX.md) and [team runbook](../qa/TEAM_RUNBOOK.md). Use those cases for full coverage; this is the native release sequence, not a replacement catalog. All distributed scenario statuses remain **NOT_RUN**.

| Run order | Action on fictional data | Required observation | Detailed QA module |
| --- | --- | --- | --- |
| 1 | Install, cold open, sign in; exercise MFA and recovery where enabled | Correct host and account; denied credentials fail cleanly; no secret in logs | AUTH, MOBILE |
| 2 | Switch between two memberships; try an inaccessible company in isolated QA | Only current membership data; stale requests never repopulate another company | SECURITY, SETTINGS |
| 3 | Overview → My work → task → project → calendar/workload drill-down | Consistent scoped records/filters; keyboard, back and refresh preserve usable navigation | OVERVIEW, WORK, TASKS, PROJECTS, CALENDAR, WORKLOAD |
| 4 | Create a timed task, revise deadline with reason, attach evidence, submit and independently review | Original commitment retained; correct timezone/time; owner cannot accept own work | TASKS, JOURNEYS |
| 5 | Concurrent edits from web and phone, then retry a lost acknowledgement in isolated QA | 409 is recoverable; original key/body/target frozen; one canonical effect, no duplicate | TASKS, SECURITY |
| 6 | DM the same person twice; group/private chat, text/photo/file/voice note | Existing DM reopens without conversation naming; authorized content and clean attachments arrive | CONNECT, MEDIA |
| 7 | Leadership outsider attempts private-chat/history access in isolated QA | Rank grants no private access; joining/leaving respects history intervals | CONNECT, SECURITY |
| 8 | Convert a selected message to task; change preview and repeat a completed conversion | Default denies publication; owner enables explicit selected publication; title/audience and existing-task outcome shown; confirmation resets on re-preview | CONNECT, JOURNEYS |
| 9 | Deny camera/mic/photos/notifications; retry after OS Settings change | Clear recoverable state; no silent permission loop; no unnecessary access | MEDIA, CALLS, MOBILE |
| 10 | Audio/video call on Wi-Fi, mobile data and TURN-only network; mute, camera, speaker/Bluetooth, leave/rejoin | Two-way media, correct devices, ended call releases resources; record actual relay/network evidence | CALLS |
| 11 | During an active call lock phone/background, receive OS interruption, switch network, reconnect | Measure audio continuity/recovery and visible state; failures block that capability; recording/transcription remain disabled | CALLS, MOBILE |
| 12 | Incoming call when foreground/background/locked/not running | Record exact behavior and OS constraints; do not advertise system incoming-call UI or guaranteed wake-up without evidence | CALLS, MOBILE |
| 13 | Explicitly enable notifications in Account; another user sends chat and task/expense attention | Direct FCM/APNs delivery; generic body-free hint; tap fetches currently authorized destination | INBOX, CONNECT, MOBILE |
| 14 | Repeat push in background/normal terminated state; separately test Android force-stop and iOS force-quit | Distinguish OS suppression from app/provider errors; opening app restores current state | MOBILE, OPERATIONS |
| 15 | In isolated QA revoke conversation membership/company/device while cached screen, queued retry and old push exist | Cached/queued/future private output revoked on revalidation; old hint reveals no content; no new send after authority loss | SECURITY, PEOPLE, MOBILE |
| 16 | Draft dummy expense with receipt → independent review → payment record → finance report/export | Exact minor units and totals; creator cannot approve/pay own expense; no duplicate payment record | FINANCE, REPORTS, JOURNEYS |
| 17 | Review task/report figures and saved/historical report permissions | Original vs revised commitments agree; CSV/share opens; reports respect current source authority | REPORTS |
| 18 | Add goal observation and complete linked task; review assistance suggestions | Observation stays independent; suggestion never approves work, pays or proves an outcome | GOALS, INTELLIGENCE |
| 19 | People/onboarding/access review/departure in isolated QA; Inbox and Settings device revocation | Responsibilities explicit, no self-service profile/offboarding-reason behavior invented; revoked session denied | PEOPLE, INBOX, SETTINGS |
| 20 | Large text, VoiceOver/TalkBack, small phone, long lists/chat, keyboard, share sheet, offline/reconnect | Controls reachable, labels/focus usable, no clipped actions or false success; no private-data flash on account change | MOBILE |
| 21 | Upgrade installed preview/store build; re-enable notifications if token changed; repeat sign-in/call/finance smoke | Correct signing/update behavior; restored session reauthorized; no duplicate writes | MOBILE, OPERATIONS |

For revocation, test an online phone and an offline phone resuming. Record **when revalidation occurs**; do not claim the server can erase pixels on a disconnected device instantly. Already-delivered generic OS hints may remain; they must not contain private bodies or grant access. Call background/incoming behavior is an acceptance gate, not an implemented CallKit/PushKit guarantee.

## 5. Diagnose without changing the live server blindly

| Symptom | First evidence | Classification / next action |
| --- | --- | --- |
| Web login/health fails on phone | Trusted TLS, DNS, clock, mobile-data vs Wi-Fi | Environment/server connectivity; operator investigates |
| 404 or missing workflow in native, web health still OK | Exact API route/status and running server release | Possible older deployed API; coordinate compatibility fix separately |
| APK/IPA won't install | Signing identity, build profile, device/OS, UDID for ad hoc | Toolchain/provisioning before app behavior |
| Call credentials issued, no media | Peer media, device permissions, ICE/relay path, TURN reachability | Token success is insufficient; distinguish app state from provider/network |
| No push | User opt-in, native token registration, server queue/provider response, FCM project or APNs environment | Provider/credential/OS gates; device state may suppress delivery |
| Duplicate task/payment or private content after revocation | Sanitized repro in isolated fixture with original request identity | Application defect; stop rollout and preserve evidence |

Use current [communication operations](../COMMUNICATION_OPERATIONS.md), [API contract](../API_CONTRACT.md) and [security controls](../SECURITY_AND_LIMITATIONS.md). Never log native tokens, Authorization headers, message bodies, receipts or passwords to diagnose a provider. Do not turn on call recording/transcription. Do not flip the live backend's APNs environment for a development phone: see the [iOS guide](IOS_TESTING.md).

## 6. Record results and release

Copy [execution-log.csv](../qa/execution-log.csv), [defect log](../qa/defect-log.csv) and [release signoff](../qa/release-signoff.md) **outside generated `docs/qa/`** into an access-controlled release run directory. Supplement each applicable QA row with this native run header:

```text
Run/date/tester:
Client SHA / clean state / EAS build ID / profile:
Version / Android versionCode or iOS buildNumber / artifact SHA256:
Server origin / deployed image digest / migration level:
Device alias / model / OS / network / app lifecycle state:
Signing certificate alias / APNs environment or Firebase project alias:
Fictional company and actor aliases:
Case ID / expected / actual / PASS|FAIL|BLOCKED|NOT_RUN:
Sanitized evidence location / defect / blocker owner / retest build:
```

1. Run isolated applicable P0/privacy tests and native matrix; resolve failures and account/provider blocks. Leave missing tests BLOCKED/NOT_RUN, never PASS by inference.
2. Test the **production-signed build through its actual distribution channel** before employee rollout. APK vs Play and ad hoc vs TestFlight can differ in signing, push and lifecycle behavior. Assess dependency findings, privacy disclosures and recovery readiness with named owners.
3. Start with a proposed **2–5-person pilot**, then a department, then the remaining authorized staff after signoff. This is a rollout recommendation, not an owner-approved capacity/SLA. Use private-store assignment groups; keep access governed by backend membership.
4. Monitor crashes, failed API writes, duplicate effects, unauthorized access attempts, provider failures and call reconnects using sanitized operational signals. Agree support coverage and observation duration with the operator before each expansion.
5. If acceptance fails, stop new distribution/assignment, stop testing the affected build and retain the working HTTPS web route. Revoke affected sessions via supported controls if necessary. Installed phones do not disappear when a link/track is disabled.
6. Ship a corrected build with a **higher build number/versionCode** and compatible signing. An arbitrary older IPA/APK is not a reliable store rollback. Do not downgrade/reset the production database or rotate shared keys to undo a phone release. Preserve pending request identities and capture consent before any uninstall that would discard local drafts/session state.

The permanent channels remain **Managed Google Play private app** and **Apple Business Manager Custom App**. Test tracks/TestFlight are interim testing routes. Profile editing, an offboarding reason field and the 85% workload threshold remain deferred owner decisions; this rollout does not change them.
