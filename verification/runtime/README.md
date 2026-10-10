# Runtime acceptance gates

From the repository root:

```sh
verification/runtime/encore-smoke.sh --output /tmp/schach-runtime-evidence
```

Requires Go, Encore CLI, Python and Docker. Copies backend/adapter into a temporary directory, uses owned disposable namespaces and an ephemeral bootstrap secret. Checks analyzer, workspace/finance API scenarios (including PATCH and multipart), direct/spoofed cron refusal, weak password refusal, bootstrap and session/account persistence after restart. Terminates owned processes and removes only its app's database containers. Original secrets/databases are untouched. Keep output logs private.

Local cron is refused because its header metadata is caller-controlled; use the authenticated company automation action. Managed cron, production service authentication/TLS and deployed proxies require deployment checks.

`tcp_scenarios.py` also supports disposable standalone servers: pass `--allow-demo-mutations`, `--url`, `--report`; `--api-only` omits the React document check. It mutates fictional fixtures; never target real company data.

Current additional gates from repository root:

For a running, fresh disposable fictional loopback demo, Chromium verifies the rendered sign-in, finance, nameless DM reuse, history/composer, thread, saved messages, task disclosure gate, phone navigation and voice-preview flows. Set SCHACH_SMOKE_URL to its loopback address (the default is port 8080):

```sh
SCHACH_SMOKE_RESULT=/tmp/schach-web-app-result.json node verification/runtime/web_app_smoke.mjs --allow-demo-mutations
```

This creates a private fictional DM and messages, changes its publication policy, and records/discards a fake microphone preview. It writes desktop/phone screenshots beside the private result file; SCHACH_SCREENSHOT_DESKTOP and SCHACH_SCREENSHOT_MOBILE can override their paths. The legacy entry point delegates to connect_ux_smoke.mjs. It does not send media, test physical devices or certify calls. Use a fresh database so the fixture can check that exactly one canonical DM exists.

```sh
python3 verification/runtime/compose_smoke.py --output /tmp/schach-compose-evidence
TEST_DATABASE_URL='postgres://...disposable-owned-instance...' TEST_CLAMAV_ADDRESS='127.0.0.1:13310' python3 verification/runtime/standalone_smoke.py --postgres-container YOUR_OWNED_CONTAINER --allow-demo-mutations --output /tmp/schach-standalone-evidence
TEST_DATABASE_URL='postgres://...disposable-owned-instance...' python3 verification/runtime/encore_export_smoke.py --postgres-container YOUR_OWNED_CONTAINER --allow-demo-mutations --output /tmp/schach-encore-export-evidence
```

The Compose probe uses a newly random-named project, private fictional bootstrap credentials and a loopback port. It builds both binaries/current web, verifies every migration ledger version, app health and non-root media access, then removes only its owned volumes/network/containers and temporary configuration. Existing Compose projects are not adopted. Docker images/build cache remain for subsequent development.

These probes mutate disposable fictional data and create/drop their owned schemas/databases, processes and networks; never point them at a real company database. The standalone gate requires a real configured ClamAV address, exercises actual TCP/proxy sockets, SIGKILL ACK/retry recovery and coordinated pg_dump/private-media restore. Keep its SQL dump/logs private. The Encore export gate uses a newly created `workspace` physical database for the pinned exporter/runtime name-mapping constraint and fails safely if that name is already occupied; it never adopts or drops an existing database. It exercises the actual exported Encore runtime without development watchers, all 91 original API assertions, sockets/revocation and restart.

Optional service/load tests run from `backend/`: set TEST_DATABASE_URL plus TEST_CLAMAV_ADDRESS/TEST_LIVEKIT_CONFIG for real scanner/provider tests; the private LiveKit JSON contains `url`, `key`, `secret`. `TEST_COMMUNICATION_LOAD=1 go test ./platform -run TestCommunicationGatewayLoadAndOverflow -v` measures 100 real TCP/proxy sockets and explicit overflow close/refetch locally. These are local fixtures, not production load or physical-device certification.

The reporting foundation has a separate Chromium acceptance probe. Run it only against an owned disposable fictional loopback demo; it creates a project/task, revises a timed deadline, accepts the task and exports the selected report:

```sh
SCHACH_SMOKE_URL=http://127.0.0.1:8083 SCHACH_SMOKE_RESULT=/tmp/schach-report-result.json node verification/runtime/reports_smoke.mjs --allow-demo-mutations
```

Optional SCHACH_SCREENSHOT_DESKTOP and SCHACH_SCREENSHOT_MOBILE paths capture desktop/390px results. This verifies exact original/current rates, a same-date time revision, project filtering, presets, CSV deadline fields and phone overflow/touch targets. It does not certify native devices.
