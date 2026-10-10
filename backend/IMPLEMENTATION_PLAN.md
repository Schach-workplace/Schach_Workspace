# Backend implementation plan

The original task-workspace sequence below is retained as historical implementation context. The completed department-finance extension follows `../docs/superpowers/specs/2026-10-10-finance-design.md` and its shared implementation plan; current delivery and verification are recorded in `IMPLEMENTATION_REPORT.md`.

Goal: implement the documented API through a shared GORM service used by standalone Go and Encore.
Spec: ../docs/PRODUCT_SPEC.md and ../docs/API_CONTRACT.md.

1. Real HTTP integration tests establish cookie authentication, tenant isolation, task authorization, reviews, optimistic updates, deadline history, imports and recurrence behavior.
2. platform/models.go defines JSON-compatible GORM records; platform/server.go routes and normalizes errors; auth.go implements opaque hashed sessions and password verification.
3. permissions.go scopes memberships and task access; workspace.go creates filtered workspace snapshots; organization.go manages companies, people, departments, projects and goals.
4. tasks.go owns validation, cycle checks, compare-and-swap task updates and reviews; collaboration.go manages evidence, comments, time and nudges.
5. automations.go performs idempotent recurrence and daily deadline reminders; seed.go imports the shared development fixture only when explicitly requested.
6. cmd/server provides persistent SQLite/PostgreSQL startup and static frontend serving; encore/api reuses the identical handler with Encore-managed PostgreSQL.
7. PostgreSQL SQL migrations, environment configuration and an implementation report document deployment and executed checks.

Review focus: forged tenant identifiers and nested references; owner bypass of required review; simultaneous task changes; invalid row in a bulk import; repeated scheduler runs. Each is covered by integration tests before declaring completion.
