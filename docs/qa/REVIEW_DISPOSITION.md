# Documentation review and corrections

The source authors inspected disjoint core, Connect/mobile/security and finance/report/intelligence modules. Their catalog reports describe source coverage, not executed acceptance. Aliases were normalized to the shared QA Alpha/QA Beta actor matrix during integration. The two bounded integration reviews remain in `catalog/integration-connect-review.md` and `catalog/integration-finance-review.md`; their original findings are preserved.

| Finding | Disposition |
| --- | --- |
| Inherited frontend URL/demo mode could bypass the disposable API | Corrected launcher forces `VITE_API_URL=''`, `VITE_DATA_MODE=api`, `NODE_ENV=production`. Controlled `.invalid` build reproduces inherited URL/demo; fixed build resolves empty/API and has zero inherited URL markers. Neither artifact was served. |
| Onboarding keyring and scheduled report storage/worker prerequisites too implicit | Added explicit key preservation to JOURNEYS-001 and dedicated report storage/worker/owner/recipient prerequisites to setup and JOURNEYS-008. |
| Generic finance journey observations | JOURNEYS-005 now specifies budget 1000000, expense 123456 and exact pending/approved/paid/available totals. JOURNEYS-006 requires clean scan, separate OCR opt-in and current reviewed fields/audience/evidence consent. JOURNEYS-007 specifies two equal negative debit occurrences, total 246912, one full association, one unmatched occurrence and association-only reversal. |
| Report delivery and unrelated recipient loss | JOURNEYS-008 names ordinary GET /attention, IDs-only recipient-bound report_ready, no route/escalate and unrelated B departure preserving eligible A/owner. Wider invalidation remains separate. |
| Raw expiry conflated with source loss and publication recovery | JOURNEYS-009 separates expired raw first write, deliberate fresh generation from still-readable originals, and unknown committed publication recovery under current publication-access/provenance/ACL. Source/session revocation remains a denial. |
| Acceptance episode inferred from current summary | JOURNEYS-001 explicitly selects task_history_v1 after independent acceptance; current totals and historical episodes remain separate. |

Root verified the integrated source references and regenerated all case artifacts. No application bug or manual PASS was inferred from documentation review.

Artifact checks also exposed authoring/harness issues, retained as qualifications:

- Initial catalog authoring had a Python syntax typo and three guessed test filenames. Corrected before integration; reference validator now requires real files.
- Validator initially required three steps/nonempty automated references. Revised to permit valid two-step cases and explicitly manual physical/provider cases without inventing automation.
- Initial PDF subprocess was launched without an awaited lifetime, so the file was absent. Awaited rendering produced the final document; the initial missing-link check failed honestly.
- Initial link scan matched HTML-like strings inside JavaScript. Replaced it with HTMLParser for actual static attributes; catalog validation and browser checks cover generated links/images.
- Browser harness initially awaited an offscreen lazy image and assumed six steps for a four-step case. It now requests eager rendering for the selected image and obtains step count from the catalog.
- Real documentation overflow at width 320 came from long source-reference labels. Added wrapping and retested 320/375/430 with no overflow.
- Visual inspection found back-edge labels hidden by boxes. Moved labels into gaps and kept side lanes outside boxes; regenerated and inspected the corrected diagrams.
- An external OOXML edit retained cached summary totals during the first LibreOffice conversion. A private second copy cleared formula caches to force evaluation and returned 224 total / 223 NOT_RUN / 1 synthetic PASS. The distributed template remains all NOT_RUN; no application case was executed. Normal spreadsheet GUI user-edit behavior was not exercised.

The initial Git preparation used an incorrect optional Markdown index path and identified CRLF CSV records as whitespace warnings. The unpublished documentation commit was corrected: the real JSON index is included and CSV uses LF records with UTF-8 BOM. A full baseline-to-commit whitespace check also exposed extra EOF blank lines in generated module guides; the writer now emits exactly one final newline. Final validation includes the entire baseline-to-release diff.

These are documentation/build-harness outcomes. The complete server-launch script and 224 manual cases remain unexecuted by this task; external device/provider/production gates remain open. Mermaid files use generated standard flowchart syntax and structural checks; no external Mermaid parser was installed or run.
