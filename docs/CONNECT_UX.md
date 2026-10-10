# Connect interaction redesign — 10 October 2026

The follow-up covers desktop and phone Connect, including native Android/iOS. The concrete usability defects were the mandatory name for direct messages, the combined list/creation/settings/history screen, the long always-visible message action toolbar, and the absence of a fixed native composer.

## Dependency order and acceptance

1. **Person-based direct messages.** Allow DM creation without a title; continue using the company-scoped unique pair and transactional reuse/blocked-user checks. Return the other participant's `peerId` only for authorized DM rows/metadata, without exposing the internal pair key or adding a SQL column. Selecting a person in either client opens the server's existing conversation, including a conversation beyond the loaded list page. Group and channel names remain required. Acceptance: nameless creation, reversed participants, repeat request, correct peer for each user, outsider isolation, blocked pair denial.
2. **Browser conversation layout.** Add conversation filtering and actual unread counts, an independent history scroll area, a fixed composer, authors/times/day separators, readable attachments and contextual actions. Put details, search/saved/pins, work, records and publication forms in accessible dialogs. Maintain call component lifetime when its controls collapse. Acceptance: rendered desktop and 390px browser, list-to-chat back navigation, no horizontal overflow, persistent composer, DM reopen, private save, thread reply, playable voice preview, existing Finance screen.
3. **Native list and chat routes.** Use an Expo Router conversation route bound to company and session; separate list and history; use a keyboard-avoiding composer and contextual sheets. Preserve the existing authenticated client generation and permission epoch boundaries. Acceptance: typecheck, lint, existing client/payload regressions, Android/iOS Hermes exports, Android evaluation APK. Physical Android/iOS navigation, keyboard, accessibility, microphone and calls require devices.
4. **Permissions and work controls.** Preserve history boundaries, membership revocation, source-revision clearing, immutable message/media/call retries, task audience preview/acknowledgement, independent review, timed deadlines, intake versions and expense approval controls. Acceptance: browser privacy/retry/deadline regressions, native client boundaries, complete SQLite and PostgreSQL application suites, focused DM concurrency/race check. No new task or finance approval bypass.
5. **Integrate and run.** Review the bounded diff, document evidence and remaining platform limits, integrate to `main`, rebuild the running browser application, and push to the already-authorized `Schach-workplace` repository. The user's existing demo database is preserved; mutating browser verification uses an owned disposable database on another loopback port.

## API compatibility

`POST /api/companies/{cid}/conversations` continues accepting the same request shape. For `kind: "dm"`, `title` is optional and ignored; the server stores `Direct message` and relies on the canonical participant pair. Group/channel title validation is unchanged. DM responses in authorized list/detail include an optional `peerId`, scoped to the current user and company. Existing clients may continue sending DM titles. No SQL migration is necessary: `peerId` is a response-only GORM field.

The existing REST commands, expected versions/revisions, publication policy, task/finance workflows, media scanning and self-hosted LiveKit gateway remain in use. The browser-only fictional preview still explains why it cannot simulate shared communication.

## Verification

Fresh execution results and rendered-browser scope are recorded under `verification/connect-ux-2026-10-10/`. Previous full communication/runtime evidence remains historical; it does not certify physical devices or production deployment. The hosting direction remains India with the deployment gates in `COMMUNICATION_OPERATIONS.md`.
