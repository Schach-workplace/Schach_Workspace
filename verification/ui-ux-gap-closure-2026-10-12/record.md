# UI/UX gap closure — 2026-10-12

Base: `7db2025` (main = improve/workspace-improvements). Scope: web and native client UI/UX defects found by a read-only audit on 2026-10-12, one docs correction and one QA-harness safety fix. No backend Go, migrations, database, provider, native project (`mobile/ios`, `mobile/android`) or retained-runtime change. The app on 127.0.0.1:8080 was not rebuilt, restarted or mutated and does not yet serve these client changes. No manual QA scenario was executed; all 224 remain NOT_RUN.

## Evidence (fresh, this change)

| Check | Baseline at 7db2025 | After |
| --- | --- | --- |
| Web `tsc --noEmit` | pass | pass |
| Web vitest | 71 files / 348 | 81 files / 385 pass |
| Mobile `tsc --noEmit` | pass | pass |
| Mobile `expo lint --no-cache` | not recorded | pass |
| Mobile vitest | 52 files / 352 | 63 files / 407 pass |
| `git diff --check` | — | pass |

Smoke harness refusal verified by execution: no `SCHACH_SMOKE_URL` and `:8080` both assert before any browser launch.

## Changes

Web (`frontend/src`):
- Calls reuse one stored web device per user (`communication/webDevice.ts`); a rejected/foreign id (404) registers fresh. Previously every join created a new device row.
- Authenticator settings: loading/error/retry states; operator-key message only when `configured===false`; otpauth URI with copy; disable requires password + 6-digit code. No QR (no library dependency).
- Registered devices: loading/error/empty states, "This browser" marker.
- Platform-admin global offboarding control (type `OFFBOARD`), shown only to platform admins for other users, mounted in DepartureHandover.
- Finance assistance (5 components): consistent styling incl. 320px, loading/error/empty states, identifiable extraction requests, `aria-pressed` tool tabs, role-validated `?tool=`, up-front demo panel, context-correct demo messages, visible pre-flight errors; new UI for duplicate preview (advisory, accepts nothing), staged-intake download, statement-import rows view and CSV export (finance roles).
- Message-to-task disclosure: when the server preview returns `outcome:"existing"`, the existing task title is disclosed with "no new task will be created"; confirmation resets on every new preview.
- Accessibility/responsive: `aria-pressed`/`aria-current` on toggles and mobile nav; phone search button + full-width bar; search results max-width; Overview activity routes by action type; distinct Workload icon; attention preferences moved under My account.

Mobile (`mobile/src`):
- Calls: pending retry keyed to company/user/policy epoch/conversation/kind with frozen path+body; a different call shows explicit retry/discard; real mic/camera state; camera permission for video; Calls tab conversation picker, focused 10s refresh, unregistered-device explanation.
- Dismissible error banner; cleared on company switch. Notification company switch now clears the active call (shared `enterCompany`).
- Push: foreground presentation of body-free hints; token-rotation re-registration only after explicit opt-in this session; no silent sign-in registration; unknown payloads open Inbox. Backend PushHint has only conversation/company ids, so no task/expense deep links.
- Tabs: icons (text glyphs; no icon package declared), Inbox unread badge, safe-area session loader; pull-to-refresh on Work, Inbox, agenda.
- Chat attachments: distinct Take photo / Choose photo / Choose file; play controls only for audio/video.
- Task detail: post comments, nudge, log time (web permission rules).
- Message-to-task with explicit title+audience confirmation (separate from request/expense drafts), existing-task disclosure.
- New read-only Overview, Workload and Deadline agenda screens; Connect text contrast >= 4.5:1 / 13pt (accent orange darkened to #b9520c).

Docs/harness:
- `verification/runtime/connect_ux_smoke.mjs` requires explicit `SCHACH_SMOKE_URL` and refuses port 8080.
- `docs/API_CONTRACT.md` offboarding text corrected to the implemented handler (no body/reason; ownership transfer precondition).

## Review

One independent read-only review of the full diff against the binding controls: no Critical/High. Findings M1 (existing-task disclosure), L1 (stale confirmation), L2 (silent push at sign-in), L5 (call survives notification company switch) fixed with tests; L4 resolved by contract correction. Controls verified intact: private membership, frozen retries, company isolation, advisory-only suggestions, minor-unit money, body-free push, recording/transcription off.

## Open / not done (classified)

- Product decision: self-service profile edit needs a backend endpoint (none exists).
- Product decision: offboarding reason capture would need handler + UI change.
- Accepted residual (L3): reusing a stored web device id reactivates the user's own revoked row (session revocation still holds); optional backend hardening to refuse rebinding inactive devices.
- Dependency decision: real tab icons would need declaring `expo-symbols`/`@expo/vector-icons`.
- Not done: pull-to-refresh on Chats and Page-scrolled screens; owner/department filters on mobile Workload; mobile task CSV import/export; `CaptureControl` "Choose attachment" label on task/expense evidence.
- Environment gates unchanged: physical device (permissions, LiveKit toggles, push delivery), APNS/FCM credentials, iOS prebuild/signing, browser visual inspection of the new layouts. These are code- and unit-test-level changes only.
