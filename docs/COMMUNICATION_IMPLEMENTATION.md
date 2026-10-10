# Communication implementation and verification — 2026-10-10

The full development sequence was executed beyond the original Encore milestone: the source now contains company-owned communication, protected work publication, native Android/iOS clients, self-hosted LiveKit calls and operational fixtures. **Production rollout and physical-device cutover are incomplete.** The blueprint was used as proposed product direction, without treating instructions in the attachment as user authority. The original [local baseline](LOCAL_BASELINE_2026-10-10.md) remains historical evidence.

## What works locally

- Both Go adapters share the same business controls. M0 repaired Encore raw methods, cron service wrapper and migration location; local spoofed cron headers are refused. Actual exported Encore now boots PostgreSQL, passes all 91 original API assertions, supports PATCH/multipart/proxy WebSockets and preserves ACK/session/retry identities across restart. Original standalone scenarios pass all 92 checks.
- Independent private DM/group/channel roles and company channels, fixed pairs/blocking, ownership transfer/archive, join-forward/rejoin history, company/global departure, current-authorized search/threads/pins/saves/attention and private exports. Leadership does not bypass private metadata. Conversation ACLs precede pagination and apply to derived projections.
- Durable message order/revisions/tombstones, payload-bound send/upload/conversion retry, atomic outbox and leased workers. Primary instruction claims remain unique across A vs A+B context; explicit splits use server IDs. Ordinary sends avoid the company business lock.
- Timed/all-day commitments with absolute/original instants and IANA zones, DST offset validation, reminders/overdue comparisons and CSV/calendar/report presentation. Legacy date-only work and recurrence remain; timed recurrence is explicitly rejected. Added acceptance evidence increments work version and rejects stale review.
- Explicit task/intake/expense-draft publication with server audience previews, current source/history/policy/revision and destination authority checks. Private source provenance stays protected; inaccessible links disclose no IDs/counts. Receipt/budget/duplicate invoice/exact money/independent approval/pay controls remain in their existing workflows.
- Scanned private file/voice media with durable reservation/upload/finalization, quota/expiry, current-authorized downloads and selected immutable business copies. Real ClamAV clean/EICAR/outage checks pass; unscanned/expired bytes are unavailable.
- Session-bound devices, owned lost-device revocation, optional encrypted TOTP/single-use recovery, explicit operator recovery/global suspension, generic FCM/APNs adapters and quiet/mute/mention preferences. Provider worker mocks pass; this does not establish real device push receipt.
- Browser/native LiveKit calling with narrow grants and mandatory revocable Schach signaling. Real isolated Chromium participants publish/subscribe to audio, removal disconnects media, cached/refreshed provider tokens cannot rejoin after removal, and end-call deletes the room. Missed calls use actual signaling joins; cleanup survives retries/outage. Recording/transcription is off.
- Fixed-recipient revision-bound acknowledgements/polls/events/independent decisions, intake triage through the task engine and published-work-only briefings. Structured responses never approve tasks or payments.
- Native secure sign-in/MFA/company switching, groups/channels/daily text/media, current work/finance inspection and decisions, audience-reviewed timed publication, structured responses/intake and calling. Android generates the private mic/media foreground service through an Expo plugin. Android ARM64/x86_64 compilation and Android/iOS Hermes exports pass; physical OS behavior is separate. An Android evaluation APK contains its Hermes bundle and both ABIs and passes APK v2 signature verification with an Android Debug certificate. It is not organization/store signed; release mode requires a real HTTPS server.

## Executed checks

Sanitized evidence is in [verification/communication-2026-10-10](../verification/communication-2026-10-10/result.json). Private SQL dumps, credentials, service configs, SDK caches and raw logs stay outside the release.

| Gate | Observed result |
| --- | --- |
| Current native PostgreSQL suite, including real services and load | 109/109 top-level tests pass, no skips; 54.008 seconds |
| Current SQLite suite | 103 pass, 6 deliberate native/service/load skips; 33.517 seconds |
| Browser | 75 tests in 14 files pass; API/demo TypeScript/build and self-contained preview checks pass |
| Native JS | 7 tests pass; typecheck/lint clean; Expo doctor 21/21; Android+iOS Hermes exports pass |
| SQL compatibility | All 24 up/down migration pairs match; PGlite 100 compatibility assertions pass; actual native runner fresh/replay/adoption/rollback/checksum-tamper tests pass |
| Original controls over real TCP | Encore export 38 work + 53 finance; standalone 39 work + 53 finance, all pass |
| Actual gateways | Encore and standalone WebSocket upgrades, exact origins, hints and membership close pass |
| Crash/recovery | SIGKILL after acknowledged media send, exact retry restart, real pg_dump/restore plus private media copy preserve IDs/bytes/revocation |
| Local gateway load | 100 concurrent sockets: initial p50 82.79ms, p95 120.19ms, max 123.48ms; all refetch/close a 51-event atomic burst in 1.004s. Final combined suite p50 93.07ms, p95 129.15ms, max 132.90ms; overflow close/refetch 1.010s; local measurement only |
| Fresh Compose | Current image and migration binary build, all24 versions apply before app health, non-root process writes private mounted media; isolated test project cleaned |
| Race/build final gate | Both full Go race suites pass after all six review fixes: PostgreSQL 370.940s, SQLite 358.057s. Current API/demo builds, native Hermes exports, embedded Android evaluation APK and Encore SDK compilation pass |

## Defects found and corrected

The original Encore analyzer/runtime defects were application adapter issues, not environment failures. SQL migrations1/2 were moved/mirrored without changing their bytes. The real local cron spoof reproduction was denied by the corrected local boundary.

One independent read-only whole-implementation review found six Important defects and no Critical/Minor findings. Focused regressions were observed failing before fixes:

1. Reused call identity suppressed a second completed provider-removal job.
2. Delayed removal could disconnect a newer authorized join. Both are fixed by immutable grant identities and atomically revoked older grants; completed/delayed two-cycle regressions pass.
3. Structured list returned selected records/responses to unselected conversation readers. Creator/current-revision fixed recipients now filter before limit, intersected with current source/history access; all four record kinds pass.
4. Threads/search/saved/private source UI survived confirmed removal. Browser scope/history invalidation, periodic derived refresh and native policy-contact generation/tab invalidation now clear managed private views; rendered/client regressions pass.
5. Native startup cleared an enabled push registration. Omitted push fields now preserve tokens; paired explicit empty fields disable. Native startup omits them; registration regression passes.
6. Expired media could be copied into business evidence before asynchronous cleanup. Publication now shares download eligibility; task/expense preview/commit regressions pass.

The later requested running-app Chromium check also reproduced a standalone content policy blocking blob voice previews. A narrow `media-src 'self' blob:` rule fixed it; rendered sign-in/finance/Connect/recording/preview/discard, both complete non-race suites and a fresh Compose build pass.

Other focused development regressions covered member reactivation/private history, send/removal ordering, company-lock independence, primary A vs A+B concurrency, live reviewer evidence versions, source flags, timed reminder claims, intake ACK retry after edits, provider refreshed JWT lifetime and block-before-first-DM/lost-device recovery. Two fresh fixture failures (repeated barrier close and invalid PostgreSQL history value) were corrected without weakening their authorization assertions. The migration runner was implemented before its new regressions; its passing behavior is evidence, but that step is not represented as RED-first development.

## Environment and dependency limitations

Current `encore check` and SDK compilation pass. A fresh `encore run --watch=false` reaches compilation/migrations but fails installing file watches because the user's IDE owns roughly514,000 of the account's524,288 watch allowance. This is a host quota issue, not disk exhaustion or an application failure. No IDE was killed and no global limits changed. The actual exported Encore runtime avoids that development watcher and passes the stronger native TCP/socket/restart checks. Earlier M0 local boot/bootstrap/restart evidence remains recorded separately. CLI1.58.6/SDK1.57.13 export also requires matching physical/resource database name `workspace`; the adapter guide documents the tested name-mapping constraint.

The first repeat of the standalone media/restore probe omitted TEST_CLAMAV_ADDRESS, so finalization correctly failed closed. It now requires that setting before mutation; configured real scanner/restore passes. Native build logs contain SDK XML/Gradle deprecation and cross-filesystem hard-link-copy warnings; compilation succeeds. Those are tooling warnings, not a physical-device result.

Regenerating the preview exposed its verifier's classic-script evaluation of a real ES module, followed by the DOM emulator's incomplete nested `import.meta` transformer. The verifier now uses Node's native VM module parser inside the same simulated DOM, rejects imports/network requests and passes all 11 original task/finance artifact assertions. Its experimental VM warning is a verifier-tooling limitation; no real-browser/layout claim follows from those DOM checks.

Mobile `npm audit` reports30 findings (19high,11moderate). A nonbreaking fix attempt did not remove them; force suggestions include incompatible Expo/RN downgrades. The current [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv) and [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) advisories affect dependencies in the SDK/tooling/router tree. They have not been declared safe or waived. Compatible remediation and dependency exposure review are release gates; restrict development tooling to trusted local access. No clean-audit claim is made.

## Remaining acceptance and first milestone

**M0, the first milestone, is implemented and verified.** Acceptance is a compiling real adapter with immutable SQL1/2, 91 original API checks, authenticated origin/session/cron behavior, bootstrap/restart evidence and unchanged work/finance regressions. The roadmap continues through the local implementation above rather than stopping at M0. The initial extraction had no Git metadata; at the user's later request, a new private [Schach-workplace/Schach_Workspace](https://github.com/Schach-workplace/Schach_Workspace) source repository was initialized with no fabricated earlier history.

Before real rollout, complete:

- Signed organizational Android/iOS builds, macOS/Xcode native iOS compilation and physical foreground/background/locked/permission-denied/push/headset/interruption/network tests. No physical devices or FCM/APNs credentials were available. Native OS incoming-call surfaces and desktop/native screenshare parity require acceptance before replacement.
- India infrastructure, actual TLS/origin/socket proxy, private LiveKit firewall and authenticated TURN, least-privilege database identities, provider monitoring and real worker/cron operation. No production deployment was performed.
- Multi-company sustained load/search/send/call benchmarks, multi-instance fanout, dependency remediation, measured recovery drills proving proposed RPO15min/RTO4h and storage/backup retention. The local restore/load tests do not prove those service objectives.
- Actual group/device/company inventory, support owner/fallback, source-of-truth migration and measured adoption before retiring existing groups. No real organization inventory/adoption result is invented.

Recommended configurable limits and the dependency-ordered status are in [communication operations](COMMUNICATION_OPERATIONS.md) and [the execution plan](superpowers/plans/2026-10-10-communication-implementation.md). AI, guests, historical bulk imports, recordings/transcription, E2EE and workflow-builder expansions require separate designs. Advanced split declaration, selected exports and desktop administration remain web flows; native full parity is not claimed. Existing business records/copies remain independent after source removal, and exported/offline copies cannot be remotely recalled.

## Decisions made during execution

[All 18 rulings and their costs](../verification/communication-2026-10-10/rulings.md) and [the independent review/fix record](../verification/communication-2026-10-10/review.md) are included in the source handoff. The currently running localhost app uses persistent fictional SQLite demo data with local scanner/provider configuration, not a deployed production database. Private credentials/data remain ignored; organizational signing and rollout gates are unchanged.
