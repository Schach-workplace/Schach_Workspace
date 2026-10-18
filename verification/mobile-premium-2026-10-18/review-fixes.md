# Final client corrections

All three Important findings in `final-review.md` are corrected in source. No backend, dependency, production, provider, native project generation, or commit work was performed in this dispatch. Parent owns final web/native bundles, fictional browser captures and integration harnesses.

## 1. Canonical Knowledge review route

Web Knowledge publication and return-for-revision now submit `POST /knowledge/{id}/review`. The focused test exercises both decisions and checks the actual submitted path against the shared canonical target registry; the plural path is explicitly rejected by that registry assertion.

## 2. Calendar asynchronous lifecycle and consent

Web Calendar export increments a monotonic generation on backgrounding, unmount, owner changes and authorization-state changes. A response must still match the captured generation and owner, and current visibility/authorization must permit export. Backgrounding, renewed authorization and changed read basis reset consent. The export entry point and ready state also honor `authorizing`.

Deferred-response regressions start a download, transition hidden→visible or authorization active→restored, then resolve the original request. They assert no old output, cleared consent, a disabled download until new consent, and a successful fresh request after renewed consent.

## 3. Persisted authorship and review context

Growth and Knowledge editors/reviews on web and native now persist one atomic envelope containing the original source snapshot and authored fields. Growth also keeps the raw multiline learning text in that envelope. Fetched initial values remain component-local until an explicit authored setter or submission freezes the envelope through the real RAM hook. Reopening or polling against source version 2 therefore preserves a version-1 authored draft with expectedVersion 1; it cannot adopt version 2 and overwrite concurrent source fields.

Review disclosure reads the retained original source, including Knowledge body/publication audience and Growth source fields/employee/mentor audience. Existing unknown-attempt payloads still take precedence for sends; retry paths and business identities remain unchanged. Matching envelopes retire in the acknowledged-commit callback, before refresh may unmount the form, and after a successful returned result. Explicit discard-and-review-latest controls retire the original envelope and initialize from the latest currently authorized detail. Ordinary close, remount and failed/unknown submissions preserve authorship.

The production `useExecutionInput`, `useRamInput`, execution mutation and business-attempt hooks were inspected before changes. Web tests now use real RAM input hooks rather than replacing persistence with plain useState. Native regressions use both real RAM input and business-attempt hooks, recording actual request path, payload, source version and retry identity across root unmount/remounts. They verify v1 edit/review → v2 detail → remount; unknown retry still uses original body/target/key and original review source/audience; acknowledged success clears matching authorship; explicit latest-source reset sends v2 under a new retry identity and requires fresh authoring/confirmation.

Knowledge question entry is capped at the backend's 1000-character limit on both web and native. The parent's visible native question label is preserved. Expo SDK 57 and current official TextInput maxLength documentation were checked; no new Expo/native API package was introduced.

## Verification observed in this dispatch

- Before fixes, the new web reproducers failed in five expected cases: canonical review target, persisted Knowledge edit version, original Knowledge review disclosure, hidden→visible calendar output, and authorization restoration.
- Temporarily restoring live-prop source binding reproduced two web Growth failures and four native Growth/Knowledge edit/review failures. Restoring the fix returned these regressions to green.
- Web focused GrowthHub/KnowledgeHub/CalendarExport: **3 files / 26 tests PASS**.
- Native focused GrowthScreen/KnowledgeScreen: **2 files / 12 tests PASS**.
- Full frontend `npm test`: **89 files / 430 tests PASS**, 8.98 seconds.
- Full mobile `npm test`: **81 files / 509 tests PASS**, 68.50 seconds.
- Frontend `npm run typecheck`: **PASS**.
- Mobile `npm run typecheck`: **PASS**.
- Mobile `npm run lint`: **PASS**.
- Prettier check over the ten owned component/test files: **PASS**.
- `git diff --check`: **PASS**.

Physical iOS/Android, signed distribution, live provider, and production database checks were not run by this dispatch. These results establish client source/hook regressions and repository checks, not physical-device evidence.
