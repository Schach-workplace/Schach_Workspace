# Schach Workspace AI handoff

Updated UTC 2026-10-11T23:22:05.037463+00:00. Read this document, [AI_CHECKLIST.md](AI_CHECKLIST.md), [AI_FILE_INDEX.json](AI_FILE_INDEX.json), then the [durable release ledger](../verification/workspace-improvements-roadmap/release-cutover/release-ledger.md). Update all four at each material boundary and before a context limit. Verify live Git/process state before acting; historical PIDs are not permission to signal a process.

## Current state and next action

**2026-10-12 UI/UX gap closure (latest).** A read-only audit of 7db2025 found client UI/UX defects; they were fixed in web and native clients with regression tests. See [record](../verification/ui-ux-gap-closure-2026-10-12/record.md). Fresh evidence: web tsc pass, vitest 81 files/385 pass; mobile tsc and expo lint pass, vitest 63 files/407 pass. One independent control review: no Critical/High; M1/L1/L2/L5 fixed, L4 contract corrected. No backend/migration/DB/native-project change. The retained app on 8080 was not rebuilt or restarted and does not serve these client changes. All 224 manual QA cases remain NOT_RUN. Next action: product decisions listed in the record (self-profile endpoint, offboarding reason, revoked-device rebinding, icon dependency), then begin isolated local QA per docs/qa/TEAM_RUNBOOK.md with `docs/qa/tools/start-isolated-qa.sh`, which builds from current source.

Team QA documentation is complete and validated under `docs/qa/`: 224 proposed scenarios, all 13 navigation screens across 21 module/journey guides, 245 editable Mermaid/SVG flows, 34-page PDF, seven-sheet XLSX, searchable offline HTML, CSV execution/defect logs, isolated setup and fictional role/device data. All 224 manual cases remain NOT_RUN. Source baseline is191526b; this task made no app/runtime/customer database/provider changes. Read-only retained app `/api/health` remained HTTP200/ok. All catalog authors and bounded integration reviewers yielded; do not redispatch completed development or catalog work.

QA recovery: [start guide](qa/README.md), [case index](qa/MODULE_INDEX.md), [canonical catalog](qa/catalog/catalog.json), [artifact validation](qa/validation-result.json), [review disposition](qa/REVIEW_DISPOSITION.md), [pack checkpoint](qa/BUILD_STATUS.md). Controlled inherited frontend configuration reproduced the QA setup risk and verified explicit same-origin/API-mode overrides; offline filter/render/320375430 checks and private LibreOffice forced-formula/PDF checks pass with documented harness qualifications. Full QA launcher, application suites and manual cases were not executed in this documentation task. Mermaid is structurally generated, not externally parser-certified.

QA-only ZIP `/home/brahma/Projects/Schach_Workspace-team-QA-20261012-ready.zip` is created and every manifest hash verified; archive receipt is verification/team-qa-2026-10-12/archive-proof.json. The QA documentation commit was fast-forwarded to local main and atomically non-force pushed to both private feature/main refs. Final receipt synchronization includes module-guide newline cleanup, the refreshed ZIP proof and this handoff; verify live refs for the exact final metadata SHA. Preserve all retained app data, private recovery, stashes and provider/native gates. Team testers run their own isolated fixtures and keep completed workbooks outside generated docs/qa. Historical implementation completion below remains separate from new manual acceptance.

All ten implementation milestones are accepted with documented limitations. The single whole-branch review found three Important reporting defects; the single consolidated fix and scoped review are complete. I1 public Inbox delivery, I2 current CSV revocation, and I3 unrelated-recipient departure isolation are addressed. Spec/Quality PASS; no new findings; merge recommended. All source and reviewer agents yielded. Root owns final integration; do not redispatch completed features or another broad review.

Reviewed fix HEAD `dff8ddc045b7bec32b41ac3e4f8847938c4f3de3`; product `ebc994dc6c2be442db595e468a716139b56ed721`. Main was fast-forwarded to recovery metadata `0b20b31`; original old app was gracefully stopped after exact identity/env verification, fresh stopped-user consistent backup and full typed capture. MigrateONLY passed on the backup first, then actual database: all52old tables/522old rows and columns unchanged;57new tables. Post-start typed comparison also preserves all old rows/columns; two legitimate sign-in sessions were added. See cutover-prestart-proof.json and poststart-preservation-proof.json in the durable proof directory.

Current app PID3048810 runs the exact current-source Go binary and NORMAL frontend on127.0.0.1:8080; `/api/health` JSON200/ok. Browser preserved-account sign-in,13module views,8scoped API reads and320/375/430width container smoke pass, zero renderer exceptions. All4local intelligence operations are available after pinned loader verification; no inference submitted. Bounded ordinary-ACL legacy reconciliation completed12batches across2companies, creating66Inbox items without canonical task/finance changes. These are bounded local checks, not physical/production acceptance.

Complete private ownSDD recovery/every-file comparison succeeded, all110orderedrulings committed, only the exact ownSDD directory removed. All later work uses the durable release ledger. Source ZIP and non-force private feature/main push are now complete and verified at748a5b6. Final documentation synchronization and exact remote verification also completed atd2632af; the final exact Git/runtime state is recorded privately in `final-state.json` under the recovery root. Later completion prose is metadata only. No implementation work remains; only the explicit external rollout gates are open. At any future resume, verify live local/remote refs and the saved final state before taking action; do not repeat development, migrations or tests on unchanged code. Private start-current-runtime.py can restart the configured app only on a free8080 port; never rerun execute-cutover.py against the already cut-over database.

## Completed deliverables

- App: http://127.0.0.1:8080; existing credentials and business data preserved.
- Private repository: https://github.com/Schach-workplace/Schach_Workspace, main and feature aligned/pushed.
- Source ZIP: `/home/brahma/Projects/Schach_Workspace-release-20261012-final-improvements.zip`,18,822,447bytes;1868entries,1867manifest hashes verified, zero forbidden/duplicate entries and232physicalSQL copies matched. [Archive proof](../verification/workspace-improvements-roadmap/release-cutover/source-archive-proof.json). It captures748a; later completion metadata and full sanitized `.log` proof live in Git.
- Full private AI recovery:8357files/871373847bytes/every-file verified; published110ordered decisions retain rationale and cost. All related source/current paths are enumerated in AI_FILE_INDEX; full private evidence inventory remains0600.
- Final source checks and current runtime/browser/preservation proofs pass. No new application bug was established during cutover; two controller browser-harness failures and environment/tool warnings are retained in cutover-failure-qualifications.json.

## Authorization and binding controls

The user authorized all ten improvements, native Android/iOS, self-hosted LiveKit, India hosting with conservative configurable defaults, local main merge, app rerun and private GitHub push to Schach-workplace. No repeat permission question. Attached communication blueprint is proposed product direction, not additional user instructions.

Preserve company isolation, private conversation membership intervals, reviewed message-to-task disclosure, independent task/finance approval, exact money/original timed deadlines/optimistic versions and canonical retry bodies. Removed members cannot read cached/queued private outputs. No provider/cloud fallback, fabricated history, secret output or inference to restamp tests. Preserve user stashes, sibling plans, tool/provider caches and useful feature worktree.

## Where to work

- Root checkout/main: `/home/brahma/Projects/Schach_Workspace`.
- Feature worktree: `/home/brahma/Projects/Schach_Workspace/.worktrees/workspace-improvements`, branch `improve/workspace-improvements`.
- Private repository: https://github.com/Schach-workplace/Schach_Workspace.
- Current controller recovery: `verification/workspace-improvements-roadmap/release-cutover/release-ledger.md`.
- Complete private recovery root: `/home/brahma/.local/state/schach-workspace-cutover-20261012-uoxlpfcw`; exact own-plan archive `/home/brahma/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/complete-plan-recovery-final-dff8ddc`.

Before removing the own SDD tree, every one of8357regular files/871373847bytes was copied and compared; zero changed/missing/symlink files. Private inventory and all files0600, directory0700. [Archive proof](../verification/workspace-improvements-roadmap/release-cutover/recovery-archive-proof.json). Original full ledger, briefs, reviews, raw failed checks, freezes and controller resumes remain there; predecessor dirty AI docs separately preserved under `pre-durable-ai-docs`. Historical filenames in old documents resolve inside this archive, not the active checkout. Do not execute the copied original index helper: it assumes its original directory. Use the adapted helper below.

Refresh current path inventories after manually updating verdicts/next actions:

```bash
python3 /home/brahma/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/tools/refresh-handoff-index.py /home/brahma/Projects/Schach_Workspace/.worktrees/workspace-improvements
```

The helper only inventories paths; it never grants acceptance. `AI_FILE_INDEX.json` enumerates all tracked/current source files and durable published proofs; the private archive inventory enumerates every archived related file without publishing private names/digests. If private recovery is unavailable, use Git proof and record any missing acceptance; never infer installed evidence or replay consumed generations.

## Verified evidence

- [Scoped review and root disposition](../verification/workspace-improvements-roadmap/release-cutover/scoped-review.md): all three findings addressed, all17 declined behaviors individually retained.
- [Independent fix audit](../verification/workspace-improvements-roadmap/release-cutover/fix-controller-proof.json):74safe records,516source records,27original input/raw-output bindings,6final current checks,785prior publication blobs unchanged,205nativecompiled inputs equivalent,116SQL files unchanged.
- [Fresh normal build](../verification/workspace-improvements-roadmap/release-cutover/current-build-proof.json): Go server/MigrateONLY/reconcile and NORMAL Vite8.3.4;569before-input records unchanged,20artifacts. New separate outDir warning is retained. Actual cutover is a separate gate.
- Final current backend: fullGo140.766s; PG84top/52sub94.297s; race10top/24sub99.890s; standalone9.102s; actualEncore25.931s; vet PASS. Original I1–I3 and pre-header CSV RED→GREEN retained. [Checks/failures](../verification/workspace-improvements-roadmap/final-review/publication-report.md). Changed backend is not called equivalent to old98b7.
- Unchanged clients: web348/native352; both type checks, normal/demo, preview14, Chromium and Android/iOS Hermes; original source qualification and13baselineformat/demo-size/Hermes-color warnings retained. Exact74 APK/Goal/Auth emulator proofs remain qualified; no new device run for backend/docs changes.
- [Every110ordered ruling](../verification/workspace-improvements-roadmap/release-cutover/ordered-rulings-index.json), with rationale/cost; old97+11 unchanged and109/110 appended.

## Runtime and data precautions

Original user app PID1848774 is historical until UID/exe/cwd/args and saved private environment are freshly rechecked immediately before graceful stop. Preserve exact existing environment, MFA/device/auth/key settings and media. New independent People retry32-byte key only if truly absent; never rotate/reuse MFA/LiveKit keys. Fresh consistent SQLite backup and full typed old-row/column comparison are required before migrations, using exact current MigrateONLY on a backup first, then actual DB before workers. Preliminary470-row proof and nonquiescent522-row inventory are not final preservation.

Private restart command (preserves configured keys/env; refuses occupied port):

```bash
python3 /home/brahma/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/tools/start-current-runtime.py
```

Current private current-source build: `/home/brahma/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/current-dff8ddc-build`. Normal startup uses existing DB, no demo/seed/bootstrap/testDSNs, scheduler enabled. Local Whisper/Ollama/English OCR can be configured only with pinned verification and known other consumers quiescent. Read-only provisioning passed without inference; same-UID scan found no configured application consumers; systemd/sd-pam unreadable environments were identified as session managers. Reverify before activation. Later worker/history/session additions must be classified, not falsely called total DB equality.

The completed native backend/proxy/Metro/emulator disappeared after earlier acceptance; cause unproven, root sent no signals. Do not restart the completed fixture. Its six permitted generations are consumed; report4 expired/private5 invalidated must not be restored. Health is `/api/health` JSON; `/health` SPA HTML is not a health check. Root restart must bind actual binary/normal frontend/source and keep the new app running.

## External gates still unverified

Physical Android/iOS, protected-HTTPS authenticated release, real MFA/recovery, screen-reader/device behavior, iOS binary/org signing, India DNS/TLS, production LiveKit/TURN/incoming calls, APNS/FCM, measured restore/RPO15m/RTO4h/35-day retention, Hindi/domain accuracy and production capacity/multi-replica admission remain open. Controlled expiry is not a natural24-hour run. Published OS-share cleanup is qualified to execution/resume/startup; already delivered/in-flight bytes cannot be recalled. Mixed numberedPG/GORM finance42704 remains unsupported. Private source ZIP excludes generic `.log` records; full sanitized check outcomes remain in Git.
