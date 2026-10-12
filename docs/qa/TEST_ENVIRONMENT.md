# Prepare a test environment

Use a disposable environment for this pack. The existing workspace at port 8080
contains retained user data; it is suitable for an agreed read-only tour, not
mutations, revocation, destructive tests, fault injection, or provider load.

## Fast local server setup

From the repository root, run:

```bash
bash docs/qa/tools/start-isolated-qa.sh
```

The script builds the current API and normal frontend, explicitly overriding
frontend API settings to same-origin authenticated API mode (`VITE_API_URL=''`,
`VITE_DATA_MODE=api`) even when shell/dotenv settings specify another server. It creates a new private
directory and SQLite database, generates independent disposable MFA and People
retry keys, and starts fictional sample data at **http://127.0.0.1:9080**. It
refuses port 8080 and an occupied port. It never copies the existing database or
inherits production/provider secrets. It remains in the foreground; Ctrl+C
stops only its child server. The printed private directory retains the database
and keys for repeat inspection. Do not delete it until your run is signed off.

Requirements: Bash, Python 3, Go as required by `backend/go.mod`, a C compiler,
Node/npm as required by the checked-in frontend packages. Run `npm ci` in
`frontend/` first when dependencies are absent or the lockfile changed. The
script does not install packages or models. Windows testers can use WSL, a
dedicated test deployment, or translate the explicit build/run commands below.

Use the public fictional demo credentials from [README](../../README.md).
Their shared evaluation password is `SchachDemo!2026`:

| Perspective | Email |
| --- | --- |
| Founder/platform owner | founder@schach.demo |
| CEO | ceo@schach.demo |
| Finance | finance@schach.demo |
| Engineering head | head@schach.demo |
| Engineering member | member@schach.demo |

Create additional fictional QA accounts for manager, viewer, second member,
independent reviewer, another department, and company outsider as required by
[TEST_DATA](TEST_DATA.md). Do not reuse those passwords on a real deployment.
Separate browser profiles are necessary for simultaneous roles; ordinary tabs
in the same profile share authentication cookies.

The generated private `restart.sh` reuses that test directory's exact keys and
database. Stop the original foreground test server before invoking it. It does
not clear data, seed a new database, or replace another listener.

## Features requiring extra configuration

| Capability | Required environment | If absent |
| --- | --- | --- |
| Ordinary work, finance, reports, People and chat text | Local isolated API; generated People keyring | Run LOCAL scenarios |
| Historical/scheduled CSV exports and report-ready Inbox | Dedicated private `REPORT_ARTIFACT_ROOT`, active owned report worker/maintenance/delivery loops, eligible definition owner and recipient/source fixtures; the launcher supplies the root and enables workers | Missing storage blocks artifact/delivery success; new exports return `export_unavailable`, while authorized historical reads remain available |
| Scanned chat attachments | Private media store and configured ClamAV | Clean-media success tests BLOCKED; unavailability tests runnable |
| Receipt OCR and private statement intake | Private intake root, finance scanner; verified English OCR for extraction | Provider-positive cases BLOCKED; manual finance still works |
| Grounded summaries/transcripts | Pinned local Ollama/Whisper, private scratch, ffmpeg/ffprobe, bounded worker admission | Positive model cases BLOCKED; manual/unavailable branches still work |
| Calls | Self-hosted LiveKit signaling/key configuration, accessible media network | Positive call cases BLOCKED; truthful unavailable behavior remains testable |
| Native push | Correct Android/iOS signing, APNS/FCM credentials and physical-device tokens | Background delivery BLOCKED |
| Release native login | Trusted HTTPS endpoint with correct cookies/origins | Real release authentication BLOCKED; never bypass TLS |

Provision an isolated QA stack using [operations](../OPERATIONS.md),
[communication operations](../COMMUNICATION_OPERATIONS.md), and
[local intelligence](../intelligence-local.md). Provider credentials and keys
belong in a private environment/secret manager, outside this pack. Do not point
a second inference worker at a provider already serving another acceptance run:
the local provider budget is process-local. Record the provider identity, source
revision, and capacity arrangement before enabling positive provider cases.

Clean attached audio may be transcribed when explicitly selected and configured.
**Call recording and automatic call transcription are disabled.** Do not invent
a success case for them. Presence/typing indicators are not advertised UI flows.

## Database and adapter coverage

SQLite is local evaluation. Production uses the supported numbered PostgreSQL
migration owner and all versions through 58: 116 up/down filenames in each of
the two byte-identical migration trees. Native PostgreSQL concurrency and the
actual Encore adapter need their own test runs. PGlite, handler tests, browser
demo, or ordinary `go build` do not substitute for those results.

Use only an explicitly owned test database/container/schema for
`TEST_DATABASE_URL`. Do not combine numbered PostgreSQL migrations with GORM
AutoMigrate; the existing mixed-mode finance `42704` limitation remains
unsupported. Never use a down migration on retained real data. Back up and
restore only the fictional test environment during operations scenarios.

## Record a baseline before testing

1. Record `git rev-parse HEAD`, date/time in Asia/Kolkata, environment URL, adapter,
   database mode, tester, company aliases and account roles.
2. Check **`/api/health` returns JSON `{"ok":true}`**. `/health` may return SPA HTML
   and is not the API-health check.
3. Sign in as each required role. Confirm normal API mode; the browser preview
   does not authenticate and does not prove backend access controls.
4. Record browser/OS/device/build/font size/network and configured capabilities.
5. Save a private baseline backup and original test keys before restart/restore
   cases. Never publish secrets, database dumps, private message text, or model
   prompts/results in a defect attachment.
6. Start the execution sheet at NOT_RUN. A missing prerequisite is BLOCKED with
   a named owner and reason; it is not a product failure or a pass.

No new manual test in this pack has been executed merely because it has an
automated source reference. The current release evidence is linked separately.
