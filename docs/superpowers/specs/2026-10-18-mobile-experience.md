# Mobile experience and employee growth direction

Date: 18 October 2026. Source baseline: `6a3cf6c`.

## Intent and authority

The owner requested an in-depth plan followed by execution, with iOS and Android UI/UX the main priority. This authorizes the reversible mobile improvements described here. The earlier competitive research supplies proposed direction, not evidence that a competitor feature or a new employee-growth workflow is required. Mixed office/field use is a working assumption, not a confirmed workforce profile.

Success means employees can understand the current company, find a module, sign in and finish common actions comfortably on a small phone. Preserve the existing application and business workflows. Employee development follows the mobile foundation; it does not delay mobile usability work.

## Product sequence

1. Mobile foundation: consistent surfaces, typography, accessible controls, safe areas, keyboard-aware forms and recognizable navigation.
2. Daily execution: clearer Work/Inbox priorities and task creation/review; no automatic employee score or silent assignment.
3. Connect: conversation hierarchy, composer ergonomics, attachments and explicit publication flows.
4. Finance and reports: readable exact amounts, progressive forms, explainable exceptions and reliable export/retry states.
5. Other modules: phone-oriented Projects, Calendar, Workload, Goals, People and Account workflows.
6. Employee growth pilot: separate career roles/levels and competencies, development goals, reviewed evidence, mentor conversations and optional learning assignments.
7. Maintained knowledge and assistance: reviewed reusable guidance, source-linked retrieval and selected-source suggestions.
8. Integration and rollout: prioritize demonstrated needs; qualify devices, providers, security, restoration and capacity.

## First implementation slice

Implement the shared mobile foundation, sign-in, company chrome, tab appearance and module directory. Preserve five existing tabs, routes, session guards and all handlers. No new backend API, dependency, permission, persistent private store, account transfer or provider configuration.

### Visual contract

- Neutral Workspace identity; warm orange accent, dark navy text, pale neutral canvas and white cards.
- Shared token module; default body 16, supporting text 14, metadata at least 13; allow native font scaling and wrapping.
- Shared actions have a minimum 48x48 logical-unit target and inputs a minimum height of 52. Labels are visible; meaning never relies on color alone.
- Full-width, rounded module rows show title and a short purpose. Related rows are grouped. Search matches titles and descriptions locally and has an explicit empty state.
- Small-screen content scrolls vertically. No fixed-width form/card, forced single-line title, maximum font-scale clamp or fixed tab-bar height.
- Native safe areas protect content; modal close remains disabled while existing operations are busy.

### Sign-in contract

Use a safe-area, keyboard-aware scrolling layout, visible Email/Password/Authenticator code/Recovery code labels, password visibility control and platform autofill metadata. MFA fields remain available behind an explicit "Use authenticator or recovery code" action, with their existing server semantics. They stay visible once opened and both alternatives remain usable. Configured production server remains visible and noneditable; only development retains the server override. Server validation, session restoration and successful-secret clearing stay in the existing handler. Prevent duplicate in-flight submissions. Do not persist credentials or add telemetry containing input values.

### Company frame contract

Extract presentation from Workspace.Page into a component with explicit props, preserving user/company body keys and current foreground/preserveMounted behavior. Keep company selection and error dismissal usable. Preserved background children must be invisible, noninteractive and hidden from accessibility. Returning to foreground does not itself confer access; existing controller refresh and invalidation remain authoritative.

### Navigation contract

Keep Chats, Work, Inbox, Calls and More; retain unread labels/badge capping and current actor/company/policy remount key. Improve tab tint and typography without custom height/safe-inset arithmetic. More exposes existing Overview, Calendar and Workload routes alongside retained modules. Hide Finance for viewers; show Overview only for the existing leadership roles; Account and local assistance history remain reachable without a loaded work payload. No menu item grants server authority. Clear search state when identity/company/policy changes.

## Subsequent workflow decisions

- Today priorities should start as explainable, editable views of authorized recorded work. Establish a baseline before choosing performance targets.
- Design each task/chat/finance flow around the current frozen attempt rather than rebuilding request bodies on retry.
- Growth assessments require their own company-scoped authorization. Career seniority never changes application permissions. Task acceptance, course completion, skill assessment and promotion remain distinct.
- Shared development notes and private reflections need separately defined audiences. Private conversations do not enter management reports or employee profiles without the existing explicit publication process.
- Offline persistence, broad knowledge indexing, integrations, new appraisal authority, finance approval thresholds and workload policy changes each require a separate design. Existing deferred profile/offboarding/85% threshold decisions stay deferred.

## Non-negotiable controls

Company/source authority, private membership/history intervals, explicit message-to-task title/audience confirmation, independent review/payment, exact minor-unit money, original timed commitments, optimistic versions, frozen retry identities and revocation of cached/queued/future output all remain intact. Suggestions establish neither outcomes nor approvals. Call recording and automatic call transcription remain disabled. Expo Go retains honest calls/push unavailable states; custom builds retain their native path.

## Evidence and rollout

Run the current mobile baseline, new behavioral tests, full mobile suite, typecheck/lint and actual iOS/Android JavaScript exports. Inspect rendered screenshots of the actual presentational components with fictional data at 320, 390 and 430 CSS-pixel widths, plus enlarged text. Browser-native previews verify layout only: they do not establish native keyboard, dp targets, VoiceOver/TalkBack, hardware Back, permissions, calls, push or store readiness.

Physical acceptance covers a small iPhone, a large iPhone, a small Android and a current edge-to-edge Android, large text, keyboard open, company switch, failed/unknown save, background/resume and revocation. Record observations in a separate run copy; do not mark the existing 224 distributed scenarios passed. Use disposable fictional QA only. Existing production web and protected local runtimes remain untouched.

## Research references

- [Asana features](https://help.asana.com/s/article/all-asana-features?language=en_US): connected work, planning and reporting.
- [Slack AI](https://slack.com/help/articles/25076892548883-Guide-to-AI-features-in-Slack): cited catch-up/discovery.
- [Lattice Grow](https://lattice.com/platform/grow): development plans, career tracks and competencies.
- [CIPD feedback evidence](https://www.cipd.org/uk/knowledge/evidence-reviews/performance-feedback/): constructive feedback needs deliberate design.
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [keyboard guide](https://docs.expo.dev/guides/keyboard-handling/), [safe areas](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/): implementation references, read before mobile changes.
