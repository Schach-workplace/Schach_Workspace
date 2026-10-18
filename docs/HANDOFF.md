# Handoff: Schach Workspace / "Workspace" (2026-10-18)

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
| Target deployment | `https://work.schachengineers.com` (self-hosted, India). Owner reports configured on 14 October 2026; read-only trusted-HTTPS API health returned JSON200/ok. Authentication/calls/push/deployment settings have not been independently qualified. |
| Phone app | Intended private distribution as **Workspace**, app ID `com.schachengineers.workspace`. Expo team linked; free Expo Go core-screen mode added16October (section14), physical phone execution pending. No standalone phone build; signed-native release gates remain. |

---

## 2. Read in this order

1. This file.
2. [deploy/SERVER_DEPLOYMENT.md](deploy/SERVER_DEPLOYMENT.md): production server guide (admin password is a placeholder).
3. [deploy/EXPO_GO_IPHONE.md](deploy/EXPO_GO_IPHONE.md): owner-approved free Linux-to-iPhone native-screen testing inside Expo Go, with calls/push unavailable. For signed standalone release, read [deploy/NATIVE_TESTING_ROLLOUT.md](deploy/NATIVE_TESTING_ROLLOUT.md): start here for the already-deployed web/backend; then [Android](deploy/ANDROID_TESTING.md), [iPhone from Mac](deploy/IOS_TESTING.md), and [private-store reference](deploy/MOBILE_APPS.md).
4. [../verification/ui-ux-gap-closure-2026-10-12/record.md](../verification/ui-ux-gap-closure-2026-10-12/record.md) and [visual-redesign.md](../verification/ui-ux-gap-closure-2026-10-12/visual-redesign.md): what changed on 2026-10-12/13 and the evidence for it.
5. [SECURITY_AND_LIMITATIONS.md](SECURITY_AND_LIMITATIONS.md), [API_CONTRACT.md](API_CONTRACT.md), [OPERATIONS.md](OPERATIONS.md), [PEOPLE_ADMINISTRATION.md](PEOPLE_ADMINISTRATION.md), [COMMUNICATION_OPERATIONS.md](COMMUNICATION_OPERATIONS.md), [FINANCE_GUIDE.md](FINANCE_GUIDE.md).
6. [`mobile/AGENTS.md`](../mobile/AGENTS.md): **mandatory before touching `mobile/`.** Use Expo SDK 57 docs, never memory; `npx expo install` only; never hand-edit `mobile/ios` or `mobile/android`.
7. QA pack: [qa/README.md](qa/README.md). It has 224 scenarios, **all still NOT_RUN**.

---

## 3. Live state at handoff (re-verify)

**Git baseline at the start of the 2026-10-14 continuation** (re-verify live refs):
- `main` = `improve/workspace-improvements` = `origin/main` = `origin/improve/workspace-improvements` = **`318446b`**. Both trees and remotes were clean/aligned before this continuation. The neutral-web product commit is `8b8e8df`, fast-forwarded to main and non-force pushed to both private branches. Final handoff metadata follows it; use live Git for the exact latest HEAD. Read live HEAD rather than treating this baseline as the latest commit.
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
| `318446b` | This handoff; `docs/deploy/*` guides; `verification/runtime/ui_screenshots.mjs`; UI agent brief. |

**Recorded baseline checks at `083ed57` (historical; current web checks below):**

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

**Owner decisions and remaining prerequisites:**
1. **Web branding:** owner approved neutral Workspace branding on 14 October 2026; implemented in this continuation. Native orange panels/check mark reused; sign-in/sidebar/loading/favicon/title/footer neutral. Company names are unchanged.
2. **Self-service profile edit:** owner deferred for discussion; needs a new backend endpoint (none exists). No implementation started.
3. **Offboarding reason:** owner deferred for discussion; the handler takes no reason. Adding one means a handler and UI change. Existing contract preserved.
4. **Revoked web device rebinding (review L3):** reusing a stored device id reactivates the same user's revoked row. Sessions stay revoked. Optional backend hardening.
5. **Workload "near capacity" threshold:** owner deferred for discussion; existing 85% display threshold preserved.
6. **iOS export compliance** (`ITSAppUsesNonExemptEncryption`): left unset; owner's legal call (HTTPS-only, normally exempt).
7. **Store prerequisites:** on14October the owner reported Expo/EAS and Apple Developer accounts not ready; on15October Expo team project is linked (section13), while paid Apple membership remains absent and the owner requires zero additional cost. Fastest immediate route: current HTTPS web app on both phones. Native recommendation: company-owned Expo setup → Android preview APK; Apple organisation/D-U-N-S enrolment in parallel → registered-phone ad hoc iOS preview. Intended private stores remain unchanged. Other readiness remains unknown: D-U-N-S, Apple Developer org, Apple Business Manager, Play Console, Managed Google Play enterprise, Firebase, APNs `.p8`, Expo account (`eas init`), privacy policy URL, and a **fictional reviewer account** on production.

**Deployment and runtime acceptance:**
- Earlier owner report was **"Calling is not configured"**. On 14 October the owner reports the server configuration is now complete. Do not assume empty LiveKit variables or reconfigure their server. Read-only HTTPS health passes; real LiveKit/TURN and push/auth are still unverified. If further setup is actually needed, see `deploy/livekit.yaml` from the example, `LIVEKIT_API_KEY`/`SECRET` in `.env`, open 7881/tcp and 7882/udp, add `-f deploy/compose.livekit.yaml`. A **TURN** relay will likely be needed for mobile data. Calls have never been tested on real devices or a real server. Full steps: `SERVER_DEPLOYMENT.md` section 10a.
- Push acceptance is still pending. Required configuration includes `FCM_SERVICE_ACCOUNT_FILE` and `APNS_*` (`APNS_BUNDLE_ID=com.schachengineers.workspace`). See `MOBILE_APPS.md` Part 5.
- Backups and one **restore drill** before real use.

**Engineering follow-ups (not started):**
- **Web over plain HTTP:** `crypto.randomUUID` and `crypto.subtle` (retry keys, file hashing) only exist in secure contexts. The web app **must** be served over HTTPS (or `localhost`) for saves to work from other devices. Optionally add a `getRandomValues` fallback for `businessKey`; hashing still needs HTTPS.
- **Mobile visual pass:** shared foundation/sign-in/module directory implemented in section15; workflow-specific Work/Connect/Finance and remaining screens are M2–M5, still pending device qualification. The 2026-10-13 redesign was web-only.
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
| `/home/brahma/Projects/MOBILE-APPS-Android-iOS.md` | Earlier external copy; use current `docs/deploy/` guides in Git |
| `/home/brahma/Projects/Schach_Workspace-*.zip` | Earlier release and QA archives (preserve) |
| `~/.local/state/schach-workspace-cutover-20261012-uoxlpfcw/` | Private recovery archive and current 8080 build (preserve; mode 0700) |
| `~/.local/state/schach-qa/run-SfPVPvry/` | Disposable QA fixture (deletable once its server is stopped) |

---

## 11. Current continuation checkpoint — 14 October 2026

Owner-approved neutral web branding is implemented and reviewed. Source base318446b; product commit `8b8e8dff0969f67df119437d6cc8a01aa3e1111a` is merged/pushed on both branches. Subsequent handoff-only metadata has the same product behavior; check live Git for its latest HEAD. Changed product files: frontend/src/App.tsx, styles/branding.css, index.html, public/favicon.svg and workspace-mark.svg. Offline title/compiled preview updated through scripts/make-preview.mjs. No backend/native API, business handler, schema, provider, 8080 runtime or real company data change.

Evidence: [neutral-web record](../verification/web-neutral-2026-10-14/record.md) and [result](../verification/web-neutral-2026-10-14/result.json). Baseline/current full web85files393tests PASS, tsc PASS, changed-web Prettier PASS, normal/demo builds PASS with documented warnings. Actual login/Overview screenshots1440/390/320, collapsed desktop1440 and open phone navigation390/320 have zero recorded overflow/exceptions; root inspected the images. One independent read-only preservation review Spec/Quality PASS, no findings. New native/device/backend suites were not repeated for unchanged source.

Failures and classification: QA validator hard-coded116files failed against actual118 mirrored files through59; corrected to validate nonempty identical paired contiguous inventory (RED/GREEN). Preview harness failed its stale visible-text selector both on this source and a separately compiled unchanged318 baseline; corrected to the existing icon's accessible label, then14compiled checks PASS/no external requests. These are tooling/harness issues, not application regressions. Full frontend format:check still fails on the same10pre-existing files as unchanged318; changed web files pass and no unrelated mass formatting was done. Single-chunk demo-size, private normal-outDir and VM experimental warnings retained. All224 manual scenarios remain NOT_RUN.

Read-only production `/api/health` returned200/ok through trusted HTTPS. Owner reports configuration complete; no deployment, credential inspection, production login, calls/push or business mutations performed. No phone/cloud/store build/account creation performed. Existing8080PID3048810, QA9080PID1182821, Vite5174PID1176363 and unrelated Encore9400PID2548856 were verified and left running; recheck identity before any action. Only own short-lived Chromium process groups were started/stopped. Private builds/logs and baseline source are under ~/.local/state/schach-web-neutral-20261014/run-gktohwro; sanitized screenshots/check outputs are in Git.

### Next action

1. Git publication is complete for product commit `8b8e8df`; keep the final handoff metadata aligned with both branches. No production update or8080restart was performed.
2. Begin a fresh isolated P0 manual QA run; record execution outside generated docs/qa. Include unseen populated report/onboarding/access/departure/assistance states. Do not confuse this bounded browser/preview evidence with the224manual case run.
3. Follow the 15 October native-guides checkpoint below. Owner creates a company-owned Expo account/project for the first Android preview APK; Apple Developer organisation/D-U-N-S in parallel. The owner has a Mac, but its model/macOS and iPhone OS are unknown. Full unchanged iOS app requires a paid team supporting push; free Personal Team is not a reliable signing route. No cloud build until accounts/authorised access are ready. Native push/calls require actual physical-phone tests.
4. Discuss profile editing, offboarding reason and workload threshold before implementing them. Mobile visual pass and deployment auth/MFA/recovery/calls/push/restore/capacity gates remain open.


## 12. Native guides checkpoint — 15 October 2026

**Request:** push to main and include end-to-end Android/iOS testing and deployment guides, planning around the already-deployed web. Initial Git was clean/aligned on main, feature and both remote branches at `72c949c475c310dca6f856c322093442720acc05`. Guide commit `5d2c7470474f8395a9a00f8826841652962c92b6` was fast-forwarded into main and atomically non-force pushed to both branches; matching remote refs and clean trees were verified. Final publication metadata follows that guide commit; use live Git for its latest HEAD. Product behavior remains `8b8e8df`.

**Changed files:** README.md, docs/deploy/MOBILE_APPS.md and new [native rollout](deploy/NATIVE_TESTING_ROLLOUT.md), [Android](deploy/ANDROID_TESTING.md) and [iOS/Mac](deploy/IOS_TESTING.md) guides; this handoff, docs/AI_FILE_INDEX.json and [documentation verification](../verification/native-guides-2026-10-15/record.md). The index inventory names the pre-commit source head and verifies paths only, not runtime acceptance.

The guides cover company-owned account/project association (dynamic app config), clean source/quality checks, Android standalone APK installation, Mac/Xcode USB development install and Metro, iOS ad hoc registration/TestFlight, direct FCM/APNs, signing/update continuity, private store release, the existing 224-case pack and a native acceptance sequence, staged rollout/rollback and sanitized evidence. They distinguish local fictional QA from narrow production pilot integration. Existing server bootstrap is explicitly not repeated. A new server release is separate work if actual API compatibility fails.

Important verified source constraints: preview/production build in the live HTTPS origin; current iOS notification plugin injects a push entitlement so free Personal Team can fail signing; the backend has one process-wide APNS_SANDBOX setting and cannot mix sandbox/production device tokens. Do not flip live APNs for local debug tests. Android APK/Play signatures can differ. iOS background/system incoming-call behavior remains a device gate. No promise of CallKit/PushKit support, provider delivery, store approval or account timing is made.

**Evidence and limits:** see the verification record for exact documentation checks and fresh mobile typecheck/lint results. Application code, package locks, schemas, native config/profiles and generated native projects are unchanged. No APK/IPA/cloud build, account creation, store submission, production authentication/business mutation or server deployment was performed. All 224 distributed manual scenarios remain NOT_RUN. Historical suites/failures in section11 remain qualified there, including the unchanged frontend-format baseline failure and unexecuted Encore runtime check.

**Environment:** existing8080PID3048810, QA9080PID1182821, Vite5174PID1176363 and unrelated Encore9400PID2548856 were observed listening and left alone; no runtime restart/kill or database action. Two stashes and other worktrees preserved. Recheck process identity before future actions. Only a bounded read-only documentation reviewer and short-lived documentation/tooling checks were started for this checkpoint.

**Exact next action:** owner prepares company Expo project and paid Apple organisation signing, records Mac/Xcode/iPhone compatibility, and supplies authorised build access through normal secure login. Follow Android section2/3 for the first standalone APK and iOS section2–5 for the Mac/registered-phone route. Execute applicable isolated P0/native acceptance tests with fictional users, then coordinate a narrow live pilot against the actual deployed API. Push/calls/store/device/restore/capacity remain open until observed. Profile editing, offboarding reason and the85% threshold remain deferred. Do not deploy/reseed the web server merely because new client documentation was pushed.


## 13. Expo project-link checkpoint — 15 October 2026

Owner now uses only Linux/Windows and requires zero additional cost. They created Expo projects personally and under a team; the latest supplied project is **@nishantjaiswals-team/workspace**, UUID `84ab66ee-3a5a-487b-8612-12fac0454b1c`. Apple paid membership remains unavailable/unconfirmed. The earlier Expo-not-ready status is historical. Do not create more projects by repeating `init`.

EAS could create the projects but could not edit dynamic app.config.ts. Added the team owner and project ID, preserving existing extra/eas metadata, permanent app IDs and server/build profiles. The personal project is unused and preserved. Actual Expo config resolution reproduced missing metadata before and passed after; read-only authenticated EAS CLI24.14.0 `project:info` confirms the exact team project. CLI deprecation warnings are separately classified tool dependency warnings, not the root failure. No forced dependency upgrade or package/lock change.

Files: mobile/app.config.ts, this handoff/index and [verification record](../verification/expo-project-link-2026-10-15/record.md)/result. Fresh mobile quality checks and independent read-only review are qualified in that record. No new cloud build, paid service action, provider/server/configuration change, production mutation, generated native project edit, UI or business-handler change. All224 manual scenarios remain NOT_RUN. Preserve running processes, two stashes and worktrees.

Next action: main checkout/mobile → `npx eas-cli@latest project:info`. Native iPhone ad hoc installation still requires paid Apple membership; do not start that build or assume Expo project creation removed this gate. For immediate zero-cost iPhone use: existing HTTPS site in Safari → Add to Home Screen. Local native Android testing is an option if the owner has an Android phone and sets up its build tools. Future paid/native rollout remains the guides' conditional path; do not redeploy the web.


## 14. Free Expo Go core-screen checkpoint — 16 October 2026

**Current owner decision:** Linux/Windows only, zero additional account/build fees. The owner explicitly accepts calls/push being unavailable and has confirmed **native screens inside Expo Go are fine**. This supersedes their earlier demand for calls/push and a standalone icon. Do not keep instructing them to buy Apple membership or retry `eas device:create` for this mode. Full standalone distribution remains a separate conditional path. Apple login eventually succeeded in owner logs, but no eligible developer team was returned; no Apple membership is established. Expo project association remains the existing team UUID.

**Implemented:** runtime-specific CallRuntime boundary prevents evaluating LiveKit/Calls in Expo Go, root/tab route use it; type-only Notifications import/native-only async setup and disposal, explicit Go push denial with token-free device registration retained; Account unavailable copy retains security/device controls. Existing core native screens/API controls stay in use. `cd mobile && npm ci && npm run start:go` starts actual Expo Go on LAN and defaults the API origin to the already deployed HTTPS server. No separate Workspace icon and Metro must remain reachable. Native custom builds keep calls/push.

**Files/evidence:** [launch guide](deploy/EXPO_GO_IPHONE.md), mobile/src/CallRuntime.tsx, Workspace.tsx, AccountScreen.tsx, root/Calls route, focused tests, testSetup/vitest config, scripts/start-expo-go.mjs, package/lock, linked READMEs/deploy guides and [plan](superpowers/plans/2026-10-16-expo-go-testing.md). [Verification](../verification/expo-go-2026-10-16/record.md) and result bind actual checks/source hashes. Baseline4095f03:67files450tests PASS. New startup/push/UI cases observed RED then GREEN; final68files455tests, typecheck/lint PASS; doctor21/21. Actual iOS Metro manifest/bundle200 and both Android/iOS Hermes exports PASS; not physical-device acceptance. One independent source/behavior review Spec/QualityPASS, no critical/important findings.

**Dependency/failure classification:** main and feature both reproduced doctor20/21 due to6pre-existing SDK57 patch mismatches; aligned installed packages via npx expo install --fix without a major SDK/RN change. npm reports32unresolved vulnerabilities12moderate20high, not waived; no force fix/security clearance. Initial command-CWD issues and launcher offline/LAN conflict corrected. Missing-effect dependency warning fixed; final lint clean. Offline manifest asset-schema abort and color-environment export warnings remain qualified in the record. All224 distributed manual scenarios stay NOT_RUN.

**Processes/data:** temporary verification Metro19016 was started/stopped through its own session; private files under ~/.local/state/schach-expo-go-20261016 (0700). No APK/IPA/EAS build, Apple/provider account action, real API login/data mutation, generated native edit or server redeployment. Existing Encore9400PID53856 was observed and left alone;8080/9080/5174 were not listening. Recheck identity/live state rather than old PIDs. Preserve both stashes and other worktrees.

**Next action:** owner installs compatible SDK57 Expo Go on the iPhone, uses same trusted LAN, opens the QR from the main checkout's start:go command, verifies work.schachengineers.com and signs in with an authorized test account. Execute the new phone checklist, especially auth/company revocation, attachments/voice-note/share/keyboard/UI. Calls/push are skipped by design. Physical phone launch is still unverified. A ready main Metro session, if retained, is recorded below; otherwise run the launcher. Leave production web and provider configuration untouched.


**Publication and ready local session:** product commit `e62d354` was fast-forwarded into main and atomically non-force pushed to main and improve/workspace-improvements. Main mobile `npm ci` passed with the same32 unresolved npm warnings. A main-checkout Metro is intentionally left running for the owner's scan: PID113183, port8081, command `/home/brahma/.local/share/mise/installs/node/24.14.0/bin/node /home/brahma/Projects/Schach_Workspace/mobile/node_modules/expo/bin/cli start --go --port 8081`, terminal session45392. Observed LAN address `exp://192.168.0.9:8081` (may change after network/restart). Same-LAN iPhone entry page: `http://192.168.0.9:8081/_expo/loading?platform=ios`, then choose Expo Go. CLI reports Using Expo Go. Main online manifest and iOS bundle returned200; LAN manifest advertises192.168.0.9, app icon PNG returned200. Online icon-schema abort was not reproduced; color warning persists. A loading-page probe without a platform header/query returned500; corrected `?platform=ios` returned200 (probe requirement, not core app failure). Private evidence is under the existing0700 directory. The main launch does not demonstrate a physical phone run. Recheck exact PID/command before stopping; use its terminal Ctrl+C, never broad pkill. Encore9400PID53856 remains untouched. Final publication metadata may follow the product commit; use live Git for HEAD.


**Expo Go account/network follow-up — 16 October 2026:** the owner encountered a LAN timeout. Kernel logs directly showed UFW dropping TCP8081 attempts from192.168.0.3; Metro was healthy, IP unchanged. A narrow Wi-Fi/LAN allow command was provided for the owner to run with sudo; do not claim agent-applied firewall changes. The owner subsequently reached Expo Go's account check and requested `nishantjaiswal0`. After their local login, `npx expo whoami` returned exactly `nishantjaiswal0`. The old owned Metro PID113183/session45392 was stopped via its own Ctrl+C and replaced by main Metro **PID217158/session87967**, same command/port8081 and LAN address. CLI reports Using Expo Go; LAN iOS manifest and explicit-platform launch page both returned200. Current owner action: reopen `http://192.168.0.9:8081/_expo/loading?platform=ios` on the iPhone, choose Expo Go signed in as nishantjaiswal0, then retry. Full physical app launch remains unconfirmed. No product/config/project-ownership/server-data changes. Old PID/session notes above are historical; recheck before stopping anything.


## 15. Mobile-first experience work — 18 October 2026

Owner requested an in-depth plan followed by execution and made iOS/Android UI/UX the priority. Baseline6a3cf6c, existing feature worktree. [Spec](superpowers/specs/2026-10-18-mobile-experience.md), [plan/checklist](superpowers/plans/2026-10-18-mobile-experience.md), [evidence](../verification/mobile-experience-2026-10-18/record.md). Roadmap sequences shared mobile foundation, Work/Inbox, Connect, finance/reports, remaining journeys and device pilot before growth/knowledge/integrations. Deferred product decisions remain deferred.

Task1 adds shared theme,48x48 actions/52-height inputs and a presentational WorkspaceFrame around the original controller. Company selection/error callbacks and actor/company body key preserved; preserved background children are now hidden in both scroll modes. Focused15tests/typecheck/lint PASS after RED; baseline68files455tests PASS with bounded thread workers. First next action: complete Task2 sign-in/tab presentation, Task3 grouped module discovery, fictional component screenshots, full mobile checks/exports and independent review. No backend/business/provider/configuration change. Keep live owner Metro and unrelated runtimes untouched; no physical device result claimed.

**Task2 checkpoint:** keyboard-safe sign-in frame, visible labels/autofill/password visibility and one pending request; optional MFA/recovery expands explicitly after screenshot review. Existing server selection and successful secret clearing retained. Focused4files19tests and mobile typecheck/lint PASS. Shared tab colors/type updated with original tabs/access/badges retained. Task3 grouped directory tests6PASS; fictional RN Web preview uses no backend and12layout probes pass, with physical native gates unchanged. Next: finish visual evidence/exports/full tests and independent combined review before integration.

**Task3/source checkpoint:** grouped searchable module directory retains original routes and company-qualified dispatch, adds discoverable Calendar/Workload/authorized Overview and resets search on actor/company/policy change. Missing work does not grant company tools; Account/history remain reachable. Current source mobile70files472tests, focused31tests, typecheck/lint and Android/iOS Hermes JS exports PASS. Twelve fictional RN Web layout scenarios inspected at320/390/430; no runtime errors/external requests/uncontained overflow. [Device checklist](../verification/mobile-experience-2026-10-18/DEVICE_CHECKLIST.md) adds15NOT_RUN cases; original224 templates unchanged. Broader M2–M9 remain pending. Final independent review/publication still pending at this checkpoint. Current processes: own fictional preview5186PID3935968/session57339 during review; unrelated Encore9400PID2489241 untouched;8080/8081/9080/5174 not listening when checked. Do not infer old Metro PIDs remain live.

**Independent review:** no Critical/Important findings, ready-to-merge source verdict. Both minor verification findings fixed/confirmed (overflow failure predicate; synchronous rapid-submit regression test proven RED with removed guard then GREEN after exact source restoration). All9 product hashes unchanged from full70files472tests and native JS export source. Fresh typecheck/lint and12layout probes PASS. Physical/device/provider/backend/runtime gates remain pending. Next operational action: authorized fast-forward of clean main and non-force push of both branches; preserve feature worktree/stashes. After integration, start M2 with observed Work/Inbox phone flows and its own detailed task plan.

**Final M1 publication:** reviewed/source checkpoint642b176 was fast-forwarded into clean main, tested on main (70files472tests PASS66.04s), and atomically non-force pushed to main and improve/workspace-improvements. Subsequent metadata carries the same nine product hashes; use live Git for latest HEAD. Both stashes/worktrees preserved. Own fictional preview5186 stopped through its own terminal; no app8080/8081 listener was started/reset. Unrelated Encore9400PID2489241 left untouched. GitHub push reported4existing dependency alerts (2high,2moderate); no new audit/clearance. Physical15additional and224existing cases remain NOT_RUN.

**Exact next action:** read the M2 brief in the current plan, inspect WorkScreen/TaskDetailScreen/TaskCollaboration/AttentionInbox/DeadlinePicker and capture current fictional task/review flows. Write M2's scoped executable plan, then improve Work/Inbox priorities, task hierarchy, labeled progressive forms and error/unknown retry states with the original handlers. Keep frozen attempts, source/company authority, independent decisions and original timed deadlines. Execute the new physical checklist when the owner has supported phones; native keyboard/tabs/providers are still unqualified. Continue UI work before M7growth; no server/bootstrap/provider or deferred-policy change. The mobile app can be started locally through mobile/npm run start:go; no Metro is left running by this task.

## 16. Premium mobile continuation — 18 October 2026

This section is the current checkpoint; earlier sections are historical. Source started at `8b0f2c052d0469f3f22ab18283aca1c37413e941` in the existing `improve/workspace-improvements` worktree. The owner requested the remaining mobile-first roadmap, all three engineering/office/field pilots, and the nine UI design skills. The skills are installed from pinned upstream commit `0874a27`; [provenance](../verification/mobile-premium-2026-10-18/skills.json). Existing Expo SDK 57, permanent app identity, packages and lockfiles remain unchanged.

### Implemented and verified locally

- Shared native headings, cards, selectable horizontal filters, readable empty/error states and scrolling headers across Work, task detail, Inbox, Connect, Finance, Reports, Overview, Projects, Calendar, Workload, Planning, Goals, People and Account. Work Focus uses recorded status/owner/deadline facts, not employee scoring.
- Development plans for all three pilots, with career-role catalogs, employee-owned objectives, learning actions, authored evidence and independent mentor feedback. Career roles grant no application permissions. Current owner/mentor authorization has no leadership bypass.
- Knowledge drafts, independent publication, explicit company/selected readers, civil review dates and current-source versioned citations/abstention. Retrieval is literal text matching, not semantic AI or an action executor. No private conversation/task ingestion or external model.
- Reviewed local calendar ICS, exact-minor expense CSV and guidance Markdown exports. Explicit fields/audience/copy consent, fresh authority/version checks and lifecycle guards precede output. No automatic third-party sends, payment, approval or external synchronization.
- Mirrored migrations 60/61, source contracts, operational/security notes and [39 supplemental manual scenarios with three flows](qa/PREMIUM_MOBILE_GROWTH.md). The existing 224-case pack is preserved.

Changed files are located through [AI_FILE_INDEX.json](AI_FILE_INDEX.json) and the [94-entry source/test hash manifest](../verification/mobile-premium-2026-10-18/source-hashes.json). Domain files are `backend/platform/development*`, `knowledge*`, `finance_export*`; shared types/adapters under `shared/growth`, `shared/knowledge`, `shared/integrations`; web `GrowthHub`, `KnowledgeHub`, `CalendarExport`, `ExpenseExport`; native `MobileUI`, `GrowthScreen`, `KnowledgeScreen`, `CalendarExport`, `FinanceExport`, `ReviewedFileExport`, `shareDocument` and the existing module screens. The [execution plan](superpowers/plans/2026-10-18-premium-mobile-execution.md) and [verification record](../verification/mobile-premium-2026-10-18/record.md) contain the scope and acceptance boundaries.

### Evidence and corrected failures

| Check | Observed result |
| --- | --- |
| Mobile | 81 files / 509 tests PASS, 68.50s; typecheck and lint PASS |
| Web | 89 files / 430 tests PASS, 8.98s; typecheck, API/demo builds PASS |
| Offline preview | 14 checks PASS; demo chunk-size/VM warnings retained |
| Native JavaScript | Android and iOS Hermes exports PASS, 34 assets; no signed/device claim |
| SQLite | 426 top-level PASS, 35 SKIP; 593 passes including subcases, 150.121s |
| PostgreSQL 18 | 449 top-level PASS, 12 SKIP; 632 passes including subcases, 558.946s |
| Migrations | 61 contiguous up/down pairs mirror; numbered upgrade/checksum-repeat tests pass |
| Actual isolated Encore | Nine gates PASS: compiler/migrations, 91 TCP API assertions, private cron refusal, socket revocation, bootstrap and restart/session/message persistence, generated-wrapper SDK check |
| Layout | 52 actual RN Web fictional cases, no recorded errors/external requests/uncontained overflow/heading clipping; root inspected PNGs |
| Browser/API | Six actual compiled-web checks PASS: all three growth pilots, independent publication, current citation and 390px fit |
| Source hygiene | 87 changed source/harness files pass Prettier; 166 changed Markdown links resolve; diff check PASS |

Optional provider/load and database-inapplicable skips are explicit in the record. The full historical frontend formatting baseline is not declared clean. No new dependency audit/security clearance is claimed.

Independent mobile/backend reviews preceded a whole-branch integration review. Three Important client findings were fixed: plural Knowledge review route, calendar consent revival after backgrounding, and persisted full drafts adopting newer source versions. Regression tests exercised RED/GREEN, real RAM-hook remounts, frozen original retry context and deliberate latest-source reset. One scoped re-review passes with no remaining blockers. [Review](../verification/mobile-premium-2026-10-18/review.md); [corrections](../verification/mobile-premium-2026-10-18/review-fixes.md).

Other failures are classified in the record: actual enlarged-text overlap/raw native empty-text rendering fixed; invalid synthetic expense fixture replaced with real authorized API fixtures; cross-company Knowledge test strengthened with eligible actors in both companies and a tenant-predicate mutation RED; socket/cache restrictions resolved with owned execution/cache. Old Encore harness requests silently updated goal values and expected old cookies after role changes. The corrected harness asserts independent observations and session revocation; application controls were not weakened. Direct SDK-only compilation without generated wrappers fails `RunScheduled`, while actual Encore generation/runtime passes. New browser harness setup/selector/remount failures are separate from the final six passing workflows.

### Environment and cleanup

Own fictional QA server 9091 (PID 1470171, session 97339) and RN Web preview 5187 (PID 1385335, session 35398) were stopped through their own Ctrl+C after evidence. No app/Metro 8080/8081 is left running by this task. Own PostgreSQL container `schach-premium-20261018-verify` on 19418 was stopped after the full pass. Encore harnesses removed only their owned namespaces' database containers. Unrelated Encore 9400 PID 2489241 and pre-existing sqldb containers were preserved; recheck live identities before future actions.

Private fictional QA data remains at `~/.local/state/schach-qa/run-CDusVBsc`; logs/artifacts are under `/tmp/workspace-premium-*`. Do not treat those as retained production data. Both stashes and other worktrees remain. No production deployment/login/business mutation, account/provider reconfiguration, paid build, generated native edit or private credential-file access was performed.

### Remaining acceptance and exact next action

All 224 original manual cases, 15 M1 phone cases and 39 supplemental cases remain **NOT_RUN**. Execute physical iOS/Android font scale, keyboard, screen reader, back/safe-area, OS sharing and performance checks. Signed distribution and actual configured calls/push remain separate gates; Expo Go deliberately lacks this app's native calls/push. Coordinated server/client release with SQL 60–61 requires separate authorization and compatibility verification against the already-deployed web. Do not bootstrap/reseed production as a phone-start shortcut.

All three learning pilots still need employee/mentor evaluation. Growth cursor-basis and Knowledge filtering inspect collections and need representative load measurements. External connectors require named providers, source-of-truth, secure credential ownership and outbox/reconciliation decisions. Profile editing, offboarding reason, the 85% threshold and staged finance policy remain deferred. A known UX refinement is preserving the scoped Goals subtab through publication's permission-epoch reauthorization; currently it returns to Measured outcomes, and reopening Knowledge shows the committed source. Preserve revocation when improving navigation.

### Publication confirmed

Product/evidence commit `d2671e114cb35260345623ecc7e71b252192f2b4` was fast-forwarded into clean local main and atomically non-force pushed to both `main` and `improve/workspace-improvements`. On merged main, mobile again passed 81 files / 509 tests in 63.15s with typecheck/lint PASS; web passed 89 files / 430 tests in 6.42s with typecheck PASS. All 94 reviewed product/test hashes match main. This metadata update changes no product behavior; use live Git for the latest metadata HEAD. GitHub reports four existing dependency alerts (two high, two moderate); they are unresolved, not waived by these tests.

**Exact next action:** execute the fictional device/manual acceptance pack and coordinate a separately authorized backend/client release with migrations 60–61 before testing new modules against the deployed site. Discuss the deferred policies/provider connectors before implementation. Owner core-screen testing can use `cd mobile && npm run start:go`; Expo Go still excludes custom native calls/push. Preserve both stashes/worktrees and unrelated runtimes. Do not repeat completed implementation or treat source publication as device/production acceptance.
