# Private historical report storage

Apply mirrored numbered SQL33–36 using the deployment's existing migration owner. Do not run production AutoMigrate. Historical facts and snapshots are durable business history; CSV artifact expiry deletes bytes and link availability only.

Set `REPORT_ARTIFACT_ROOT` to a dedicated private persistent volume, separate from media, frontend static content and public object URLs. Every ancestor must be a real directory; the root is0700 and files0600. Both standalone and Encore accept this setting via `platform.ConfigureReports`. `REPORT_ARTIFACT_TTL_HOURS` defaults to168 and permits1–8760. Local standalone defaults alongside its selected SQLite database; local Encore defaults `.encore/report-artifacts`. Production without configured private storage still supports historical reads and returns `export_unavailable` for new exports.

The dedicated report worker handles one long export at a time with120s maximum generation,60s leases and15s renewal. Separate maintenance runs short passes with10s contexts every60s; at most100 schedules, delivery intents and cleanup records are considered per pass. The existing communication worker remains separate. Startup performs one bounded observation batch after seeding, then report maintenance continues observation. Legacy done tasks never become acceptance episodes.

Standalone signal cancellation joins both worker loops. Encore implements actual `shutdown.Handler` with value `shutdown.Progress`; it cancels both owned loops and joins within ForceShutdown or15s. Storage work observes cancellation. Expired leases recover after restart, with at most5 total attempts and5/10/20/40s retry delays.

Artifact downloads authenticate a session and authorize the complete immutable source manifest before headers and before each64KiB chunk. Locks end before network writes. Denied checks stop later chunks; already written or in-flight bytes and explicitly downloaded/shared copies cannot be recalled. Scheduled delivery is only an IDs-only in-app Inbox link; no email, external provider, automatic device copy or leadership-scope inheritance.

Provisioned India-region volumes, backup retention, physical devices, signing and capacity remain operator rollout gates; owned fixtures do not certify those.
