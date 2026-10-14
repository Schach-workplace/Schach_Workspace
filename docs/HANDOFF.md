# Handoff: Schach Workspace / "Workspace" (2026-10-14)

Start here. This is the current, self-contained handoff for the next agent. It supersedes the dense history at the top of [AI_HANDOFF.md](AI_HANDOFF.md), which stays as background. **Before acting, verify live state yourself** (section 3). Never treat a process ID or commit written here as permission to act.

---

## 1. What this is

A multi-company work and finance application:
- **Web app:** React + Vite in `frontend/`.
- **Go backend:** `backend/`, with an Encore adapter in `encore/`; PostgreSQL in production, SQLite for local evaluation.
- **Native app:** Expo / React Native in `mobile/`.
- **Shared logic:** `shared/`.

Modules: Connect (chat and calls), Overview, My work, Tasks, Projects, Calendar, Workload, Goals, Finance, Reports, People, Inbox, Settings.

| | |
|---|---|
| Owner / git user | Nishantschach (`techops@schachengineers.com`) |
| Repository | https://github.com/Schach-workplace/Schach_Workspace (private) |
| Local checkout | `/home/brahma/Projects/Schach_Workspace` (branch `main`) |
| Feature worktree | `/home/brahma/Projects/Schach_Workspace/.worktrees/workspace-improvements` (branch `improve/workspace-improvements`). **Do work here**, then fast-forward `main`. |
| Target deployment | `https://work.schachengineers.com` (self-hosted, India). Not yet deployed as of this handoff, as far as this agent knows. **Ask the owner.** |
| Phone app | Published privately as **Workspace**, app ID `com.schachengineers.workspace`. Not yet built. |

---

## 2. Read in this order

1. This file.
2. [deploy/SERVER_DEPLOYMENT.md](deploy/SERVER_DEPLOYMENT.md): production server guide (admin password is a placeholder).
3. [deploy/MOBILE_APPS.md](deploy/MOBILE_APPS.md): Android/iOS private distribution guide.
4. [../verification/ui-ux-gap-closure-2026-10-12/record.md](../verification/ui-ux-gap-closure-2026-10-12/record.md) and [visual-redesign.md](../verification/ui-ux-gap-closure-2026-10-12/visual-redesign.md): what changed on 2026-10-12/13 and the evidence for it.
5. [SECURITY_AND_LIMITATIONS.md](SECURITY_AND_LIMITATIONS.md), [API_CONTRACT.md](API_CONTRACT.md), [OPERATIONS.md](OPERATIONS.md), [PEOPLE_ADMINISTRATION.md](PEOPLE_ADMINISTRATION.md), [COMMUNICATION_OPERATIONS.md](COMMUNICATION_OPERATIONS.md), [FINANCE_GUIDE.md](FINANCE_GUIDE.md).
6. [`mobile/AGENTS.md`](../mobile/AGENTS.md): **mandatory before touching `mobile/`.** Use Expo SDK 57 docs, never memory; `npx expo install` only; never hand-edit `mobile/ios` or `mobile/android`.
7. QA pack: [qa/README.md](qa/README.md). It has 224 scenarios, **all still NOT_RUN**.

---

## 3. Live state at handoff (re-verify)

**Git** (as of 2026-10-14):
- `main` = `improve/workspace-improvements` = `origin/main` = `origin/improve/workspace-improvements` = **`083ed57`**. Clean tree.
- Two user stashes exist: `m10-paused-for-m9-round5-20261011` and `m10-paused-for-m9-n2-20261011`. **Preserve them; never drop or pop them.**
- Never force-push. Pushes to the private repo are authorised for development work.

Verify:
```bash
cd /home/brahma/Projects/Schach_Workspace
git status --short; git log --oneline -3; git ls-remote origin main improve/workspace-improvements; git stash list
```

**Processes on this machine:**

| Port | What | Owner | Action |
|---|---|---|---|
| 127.0.0.1:8080 | Older private build (`~/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/current-dff8ddc-build/server`) on `data/schach-demo.db`, serving `frontend/dist` from the main checkout | Earlier release work | **Do not mutate, reset or restart without the owner's say-so.** The owner says this data is demo data and production will start fresh, but leave it alone unless asked. It does **not** include anything after `7db2025` (no rebuild was done). |
| 127.0.0.1:9080 | Disposable fictional QA server. Run dir `~/.local/state/schach-qa/run-SfPVPvry` (own `qa.sqlite`, demo accounts, `ALLOWED_ORIGINS` extended to `http://127.0.0.1:5174`) | Started by the previous agent | Safe to use or stop. Stop by verifying the PID's cmdline contains `run-SfPVPvry/server`, then `kill <pid>`. |
| 127.0.0.1:5174 | Vite dev server (`frontend/`, worktree source) proxying `/api` to 9080; hot reload | Started by the previous agent | Safe to use or stop. Stop: find the `vite --port 5174` node process and kill it. |
| 127.0.0.1:9400 | Encore daemon | Not ours | Leave alone. |

Demo logins (fictional; QA/demo only): `founder@`, `ceo@`, `finance@`, `head@`, `member@schach.demo`, password `SchachDemo!2026`.

**Restart the QA fixture if needed:** a fresh fixture comes from `SCHACH_QA_PORT=9080 bash docs/qa/tools/start-isolated-qa.sh` (builds the current source; refuses 8080). For the existing run dir, `restart.sh` can fail with "Address already in use" for about 60 seconds after a stop: its bind probe has no `SO_REUSEADDR`. Wait, or exec the server directly with the saved `environment.json`.

---

## 4. Owner decisions (binding)

| Decision | Value |
|---|---|
| Production domain | `https://work.schachengineers.com`; **all companies on one server** |
| Existing data | Demo only; **production starts fresh** (no SQLite→PostgreSQL migration needed) |
| First admin | `techops@schachengineers.com`, name "Schach TechOps", role Founder. Password held by the owner (min 12 characters enforced by `backend/platform/auth.go:57`). **Never write it into the repo.** |
| Phone app name | **Workspace** (neutral; used by multiple companies; no "Schach" visible in the mobile app) |
| App ID | `com.schachengineers.workspace` (iOS and Android). Permanent once published. |
| Distribution | **Private:** Apple Business Manager **Custom App**; **Managed Google Play** private app (testing tracks as interim) |
| Mobile server | Built in via `EXPO_PUBLIC_SERVER_URL` in the `preview`/`production` EAS profiles; field hidden; `__DEV__` builds can change it |
| Icon | Neutral placeholder (orange stacked panels + check), `mobile/assets/source/*.svg` → `render.sh`. Owner may supply a final one. |
| Message-to-task | Requires conversation **Publication policy = "Explicit selected publication allowed"** (default is private/deny; only the conversation owner can change it). This is by design. |

---

## 5. Work completed (2026-10-12 → 2026-10-14)

| Commit | Summary |
|---|---|
| `be59655` | Read-only audit, then fixes: web call device reuse, MFA/device states, platform-admin offboarding UI, finance-assistance UX and new UI for duplicate preview, intake download and statement rows/export, a11y toggles, phone search. Mobile: call retry/permissions, Calls picker, dismissible errors, push opt-in, tab icons/badge, attachments, task comments/nudge/time, message-to-task, Overview/Workload/agenda, contrast. Smoke harness refuses 8080. Offboarding contract text corrected. |
| `d5eccc9` | Backend **attention push** worker (`backend/platform/attention_push.go`, **migration 59** `attention_pushes`, mirrored in `encore/api/migrations`). Opaque hint `{eventId, companyId, attentionId}`, send-time re-authorisation, no lock held during the provider call. Mobile deep links to task/expense. Mobile task CSV import/export, Workload filters, Chats pull-to-refresh. SQLite and disposable-PostgreSQL suites passed. |
| `c179547` | **Web visual redesign** of all 13 views and their pop-ups to the house style (new scoped CSS in `frontend/src/styles/*.css`), verified with before/after headless screenshots at 1440/390 and a behaviour-preservation review. |
| `e02ae3f` | Deployment: `compose.production.yaml` (People onboarding keyring, finance-intake and report storage) and Dockerfile creating `/app/intakes` and `/app/reports` (owned, 0700). Image build verified. |
| `083ed57` | Mobile: neutral **Workspace** branding, app ID, scheme `workspace`, `app.config.ts` (replaces `app.json`, optional `GOOGLE_SERVICES_JSON`), `eas.json` profiles, built-in server, placeholder icon/splash (`expo-splash-screen`), Expo patch alignment. |
| (this commit) | This handoff; `docs/deploy/*` guides; `verification/runtime/ui_screenshots.mjs`; UI agent brief. |

**Baseline checks at `083ed57`:**

| Check | Result |
|---|---|
| Web `cd frontend && npx tsc --noEmit && npx vitest run` | pass, 85 files / 393 tests |
| Mobile `cd mobile && npx tsc --noEmit && npx expo lint --no-cache && npx vitest run` | pass, 67 files / 450 tests |
| Mobile `npx expo-doctor` | 21/21 |
| Backend `cd backend && go vet ./... && go test -count=1 ./...` | pass, SQLite (platform about 150 s) |
| Backend on PostgreSQL | Run against a **disposable owned container**, e.g. `docker run -d --rm --name schach-pg-<rand> -e POSTGRES_USER=test_operator -e POSTGRES_PASSWORD=<x> -e POSTGRES_DB=schach_test -p 127.0.0.1::5432 postgres:18-alpine`, then `TEST_DATABASE_URL=postgres://test_operator:<x>@127.0.0.1:<port>/schach_test?sslmode=disable go test -count=1 ./platform/...` (about 590 s). Stop the container afterwards. Never touch the `sqldb-*` Encore containers. |
| `encore/` `go vet` | Fails with `undefined: RunScheduled`. **Pre-existing**: it needs Encore code generation. Not a regression. The real gate is `encore check`, which has not been run. |

---

## 6. Open items and pending owner decisions

**Waiting on the owner:**
1. **Web branding:** the phone app is neutral, but the **web app** sign-in still shows the Schach Engineers logo and "Built for teams that build". Should it go neutral too (multiple companies)? Asked; no answer yet.
2. **Self-service profile edit:** needs a new backend endpoint (none exists). The UI was deliberately not added.
3. **Offboarding reason:** the handler takes no reason. The contract was corrected to match. Adding one means a handler and UI change.
4. **Revoked web device rebinding (review L3):** reusing a stored device id reactivates the same user's revoked row. Sessions stay revoked. Optional backend hardening.
5. **Workload "near capacity" threshold:** 85% was chosen for display; confirm it.
6. **iOS export compliance** (`ITSAppUsesNonExemptEncryption`): left unset; owner's legal call (HTTPS-only, normally exempt).
7. **Store prerequisites:** D-U-N-S, Apple Developer org, Apple Business Manager, Play Console, Managed Google Play enterprise, Firebase, APNs `.p8`, Expo account (`eas init`), privacy policy URL, and a **fictional reviewer account** on production.

**Deployment and runtime work (when the owner deploys):**
- The owner reported **"Calling is not configured"** from phones. LiveKit env vars are empty. Steps: `deploy/livekit.yaml` from the example, `LIVEKIT_API_KEY`/`SECRET` in `.env`, open 7881/tcp and 7882/udp, add `-f deploy/compose.livekit.yaml`. A **TURN** relay will likely be needed for mobile data. Calls have never been tested on real devices or a real server. Full steps: `SERVER_DEPLOYMENT.md` section 10a.
- Push: server needs `FCM_SERVICE_ACCOUNT_FILE` and `APNS_*` (`APNS_BUNDLE_ID=com.schachengineers.workspace`). See `MOBILE_APPS.md` Part 5.
- Backups and one **restore drill** before real use.

**Engineering follow-ups (not started):**
- **Web over plain HTTP:** `crypto.randomUUID` and `crypto.subtle` (retry keys, file hashing) only exist in secure contexts. The web app **must** be served over HTTPS (or `localhost`) for saves to work from other devices. Optionally add a `getRandomValues` fallback for `businessKey`; hashing still needs HTTPS.
- **Mobile visual pass** (the 2026-10-13 redesign was web-only).
- **Unseen populated states** (styled from code only): historical report snapshots, onboarding stages 2–4, captured access decisions, departure responsibilities, assistance history entries.
- `frontend/src/main.tsx` imports `styles.css` after `App`, so global rules override component CSS of equal specificity. Swapping was tested and caused layout shifts; left as is. New CSS lives in `frontend/src/styles/*.css`, scoped by class.
- 224 manual QA scenarios **NOT_RUN**. 16 are DEVICE-gated. Record results in a copy of `docs/qa/execution-log.csv` **outside** `docs/qa/`; never overwrite the distributed templates.
- External gates, all still open: physical Android/iOS (permissions, calls, push, background, accessibility), signed iOS build, HTTPS auth/MFA/recovery on the real domain, LiveKit/TURN, APNs/FCM delivery, measured restore and RPO 15 min / RTO 4 h / 35-day retention (proposed, **not measured**), production capacity.

---

## 7. Binding controls: never regress

- Company isolation and current role/source authority on every request.
- Private conversation membership and history intervals; **leadership rank never grants private-chat access**.
- **Explicit message-to-task disclosure:** preview shows task title + destination audience; confirmation required; confirmation resets on re-preview; the existing-task outcome is disclosed.
- Independent task review (owner can't accept own work) and expense approval/rejection/payment independence (creator can't approve or pay their own expense).
- Exact minor-unit money (`int64`), immutable original commitments, timed deadlines.
- Optimistic versions (409) and **frozen original retry keys/bodies/targets**.
- Revocation of cached, queued and future private outputs; push hints are body-free and re-authorised at send time.
- Goal observations independent from task completion.
- Suggestions never approve work, execute payments or establish outcomes.
- **Call recording and automatic call transcription stay disabled.**

---

## 8. Safety rules for the environment

- **Never** mutate, reset, reseed or restart the 8080 workspace or its database without the owner's explicit request. Never rotate existing keys. Never expose secrets or send private data to external providers.
- UI/QA testing: use only a **disposable fictional** fixture (section 3). `verification/runtime/*` harnesses require explicit URLs and refuse 8080.
- **Process kills:** match the full command line precisely. `pkill -f <pattern>` can kill the shell running it if the pattern appears in its own command (that happened once). The owner's personal Chromium and Edge run on this machine; never kill browsers broadly.
- Disposable PostgreSQL: create your own named container and stop it after; leave `sqldb-*` (Encore) containers alone.
- Preserve stashes, other worktrees, `~/.local/state/schach-workspace-cutover-20261012-uoxlpfcw` (private recovery archive) and the release ZIPs in `/home/brahma/Projects/`.
- Mobile: follow `mobile/AGENTS.md` (Expo SDK 57 docs; `npx expo install`; don't edit generated `ios/` or `android/`).

---

## 9. Useful tools and gotchas

- **UI screenshots:** `WIDTHS=1440,390 node verification/runtime/ui_screenshots.mjs http://127.0.0.1:5174 <outdir> ceo@schach.demo overview calendar ...`. A view can be `route!cssSelector` to click something open first. It writes `report.json` with overflow offenders and runtime errors. Read the PNGs to actually look.
- **Live UI preview against a fixture:** run Vite with `API_PROXY_TARGET=http://127.0.0.1:9080 VITE_API_URL= VITE_DATA_MODE=api npx vite --host 127.0.0.1 --port 5174 --strictPort`. The fixture's `ALLOWED_ORIGINS` must include `http://127.0.0.1:5174`, because the server checks `Origin`.
- If Vite serves blank or stale modules after mass reformatting, `touch` the files.
- Parallel agents: give each one **disjoint files** and new scoped CSS files. Have them **not commit**, and run one behaviour-preservation review over the combined diff (this caught four real issues last time).
- Handoff index helper (path inventory only, grants no acceptance): `python3 ~/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/tools/refresh-handoff-index.py <worktree>`.

---

## 10. Files outside the repository

| Path | What |
|---|---|
| `/home/brahma/Projects/DEPLOY-work.schachengineers.com.md` | Server guide **with the real admin password**. Private; don't copy into Git. |
| `/home/brahma/Projects/MOBILE-APPS-Android-iOS.md` | Same as `docs/deploy/MOBILE_APPS.md` |
| `/home/brahma/Projects/Schach_Workspace-*.zip` | Earlier release and QA archives (preserve) |
| `~/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/` | Private recovery archive and current 8080 build (preserve; mode 0700) |
| `~/.local/state/schach-qa/run-SfPVPvry/` | Disposable QA fixture (deletable once its server is stopped) |

---

## 11. Suggested next actions

1. Confirm with the owner: deployment status of `work.schachengineers.com`, the web-branding decision (6.1), and whether to stop the 9080/5174 fixtures.
2. If deployed: help configure LiveKit (+TURN) and push credentials, then run `MOBILE_APPS.md` Part 4 on real phones and record the results.
3. Build `preview` mobile apps once the owner has an Expo account and Firebase file. Triage real-device findings.
4. Begin the isolated manual QA pack (P0 first) in a fresh fixture; keep run results outside `docs/qa/`.
