# Reviewed People administration

Company leadership can manage membership and reusable onboarding presets, attest a complete access review, and prepare a company departure. Company rank never grants private conversation access. Global account suspension remains a separate platform-admin operation.

## Credentials and deployment

Standalone and Encore use the same `ConfigurePeopleCredentialRetry` loader. New-account onboarding requires both `PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID` and `PEOPLE_CREDENTIAL_RETRY_KEYS_JSON`. The latter is a JSON object mapping key IDs to exactly 64 hexadecimal characters representing independent 32-byte secret keys. Use a secret manager; never put real keys in source, request logs or application DTOs. Key IDs use 1–40 ASCII letters, digits, underscores or hyphens, and the keyring permits at most 64 entries. Retain previous keys for every retained canonical retry binding. Rotation changes the active ID for new submissions and preserves old IDs for historical recovery. Missing configuration disables new-account apply with 503; malformed configuration fails startup.

The binding uses independent 24-byte random salt, PBKDF2-HMAC-SHA256 with 600,000 iterations and 32-byte output and a dedicated-key HMAC over the versioned length-prefixed UTF-8/U64 transcript. The ordinary business hash excludes the password. A known apply ACK clears the credential-bearing frozen attempt before dependent refresh. While the ACK is unknown, only scoped RAM retains the exact submitted password; it is not localStorage, SecureStore, read data or logging material. A changed credential under the same canonical key conflicts even after account password rotation. Account login credentials and retry-binding keys are independent.

Default admission limits are 120 attempts per actor/company and 300 per actor per 15 minutes, with 20 proven mismatches per actor/company, 2 active KDF operations, 8 waiting operations and a 5-second queue timeout. The bounded admission maps fail closed. KDF work happens outside the final mutation locks; current authority and winning retry metadata are rechecked afterward. The same configured keyring must be available on all instances and after restart.

Apply numbered migrations through 56 using the existing migration owner. SQL 1–49 remains unchanged. New paired migrations add positive membership versions/access epochs, company permission epochs and account/session epochs; output epoch bindings and queued communication audience; credential retry metadata; onboarding; access reviews; and departures. Existing account sessions receive coherent positive epochs on upgrade. Do not use schema auto-migration as the production PostgreSQL migration owner.

## API and source contracts

All paths below are relative to `/api/companies/{cid}`. Every endpoint reloads current authority under the shared fence; an epoch is invalidation metadata, not an access grant.

| Path | Behavior |
| --- | --- |
| `GET /people/context` | Complete leadership directory and current eligible role/department choices, bounded at 1,000 memberships. |
| `GET/POST /people/presets`, `GET/PATCH /people/presets/{id}` | Current rank-filtered presets, canonical mutations, captured version for edits/archive. |
| `POST /people/onboarding/preview`, `/apply` | Read-only 30-minute preview, at most 20 existing task-template applications, explicit current source versions; canonical atomic apply. Existing global account identity, credentials, MFA and platform status are preserved. Inactive duplicate membership requires explicit rejoin. |
| `POST /people/access-reviews/preview`, `/people/access-reviews/{id}/complete` | Complete bounded snapshot and resulting graph, keep/change/revoke/departure-follow-up decisions; immutable completed attestation, canonical completion. At most 1,000 memberships and 1 MiB snapshot/manifest. |
| `GET /people/access-reviews`, `/{id}` | Current authorized historical review projection. Pending departure does not certify handover completion. |
| `POST /people/{id}/departure/preview`, `/apply` | Complete current source inventory and exact replacements; 30-minute preview, all-or-none transfer and company departure. Bound of 1,000 live obligations and 8 MiB manifest/serialized view. |
| `GET /people/departure-previews/{id}` | Current source-authorized projection; private blockers remain opaque. |
| `PATCH /people/{id}` | Existing direct membership edit/rejoin/revocation with optional legacy-compatible `expectedVersion`; first-party editors send it. Direct revocation records handover not performed and preserves assignments. |

Onboarding never automatically invites someone into private conversations. Its generated tasks go through the existing template/task engine, including independent review, exact commitments, checklists, facts, notifications and attention. Company departure reuses task, project, milestone, goal, department and attention validation/commit helpers inside one transaction. Accepted tasks and milestones, original task deadlines, measured goal facts, finance amounts and recorded financial actors remain unchanged. Goal handover changes metadata ownership once and does not transfer personal reminder preferences.

An in-review milestone requires a separate authorized human `request_changes` action before a fresh departure preview. Open private review obligations remain blockers even if archived or past due. The People API introduces no private decision close/reviewer-transfer operation. Expense handover transfers or explicitly retains an already-current eligible independent reviewer route; it does not approve or pay an expense. Reporting-manager removal is an explicit reviewed choice.

Consequential scope changes advance affected membership access epochs, account session epochs and the company permission epoch once per batch, revoke sessions/devices/grants, end departed private intervals and retire personal derived outputs. Title/capacity edits change the membership version without signing out the account. Company departure preserves other memberships, but account-wide sessions require fresh authentication there too. Rejoin never restores historical private intervals or old raw finance/report/reminder capabilities.

The lock order is Company UPDATE, captured existing sessions (SHARE for ordinary access; UPDATE for the complete affected set), company memberships UPDATE ordered by user, merged directory Users ordered by ID using their strongest required mode, current Conversations, sorted calls SHARE, then devices/grants/jobs. Account-only writers capture sessions before User UPDATE and do not later enter company fences. M7 original-session checks deliberately perform a fresh nonlocking lookup under the original User SHARE fence; every session deletion/revocation path holds the same User UPDATE, avoiding a late Session→User inversion.

Web and native share the canonical attempt registry. Graph-only refresh clears ordinary drafts and fetched previews while preserving an unknown canonical submission only with the same positive actor access epoch/role/department/manager. Retry sends the original key, target, ordered dependencies, body and captured versions. Actor/session/source denial clears relevant recovery state and seals late ACK callbacks. The web People host remains mounted while joined workspace data refreshes; native People pages preserve authored controls during foreground/current-source checks.

The browser demo is a finite isolated illustration with explicit limitations: no real account authentication, cryptographic credential binding, private source semantics or task-template provisioning. It never falls back from a failed real API and never persists a submitted onboarding password. Device signing, physical keyboard/screen reader/background delivery, physical iOS, deployment region, provider capacity and disaster recovery require their separate deployment evidence.
