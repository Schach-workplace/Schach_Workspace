# Operations guide

Run the shared Go service through one supported adapter. Keep the release verification record beside these instructions: build examples and deployment checks below are procedures, not claims that a production environment has been exercised.

## Runtime choices

| Mode | Entry point | Database and scheduling |
| --- | --- | --- |
| Standalone | `backend/cmd/server` | GORM with PostgreSQL; SQLite for local evaluation. A five-minute in-process automation scan can be disabled. |
| Encore | `encore/` | Encore-managed PostgreSQL connected to the same Go handler through `sqldb.Stdlib()`. Use the Encore cron declaration in managed environments; explicitly arrange scheduling when self-hosting. |
| Browser demo | Frontend demo mode | Fictional data in that browser. It is an evaluation mode and does not authenticate against the real API. |

The common implementation is `backend/platform`. Standalone and Encore must retain the same membership, work review, expense decisions, budget locks, upload, and session checks. [Encore documents the GORM connection pattern](https://encore.dev/docs/go/how-to/atlas-gorm) and [standard HTTP-handler adapters](https://encore.dev/docs/go/primitives/raw-endpoints).

## Build and local evaluation

Use the Go version required by the checked-in modules, Node/npm for the frontend, and a C toolchain when building the SQLite driver. Use Go 1.26 or later for the current module set.

From `frontend/`:

```sh
npm ci
npm run build
```

From `backend/`:

```sh
go test ./...
go build -o ../bin/schach-workspace ./cmd/server
../bin/schach-workspace --demo
```

The standalone default address is `:8080`, SQLite file is `schach.db` in the current working directory, and frontend path is `../frontend/dist`. Run that example from `backend/` or supply explicit paths. The default binds all interfaces; use `--addr 127.0.0.1:8080` for a machine-local evaluation.

`--demo` or `SEED_DEMO=true` explicitly seeds fictional accounts. Demo credentials in [API_CONTRACT.md](API_CONTRACT.md) are public evaluation credentials. Use a separate disposable database for them. Removing the seed flag does not remove already-created users; never promote a populated demo database into production.

## Standalone configuration

Environment variables must be supplied to the process by your shell, service manager, or container runtime. A sample environment file is not automatically loaded by Go.

| Setting | Purpose |
| --- | --- |
| `ENVIRONMENT=production` | Select production startup checks: PostgreSQL, Secure cookies, explicit HTTPS origins, and no demo seeding. Set this deliberately; never rely on a development default for a real service. |
| `DATABASE_URL` | PostgreSQL connection string. Without it, `--db` selects the local SQLite file. Use the TLS mode and trusted CA required by your database provider. |
| `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD`, `BOOTSTRAP_NAME` | Deliberate first-account setup for an empty database. The shared bootstrap function refuses a database that already has users. |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins, such as `https://workspace.example.com`; no path, query, or wildcard. |
| `SECURE_COOKIES=true` | Set the session cookie's Secure attribute for HTTPS. Required for an internet-facing deployment. |
| `SESSION_HOURS` | Absolute session lifetime; default 72 hours, accepted range 1–720. |
| `SEED_DEMO=true` | Development fixture initialization. Do not use for real data. |
| `DISABLE_SCHEDULER=true` | Disable the standalone in-process automation scan. |
| `--addr`, `--frontend`, `--db` | Explicit listen address, compiled frontend directory, and SQLite path. |
| `--migrate` | Deliberate GORM schema update for development PostgreSQL; production releases should use the supplied versioned SQL migration path. |

### First production setup

For the Docker Compose deployment, combine `compose.yaml` with `compose.production.yaml`, which adds the People onboarding keyring and private finance-intake/report storage volumes that `compose.yaml` omits: `docker compose -f compose.yaml -f compose.production.yaml up -d --build`.

1. Create a dedicated PostgreSQL database and a restricted application role. Keep the database private. Use a migration role for schema changes and a runtime role with only the necessary application permissions where your deployment supports that separation.
2. Apply the versioned migration for the release once, using a migration identity and a recorded migration history. Run `backend/cmd/migrate` with the schema-owner credential to apply all numbered migrations and verify their checksums. A pre-ledger version-1/2 database requires an explicit `--adopt-through 1` or `--adopt-through 2` after backup and schema verification; follow [the migration instructions](../backend/migrations/README.md). Do not run competing schema changes from every replica. Confirm that the schema and code revision match before starting the app. The down migration deletes application data and is for disposable databases.
3. Set `ENVIRONMENT=production` and supply `DATABASE_URL`, the public `ALLOWED_ORIGINS`, `SECURE_COOKIES=true`, and unique bootstrap credentials through a protected secret mechanism. Do not commit the environment file, print it to logs, or place credentials in a browser build.
4. Initialize the empty database with one instance. Verify the new account and its initial company, then remove the bootstrap password from the long-lived service configuration. Add real memberships through the application; account creation does not send an invitation email.
5. Serve the compiled frontend and `/api` under one HTTPS origin where practical. Test the production sign-in and cookie attributes before granting broader access.

The first-account password must contain at least 12 Unicode characters and no more than 256 UTF-8 bytes. Choose a unique password; the bootstrap function initializes an account and does not provide password recovery.

### Operator password recovery

An operator with authorized database access can recover an existing account using `backend/cmd/reset-password`. Supply `RESET_EMAIL` and `RESET_PASSWORD` through a protected environment or secret manager, plus `DATABASE_URL` for PostgreSQL. From `backend/`, run `go run ./cmd/reset-password`; for an existing local SQLite database, add `--db /path/to/schach.db`. Production recovery requires `ENVIRONMENT=production` and PostgreSQL. Passwords are not accepted as command-line arguments.

The command updates only an existing account, revokes all its sessions, and records an operator-reset audit entry for its companies. It does not create an account or send email. Remove the temporary reset credentials after recovery and follow your identity-verification and password-handover process. This also works for the Encore database when the operator has legitimate access to that PostgreSQL instance.

## TLS and proxy behavior

Terminate TLS at a maintained reverse proxy or load balancer, redirect public HTTP to HTTPS, and restrict direct access to the Go service. Keep the original public host and the `Origin` and fetch-metadata headers. Set the exact public HTTPS origin in `ALLOWED_ORIGINS`: the Go handler may see an HTTP upstream even though the browser is using HTTPS.

The API uses an opaque `HttpOnly`, `SameSite=Lax` cookie scoped to `/api`. Do not rewrite it to a broad parent-domain cookie or store it in frontend local storage. An allowed CORS origin receives credentialed responses; the allowlist is a trust decision. Requests with a rejected origin fail before application mutations. Direct clients without browser origin headers still require normal authentication and authorization. [OWASP's session](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) explain these controls.

Set edge request-size/time limits consistent with the application, add login abuse limits, and avoid logging passwords, session cookies, attachment bytes, or entire private request bodies. `/api/health` checks the database connection; it does not prove that authorization, migrations, or outbound delivery work.

## Uploads and data storage

Task attachments and expense receipts are limited to 10 MiB each and stored as bytes in separate database tables. Accepted formats are PDF, PNG, JPEG, WebP, plain text, and CSV, with extension and detected-content checks. Export unsupported Office documents to PDF. These task/receipt bytes stay in SQL. Communication media additionally requires a private MEDIA_ROOT volume and coordinated backups; see [Communication operations](COMMUNICATION_OPERATIONS.md). Preserve permission-checked download routes; do not serve attachment rows or bytes through a public static-file location. Configure the proxy to allow the file size plus multipart overhead while maintaining its own bounded request limit; the API caps the multipart request at 11 MiB.

Database capacity and backups must account for evidence files. The file-type allowlist is not malware scanning, organization quotas, or a retention policy. If those are required, add and validate them before accepting sensitive files. See [OWASP's upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

## Recurring work and notifications

For a single standalone instance, the built-in scan processes recurring tasks and deadline reminders every five minutes. `DISABLE_SCHEDULER=true` stops it. Company administrators can use the scoped `/api/companies/:cid/automations/run` operation to exercise the same processing deliberately.

For multiple instances, designate one scheduler and disable the others. For an external scheduler, use an authenticated invocation path. Do not expose an unauthenticated internal automation endpoint. Confirm database idempotency and overlapping execution against PostgreSQL before using several scheduler instances; an in-process ticker does not elect a distributed leader.

Encore declares a five-minute job; confirm that the selected managed environment supports that cadence. Cron Jobs do not automatically run in local development or preview environments, and their targets must be idempotent. The declarative API does not create a scheduler inside an exported container. Managed Encore scheduling and self-hosted scheduling therefore need different operational setup. [Official cron documentation](https://encore.dev/docs/go/primitives/cron-jobs).

Assignment, comment, task review, expense review/payment, nudge, and deadline messages populate the in-app inbox. Recurrence with an inactive or read-only required reviewer is skipped with an actionable event, preserving independent review. **No real email, SMS, WhatsApp, Slack, or push delivery is enabled by default.** Adding an external provider requires separate configuration and delivery/retry verification.

## Encore deployment

Work from `encore/` and follow the [adapter README](../encore/README.md). Install the CLI version compatible with its checked-in dependencies. `api/api.go` loads nonsecret service settings from `api/config.cue` and obtains `BootstrapPassword` through Encore secrets. The adapter uses its own configuration; standalone `ALLOWED_ORIGINS`, `SECURE_COOKIES`, and bootstrap environment variables do not replace those CUE/secret values. [Typed configuration](https://encore.dev/docs/go/develop/config); [secrets](https://encore.dev/docs/go/primitives/secrets).

For local use, Docker supplies Encore's PostgreSQL. Set `BootstrapEmail` and `BootstrapName` in `api/config.cue`, and provide the password without putting it in that file:

```sh
encore secret set --type local BootstrapPassword
encore check
encore run
```

For a machine-only secret override, Encore supports an ignored `.secrets.local.cue` file beside `encore.app`, containing `BootstrapPassword: "your-unique-local-password"`. Restrict that file's permissions and keep it out of source control. CLI 1.58.6 permits an undefined local secret with a warning and empty value. Non-demo empty-database bootstrap requires a valid password. Demo seeding is rejected outside local evaluation.

The frontend is served separately from this Encore API adapter. From `frontend/`, use `API_PROXY_TARGET=http://127.0.0.1:4000 npm run dev` for the default Encore local port. In a deployment, route the compiled frontend and `/api` through one HTTPS origin.

Before production, replace the localhost origins in `api/config.cue` with the exact HTTPS origin, keep `SecureCookies: true` and `SeedDemo: false`, and set the initial account identity deliberately. Supply `BootstrapPassword` for the intended environment, for example with `encore secret set --type prod BootstrapPassword`. Production environment metadata, or `ENVIRONMENT=production`, enables the adapter's production checks. After initialization, rotate the stored bootstrap secret to an unused random value if retaining the declared secret; doing so does not change the existing user's password. Change that password through the application.

Encore uses logical database `workspace` and migrations in `encore/api/migrations/`, which mirror the standalone SQL schema. Do not add GORM AutoMigrate to the production adapter.

For a self-hosted image, Encore supports:

```sh
encore build docker --config=infra-config.example.json schach-workspace:latest
```

Replace the placeholders in [infra-config.example.json](../encore/infra-config.example.json) with the `workspace` database, production metadata, and secrets supplied using runtime `$env` references. The template references `DB_USER`, `DB_PASSWORD`, `BOOTSTRAP_PASSWORD`, and `SERVICE_API_KEY`. Apply the documented migration path to the destination database. The default container port is 8080, overridable with `PORT`. [Docker builds](https://encore.dev/docs/self-host/build).

Keep incoming service authentication enabled in the self-hosted configuration:

```json
"auth": [{"type": "key", "id": 1, "key": {"$env": "SERVICE_API_KEY"}}]
```

This is a top-level configuration field. Supply a strong service key through the runtime's secret mechanism. Private endpoints do not require authentication when this configuration is omitted. The private `RunScheduled` endpoint additionally requires Encore's cron-execution metadata; that discriminator does not replace service authentication. Local and self-hosted manual processing uses the cookie-authenticated company administration endpoint. Arrange an authenticated scheduler or use the standalone scheduler for unattended self-hosted processing; no external scheduler is provisioned by this package. [Infrastructure and service authentication](https://encore.dev/docs/self-host/configure-infra); [cron request metadata](https://pkg.go.dev/encore.dev#Request).

## PostgreSQL backup and restoration

Back up the entire application database, including task evidence, expense receipt bytes, budgets, expenses, financial events, accounts, sessions, audit records, and automation idempotency records. Use encrypted storage with access controls and retention suitable for the data. A backup contains personal information and authentication state even though usable session tokens and plaintext passwords are not stored.

The following uses standard PostgreSQL client connection variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`) and a protected password file or secret mechanism. Choose a backup filename and an **isolated empty restore database**, not the live database:

```sh
pg_dump --format=custom --file=schach-workspace.dump
createdb --template=template0 schach_restore_check
pg_restore --dbname=schach_restore_check --no-owner --no-acl --exit-on-error --single-transaction schach-workspace.dump
```

`pg_dump` produces a consistent database snapshot while the service is running. Its database dump does not include cluster-wide role definitions; manage those separately. Custom archives use `pg_restore`. Recreate the intended owner/grants when using the portable `--no-owner --no-acl` restore above. Use a compatible PostgreSQL client version. [PostgreSQL backup](https://www.postgresql.org/docs/current/backup-dump.html); [restore reference](https://www.postgresql.org/docs/current/app-pgrestore.html).

Test the restored database with a separate app instance, its scheduler disabled, and no external notification provider. Verify company counts, role boundaries, representative tasks, comments, evidence and receipt downloads, expense statuses, exact budget totals, and the latest migration. Record restore duration and the recovered backup time. Restoring also restores the session table; revoke sessions before reopening a recovered production service if old sessions must not become valid again.

## Release and deployment validation

Before replacing a real service: retain a recoverable database backup, review migration compatibility, deploy one verified revision, and check `/api/health`. An old binary is not a safe rollback if the database schema is no longer compatible.

Then validate real HTTPS sign-in, Secure/HttpOnly cookie flags, allowed and rejected origins, unauthorized access, company switching, department/manager/member scope, viewer write denial, approval segregation, stale edit conflicts, foreign references, attachment authorization, import atomicity, and repeated automation execution. Exercise these on the deployment's PostgreSQL and runtime adapter. Verify a restore rather than only a successful backup command. Keep the actual results with the release record.


### Finance upgrade and operational limits

Follow [Finance guide → Upgrading](FINANCE_GUIDE.md#upgrading-an-existing-installation) for an existing version-1 database. Company-row serialization covers budget edits, submissions, approvals, payments and receipt version increments. Measure this on the native PostgreSQL deployment; a successful WASM migration probe or single-connection SQLite handler scenario does not certify multi-connection production locking or capacity.

Current finance boards assemble bounded authorized keyset pages; report aggregation uses its own authorized server inputs. Very large tenants still need deployment load testing before scale-out. Financial events are the latest 1,000 visible events, not an unlimited compliance archive. Backups must retain the entire database history. Company budgets are envelope control, not double-entry accounting, bank reconciliation, tax filing, inventory valuation or payroll.

## Communication additions

Use [Communication operations and rollout gates](COMMUNICATION_OPERATIONS.md) for media/scanner setup, private LiveKit signaling, native push, MFA/lost-device recovery, coordinated SQL-plus-media backups, retention and India-hosted pilot limits. Start only one gateway for the measured initial topology. Both adapters start the leased communication worker independently of the work scheduler. Keep a disposable copy for demo credentials; the new browser Connect explicitly requires the shared server.

## Finance scratch and local receipt extraction

Apply the complete current mirrored numbered inventory through SQL61 using the existing checksummed migration owner. SQL59 adds the `attention_pushes` per-item/per-device native push intent table for Inbox attention hints. The finance-assistance milestone introduced SQL38–46; SQL38–45 add private intake/leased queue/unique acceptance/current pair review/retained statement rows/full allocations/capture binding/attention; SQL46 adds separately scoped metadata-only scratch success history in the same business transaction. Old migration checksums are immutable. Back up retained business evidence/rows/audit and private intake metadata/store together; restoring private scratch never renews original session/expiry grants.

`ConfigureFinanceAssistance(*Options) error` is used by standalone and Encore. It does not install providers or download models. Defaults: OCR disabled, PDF disabled, TTL7days, receipt10MiB/statement8MiB, actor50MiB/company500MiB. `FINANCE_INTAKE_ROOT` must be a separate owned private FileMediaStore root. `FINANCE_SCANNER_ADDRESS` configures existing ClamAV mechanics. `FINANCE_INTAKE_TTL_DAYS` is1–30; actor/company quota env values are10MiB–500MiB. Capture reservations consume the full receipt cap until actually bound/cancelled/expired.

To enable qualified English image OCR, explicitly set `FINANCE_OCR_ENABLED=true`, fixed absolute `FINANCE_OCR_EXECUTABLE` (default `/usr/bin/tesseract`), `FINANCE_OCR_LANGUAGE=eng`, `FINANCE_PDF_ENABLED=false`. Startup verifies binary, `/usr/share/tessdata/eng.traineddata`, `/usr/bin/prlimit`; fingerprint includes those bytes, psm6/OMP1/AS512MiB/CPU45s. Each image≤20MP/12000px side uses owned0700 tempdir/0600 file;45s command,64KiB stdout/8KiB stderr and fixed traineddata path. PDF/Hindi/encrypted document rendering is unavailable/manual, not inferred from CLI availability. Exported Alpine default runtime has no qualified host OCR capability.

Finance jobs have a separate1s worker, SKIP LOCKED/CAS120s leases, maximum3 attempts and bounded external work outside business locks. One process-wide LocalProviderBudget slot is shared with local intelligence consumers. Session/actor/company/source/parent/version/generation/hash/provider config are rechecked before bytes/provider and final commit. `StartBackgroundWorkers(parent)*WorkerLifecycle` cancellation and `Stop(ctx)` join finance along with accepted communication/report workers. Cleanup runs every minute with30s context and at most100 total scratch records/pass; logical expiry denies reads/providers immediately, external deletion retries outside locks without advancing expiry generation again. Expired candidate/preview text is erased before fallible file deletion, so deletion failure cannot retain review text. Each attempted scratch record consumes the pass budget; failed file deletion is retried without renewing access. Minimal canonical success history remains. Accepted ExpenseReceipt.Data and normalized statement rows/allocations/audit survive source expiry independently.

Routine HTTP measurements are route-template/status/byte/query-count/duration only, never OCR text, bank cells, filenames, source hashes/session tokens or SQL/provider private errors. Product failures expose sanitized codes and manual entry. The fictional local runtime harnesses in `verification/runtime` own private process/storage/schema/container resources and scrub inherited communication/finance/report/intelligence/people/provider/session/database config. Run only with explicit disposable-demo authorization; never point them at production data. Their single-user local p50/p95 measurements are a baseline, not production capacity or retention policy qualification.

## Current roadmap deployment and verification isolation

Use all 61 paired/checksummed migrations; preserve predecessor checksums and existing data. SQLite GORM evaluation and the numbered PostgreSQL migration runner are distinct schema owners. A mixed numbered-PostgreSQL/full-GORM startup may be unsupported; retain an actual failure rather than altering production migrations to make a fixture pass. Back up matching SQL/media/report artifacts and the independent People credential-retry keyring; retain old key IDs for canonical retries. MFA encryption keys, provider identity keys and credential-retry keys are separate secrets. [People administration](PEOPLE_ADMINISTRATION.md) and [local intelligence](intelligence-local.md) list actual configuration and limits.

Owned harnesses derive current contiguous up/down inventory/checksums, retain actual legacy47/49 upgrade inputs, scrub inherited application/database/provider/auth/deployment options and explicitly disable scheduler, OCR/PDF/intelligence and external delivery unless that fixture is deliberately testing its own provider. Planning `--calendar-civil-only` cannot be combined with `--browser`; rejection precedes output/database access. Browser proof labels record actual executed cases/widths. Never reuse retained acceptance stores, sessions or shared inference workers for these fixtures.

The proposed India RPO15minutes/RTO4hours/35days encrypted backups remain unmeasured objectives. Trusted HTTPS authentication, organization signing, physical Android/iOS, iOS binary, TURN/push, restore drills, language/claim quality and production capacity remain deployment gates. Evaluate embedded release APK launch/Auth geometry on an isolated fresh device; keep any current-JS developer-shell Goal geometry separately qualified.


## Coordinated release of premium clients, Development and Knowledge

This source adds mirrored migrations60 (development plans/reviews) and61 (Knowledge/articles/reviews). Apply every checksummed predecessor through61 with the existing migration owner; never modify predecessor checksums or run down migrations on retained data. A currently deployed website does not establish compatibility with newly added routes. Rehearse upgrade/backup in an owned fictional PostgreSQL fixture, then coordinate the separately authorized server/client release. The agent's local verification is not deployment authorization or evidence of production acceptance.

Before a pilot, verify all three career catalogs, self/mentor isolation, Knowledge draft/independent publication/audience expiry, stale409 and original retry behavior, and expense export current-version rejection. Keep current authorized data and separate original goal observations. Exported ICS/CSV/Markdown are independent user-held copies, with no OAuth tokens, provider state, third-party messages or scheduled sync. External connectors still require an explicit provider/source-of-truth decision, secure credential ownership, a durable outbox/idempotency/reconciliation design and fictional provider sandbox acceptance.

Run the supplemental [premium mobile/growth QA guide](qa/PREMIUM_MOBILE_GROWTH.md) alongside the unchanged224-case pack. Physical iOS/Android, signed delivery and configured calls/push remain separate gates even if the owner reports their server configured. Deployment/restore/load objectives and migration behavior on the actual hosting topology must be observed. No server bootstrap or production reseed is part of this change.
