# Schach Workspace Implementation Plan

> For agentic workers: use the implementation and verification skills. The user requested complete execution in one pass. Independent backend, frontend and validation work is delegated with non-overlapping file ownership.

**Goal:** Deliver a working, verifiable, multi-company task management application as a ZIP.

**Architecture:** One shared Go domain and HTTP handler, a standalone Go executable and an Encore adapter. GORM persists data in PostgreSQL, with SQLite for local evaluation. A typed React frontend uses an HTTP adapter or an explicitly labelled local demo adapter.

**Tech stack:** Go, Encore Go, GORM, PostgreSQL, SQLite, React, TypeScript, Vite, Radix UI, Lucide, automated Go/TypeScript tests.

**Spec:** PRODUCT_SPEC.md. **Interface:** API_CONTRACT.md and frontend/src/types.ts.

## Global constraints

- Every company-owned resource is checked against authenticated company membership.
- Task owner cannot approve their own required review.
- Commitments use date-only strings; audit timestamps use UTC ISO timestamps.
- Brand: #F97316 / #09090B / #18181B / #FAFAFA.
- No external deployment or real user notifications are part of this ZIP task.
- No secrets, production sample accounts, node_modules or build caches in the source archive.

## Review focus

Cross-tenant ID substitution; head/member privilege escalation; concurrent task editing; original-date accuracy; sensitive data in exports/uploads. Backend tests own authorization and concurrency, frontend tests own metric edge cases and imports, browser checks own usability.

## Task 1 — domain and backend (backend/ and encore/)

- [x] Create permission and workflow tests from the contract, observe expected failures where the runtime permits.
- [x] Implement models, auth/session lifecycle, GORM store, company scoping and explicit migrations.
- [x] Implement workspace reads and entity mutation endpoints, review/time/comments/attachments/imports.
- [x] Implement recurring tasks, reminders and Encore cron integration using the same domain code.
- [x] Run Go tests and build the standalone executable; validate Encore parsing/build if available.

## Task 2 — application UI (frontend/src excluding types, data and store)

- [x] Build responsive application shell, navigation, company picker and visible demo indicator.
- [x] Implement overview, tasks/list/board/calendar, personal work, projects, workload, goals and reports.
- [x] Implement task details and forms, evidence/time/comments, reviews and company administration.
- [x] Check TypeScript/build and representative role/device states.

## Task 3 — typed data adapters and integration (frontend/src/data, store, types, tests)

- [x] Define and test metric calculations, CSV handling and data validation.
- [x] Create consistent, fictional multi-company sample data and local demo persistence.
- [x] Implement authenticated HTTP adapter and provider API, refresh/error/stale state handling.
- [x] Connect user actions end to end; fix mismatches revealed by real API and UI tests.

## Task 4 — review and distribution (docs/, scripts/, root package files)

- [x] Review core authorization and delivery workflows independently.
- [x] Verify backend tests, frontend tests, production builds, startup and responsive screenshots when supported.
- [x] Supply configuration templates, Docker/self-host and Encore instructions, operation/backup notes.
- [x] Build explicit browser preview and package full source plus verification record into ZIP.
- [x] Prepare the complete release for distribution with an honest summary of tested capabilities.

## Delivery verification boundary

The implementation, source builds, automated domain/DOM checks, independent security review, compiled preview and packaging work are complete. Full Encore analyzer/runtime execution, native PostgreSQL integration, Docker/Compose execution and actual desktop/mobile browser rendering were not available in this workspace. Their explicit deployment gates are retained in [VERIFICATION.md](VERIFICATION.md); checked plan items do not represent those unavailable checks as passed. The final delivery message supplies the download link separately from this archive.
