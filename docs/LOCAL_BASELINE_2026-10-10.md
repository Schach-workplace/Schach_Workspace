# Local baseline — 10 October 2026

The released task/finance application works locally with SQLite and native PostgreSQL. The unchanged Encore adapter fails analysis because of three source defects. A disposable diagnostic copy demonstrates that correcting those defects lets the adapter boot and run the existing API scenarios. Those corrections have **not** been applied to the application in this checkout.

This record supplements [the previous verification record](VERIFICATION.md). It replaces its environment-blocked conclusions only for the checks actually executed below. It is not a production deployment or security certification.

## Scope and provenance

Read README, API contract, security limits, previous verification, supplied communication blueprint, runtime/migration instructions, and the actual shared handlers, permissions, models, jobs, adapters, frontend stores, forms, calculations and tests. The requested `docs/Schach_Communication_Blueprint.md` was missing. The Downloads attachment was copied there without changes; SHA-256 `46ac8ecd67eb79070b96acc8ac8e5d8817bb1e814f71c69eef14f5e9886ad33f` matches both copies.

The blueprint is proposed direction, not an instruction to implement its entire roadmap. Its historical commit identifier cannot be confirmed: this extracted workspace contains no `.git`. No product Go/TypeScript/SQL source was changed. Dependency installation and frontend/preview regeneration used the existing lockfiles. Added artifacts are this record, the proposed plan, the blueprint copy, and isolated verification scripts/results. PGlite and preview runners refreshed their existing generated result files.

Evidence is in [`verification/local-2026-10-10`](../verification/local-2026-10-10/); [source hashes](../verification/local-2026-10-10/source-sha256.txt) identify the tested source. All accounts and mutations were fictional, in newly created databases/containers. Normal authentication was used throughout.

## Host versions

| Component | Observed version |
| --- | --- |
| Go on host | 1.26.1 linux/amd64 |
| Node / npm | 24.14.0 / 11.9.0 |
| Python | 3.14.7 |
| Encore CLI / pinned SDK | 1.58.6 / 1.57.13 |
| Docker engine / Compose | 29.7.2, rootless / 5.5.1 |
| Native database for shared tests | PostgreSQL 18.3, `encoredotdev/postgres:18` |
| psql client | 18.6 |
| Chromium | 152.0.7977.82 |
| PGlite | 0.5.8, PostgreSQL 18.3 WASM |

## Fresh results

Commands are relative to the module/directory named in the first column. Logs are under the evidence directory's `logs/`.

| Check | Command / evidence | Result and boundary |
| --- | --- | --- |
| Backend, SQLite | `go test -count=1 -json ./...`; `backend-tests.jsonl` | **45 top-level tests passed**, 49 including subtests; 11.842s |
| Backend, PostgreSQL | `TEST_DATABASE_URL=postgres://schach@127.0.0.1:55432/schach_baseline?sslmode=disable go test -count=1 -json ./...`; `postgres-tests.jsonl` | **45 passed**, 49 including subtests; 14.643s. Real GORM/pgx, eight-connection pool, actual ordered SQL migrations in per-test schemas |
| SQLite race detector | `go test -race -count=1 -json ./...`; `backend-race.jsonl` | **45 passed**, no reported races; 110.044s |
| PostgreSQL race detector | Same with `TEST_DATABASE_URL`; `postgres-race.jsonl` | **45 passed**, no reported races; 113.282s. Includes competing task/budget/approval and stale-authority regressions |
| Backend analysis/builds | `go vet ./...`; builds of `./cmd/server` and `./cmd/reset-password` | All exit 0; host binaries used for local servers |
| Frontend dependencies | `npm ci`; `frontend-install.log` | Locked installation passed |
| Frontend tests | `npm test`; `frontend-tests.log` | **63 tests, 8 files passed**, 3.83s |
| Frontend format/type/build | `npm run format:check`, `npm run build`, `npm run build:demo` | All exit 0; both builds include TypeScript no-emit checking |
| Standalone preview | `node scripts/make-preview.mjs`; `node frontend/scripts/verify-preview.mjs` | **11 checks passed**, 938,332-byte artifact; compiled DOM check |
| Existing handler bridge | Existing workspace/finance Python runners against freshly built `verification/httpbridge` | **38 workspace + 53 finance checks passed**, SQLite in process |
| Listening SQLite app | Standalone `--demo --db` on port 18080; existing `http_flow.py --url` | **39 checks passed**, including static React document and real cookies/TCP |
| Listening PostgreSQL app | Standalone with `DATABASE_URL`, no `--migrate`, port 18081 | Health and **39 workspace checks passed**; SQL migrations were applied first with `psql --single-transaction -v ON_ERROR_STOP=1` |
| Native finance via TCP | [TCP scenario adapter](../verification/local-2026-10-10/tcp-scenarios.py), port 18081 | **39 workspace + 53 finance checks passed**. Reuses existing scenario bodies; competing approvals use a barrier and independent HTTP connections |
| Native browser | [Chromium CDP smoke](../verification/local-2026-10-10/browser-smoke.mjs); [result](../verification/local-2026-10-10/browser-result.json) | **4 checks passed**: API sign-in renders, founder logs in through form, Finance renders server data, no uncaught JS exceptions. [Screenshot](../verification/local-2026-10-10/browser-postgres.png). This is a narrow desktop smoke |
| Migration compatibility | `verification/postgres-compat`: `npm ci`, `npm test` | **100 checks passed**, including all-table populated upgrade, constraints and reverse teardown in PGlite |
| Native migration application | `psql` versions 1 then 2; backend PostgreSQL tests | Both SQL files executed successfully; Encore/standalone copies match byte for byte |
| Native populated upgrade | Owned temporary schema, migration 1, legacy company/user/membership/task, migration 2, reverse teardown | **7 checks passed**: full legacy task row unchanged; INR/April defaults; down-2 preserves task; down-1 removes tables. [Result](../verification/local-2026-10-10/native-upgrade-result.json). Smaller fixture than PGlite's all-table upgrade |
| Native backup/restore | `pg_dump --schema=public --no-owner --no-acl`, restore into separately created `schach_restore` with `psql --single-transaction` | **19 table row counts and two binary-table hashes matched**. [Result](../verification/local-2026-10-10/restore-result.json). Local SQL dump, not encrypted production backup or measured RPO/RTO |
| Production startup guards | Standalone binary with three invalid production configurations | **3 expected rejections passed**: demo, insecure cookies, SQLite; [result](../verification/local-2026-10-10/production-guards.json) |
| Docker/Compose | Supplied Dockerfile; `docker compose -p schach-baseline-probe build`, `up --detach --wait` with temporary random credentials | Build passed; both healthchecks passed; fresh non-demo bootstrap login and empty workspace passed. [Result](../verification/local-2026-10-10/compose-result.json) |
| Encore SDK only | `ENCORERUNTIME_NOPANIC=1 go test ./...`; `go vet ./...` | Exit 0; **no Encore package tests** |
| Unchanged Encore analyzer/runtime | `encore check`, repeated verbose; `SEED_DEMO=true encore run --watch=false --browser never --port 4400` | **Exit 1 before startup**; source defects below |

## Failures: application versus environment/procedure

### Application defects in the Encore adapter

1. `encore/api/api.go:89`: `method=*` is rejected with **E1371**, “Invalid endpoint method”. In a disposable copy, an explicit `GET,POST,PATCH,OPTIONS,HEAD` list removes this error. The shared handler still owns route-specific permissions and method validation.
2. `encore/api/api.go:92`: `Endpoint: (*Service).RunScheduled` is rejected with **E1288**, unable to resolve a package-level endpoint. Referencing the generated package-level `RunScheduled` removes this error. Preserve the private endpoint and cron metadata check. Encore [documents generated package-level functions for service methods](https://encore.dev/docs/go/primitives/service-structs).
3. `encore/api/api.go:22`: `Migrations: "../db/migrations"` is rejected with **E1796** because it escapes the service package. Copying unchanged SQL into `api/migrations` and using `./migrations` removes this error. Production repair should move the migration location and update duplication checks/docs atomically.

The CLI initially prints one error plus “2 more errors”. Sequential isolated probes exposed each one. Probe logs name each stage; the original source still contains all three defects.

### Disposable diagnostic result

Only `/tmp/schach-encore-baseline-probe` received these three corrections. `SEED_DEMO=true encore check` then exited 0 and applied Encore-managed PostgreSQL migrations. `encore run` served real HTTP on port 4400; **38 workspace and 53 finance checks passed**, including simultaneous approval requests. A direct call to `/api.RunScheduled` without cron execution metadata returned 403. This proves a viable repair; it does not establish that the unchanged adapter passed or that managed cron dispatch/private-service ingress is secure in production.

Local Encore also warned that `BootstrapPassword` was undefined and left empty in development. The existing README says every declared secret is required locally; that statement needs correction for the observed CLI. Demo boot does not consume that secret. Fresh non-demo bootstrap still needs a strong configured value. [Encore raw endpoints](https://encore.dev/docs/go/how-to/http-requests) and [cron documentation](https://encore.dev/docs/go/primitives/cron-jobs) were consulted for adapter boundaries; managed cron does not execute locally.

### Environment/procedure findings

- No prior Unix-socket, TCP, Docker or browser sandbox block reproduced on this host.
- First Compose build lacked required `.env` values and stopped during interpolation. Supplying temporary generated configuration resolved it; this was an expected configuration requirement.
- First SQL restore encountered an already-created empty `public` schema. Dropping that empty schema **only in this turn's owned restore database** and retrying resolved it. The restore transaction had rolled back; no application defect was involved.
- Missing Git metadata prevents branch/commit provenance, not application execution. No repository was initialized or commit history invented.

## What currently works and what needs extension

Current tests support active-membership/company isolation; member/head/manager/viewer scopes; immutable original date commitments; reasoned changes and optimistic writes; independent task and expense decisions; checklist/dependency gates; recurrence/reminder claims; permission-checked evidence; exact minor-unit money; fiscal budgets and overruns; scoped history/notifications; role narrowing and revoked membership denial. Native database tests now exercise these through actual row locking, rather than SQLite serialization alone. This is finite scenario coverage, not proof of every possible race or capacity level.

Actual code confirms the blueprint's integration gaps:

- No conversations, messages, private chat authorization, search/sync, outbox, mobile push, native app or call domain exists.
- `permissions.go:canRead` intentionally grants leadership/viewers broad task visibility. A self-assigned task is not a private reminder.
- `workspace.go` exposes taskless activities to broad work readers and taskless notifications to their recipient. Private chat content must not reuse these untyped projections.
- `withAccessTransaction` and `organization.go:lockCompany` serialize task/finance mutations on the company row. Routine message traffic needs separate, narrower locks, coordinated with membership edits.
- `tasks.go`, `automations.go`, `models.go`, metrics, reports and CSV use date-only deadlines. “By 4 pm” is unsupported today.
- `collaboration.go:addComment` and `upload` do not increment task version; `addTime` does. Finance receipts do increment expense version. New task evidence can therefore leave an old reviewer view valid: fix this integration gap before conversion publishes evidence.
- Membership deactivation changes the company membership; it does not currently implement comprehensive session/device/socket offboarding. Preserve other-company access for company-only departure; distinguish global account offboarding.
- React uses a whole-workspace 30-second poll. Communication needs separate paginated caches and cancellation/generation checks.
- Standalone HTTP's 60-second write timeout has not been evaluated for streaming.

## Still unverified

The unchanged Encore adapter's successful boot; configured non-demo Encore bootstrap; actual authenticated managed cron dispatch; production/private-service gateway ingress; reverse-proxy TLS, secure-cookie/CORS behavior and streaming; multi-instance fanout and throughput; production least-privilege roles; encrypted backups, restoration procedures and recovery objectives; full browser task/review/upload/report/focus flows; physical mobile devices and background delivery/calls.

All future communication tests remain unexecuted because the domain does not exist. No inference from task/finance tests establishes private-chat permission, message retry behavior, conversion disclosure, timed deadlines, socket revocation, object-store scanning or calls.

See the [dependency-ordered proposed implementation plan](superpowers/plans/2026-10-10-communication-implementation.md). Verification processes and owned disposable resources are cleaned up after the run; evidence remains, not a persistent demo deployment.
