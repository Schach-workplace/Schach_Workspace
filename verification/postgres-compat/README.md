# PGlite migration compatibility check

This isolated tool applies the actual release SQL to a disposable, in-memory PGlite database. It is a **PGlite compatibility check**, not a Go/GORM/pgx or native PostgreSQL integration test. It is separate from application dependencies; do not include its `node_modules/` directory in the source delivery.

## Reproduce

From the repository root, with Node and npm installed:

```sh
cd verification/postgres-compat
npm ci
npm test
```

The lock pins `@electric-sql/pglite` **0.5.8**. The recorded run used Node **24.19.0**, npm **11.9.0**, and PGlite's **PostgreSQL 18.3** WASM engine. `check.mjs` resolves migration files from the repository, so run it within the extracted full source tree.

The command prints a concise result and writes `result.json`, including the ordered migration list, SHA-256 hashes of each up/down file, the engine version, every completed check, and limitations. A failed assertion exits nonzero. The checked-in result is a sanitized snapshot from the recorded run; rerunning replaces it.

## What the 100 checks cover

- Version 1 and version 2 standalone/Encore migration pairs match byte for byte. The initial migration commits atomically and creates all 14 original tables.
- Valid fixtures exercise company membership, tasks, projects, goals, comments, time, evidence, sessions, and automation records. Separate companies can reuse task codes.
- Composite foreign keys reject owners from another company and task links crossing company boundaries for comments, time entries, and attachments.
- Unique constraints reject duplicate membership, task code within a company, company slug, account email, and automation key.
- Checks reject invalid roles, excessive capacity, invalid task status, excessive progress, negative effort, nonpositive versions, invalid owner/reviewer combinations, missing required reviewers, invalid time/upload sizes, and a goal target equal to its baseline.
- JSONB arrays/objects, evidence `bytea`, and session `timestamptz` values work. Malformed JSON and an unknown session user are rejected.
- A failed statement rolls back the preceding write in its transaction.
- Version 2 upgrades a populated version 1 schema. Every original column and row across all 14 legacy tables is preserved, including work, activity, notification, evidence and session data. Existing companies acquire INR and an April financial-year start; existing notifications have no expense link.
- All five financial tables appear, the Finance membership role is accepted, and money columns use PostgreSQL `bigint`. The supported upper money boundary, zero budget allocations, binary receipt data and financial event storage round-trip exactly.
- Financial foreign keys reject cross-company departments, categories, creators, expense receipts, and receipt uploaders. Company-scoped expense codes and normalized non-void vendor/invoice pairs are unique; separate companies can reuse them and a void expense releases the invoice key.
- Financial checks reject invalid amounts, dates, currencies, status/version values, self-review/self-payment, missing submitted/review/payment metadata, invalid payment dates/methods/references, and invalid receipt sizes.
- The reverse-order downgrade removes version 2 financial tables/columns while preserving original data and demoting Finance memberships to Member before restoring the old role constraint. Version 1 down then removes every remaining fixture table.

The destructive down migrations touch only the in-memory fixture created by this command. No live connection string is used. This test of downgrade behavior is not advice to drop financial history from a live database.

## Limits

This probe does not run the Go handlers, GORM mapping, pgx driver, database network authentication, TLS, connection pools, native persistence, backup/restore, separate concurrent PostgreSQL connections, scheduler overlap, or load tests. SQL acceptance on this PostgreSQL 18.3 WASM build does not certify a different deployment version. Optional text references, JSON graph edges, active membership, and role visibility also require the application's authorization checks. Budget overlap/fiscal-year rules, settings immutability, workflow transitions, version conflicts, receipt policy, overspend approval and current role authorization are enforced by the application; see the separate [finance HTTP flow](../httpbridge/README.md).

Primary references: [PGlite architecture](https://pglite.dev/docs/about), [query, migration and transaction API](https://pglite.dev/docs/api). See [the release verification record](../../docs/VERIFICATION.md) for other executed checks and open deployment gates.
