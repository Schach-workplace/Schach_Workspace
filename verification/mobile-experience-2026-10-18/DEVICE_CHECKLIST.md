# Mobile foundation device acceptance

All rows start NOT_RUN. Copy this file to an access-controlled run record and record device/model, OS, Expo Go or native build version, Git SHA, deployed API release, actor role, observed result and defect id. The screenshots beside this file are fictional RN Web layout evidence only.

Use fictional authorized accounts and the isolated QA environment for fault/revocation scenarios. Do not change production data or fault-inject the deployed web service. Use Expo Go core screens first; signed-native calls/push are separate gates.

| ID | Platforms / procedure | Expected | Status |
| --- | --- | --- | --- |
| UX01 | Small supported iPhone and Android: open sign-in in portrait/landscape | Safe insets; server identity readable; no clipped labels; primary action reachable | NOT_RUN |
| UX02 | Open email/password keyboard, scroll, use password manager | Inputs and submit reachable; credential autofill appropriate; no accidental submit or dismissal | NOT_RUN |
| UX03 | Toggle password visibility | Value retained; explicit show/hide label; conceal again before backgrounding | NOT_RUN |
| UX04 | Expand verification, enter TOTP or recovery code, sign in to a fictional MFA-enabled account | Both alternatives available; server requirements enforced; successful secrets cleared | NOT_RUN |
| UX05 | Isolated QA: slow/fail sign-in, tap repeatedly, retry | One request in flight; clear error; entered credentials retained for intentional retry; no logged credentials | NOT_RUN |
| UX06 | Multiple companies, long names, enlarged font | Selected company announced; chips scroll; body belongs to selected company; no old private data flashes | NOT_RUN |
| UX07 | Open More; find Calendar, Workload, Finance, Reports, Account; search by purpose then clear | Grouped rows readable and tappable; correct current-company destination; explicit no-match state | NOT_RUN |
| UX08 | Compare member/viewer/leadership accounts; repeat with company data unavailable | Existing role visibility retained; viewer has no Finance entry; loading does not confer access; Account/history remain available | NOT_RUN |
| UX09 | Search modules, change company/account/policy scope | Search resets; links use the new scope; no stale pending navigation authority | NOT_RUN |
| UX10 | Background/resume while a task/chat editor is mounted; revoke membership through an independent QA actor | Background private content hidden; current authority checked on return; no old cached private output | NOT_RUN |
| UX11 | iOS VoiceOver / Android TalkBack, large font/display settings | Sensible reading order, selected-company state, headings and buttons named; text wraps; actions reachable | NOT_RUN |
| UX12 | Android hardware/gesture Back and iOS back/swipe on task/detail/sheet | Expected route/close behavior; busy confirmation preserved; no unexpected draft loss | NOT_RUN |
| UX13 | Tabs with zero and many unread items; open keyboard | Correct badge/accessibility label; safe bottom area; keyboard does not conceal active form | NOT_RUN |
| UX14 | Core task acceptance, exact-time deadline, expense review/payment and message publication journeys | Independent review, exact money/original commitment, disclosure/audience confirmation and frozen retry controls unchanged | NOT_RUN |
| UX15 | Expo Go Calls / Account push; separately test authorized signed-native builds | Expo Go explains unavailable capabilities; signed-native path remains distinct; no inferred provider PASS | NOT_RUN |

The existing224 distributed QA templates remain unchanged. These15 focused instructions are additional manual acceptance work, not new PASS results. The85% capacity threshold, profile editing and offboarding reason remain deferred product decisions.
