# Task5 fix round2 — retained authored template CAS

Status: **DONE**, scoped repair complete; independent scoped review still follows before milestone acceptance.
BASE: `79049f08ad91c5497cc6d3ebfb7fb272ffed9867`.
Commit/final HEAD: `a6671c0893fc870994ce25ec4c0d6d6d60173f28` — `fix(templates): retain the inspected version with authored edits`.
Worktree: `/home/brahma/Projects/Schach_Workspace/.worktrees/workspace-improvements`.

## Addressed finding and implementation

Repeated Edit and Cancel/re-enter previously retained an authored rename from template version1 while unconditionally replacing its captured version with current source version2. The real component's outgoing PATCH could therefore silently rebase stale authored intent instead of allowing the server's existing CAS guard to reject it.

The captured `expectedBasis` now lives in the same per-template `$template-manage:<id>` scoped RAM form as the retained authored fields. The existing authorization-aware management effect captures a version only when that form has no captured basis. Ordinary Edit/reopening does not overwrite it. Starting another/new form does not zero the former form's retained basis. A matching successful save, warned reconciliation, or confirmed source denial uses the existing form purge, which now removes fields and captured basis together. A fresh subsequent edit can then inspect/capture the current source version.

Only `frontend/src/components/TaskTemplates.tsx` and its existing test file changed. Production diff: change the version RAM scope to managementForm, remove unconditional loadManagement version replacement, remove New-template's write to the preceding form's version. No new shared export, dependency, persistence mechanism, endpoint, migration or engine. Source-pending hiding/disabled writes, confirmed-denial purge, frozen uncertain attempt identity and captured PATCH target/method remain unchanged. Original nine review findings were not reopened.

## Actual RED → GREEN

Tests use the real `TaskTemplates` and `executionInput` components and accepted RAM store; only surrounding workspace/read/mutation boundaries are mocked, following the existing component harness.

Before production edits, added three behavioral cases: repeated Edit, Cancel/re-enter, and Cancel followed by explicit React unmount/remount. Each opens version1, authors `Authored against version one`, supplies a concurrent version2 source with `Concurrent task default`, reopens and saves. Assertions first verify the authored rename remains and the refreshed fetched default is actually displayed, then require a PATCH to the original template with version1. This rules out accidentally testing an unchanged/stale source fixture.

RED command, frontend directory:

```sh
npm test -- src/components/TaskTemplates.test.tsx
```

Exit1;1 failed file;3 failed/3 passed tests; duration585ms. All three failed on the actual outgoing payload:

```text
"name": "Authored against version one"
"defaults": { "title": "Concurrent task default" }
- "version": 1
+ "version": 2
```

After the scoped implementation, the same command exited0:1 file,6 tests passed, duration541ms. Added one further protection against retaining a basis forever: a matching successful save invokes the real component's committed cleanup; after the source advances, a fresh authored edit submits version2 and current fetched prefill, with the old rename retired.

## Covering checks

All following commands exited0 with no application/test warnings:

```sh
npx prettier --write src/components/TaskTemplates.tsx src/components/TaskTemplates.test.tsx
npm test -- src/components/TaskTemplates.test.tsx src/data/execution.test.tsx src/data/businessAttempts.test.ts src/components/TaskDrawer.retry.test.tsx
npm run build
npm run build:demo
npx prettier --check src/components/TaskTemplates.tsx src/components/TaskTemplates.test.tsx
```

Covering tests:4 files,24 tests passed,654ms:7 template cases,8 execution adapter/source/late-company cases,6 neutral retry cases,3 ordinary drawer retry cases. This includes the retained typed-default/version test and pending-source PATCH/POST barrier, plus the three new stale-basis reopening regressions and matching-success retirement case.

Both builds include `tsc --noEmit`: API build2077 modules,306ms; demo build2077 modules,271ms. Prettier: `All matched files use Prettier code style!`. `git diff --check` passes. Post-commit `git status --short` is empty. Self-review covered the complete BASE→a6671c0 two-file diff and the capture/cleanup transitions, including per-template isolation and remount lifetime.

Per the scoped brief, unchanged backend/native suites, migrations, exports and full suites were not repeated. Round1's full checks remain source-qualified evidence for their respective commits. No actual browser/API/native runtime was started or mutated for round2; this handoff claims the real browser-component payload/lifetime regression and builds, not a new device/server runtime proof. Existing physical/iOS/distribution gates and round1 deferred Minor logging qualifications remain unchanged.

No root app/database/controller runtime changes, children, push or merge. Only the scoped implementation/tests were committed; this report and the original-report pointer are retained in the existing ignored evidence directory. Controller ledger/preparations untouched.
