# In-process HTTP handler integration

This isolated Go module creates a fresh in-memory SQLite database with `platform.Migrate` and the explicit fictional `platform.SeedDemo` fixture. It initializes the real `platform.Server`, then sends JSON-line requests through `httptest.NewRequest` and `httptest.NewRecorder`. **It never opens a listening socket.** No caller identity or role is injected: clients sign in through the normal API, receive opaque session cookies, and use the same authorization checks as the application.

## Reproduce the workspace and finance flows

Requirements: Go 1.25 or later, a C compiler for the SQLite driver, and Python 3. The recorded bridge run used Go 1.27.2 and Python 3.12.14 on Linux. The Python bridge runner uses selectable subprocess pipes; the commands below target a Unix-like development environment.

From the repository root:

```sh
cd verification/httpbridge
go build -o /tmp/schach-httpbridge .
cd ../..
python3 verification/http_flow.py --bridge /tmp/schach-httpbridge --allow-demo-mutations --report verification/http-result.json
python3 verification/finance_flow.py --bridge /tmp/schach-httpbridge --allow-demo-mutations --report verification/finance-result.json
```

The separate module imports `schach.local/workspace/backend` through `replace ../../backend`; keep the full extracted source tree together. The binary can live outside the project. No application dependency files need modification.

`http_flow.py` starts exactly one bridge process for the sequence. Each founder, department head, member, and viewer client keeps its own `SimpleCookie` state. Binary request and response bodies use base64, so multipart uploads and evidence downloads preserve their bytes. Mutation success responses are asserted as HTTP 200, matching the shared API's `{ok:true,id?:string}` contract.

The flow checks authentication and origin rejection, company creation/isolation, departments and scoped roles, projects/goals, task assignment and stale versions, deadline history, review/reopen rules, comments/time/evidence, atomic imports, automations, audit events, notifications, and logout. Logout also retries the old cookie to verify server-side revocation. The static React document assertion is skipped in bridge mode because static files belong to the standalone adapter.

The separate **53-check finance flow** creates fresh fictional companies and all eight role scenarios through the real API. It checks integer money boundaries, currency/fiscal-year locking, immutable expense ownership, budget overlap and period rules, independent approval and payment, receipt bytes and scope, stale decisions after new evidence, invoice duplicates, paid/void finality, scoped financial history, role changes and membership revocation. Future expense dates reject without advancing a draft's version, and multilingual text is accepted or rejected by Unicode character count at the documented limits. It also starts two approval handlers together when the same department budget can fund only one request: one approval succeeds and the other is rejected. A company authority must then supply a meaningful explicit override to approve the remaining request. Allocation revisions below existing use preserve commitments and expose negative availability.

The finance flow includes a regression for hidden work links: adding a private task/project to an expense must not disclose those identifiers in the finance reader's expense fields or change-history text. Each report records the relevant source hashes. Rebuild the bridge after changing the backend before recording a new result.

The command writes a sanitized report containing check names, counts, scope and any failure message. It prints the failing method/path, expected/actual status, and a bounded response excerpt when a request fails. Protocol errors are printed by the bridge to stderr; a missing response times out. No session tokens, passwords, fixture records, or evidence bytes are included in the successful result snapshot.

## Real HTTP mode is retained

For a separately running server pointed at an explicitly disposable demo database:

```sh
python3 verification/http_flow.py --url http://127.0.0.1:8080 --allow-demo-mutations --report verification/http-result.json
```

This mode uses Python's normal HTTP client and cookie jar, and additionally checks the standalone static React document. It creates fictional company records and should never target a live company database. Both modes require the explicit mutation flag.

## Protocol

The bridge reads one JSON object per line:

```json
{"method":"GET","path":"/api/health","body":"","headers":{}}
```

It returns one JSON line with `status`, `headers` (string values), and base64 `body`. Multiple values for the same response header are separated by newlines inside the JSON string. The runner reconstructs those header values before processing cookies. Stdout contains only protocol responses; diagnostics go to stderr. EOF closes the disposable database and exits.

For a coordinated concurrency check, one input line may instead contain `{"batch":[request,request]}` with 2–16 ordinary request objects and no top-level request fields. The bridge releases the handlers from a shared start signal and returns `{"responses":[response,response]}` in the original request order. This is an additive protocol extension; existing one-request lines and responses remain unchanged.

## What this proves

The recorded **38 workspace checks and 53 finance checks** are **in-process HTTP handler integration with GORM/SQLite**. They exercise actual handler routing, parsing, cookies, authentication, authorization, transactions and returned data. The simultaneous approval check uses concurrent Go handlers and the bridge's single SQLite connection. It verifies the observable shared-budget decision in this setup; it does not establish transaction isolation or locking across separate native PostgreSQL connections.

These checks do not establish TCP transport behavior, production TLS or proxy configuration, the standalone static-file server, native PostgreSQL/pgx behavior, Encore startup, distributed scheduling, or browser/mobile rendering. See the [workspace result](../http-result.json), [finance result](../finance-result.json), and [verification record](../../docs/VERIFICATION.md).
