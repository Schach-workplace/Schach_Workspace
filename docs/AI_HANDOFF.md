# Schach Workspace AI handoff

Updated UTC 2026-10-11T23:10:55.575350+00:00. Read this document, [AI_CHECKLIST.md](AI_CHECKLIST.md), [AI_FILE_INDEX.json](AI_FILE_INDEX.json), then the [durable release ledger](../verification/workspace-improvements-roadmap/release-cutover/release-ledger.md). Update all four at each material boundary and before a context limit. Verify live Git/process state before acting; historical PIDs are not permission to signal a process.

## Current state and next action

All ten implementation milestones are accepted with documented limitations. The single whole-branch review found three Important reporting defects; the single consolidated fix and scoped review are complete. I1 public Inbox delivery, I2 current CSV revocation, and I3 unrelated-recipient departure isolation are addressed. Spec/Quality PASS; no new findings; merge recommended. All source and reviewer agents yielded. Root owns final integration; do not redispatch completed features or another broad review.

Reviewed fix HEAD `dff8ddc045b7bec32b41ac3e4f8847938c4f3de3`; product `ebc994dc6c2be442db595e468a716139b56ed721`. Later commits contain explicit recovery/release metadata outside that frozen review. Main still `d20063b8063ee1dfd9bec6b4cd7807f4e31bcfa6` and original app on127.0.0.1:8080 at this boundary; cutover and push are pending.

Next: commit the durable recovery metadata, remove only the verified archived own SDD directory, run backup-first cutover, validate actual runtime/auth/browser and retained data, create safe source ZIP, push feature/main without force and verify remote commits. Prepared private `tools/execute-cutover.py` requires accepted scoped disposition and exact old process identity/env; it has NOT run yet. Stop dependent work on concrete preservation/application failure; never reseed/reset or restore blindly.

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

Current private current-source build: `/home/brahma/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/current-dff8ddc-build`. Normal startup uses existing DB, no demo/seed/bootstrap/testDSNs, scheduler enabled. Local Whisper/Ollama/English OCR can be configured only with pinned verification and known other consumers quiescent. Read-only provisioning passed without inference; same-UID scan found no configured application consumers; systemd/sd-pam unreadable environments were identified as session managers. Reverify before activation. Later worker/history/session additions must be classified, not falsely called total DB equality.

The completed native backend/proxy/Metro/emulator disappeared after earlier acceptance; cause unproven, root sent no signals. Do not restart the completed fixture. Its six permitted generations are consumed; report4 expired/private5 invalidated must not be restored. Health is `/api/health` JSON; `/health` SPA HTML is not a health check. Root restart must bind actual binary/normal frontend/source and keep the new app running.

## External gates still unverified

Physical Android/iOS, protected-HTTPS authenticated release, real MFA/recovery, screen-reader/device behavior, iOS binary/org signing, India DNS/TLS, production LiveKit/TURN/incoming calls, APNS/FCM, measured restore/RPO15m/RTO4h/35-day retention, Hindi/domain accuracy and production capacity/multi-replica admission remain open. Controlled expiry is not a natural24-hour run. Published OS-share cleanup is qualified to execution/resume/startup; already delivered/in-flight bytes cannot be recalled. Mixed numberedPG/GORM finance42704 remains unsupported. Private source ZIP excludes generic `.log` records; full sanitized check outcomes remain in Git.
