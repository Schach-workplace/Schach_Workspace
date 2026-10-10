# Reproduce the verification tools

The [verification record](../docs/VERIFICATION.md) identifies the final executed checks and remaining deployment gates. These tools are separate from the application runtime and use disposable data.

## HTTP handler integration: 38 workspace and 53 finance checks

The Go bridge runs the actual shared handler through `httptest` with an in-memory GORM/SQLite database. Python drives the normal login and API routes through one subprocess, retaining separate session cookies for each client. It opens no listening port and grants no authentication bypass.

From the repository root, on a Unix-like system with Go, a C compiler, and Python 3:

```sh
cd verification/httpbridge
go build -o /tmp/schach-httpbridge .
cd ../..
python3 verification/http_flow.py --bridge /tmp/schach-httpbridge --allow-demo-mutations --report verification/http-result.json
python3 verification/finance_flow.py --bridge /tmp/schach-httpbridge --allow-demo-mutations --report verification/finance-result.json
```

The recorded run passed **38 checks**, including account/company boundaries, roles, review and reopen behavior, evidence bytes, atomic imports, automations, notifications, and old-cookie rejection after logout. The standalone static React document check is explicitly skipped in bridge mode. This is **in-process HTTP handler integration**, with no TCP, native PostgreSQL, Encore-runtime, or browser claim.

The separate financial flow passed **53 checks**. It covers exact money and multilingual text boundaries, company-local dates, department budgets and controlled revisions, independent approvals/payments, missing-receipt exceptions, scoped receipt bytes, version conflicts, final paid/void records, budget overrides and current membership authority. Two approval handlers run together against a budget that can fund only one: exactly one succeeds. This uses one SQLite connection and does not certify native PostgreSQL concurrency. The [financial result snapshot](finance-result.json) records source/module/fixture hashes and the tested bridge binary digest.

The same script retains normal HTTP mode for a separately running disposable demo server:

```sh
python3 verification/http_flow.py --url http://127.0.0.1:8080 --allow-demo-mutations --report verification/http-result.json
```

Normal HTTP mode also asserts the standalone React document. It creates sample records and must not target a live company database. See [bridge details and protocol](httpbridge/README.md) and the [sanitized result snapshot](http-result.json).

## PostgreSQL migration compatibility: 100 checks

This separate npm package applies the actual release migrations to PGlite's PostgreSQL WASM engine:

```sh
cd verification/postgres-compat
npm ci
npm test
```

The recorded run passed **100 checks** with PGlite 0.5.8 / PostgreSQL 18.3 WASM. It applies migration 1, creates legacy data, applies migration 2, verifies original data preservation and financial constraints, then downgrades in reverse version order. Both standalone/Encore SQL pairs must match exactly. Dependencies are isolated in this directory; its generated `node_modules` is omitted from the delivery.

This is a **PGlite compatibility check**, separate from the HTTP bridge and from native PostgreSQL/GORM/pgx integration. See [full instructions and limitations](postgres-compat/README.md) and the [result snapshot](postgres-compat/result.json).

## Other application checks

The backend/frontend suite counts, compiled-preview DOM checks, build results, and runtime/browser limits are recorded in [docs/VERIFICATION.md](../docs/VERIFICATION.md). A DOM check of the compiled preview does not certify browser layout, mobile screenshots, focus behavior, or production deployment.
