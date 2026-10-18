# Mobile experience — 18 October 2026

Source baseline6a3cf6c. Owner priority: iOS/Android UI/UX; plan then execute. Existing feature worktree used, no production/server data access. Spec and dependency-ordered roadmap are in docs/superpowers/{specs,plans}/2026-10-18-mobile-experience.md.

## Baseline and environment

Unchanged mobile suite:68files455tests PASS,63.18s, using `npm test -- --maxWorkers=2 --pool=threads`. Default-pool attempts stalled before collection; supported bounded worker configuration passed. This is a runner/environment issue, not a confirmed application defect. Network process enumeration is restricted in the sandbox; do not infer old recorded PIDs are live.

## Task1 — shared presentation/frame

RED: missing WorkspaceFrame import; independently observed44px action failing>=48 target. GREEN:2files15tests PASS, typecheck/lint clean. Initial test typing and unused imports corrected before clean checks. Company selected semantics/original id, error dismissal, safe bottom, keyboard tap handling, background preserved content hidden from touch/accessibility in scroll and nonscroll modes, and company-body remount are covered. Existing business controller/request code unchanged.

Task2/3 and visual/native export verification are in progress. No actual iOS/Android device acceptance or provider results are claimed. Existing224 QA cases stay NOT_RUN.

## Task2 — sign-in and tabs

Actual320-width screenshot prompted progressive disclosure of optional verification, with an explicit action and both alternatives remaining available. Label/visibility/autofill and initial-hidden/reveal tests observed RED before implementation; success/retry/pending/MFA contracts preserved. Final focused4files19tests PASS, typecheck/lint PASS. Tab routes, auth/company/policy remount and badge logic unchanged; appearance uses shared tokens and no fixed height. Initial mock incompatibilities and test children-prop typing/lint errors were corrected.

Fictional actual-component RN Web preview on localhost5186 is owned by this run; it performs no API/storage/provider access. Initial fixture dependency aliases and root flex were corrected. Current12layout probes have no runtime errors or external requests and no uncontained horizontal overflow; company chips intentionally scroll horizontally. Browser proxies do not prove native dp, keyboard, font scaling or accessibility. Screenshots were actually opened and inspected, including320-width sign-in and enlarged text/long company names.
