# Spec Compliance

- ❌ **Issues found.** Full BASE `022c055e628eca9ba58d09840b81b4b630e75d85` → HEAD `69fdc77a86a4718695decbf7c127666fece278db` review: **0 Critical, 5 Important, 1 Minor**. All nine implementation slices and the capture amendment are represented, but authored original-CAS recovery, frozen bank-import recovery, reconciliation ACK recovery, current reconciliation attention episodes, and terminal scanner feedback have defects described below.
- ⚠️ **CannotVerify: controller-owned native gate.** The writer explicitly leaves the final-source Android/Hermes aggregate and real native route evaluation pending (`task-7-report.md:134`). Native DOM tests and exports do not establish the required real aggregate rendering, keyboard/back/background/camera-return behavior. At handoff the controller reports that source-69 native More/manual input hold passed; fast ADB double-R reload was isolated to the installed development-shell recognizer and is excluded as a production defect. I did not independently execute these probes. The controller must resolve the complete gate against the final repaired source.
- ⚠️ **CannotVerify: physical/production qualification.** Physical accessibility/camera/picker/photo privacy/push, iOS/signing, India deployment, company-language OCR accuracy, hardened deployment memory behavior, multi-replica admission, large/distinct-cohort capacity and production retention/restore procedures remain qualified gates, not source-review approvals (`task-7-report.md:136`). The exported Alpine runtime explicitly does not claim host Tesseract capability.

# Strengths

- Exact arithmetic reaches genuine consumers: `shared/finance/money.ts:22` formats integer strings without floating division; `frontend/src/data/finance.test.ts:165` exercises the real 9,008-row summary; `backend/platform/finance_statements.go:283` emits checked integer-string totals while preserving original CSV ordinals. Equal-valued rows are not deduplicated.
- Ordinary create and extraction acceptance reuse existing finance authority and canonical business mutations. `backend/platform/expenses.go:179`, `finance_mutations.go:102`, and `finance_extraction_acceptance.go:248` retain draft/creator/current destination checks, original invoice validation, transactional code/evidence/claim writes and separate review/payment transitions. `finance_extraction_acceptance_test.go:76` covers the difficult source-equals-target replay after its own version bumps.
- The amended capture contract is real: SQL44 preserves SQL38 and introduces explicit unbound identities; `backend/platform/finance_receipt_intakes.go:154` charges 10 MiB per active capture reservation; `finance_capture.go:44` binds through canonical lookup before first-write state/CAS checks without renewing the original session or expiry. `mobile/src/capture.ts:138` refuses camera launch against a bound canonical source.
- Provider work is outside business locks, with current original-session/source/lease checks around private reads and shared-budget waits (`backend/platform/finance_assistance_jobs.go:13`, `:192`). The final boundary tests cover source denial, cancellation, reclaimed lease and original-session expiry before provider entry and after slot waiting (`finance_provider_boundaries_test.go:29`, `:88`). The process-wide budget is an actual shared default (`local_provider_budget.go:33`).
- Accepted evidence survives scratch lifetime. Receipt copies are stored independently (`finance_extraction_acceptance.go:283`), statement rows are committed independently in batches (`finance_statements.go:530`), and active allocation uniqueness protects both row and expense (`backend/migrations/43_finance_reconciliation.up.sql:2`). Reconciliation does not call the payment transition or change paid economics.
- Real runtime evidence is available. I read the final standalone, Encore, SQLite and PostgreSQL browser result files: standalone reports eight checks, exported Encore seven, and browser six; the browser includes actual committed receipt acceptance with lost ACK and actual import followed by failed refresh. I also read the final SQLite/PG/race/original-session-boundary logs; each reports success and those logs contain no warnings. This supports the documented bounded fictional workflows, not the recovery cases below or production certification.

# Issues

## Critical (Must Fix)

None identified.

## Important (Should Fix)

### I1 — Restored web expense edits silently adopt a newer optimistic version

**Evidence:** `frontend/src/components/FinanceForms.tsx:90`–`:93`; PATCH submission at `:140`; `frontend/src/data/executionInput.ts:27`–`:39`; editor reopening at `frontend/src/pages/Finance.tsx:1257`.

The change persists `draft` in scoped RAM but leaves `version` in component-local state initialized from the newly supplied expense. Closing and reopening restores the old authored draft while adopting the current server version. The stale check then compares the current expense to that newly adopted version and passes.

**Reproduction:** Open expense version 1, edit its title, close the editor, and update the expense to version 2 through another authorized session. Reopen the expense editor. The old version-1 draft returns, but Save PATCH sends version 2 and all restored fields, overwriting the intervening changes without a conflict or deliberate Load latest action. No transport failure is required.

**Required correction:** Persist the inspected version with the authored draft on its first edit, restore them together, and replace both only on deliberate re-review. Retire the matching authored draft on a confirmed successful save. Add a close/reopen/external-update test using the real RAM hook and assert the original CAS is retained.

### I2 — Unknown statement-import attempts can be detached by creating another preview

**Evidence:** `frontend/src/components/StatementImportReview.tsx:41`, `:48`, `:53`, `:76`; `mobile/src/FinanceStatementReview.tsx:60`, `:123`, `:136`.

The web mapping fieldset is disabled only for the preview mutation, not for a pending import attempt. Changing a mapping clears `preview`, which changes the import form identity and detaches the unknown prior import. Both clients also permit Preview exact statement rows while `imported.attempt` exists but `imported.busy` is false. A successful preview creates a new preview ID and switches the import attempt scope. Native disables the mapping fields correctly but still leaves this preview action available.

**Reproduction:** Let an import commit and drop its ACK. On web, change a mapping choice and request a new preview; on either client, request another preview without editing. The UI changes to a fresh preview/import scope instead of recovering the original frozen import. The original canonical import may already exist. A subsequent repeated-file warning does not recover or explicitly abandon that unknown operation.

**Required correction:** Freeze every mapping/re-preview control while an import attempt is unresolved, or provide an explicit warned reconciliation/abandon flow that retains access to its canonical recovery. A new preview must not silently replace the attempted import's source. Test a committed-but-lost import ACK followed by re-preview on both clients.

### I3 — Web reconciliation loses the retry controls after a committed match/unmatch with lost ACK

**Evidence:** `frontend/src/components/FinanceReconciliation.tsx:25`, `:68`, `:153`; `backend/platform/finance_reconciliation.go:413` excludes actively allocated expenses from the unallocated list.

The match button requires the selected expense to remain in `unallocatedExpenses` even when `m.attempt` already contains the frozen canonical match. After a successful match whose ACK is lost, a current refresh correctly removes that expense from the list, permanently disabling the identical retry. The reversal control is similarly rendered only while `allocation.active`; after a committed unmatch with lost ACK and refresh, the control disappears despite its pending attempt. Native's match condition already handles the missing-current-choice case differently.

**Reproduction:** In the web `state=all` reconciliation view, match a row and drop the successful response. Refresh/reopen current reconciliation. The row and active allocation are visible, but the selected expense is absent from the unallocated choices and Match stays disabled. Repeat with an unmatch whose response is dropped: the allocation becomes inactive and the entire retry control is removed.

**Required correction:** Render an explicit retry/reconcile control from the frozen pending attempt independent of post-commit candidate eligibility/active state, while still requiring current source/result authorization. Do not require first-write eligibility again for canonical replay. Add actual committed-match and committed-unmatch lost-ACK UI tests with subsequent refetch.

### I4 — Reconciliation attention disappears when another row changes its suggestion basis

**Evidence:** `backend/platform/finance_reconciliation.go:83`, `:103`, `:196`, `:258`; `finance_assistance_attention.go:64`, `:106`, `:141`; unchanged integration checked at `attention_producers.go:76` and `attention_jobs.go:125`.

An attention occurrence contains the complete suggestion basis, including currently unallocated paid-expense IDs/versions. Matching one row removes its expense from every other compatible row's suggestion set, but the mutation calls `syncFinanceReconciliationAttention` only for the matched row. Those other rows now fail the occurrence-basis equality check and disappear from attention. The periodic attention worker only rechecks existing occurrences; it does not produce replacement finance episodes. A newly recorded payment or additive receipt version bump has the same basis-drift problem because the existing expense producer does not synchronize these rows.

**Reproduction:** Import two equal negative bank rows while one compatible paid expense is available. Both receive reconciliation attention. Match row A to that expense. Row B remains unmatched and still needs accounting review, but its suggestions change from that expense to none; its old attention occurrence is rejected and no replacement is created. Recording a new matching payment after importing an unmatched row similarly invalidates its old occurrence without replacing it.

**Required correction:** Reconcile affected unmatched-row episodes whenever the paid candidate/allocation basis changes, using bounded work and current recipients; alternatively design an obligation basis that remains valid until an explicit domain resolution and separately reauthorize displayed suggestions. Preserve dismissed-basis semantics and generate fresh attention when warranted. Cover the two-row/one-expense case and later paid/evidence-version changes.

### I5 — Terminal scanner failure leaves the only observable intake state permanently “scanning”

**Evidence:** `backend/platform/finance_assistance_jobs.go:158`, `:214`, `:268`; `finance_receipt_intakes.go:201`, `:345`; `frontend/src/components/FinanceAssistance.tsx:104`; `mobile/src/FinanceIntakeReview.tsx:193`.

Failure/exhaustion updates only the private scan job. The associated intake remains `scanning`, and intake GET serializes only that intake. Finalize returns the intake ID rather than a queryable scan-job result, while receipt-extraction GET/list expressly select only `extract_receipt` jobs. Consequently, scanner rejection, scanner outage or exhausted scan lease has no observable terminal status/error in the real intake flow. Both clients keep offering Check clean assessment forever; finalize cannot be retried because the intake is no longer `uploaded`.

**Reproduction:** Configure a scanner that rejects the staged bytes or is unavailable, finalize an intake, and allow all three attempts to fail. The job becomes failed but every intake refresh still says scanning. No clean assessment can complete and no sanitized failure/manual-recovery state appears. The same problem occurs for lease exhaustion.

**Required correction:** Publish a source/generation/lease-safe terminal scan outcome to the observable intake contract (or expose an authorized assessment status linked from it), while keeping all bytes quarantined. Give the clients a truthful failed/rejected/manual-recovery state and a deliberate supported retry/cancel path. Test scanner rejection, outage/exhaustion and stale-worker races through the actual intake GET/UI contract.

## Minor (Nice to Have)

### M1 — Web remapping retains a cursor belonging to the old preview

**Evidence:** `frontend/src/components/StatementImportReview.tsx:30`, `:45`, `:48`.

After reviewing page 2, changing a mapping clears the preview ID but does not clear `pageCursor`. The next preview's GET therefore submits the previous preview's correctly source-bound cursor and receives 422. Its First rows button is inside `p.data`, so this error also removes the in-place reset control; closing/reopening is needed to reset component-local cursor state. Reset `pageCursor` when replacing mapping/preview, as the native implementation already does. Test remapping after advancing beyond the first page.

# Assessment

**Task quality: Needs fixes.** The backend canonical/economic/source boundaries and real provider/runtime evidence are substantial. The remaining defects affect ordinary recovery and current attention behavior, so passing broad suites and the fictional happy-path acceptance do not establish this milestone's required contract.

**Review scope and checks:** Read the twelve-commit serial review package, the complete brief/report, capture ruling and all nine finalized plan slices. Read the diff in sequential chunks; recovered tool-truncated portions explicitly. No suite, service, runtime, database, Git or index operation was run or changed. No child agents were dispatched. The only write is this review report.

**Focused context outside the diff:** (1) `executionInput.ts` and the cut-off mutation hook confirm RAM lifetime and retry retirement for the named editor/recovery risks; (2) existing Finance editor callbacks and scope cleanup confirm close/reopen behavior; (3) SQL36 checks confirm SQL45 does not conflict with an inherited report-pair CHECK; (4) `attention_producers.go`, `attention_jobs.go` and `attention.go` establish whether existing producers/worker repair changed reconciliation bases; (5) `finance.go:69` confirms meaningful reasons already enforce the Unicode upper bound. A lookup for `attention_runtime.go` found no such file; the actual runtime is `attention_jobs.go`. These were targeted contract checks, not a repository crawl.

**Evidence qualification:** Inspected `/tmp/schach-m7-final-source-evidence/manifest.json` (HEAD69fdc77; controller independently verified its hashes), `/tmp/schach-m7-owned-standalone-final-head/result.json`, `/tmp/schach-m7-owned-encore-final-head/result.json`, `/tmp/schach-m7-owned-sqlite-final-head/result.json`, `/tmp/schach-m7-owned-standalone-final-head/finance-browser.json`, and the four final backend logs named above. Findings are deterministic source traces; their focused reproductions were not executed because this review is source/read-only and the existing passing suites were not to be repeated. The controller should commission the named focused regression tests with the fixes, then source-qualify the pending native gate.
