# PostgreSQL schema migrations

All numbered SQL files are the production schema authority and are mirrored byte for byte in `encore/api/migrations`. Original versions 1/2 remain unchanged. This release adds versions 3–24 for communication, deadlines, media, identity, delivery and retention.

For a fresh standalone database, supply a schema-owner DATABASE_URL and run from `backend/`:

```sh
go run ./cmd/migrate
```

The runner obtains a PostgreSQL transaction advisory lock, applies contiguous versions atomically and records SHA-256 checksums in `schach_schema_migrations`. Re-running verifies applied checksums and only applies new versions. A changed checksum fails. The application role can retain only CONNECT/schema USAGE/table DML privileges; apply matching default privileges for newly created tables and revoke public schema creation as appropriate. The local Compose reference uses one role for convenience, so split migration/runtime identities before production.

For an existing original version-1 or version-2 standalone release without this ledger, stop writes, take a coordinated backup, verify its schema and the original migration hashes, then explicitly run `go run ./cmd/migrate --adopt-through 1` or `--adopt-through 2`. Adoption validates the legacy surface but cannot establish unknown historical changes; the operator owns that verification. Never adopt a later or unverified schema. A failed upgrade rolls back both DDL and ledger changes. With Compose, start the database first, then `docker compose run --rm migrate --adopt-through 2` for a verified version-2 volume before normal startup.

Encore tracks its own migration ledger. Do not apply the standalone runner against an Encore-managed schema as a second migration owner. Exported Encore images do not provision or migrate self-hosted infrastructure; choose one migration owner and apply the numbered files through that deployment process.

Down files are destructive disposable teardown, in reverse numeric order. They are not expense reversals, content deletion policy, production rollback or a safe way to downgrade a populated release. Restore a verified compatible backup for rollback. PostgreSQL sessions and timed commitments use native timestamps; legacy date-only work remains unchanged, JSON collections use JSONB and monetary amounts remain integer minor units.
