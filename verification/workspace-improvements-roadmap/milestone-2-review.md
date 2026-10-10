# Milestone 2 independent review record

## Initial review — findings fixed

### Spec Compliance

- ❌ Issues found: selected web details do not track refreshed record access/version (`frontend/src/store.tsx:549`), and lean projections silently break existing search/export behavior (`backend/platform/read_scopes.go:168`, `backend/platform/read_scopes.go:286`). Both violate the requirement to migrate clients without semantic regressions and reauthorize scoped cached data.
- ⚠️ Physical-device acceptance remains explicitly unfinished in the implementation report. Production/provider/India deployment gates are outside this task's diff; this review does not certify them.

### Strengths

- Task and finance authorization predicates precede keyset pagination, with company/user/membership/filter-bound cursors and batched hidden-reference pruning (`backend/platform/read_scopes.go:15`, `backend/platform/read_scopes.go:147`, `backend/platform/read_scopes.go:273`).
- Reports freeze their inputs in a read-only repeatable-read transaction, bound snapshot storage, and reauthorize source tasks and exposed dependencies before reuse. Rows and formula-safe streamed CSV share that frozen selection (`backend/platform/report_reads.go:143`, `backend/platform/report_reads.go:278`, `backend/platform/report_reads.go:392`).
- Membership-graph fingerprints protect web/native scope changes, with regressions covering an unchanged manager role whose subordinate graph changes (`backend/platform/read_scopes_test.go:192`, `frontend/src/store.scopes.test.tsx:13`, `mobile/src/readScopes.test.ts:3`).
- Metrics use route templates and preserve HTTP flushing/hijacking; the changed TCP WebSocket test exercises actual upgrade and delivery (`backend/platform/read_metrics.go:13`, `backend/platform/read_metrics.go:64`, `backend/platform/communication_delivery_test.go:88`). The owned fixture records p50/p95, bytes, query counts and before/after plans without claiming production capacity (`backend/platform/read_load_test.go:14`, `verification/runtime/data-read-performance.json:1`).

### Issues

#### Critical (Must Fix)

- None found.

#### Important (Should Fix)

1. **An open web task detail can outlive confirmed loss of record access.** `frontend/src/store.tsx:549` keys `useTaskDetail` by identity, task ID and membership basis, but does not depend on the refreshed task's presence/version and has no periodic detail refetch. If a task owned by a member is reassigned away while their membership graph stays unchanged, the list poll removes the task but the detail query remains successful and continues exposing its cached description, comments and attachments. `frontend/src/App.tsx:776` keeps the drawer mounted solely from `taskId`; it only checks list membership when opening (`frontend/src/App.tsx:359`). Other users' edits similarly leave open task/expense detail stale (`frontend/src/store.tsx:586`). Immediately withhold detail when the current authorized list excludes its record, and revalidate selected details on record changes or appropriate polling/events. Add a mounted-drawer regression for reassignment without a membership change.

2. **Lean lists erase data still required by existing search and CSV controls.** `backend/platform/read_scopes.go:168` omits task description, blocker and deadline-change reason; `backend/platform/read_scopes.go:286` omits expense description, review note, receipt exception and override reason. The migrated store now feeds these partial records directly to existing consumers. Task description search (`frontend/src/pages/Tasks.tsx:55`) and finance description search (`frontend/src/pages/Finance.tsx:259`) stop finding matching records. Task CSV (`frontend/src/pages/Tasks.tsx:282`, `frontend/src/data/imports.ts:210`) and finance CSV (`frontend/src/pages/Finance.tsx:127`) silently export blank values in previously populated columns; blocked-board previews also disappear (`frontend/src/pages/Tasks.tsx:482`). Preserve those controls through authorized server search/export or explicit on-demand complete projections, and retain the required preview data. Add API-mode regressions using nonempty omitted fields; demo data cannot catch this mismatch.

#### Minor (Nice to Have)

- None added.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The backend read/snapshot design and measured index evidence are substantial, but the client migration has a privacy-related stale-detail path and observable search/export regressions.

**Checks:** Read the supplied diff once. Focused checks outside its shown context examined task/finance search and export consumers, App drawer lifetime, native request cancellation/policy handling, legacy report semantics, and task authorization parity. The permissions hunk ended at `ownsScope`, so its continuation through `canRead` was inspected. Existing final logs confirm backend/PostgreSQL success, 102 web tests and 24 native tests; the supplied final logs contain no warning matches. No suites rerun, no application/database mutations, and no writes except this review document.


## Fix round 1 — findings fixed

- **Open task/expense details outliving confirmed access loss and record changes — ADDRESSED.** `frontend/src/store.tsx:554`, `:562`, `:567`, `:582` bind task reads to the complete authorized list's presence/version and suppress excluded records; the equivalent expense gates are at `:600`, `:608`, `:613`, `:628`. Selected reads additionally poll at `:570` and `:616`. `frontend/src/components/TaskDrawer.tsx:71` and `frontend/src/components/FinanceDetail.tsx:64` clear mounted draft RAM on exclusion or confirmed detail denial and withhold the body when detail is unavailable. Mounted API-mode regressions cover unchanged-membership exclusion, pending version changes, later-page records and denial/restoration in `frontend/src/store.details.test.tsx:202`, `:221`, `:245`, `:327`. Same-key pending reauthorization remains a separate Important gap below.

- **Lean lists erasing search/export/blocked-preview fields — ADDRESSED.** `backend/platform/read_scopes.go:168` now omits only task checklist, and `:286` restores expense business fields without loading nested evidence. `backend/platform/read_scopes_test.go:237` checks nonempty formerly omitted fields and empty histories. Actual API-mode search/export/board controls are exercised with populated descriptions, blocker/deadline reasons and finance notes/reasons in `frontend/src/list-controls.api.test.tsx:109` and `:132`.

- **New breakage — Important: same-key detail reauthorization exposes cached source content while pending.** The newly added polling at `frontend/src/store.tsx:570` and `:616` refetches the current key; source gates at `:582`, `:588`, `:628`, `:633` check `isFetchedAfterMount` and `isError`, neither of which withholds a previously successful result during a pending refetch. A delayed periodic/event read therefore keeps fetched description, comments, attachments and resolved people visible until success or confirmed denial, contrary to the fix's source-content gating requirement. The version-key delay regression at `frontend/src/store.details.test.tsx:221` covers a new query key; the same-version polling regression at `:290` does not pause the request or assert pending withholding. Withhold fetched record/people while the selected read is reauthorizing, retain only explicitly authored RAM edits and their inspected version, and add delayed same-key task/expense regressions including denial.

- **Draft preservation check:** `frontend/src/components/useRecordDraft.ts:6` confines memory to the mounted wrapper and resets it on scope change/exclusion. `frontend/src/components/TaskDrawer.tsx:167`, `:190`, `:194`, `:241` overlay edited fields and retain the original optimistic version; `frontend/src/components/FinanceDetail.tsx:106`, `:156`, `:192`, `:225` retain the inspected decision version and block changed-during-review submission. Existing regressions at `frontend/src/store.details.test.tsx:251`, `:276`, `:304`, `:327` support survival, explicit reconciliation and confirmed-denial erasure.

- **Verification checked:** Existing final logs report 116 web tests/21 files and successful API/demo builds (`/tmp/task2-fix1-web-final.log`), successful SQLite and PostgreSQL suites (`/tmp/task2-fix1-backend-final.log`, `/tmp/task2-fix1-postgres-final.log`), and both populated-field backend subtests passing (`/tmp/task2-fix1-business-green.log`). `/tmp/schach-task2-owned/fix1-scopes-result.json` records Chromium 152, 3/3 checks, including old submitted optimistic version, explicit reconciliation and reassignment with unchanged membership basis; its claims match `verification/runtime/read_scopes_smoke.mjs:56`, `:59`, `:65`. These runs do not establish pending same-key withholding.

- **Focused check run:** A read-only Node `QueryObserver` probe using the installed `@tanstack/query-core` performed initial success followed by a paused same-key refetch. It returned `isFetchedAfterMount=true, isError=false, isPending=false, isFetching=true`; the exact store display predicate still returned the fetched private description. No suites were rerun and no code, Git or application state was mutated.

- **Out-of-scope observations:** None.

- **Fix round: Findings remain open** — both original findings are addressed; the new Important pending same-key source-content exposure must be resolved before approval.


## Fix round 2 — approved

- **Same-key pending task/expense reauthorization exposing cached source and people — ADDRESSED.** `frontend/src/store.tsx:582`, `:590`, `:632`, `:639` now require `!result.isFetching` before returning selected source or resolved people. Loading includes fetching at `:588` and `:637`. These gates withhold previously successful cached details during same-key event/poll reads while retaining the existing presence, mount-success and error checks.

- **Draft/version/denial verification:** Delayed mounted task and expense cases at `frontend/src/store.details.test.tsx:361` independently assert absent source/people while the list remains version1 (`:383`, `:384`, `:388`). Successful reauthorization restores authored task input with editing/submitted version1 despite fresh source version2 (`:399`, `:400`, `:404`), and restores the finance note with its changed-review submission block (`:407`, `:408`, `:410`). Delayed denial cases at `:417` check pending withholding, confirmed404 and later access restoration without resurrecting either authored draft (`:434`, `:441`, `:451`, `:452`, `:459`). No fetched source is added to draft memory by this diff.

- **Existing evidence checked:** `/tmp/task2-fix2-details-red.log` records the four new cases failing against cached-source exposure, then `/tmp/task2-fix2-details-green.log` records16/16 passing. `/tmp/task2-fix2-web-final.log` records120 tests/21 files, successful API/demo builds and exit0. `/tmp/schach-task2-owned/fix2-scopes-result.json` and `/tmp/task2-fix2-scopes-runtime-final.log` record actual Chromium4/4, matching the unchanged-version comment/event delay, pending withholding and inspected-version restoration checks at `verification/runtime/read_scopes_smoke.mjs:55`, `:56`, `:58`, `:60`, `:61`, `:63`. No suites or application probes were rerun.

- **New Critical/Important/Minor breakage:** None found in the fix diff. Temporary loading and focus removal during periodic reauthorization follow the required source-withholding behavior; authored edits survive it.

- **Out-of-scope observations:** None. The two findings already addressed in round1 were not reopened.

- **Fix round: All findings addressed, no new Critical/Important breakage.**

