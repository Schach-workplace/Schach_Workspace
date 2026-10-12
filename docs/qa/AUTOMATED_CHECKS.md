# Existing automated checks and reproduction

The case catalogs link to real owning source/test files. A reference helps locate a regression; it does not mean every manual step is automated or already passed. No application suite was rerun for this documentation-only change. Current historical evidence is in [VERIFICATION](../VERIFICATION.md) and [the final source checks](../../verification/workspace-improvements-roadmap/final-review/publication-report.md).

## Local source checks

Run these in the named directories. Dependencies should follow the checked-in lockfiles and tool versions. Use a clean QA shell with provider/test-DSN variables unset unless deliberately configuring an owned integration fixture.

| Directory | Commands | What it establishes |
| --- | --- | --- |
| `backend/` | `go test -count=1 ./...`; `go vet ./...` | Handler/domain and isolated SQLite regressions; compilation/static checks |
| `backend/` | `go test -race -count=1 ./...` | Go memory race detector in that fixture; no production capacity claim |
| `frontend/` | `npm ci`; `npm test`; `npm run typecheck`; `npm run build` | Web component/unit regressions and normal frontend build |
| `mobile/` | `npm ci`; `npm test`; `npm run typecheck`; `npm run lint` | Native source/component checks; no physical device/signing/push/call certification |
| `encore/` | `ENCORERUNTIME_NOPANIC=1 go test ./...`; `go vet ./...` | SDK compatibility only; not Encore analyzer/exporter/runtime acceptance |

Use `npm run build:demo` only to verify the optional fictional preview separately. Demo mode does not authenticate and cannot prove backend permissions. The isolated QA launcher forces same-origin API mode when building.

## Native PostgreSQL and migrations

Read `backend/platform/platform_test.go` and `backend/platform/migration_runner_test.go` before running. Set `TEST_DATABASE_URL` privately to a dedicated disposable native PostgreSQL instance with permission to create schemas. The fixtures create random schemas, apply all numbered migrations, and drop only their owned schemas. Do not point at retained or production data, publish a DSN, or combine these numbered migrations with GORM AutoMigrate.

From `backend/`, with that verified private test configuration:

```bash
go test -count=1 ./...
go test -race -count=1 ./...
```

For the **standalone numbered migration owner**, configure `DATABASE_URL` privately for a fresh owned disposable database/schema and run `go run ./cmd/migrate` from `backend/`. It checksums all current versions through 59. Repeating the owner should preserve the ledger and original records. `-adopt-through` is an explicit verified legacy-1/2 adoption procedure; it is not needed for a new fixture. Test populated upgrades and preservation separately as OPERATIONS-003 describes. Never use down migrations on retained real data.

The 59 up/down pairs are byte-identical across `backend/migrations` and `encore/api/migrations`. Older PGlite finance-release checks cover only their recorded versions 1–2; they do not establish the current full native PostgreSQL path. Older “no reconciliation” finance documentation describes an earlier release; current FINANCE cases use the implemented statement and full-payment association handlers.

## Browser and adapter end-to-end checks

Start a **fresh fictional isolated server**, confirm `/api/health` and its account roles, and read each harness's prerequisites first. These probes mutate their fictional fixtures. For example, from the repository root:

```bash
SCHACH_SMOKE_URL=http://127.0.0.1:9080 SCHACH_SMOKE_RESULT=/your/private/qa-run/connect-result.json node verification/runtime/web_app_smoke.mjs --allow-demo-mutations
SCHACH_SMOKE_URL=http://127.0.0.1:9080 SCHACH_SMOKE_RESULT=/your/private/qa-run/reports-result.json node verification/runtime/reports_smoke.mjs --allow-demo-mutations
```

Replace the result directory with your owned private path. A fresh fixture matters: the Connect harness expects one canonical pair DM, and prior case mutations can invalidate its assumptions. Never rely on a harness's default port 8080. Browser screenshots/logs remain private until reviewed.

For actual Encore analyzer/build/runtime, read [runtime acceptance instructions](../../verification/runtime/README.md) and [adapter setup](../../encore/README.md). `encore check`, configured `encore run`, and owned Docker export/native PostgreSQL TCP probes establish different boundaries. The checked-in `encore-smoke.sh`, `standalone_smoke.py`, `encore_export_smoke.py` and `compose_smoke.py` own disposable resources; they require their stated Go/CLI/Docker/private scanner configuration. Inspect each command's help and ownership checks before invoking; do not translate successful SDK compilation into runtime acceptance. Preserve the private service-authentication configuration and cron refusal checks.

Provider-positive finance/intelligence/media/call tests require independently configured private fixtures and pinned provider identity. Some historical native/inference harness generations are consumed; do not revive them. Build a new authorized fixture instead. No automated script replaces physical mobile, real incoming/background calls, production TLS/cookies, APNS/FCM or measured backup/restore signoff.

## Pack-only verification

`python3 docs/qa/tools/validate_pack.py` checks schema/IDs, source references, spreadsheet rows and statuses, diagrams, local links and migration mirrors without starting the app. `python3 docs/qa/tools/check_frontend_isolation.py` builds two private copies with a synthetic `.invalid` inherited API URL; it demonstrates the unsafe inherited setting and the launcher's explicit empty/API override. Neither copy is served or submitted to an application.
