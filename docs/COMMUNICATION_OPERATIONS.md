# Communication operations and rollout gates

The user selected India hosting, self-hosted LiveKit, and native Android/iOS clients. This is an implemented source release with local evidence, not a deployed company service or completed physical-device pilot. [Implementation status](COMMUNICATION_IMPLEMENTATION.md) separates those outcomes. The blueprint remains a proposed direction; its instructions do not override the user's request.

## Recommended first deployment

Use one application/gateway process and its durable worker, PostgreSQL in India, encrypted private filesystem media in India, and a self-hosted LiveKit instance with private signaling in the same region. Select Mumbai or Hyderabad according to the operator's actual network and recovery services. Keep every database, object/file backup and disaster-recovery location in India unless the organization explicitly selects otherwise. Push travels through FCM/APNs and can involve provider infrastructure outside India; payloads contain the generic text "A company update is available." and only opaque identifiers, `{eventId,companyId,conversationId}` (Connect) or `{eventId,companyId,attentionId}` (Inbox task/expense/attention items), never message/finance text, titles, amounts, names or item types. This is not a claim of strict all-traffic residency.

Inventory up to 10 companies, 50 active people per company and 500 registered devices for planning. Initially target at most 100 simultaneously foreground communication sockets and 20 concurrent call participants; these are proposed pilot ceilings, not measured production capacity or enforced licensing limits. The local 100-socket probe is a single-conversation/proxy test on this machine. Benchmark the actual deployment, per-user send/history/search latency, simultaneous companies, worker lag, provider CPU/bandwidth and TURN traffic before accepting those ceilings. Multi-gateway fanout and distributed login throttling remain rollout gates; do not scale replicas on the basis of this local probe.

## Configuration and startup

Both runtime adapters read `MEDIA_ROOT`, `CLAMAV_ADDRESS`, `MFA_ENCRYPTION_KEY`, `LIVEKIT_INTERNAL_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and push settings. Missing storage/scanner prevents media finalization; missing call credentials prevents calls. Core work/text remains usable. Persist the MFA key in a secret manager: exactly 32 bytes expressed as 64 hex characters. Losing it prevents decoding enrolled TOTP secrets. Enrollment is optional in source; require and verify MFA for privileged users before rollout. Do not share keys or demo accounts.

| Setting | Default policy |
| --- | --- |
| `COMMUNICATION_MEDIA_LIMIT_BYTES` | 25 MiB per file, positive configurable value, implementation maximum 100 MiB |
| `COMMUNICATION_USER_QUOTA_BYTES` | 500 MiB per uploader per company |
| `COMMUNICATION_COMPANY_QUOTA_BYTES` | 25 GiB per company |
| `COMMUNICATION_UNUSED_UPLOAD_HOURS` | 24 hours |
| `COMMUNICATION_MEDIA_RETENTION_DAYS` | 90 days for bound media |
| `COMMUNICATION_MESSAGE_RETENTION_DAYS` | 365 days for conversation text/revisions and derived content |

Existing task evidence and finance receipts retain their 10-MiB format/permission controls. Quarantined/rejected reservations count against quota until cleanup. Communication files are privately written with file/directory sync and path/symlink checks, scanned by ClamAV INSTREAM, and downloaded through current ACL checks. Protect the filesystem from operator/public static access. Scanner signature updates need controlled outbound network access; an outage fails closed and needs operator alerting.

Run all numbered migrations using one migration owner before application startup; see [migration guide](../backend/migrations/README.md). Compose's one-shot migration service now handles fresh installations. Its database role remains a local convenience: create a separate DDL migration role and restricted runtime DML role for real use. Never use GORM AutoMigrate as a PostgreSQL production upgrade.

The shared communication worker leases outbox, push (Connect `communication_pushes` and Inbox attention `attention_pushes`) and provider jobs, retries with bounded backoff, and rechecks current permissions. A five-minute work scheduler is separate. Watch queue age/count, lease failures, scanner health, disk/quota, expired unused media, last successful retention scan, provider cleanup failures and PostgreSQL connection pressure. Logs should identify job/type/status only; omit tokens, message bodies, filenames, selected publication text and receipts. A database health response does not establish worker/scanner/provider health. FCM/APNs delivery is at least once with recipient acknowledgment/collapse hints; provider acceptance is not device receipt.

## Calls and public ingress

`deploy/compose.livekit.yaml` and `deploy/livekit.example.yaml` show a self-hosted topology. Fill private secrets and actual RTC addressing before using it. Expose the Schach HTTPS origin and the provider's documented RTC TCP/UDP/TURN ports; keep provider signaling 7880 private. `/api/companies/:cid/calls/:id/transport/rtc` is the authorized signaling gateway. It verifies current session, device, company, conversation epoch/role and persisted grant on join and during the connection. Allow WebSocket upgrades at the edge, preserve authentication/origin, and avoid buffering/timing out active signaling. Do not log the query's provider access token. No Schach bearer/session credential belongs in a URL.

Self-hosted LiveKit participant removal does not invalidate cached room tokens, so directly reachable provider signaling would bypass Schach revocation. The real-provider test establishes cached and provider-refreshed token denial at Schach's gateway. Clients get narrowly scoped mic/camera/screenshare room rights, never room administration or recording. Server cleanup uses separate operation-specific admin credentials, including LiveKit's required room-create permission for DeleteRoom. Unanswered calls become missed after 60 seconds based on actual signaling joins; durable deletion jobs retry outages. Recording/transcription remains disabled. Enabling it needs an explicit consent, audience, storage and retention design with device tests.

Configure authenticated TLS TURN for restrictive mobile/corporate networks using the provider's current [self-hosting guidance](https://docs.livekit.io/home/self-hosting/deployment/). Device/network acceptance must cover TURN-only routing, headset/Bluetooth, interruptions, foreground/background/locked states and incoming-call behavior. The Android development build includes the ongoing mic/media foreground service; it does not establish OS behavior on physical devices. Native OS incoming-call surfaces and signed store delivery remain release gates. There is no signed iOS binary from this Linux environment.

## Devices, removal and recovery

Company departure is scoped to that company and closes private memberships/history windows, delivery and call grants. It preserves other-company work. Private group/channel owners must hand over or archive before removal; fixed-pair DMs archive on departure. Reactivation does not silently restore private history. Global offboarding is a platform-operator action requiring a reason, ownership handover and current authority; it suspends the account and revokes all sessions/devices.

An account can list its registered devices and revoke a lost device's bound session across all companies. Other sessions remain available. Password change/recovery, logout, expiry and suspension revoke delivery paths. Password-only operator recovery preserves MFA. For verified loss of both authenticator and recovery codes, run the existing reset command with `--reset-mfa` and a private `RESET_REASON` after identity verification; it revokes all sessions/devices and records audit entries. Recovery requires direct operator database access, not a public reset endpoint. Do not retain temporary password environment values.

Push needs operator-owned credentials: `FCM_SERVICE_ACCOUNT_FILE` (the service-account JSON supplies the project ID) for FCM HTTP v1, or `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_AUTH_KEY_FILE` and optional `APNS_SANDBOX=true` for APNs. Mount those files read-only outside the source release. Register the actual device token from the correct build; permission denial must leave in-app attention usable. FCM/APNs provider mocks pass locally; real credentials and physical delivery have not been supplied.

## Backup, retention and recovery

Recommend RPO 15 minutes and RTO 4 hours, with 35 days of encrypted operational backups. These are proposed objectives, not measured service guarantees. Use PostgreSQL WAL/PITR and media snapshots with a coordinated manifest/point; replication alone is not a backup. Quiesce application/worker writes for a consistent SQL-plus-media snapshot if a storage-consistent PITR mechanism is unavailable. Back up MFA/provider identity secrets separately with tightly restricted access. Measure snapshot age, restoration time and missing-object count.

Restore into isolated India-hosted infrastructure with all ingress/providers/push disabled. Restore SQL and the matching private media set; verify checksums, sessions, memberships/history epochs, retry claims, work/finance links and original commitments. Run retention and media cleanup against the restored data before enabling traffic, so old backup content does not regain visibility. Published task/receipt copies remain independent business records with their own existing retention; deleting private source text does not retract those records. Retained retry tombstones prevent a purged instruction from being recreated. Expired live media is denied before asynchronous cleanup.

The local real pg_dump/restore test preserves messages, ACK IDs, retry identities, revoked membership and private file bytes. A separate retention test proves scrub/reapply after restoration. It does not measure production PITR or the proposed RPO/RTO. Keep a protected restore drill record; expire backups by policy rather than claiming live deletion erases all backups immediately. Exports/downloads are independent copies and cannot be remotely recalled.

## Company pilot and cutover record

Before provision/migration, the organization must name the operational owner and support/phone fallback. Fill a record for each actual team: company, existing group, owner, private/public destination, current participants, device/OS/network inventory, media needs, triage department, active commitments/files to move, and authoritative workflow. No real group inventory or adoption baseline was available in this workspace.

Define adoption from measured people/workflows and a baseline period; do not report the blueprint's example 90% as achieved. Preserve explicit original delivery labels on authorized historical imports; this release does not bulk-import external histories or invent read receipts. Run a staged pilot, log concrete fallback reasons and resolve them before retiring internal groups. Approvals/payments remain in the existing independent review screens. AI, guests, E2EE, workflow builders, transcription and recordings require separate scoped designs and evidence; task counts are not employee scores.
