# Neutral Workspace web identity — 14 October 2026

Base `318446b6cff72d3051b0c01c9e9bf51f42ee2645`. Owner approved neutral web branding to match the native client, reported server configuration complete, deferred profile editing/offboarding reason/85% threshold decisions and said Expo/Apple accounts are not ready.

The web sign-in, sidebar, loading marks, footer, tab title/description and favicon now use Workspace and the existing native orange panels/check geometry. Tagline: “Your team. Your work. One place.” Actual company names and account identities remain unchanged. Scoped branding CSS preserves the current shell and navigation. The offline preview is regenerated with neutral metadata and embedded assets.

## Evidence

- Baseline and changed-source web tests: 85 files / 393 tests PASS; current TypeScript and changed-file Prettier checks PASS.
- Full package `format:check` fails on the same10files at current source and unchanged318 baseline: communication/api.ts, communication/Calls.test.tsx, components/CommitmentFields.tsx, components/MessageTaskConversion.test.tsx, data/deadlines.test.ts, data/deadlines.ts, data/imports.test.ts, data/imports.ts, data/metrics.ts and finance.ui.test.tsx. Changed web files pass. No unrelated files reformatted. This package has no ESLint script.
- Normal and demo builds PASS. Existing large single-chunk demo warning and normal private-outDir warning remain qualifications.
- `verify:preview`: 14 checks PASS, no external requests, compiled artifact2,089,731 bytes. Its original text selector failed both new source and fresh318 baseline compilation; current icon has the unchanged accessible label. Harness now selects that label. VM experimental warning remains.
- QA artifact validator: old count116 reproduced RED; current two trees118files, paired contiguous versions1–59, GREEN. This is documentation/tooling acceptance, not manual application acceptance.
- Actual Chromium screenshots from the fictional9080 API through Vite5174: login/Overview at1440/390/320; collapsed desktop sidebar1440; open phone navigation390/320. Zero recorded overflow or runtime exceptions. Root inspected real screenshots. Baseline and final JSON/PNG are retained here.
- Production read-only `/api/health` on work.schachengineers.com returned JSON200/ok through trusted HTTPS. This establishes reachability/health only, not real sign-in/MFA/LiveKit/TURN/push/restore acceptance. No production mutation or deployment.

## Review

One bounded read-only independent behavior-preservation review: Spec PASS, Quality PASS, no Critical/Important/Minor findings; ready to merge. Reviewer checked the actual source diff, CSS scope, decorative accessibility, exact native SVG geometry, embedded preview, paired migration inventory and unchanged business controls. Declined behaviors: deferred profile/offboarding/threshold features; production authentication/providers; native accounts/build/device behavior; independent build/runtime repetition; external guidance/account eligibility; unchanged migration SQL correctness; final root-written handoff/evidence prose. Root disposition: all remain outside this bounded change, with actual production health and supplied source evidence separately qualified.

## Continuation

Expo/EAS and Apple Developer accounts are absent. Fastest immediate path is the existing HTTPS browser app on both phone types. Next native path: company-owned Expo setup → Android preview APK; Apple organisation/D-U-N-S enrolment in parallel → registered-device iPhone ad hoc preview. Intended private store distribution remains unchanged. No cloud build or store submission started.

All224 manual QA scenarios remain NOT_RUN, including the P0 run and unseen populated UI states. Mobile visual review and actual devices/secure production authentication/calls/push/restore/capacity remain open. Existing8080/9080/5174/9400 processes were left running; only own short-lived browser groups were stopped. Private build/baseline logs remain in the current owned schach-web-neutral-20261014 state directory. Read docs/HANDOFF.md for current next action and preserve all prior release evidence/stashes.

Product commit `8b8e8dff0969f67df119437d6cc8a01aa3e1111a` was fast-forwarded to local main and atomically non-force pushed to both private branches. Remote refs were verified equal. Later handoff-only metadata records this receipt; use live Git for the final metadata HEAD. No production deployment or retained8080update was performed.
