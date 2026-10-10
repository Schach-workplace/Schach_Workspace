# Runtime acceptance gates

From the repository root:

```sh
verification/runtime/encore-smoke.sh --output /tmp/schach-runtime-evidence
```

Requires Go, Encore CLI, Python and Docker. Copies backend/adapter into a temporary directory, uses owned disposable namespaces and an ephemeral bootstrap secret. Checks analyzer, workspace/finance API scenarios (including PATCH and multipart), direct/spoofed cron refusal, weak password refusal, bootstrap and session/account persistence after restart. Terminates owned processes and removes only its app's database containers. Original secrets/databases are untouched. Keep output logs private.

Local cron is refused because its header metadata is caller-controlled; use the authenticated company automation action. Managed cron, production service authentication/TLS and deployed proxies require deployment checks.

`tcp_scenarios.py` also supports disposable standalone servers: pass `--allow-demo-mutations`, `--url`, `--report`; `--api-only` omits the React document check. It mutates fictional fixtures; never target real company data.

Current additional gates from repository root:

For a running, explicitly fictional loopback demo, Chromium can verify the current rendered sign-in, finance, Connect and voice-preview flows:

```sh
SCHACH_SMOKE_RESULT=/tmp/schach-web-app-result.json node verification/runtime/web_app_smoke.mjs --allow-demo-mutations
```

This creates private fictional groups and records/discards a fake microphone preview. It does not send media, test physical devices or certify calls. The test checks the real server's media policy, rather than replacing it in a harness.

```sh
python3 verification/runtime/compose_smoke.py --output /tmp/schach-compose-evidence
TEST_DATABASE_URL='postgres://...disposable-owned-instance...' TEST_CLAMAV_ADDRESS='127.0.0.1:13310' python3 verification/runtime/standalone_smoke.py --postgres-container YOUR_OWNED_CONTAINER --allow-demo-mutations --output /tmp/schach-standalone-evidence
TEST_DATABASE_URL='postgres://...disposable-owned-instance...' python3 verification/runtime/encore_export_smoke.py --postgres-container YOUR_OWNED_CONTAINER --allow-demo-mutations --output /tmp/schach-encore-export-evidence
```

The Compose probe uses a newly random-named project, private fictional bootstrap credentials and a loopback port. It builds both binaries/current web, verifies every migration ledger version, app health and non-root media access, then removes only its owned volumes/network/containers and temporary configuration. Existing Compose projects are not adopted. Docker images/build cache remain for subsequent development.

These probes mutate disposable fictional data and create/drop their owned schemas/databases, processes and networks; never point them at a real company database. The standalone gate requires a real configured ClamAV address, exercises actual TCP/proxy sockets, SIGKILL ACK/retry recovery and coordinated pg_dump/private-media restore. Keep its SQL dump/logs private. The Encore export gate uses a newly created `workspace` physical database for the pinned exporter/runtime name-mapping constraint and fails safely if that name is already occupied; it never adopts or drops an existing database. It exercises the actual exported Encore runtime without development watchers, all 91 original API assertions, sockets/revocation and restart.

Optional service/load tests run from `backend/`: set TEST_DATABASE_URL plus TEST_CLAMAV_ADDRESS/TEST_LIVEKIT_CONFIG for real scanner/provider tests; the private LiveKit JSON contains `url`, `key`, `secret`. `TEST_COMMUNICATION_LOAD=1 go test ./platform -run TestCommunicationGatewayLoadAndOverflow -v` measures 100 real TCP/proxy sockets and explicit overflow close/refetch locally. These are local fixtures, not production load or physical-device certification.
