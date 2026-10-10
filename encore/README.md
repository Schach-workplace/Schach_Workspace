# Encore Go adapter

The `api` Encore service forwards `/api/*path` to the public `platform.Server` from `../backend`. It uses an Encore-managed PostgreSQL database via `sqldb.NewDatabase` and passes its `Stdlib()` connection to GORM. Authentication, role checks, tenant isolation, validation, file handling, task transactions, department budgets, categorized expense approvals/payments and automations are the identical implementation used by the standalone server. No production AutoMigrate path is used.

Requirements: Go 1.26 or later, Encore CLI, Docker for Encore's local PostgreSQL infrastructure, and the sibling `backend` directory. The pinned dependencies were resolved with Go 1.27.2 and Encore SDK 1.57.13. CLI 1.58.6 was installed during verification. Use the normal Encore CLI for actual application builds and runs; direct `go test` only checks published SDK signatures.

## Local evaluation

From this directory, set the declared bootstrap secret interactively. Configure a local secret explicitly. CLI 1.58.6 otherwise warns and supplies an empty value; non-demo empty-database bootstrap requires a valid password:

```sh
encore secret set --type local BootstrapPassword
SEED_DEMO=true encore run
```

Enter a strong locally controlled password when prompted. The explicit demo flag loads fictional accounts from the same shared fixture as the frontend, with evaluation password `SchachDemo!2026`. Demo seeding only operates on an empty database and only in a local Encore environment. It is rejected in production.

Serve the frontend through Vite, proxying `/api` to `http://localhost:4000`, or put both under one local reverse proxy. `api/config.cue` allows the default Vite and Encore origins. For a fresh non-demo workspace, set `BootstrapEmail` and `BootstrapName` in that CUE file before startup; the secret supplies its initial password. Bootstrap runs only while there are no users. Once initialized, rotate the configured bootstrap secret to an unused random value. This does not reset existing accounts.

## Production configuration

Edit `api/config.cue` with real HTTPS `AllowedOrigins`, the initial founder email and display name, `SecureCookies: true`, `SessionHours`, and `SeedDemo: false`. Production startup requires explicit HTTPS origins and secure cookies, and rejects demo seeding. Declare the bootstrap password in Encore's secret store:

```sh
encore secret set --type prod BootstrapPassword
```

The SQL files under `api/migrations` are byte-identical to `backend/migrations`. Encore applies all numbered migrations in order through its managed database workflow. Version 2 upgrades existing companies without erasing work, adds INR/April defaults and introduces the finance tables and role. It preserves every version-1 file. Down migrations are destructive disposable teardown, never an expense reversal or an upgrade shortcut. Link to an Encore application and deploy using your own authenticated account and infrastructure. This deliverable has not been published or deployed.

Keep the frontend and `/api` on the same HTTPS origin for cookie authentication. If using separate origins, configure both Encore gateway CORS and the application's exact `AllowedOrigins`; the shared handler alone does not replace upstream gateway settings. Do not use a public shared domain for unrelated applications because the browser cookie is scoped to `/api` on the host.

## Scheduled and manual automations

The managed Encore cron job runs every five minutes and calls `RunScheduled`. The endpoint is private and checks Encore's cron execution metadata before invoking the shared idempotent automation logic. A cron metadata header is not itself authentication: Encore's incoming private-service authentication must be enforced.

Encore cron declarations do not start a scheduler during local development, preview environments, or arbitrary self-hosted images. For local/manual use, log in as company leadership and invoke the regular cookie-authenticated route:

```text
POST /api/companies/{companyId}/automations/run
```

The product's Settings action calls that route. For simple self-hosting with automatic recurring work, use `../backend/cmd/server`, which runs the same job every five minutes in process. Each company mutation is serialized and recurrence/reminder claims are persisted atomically, so repeated scans are safe.

## Self-hosted Encore image

`infra-config.example.json` is a configuration template. Replace its hostname, environment metadata and HTTPS URL with your infrastructure values. Supply `DB_USER`, `DB_PASSWORD`, `BOOTSTRAP_PASSWORD`, and a cryptographically random `SERVICE_API_KEY` through your secret manager. It contains no credentials.

The top-level `auth` array is deliberately present: it requires incoming service authentication for private APIs. Do not remove it. Without configured authentication, Encore self-hosting can permit unauthenticated private API calls. Restrict ingress to the public gateway and keep service endpoints on trusted networking. The cron metadata check does not compensate for removing service authentication.

Build through Encore after configuring values and validating migrations:

```sh
encore build docker --config=infra-config.example.json schach-workspace:latest
```

An image does not provision a database, install an external scheduler, apply your operational backup policy, or configure TLS. See the repository's operations guide. The standalone operator password-reset command can recover an existing Encore account when run with authorized access to the same PostgreSQL database.

## Runtime verification

Run the [disposable native runtime gate](../verification/runtime/README.md). It checks real PostgreSQL boot, API scenarios, spoofed scheduled-route refusal, bootstrap and restart persistence. Managed cron, production private ingress/TLS and deployed proxies require deployment checks.


## Current export compatibility and communication

With CLI 1.58.6 / SDK 1.57.13, keep the physical PostgreSQL database and the Encore resource both named `workspace`. The exporter checks the map key against declared resources, while the runtime uses the optional `name` as its resource identifier and the map key as the physical database name. The checked-in example therefore uses `workspace` for both. The actual exported image passed native SQL, all 91 original API checks, socket upgrade/revocation and restart tests with this configuration. Do not rename an existing production database without a planned migration. This pinned-version constraint is established from [Encore's exporter](https://github.com/encoredev/encore/blob/v1.58.6/cli/daemon/export/infra_config.go) and runtime `appruntime/exported/config/parse.go` in the installed SDK, rather than assuming the documentation example maps different names correctly.

Both adapters start the communication worker. Configure media/scanner, MFA, push and private LiveKit environment settings as documented in [communication operations](../docs/COMMUNICATION_OPERATIONS.md); the shared domain reads these environment variables. The frontend and provider signaling gateway must share the public HTTPS origin. Provider port 7880 must remain private.
