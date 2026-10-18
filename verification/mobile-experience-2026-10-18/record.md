# Mobile experience — 18 October 2026

Source baseline6a3cf6c. Owner priority: iOS/Android UI/UX; plan then execute. Existing feature worktree used, no production/server data access. Spec and dependency-ordered roadmap are in docs/superpowers/{specs,plans}/2026-10-18-mobile-experience.md.

## Baseline and environment

Unchanged mobile suite:68files455tests PASS,63.18s, using `npm test -- --maxWorkers=2 --pool=threads`. Default-pool runs were initially quiet and suspected stalled; their final outputs subsequently confirmed PASS68files455tests in65.03s and64.62s. That suspicion is withdrawn: no runner failure was demonstrated. The bounded pool also passed; it is retained for predictable resource use. Network process enumeration is restricted in the sandbox; do not infer old recorded PIDs are live.

## Task1 — shared presentation/frame

RED: missing WorkspaceFrame import; independently observed44px action failing>=48 target. GREEN:2files15tests PASS, typecheck/lint clean. Initial test typing and unused imports corrected before clean checks. Company selected semantics/original id, error dismissal, safe bottom, keyboard tap handling, background preserved content hidden from touch/accessibility in scroll and nonscroll modes, and company-body remount are covered. Existing business controller/request code unchanged.

Task2/3 and visual/native export verification are in progress. No actual iOS/Android device acceptance or provider results are claimed. Existing224 QA cases stay NOT_RUN.

## Task2 — sign-in and tabs

Actual320-width screenshot prompted progressive disclosure of optional verification, with an explicit action and both alternatives remaining available. Label/visibility/autofill and initial-hidden/reveal tests observed RED before implementation; success/retry/pending/MFA contracts preserved. Final focused4files19tests PASS, typecheck/lint PASS. Tab routes, auth/company/policy remount and badge logic unchanged; appearance uses shared tokens and no fixed height. Initial mock incompatibilities and test children-prop typing/lint errors were corrected.

Fictional actual-component RN Web preview on localhost5186 is owned by this run; it performs no API/storage/provider access. Initial fixture dependency aliases and root flex were corrected. Current12layout probes have no runtime errors or external requests and no uncontained horizontal overflow; company chips intentionally scroll horizontally. Browser proxies do not prove native dp, keyboard, font scaling or accessibility. Screenshots were actually opened and inspected, including320-width sign-in and enlarged text/long company names.

## Task3 — directory and final checks

All6 new directory assertions first failed against the old list, then passed. Current final mobile suite70files472tests PASS64.00s; typecheck/lint clean and focused6files31tests PASS. Final source includes13pt tab labels and disabling development-server editing while sign-in is pending. Native iOS/Android Hermes exports PASS with34assets; existing NO_COLOR/FORCE_COLOR warning only. Output under /tmp/workspace-mobile-ui-export-final-20261018 is not a native binary. No package/lock/config/generated-native/backend change. No new dependency audit was run; previous unresolved dependency findings are not waived.

Current layout evidence:12 scenarios,320/390/430 widths, no runtime errors/external requests/uncontained overflow. Actual PNGs inspected, including expanded MFA bottom action and module empty state. Intentional horizontal company-chip scrolling is excluded from overflow findings. Capture now refuses an occupied debug port before launching its own browser. Additional15 physical checklist cases remain NOT_RUN, as do the224 distributed cases.

Only owned fictional preview5186PID3935968/session57339 remains during review and will be stopped afterward. Observed pre-integration:8080/8081/9080/5174 not listening, unrelated Encore9400PID2489241 left alone. Two stashes and existing worktrees preserved. No production operation, real login or owner account change. Independent review and branch publication are pending at this source checkpoint.

Tooling correction before publication: Vite emitted an unignored .vite dependency cache into the preview folder. Formatting identified generated JS, and the unpublished source checkpoint accidentally included it. The cache is now explicitly ignored and removed from the unpublished commit; only preview source/evidence is intended for publication. No product source or test result changed.

## Independent review disposition

Fresh-context read-only review: no Critical/Important findings; ready-to-merge source verdict. Two Minor verification findings fixed and confirmed by the same reviewer: screenshot exit now checks element overflow as well as document width; rapid-submit test now calls the captured handler twice before render. A removed-guard mutation produced two requests and RED; exact product source restored,7login tests GREEN. Fresh typecheck/lint PASS;12layout cases pass under tightened capture. All9 product hashes still match the full472-test/export source. See review.md for scope/exclusions.
