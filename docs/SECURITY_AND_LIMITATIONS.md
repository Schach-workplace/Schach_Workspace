# Security boundaries and practical limits

This document describes the source package and the controls a deployment must supply. It is not a penetration-test certificate. Read the release verification record for checks actually executed; a listed test or documented requirement is not evidence that it passed in your infrastructure.

## Authentication implemented in the shared Go service

`backend/platform/auth.go` and `server.go` implement password authentication for both runtime adapters:

- Passwords are salted and hashed with PBKDF2-HMAC-SHA256, 600,000 iterations, a random 24-byte salt, and constant-time comparison. Accepted passwords contain at least 12 Unicode characters and no more than 256 UTF-8 bytes; no password hash is serialized in the user API response.
- Sign-in generates 32 cryptographically random bytes, encoded as a 64-character opaque token. The database stores its SHA-256 digest, user ID, creation time, and expiry; it does not store the usable token.
- The `schach_session` cookie is host-only, scoped to `/api`, `HttpOnly`, and `SameSite=Lax`. `Secure` is configurable and must be enabled for HTTPS production. Default absolute expiry is 72 hours; the supported range is 1–720 hours. This is not a sliding inactivity timeout.
- Logout removes the matching session. Password change checks the current password and removes other sessions. Bootstrap refuses to initialize a database that already contains users.
- Login throttling permits six attempts per email/client-address pair in a 15-minute window. Counters are process-local, reset on restart, and do not form a distributed abuse-control service. Add a reverse-proxy or gateway limit for a public deployment; decide how that gateway handles trusted client addresses.

Use TLS for the entire application, not only sign-in. Restrict access to session-bearing logs, database snapshots, and credentials. The cookie protections and the reason for TLS are covered by [OWASP's session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Browser origin policy

Unsafe methods and preflight requests reject a supplied origin unless it matches the direct request origin or an exact configured origin. A browser request with no `Origin` and `Sec-Fetch-Site: cross-site` is also rejected. Non-browser clients may omit both headers; they still need a valid session and resource authorization. `Origin: null` is not an allowed origin.

Allowed origins use `scheme://host[:port]`, without a path, query, or wildcard. Configure the public HTTPS origin explicitly when TLS terminates at a reverse proxy, because the Go handler sees the upstream HTTP connection. Credentialed CORS replies echo an accepted origin; they do not use `*`. Only the headers and methods needed by the application are enabled. Do not put an untrusted site into the allowlist to solve a CORS error. See [OWASP's CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

API responses set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: same-origin`. These response headers do not provide TLS, malware scanning, or protection from a compromised trusted origin.

## Authorization contract

The authoritative role and company requirements are in [PRODUCT_SPEC.md](PRODUCT_SPEC.md) and [API_CONTRACT.md](API_CONTRACT.md). They must remain true in both the standalone and Encore adapters:

| Boundary               | Required behavior                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company                | Resolve an active membership for the authenticated user and the company in the URL. Platform ownership does not grant a membership bypass.                                |
| Leadership             | Founder, CEO, and company admin can administer their company; they cannot act in another company without membership.                                                      |
| Department and manager | A department head is scoped to that department; a manager sees reports and their own work.                                                                                |
| Member                 | Task visibility follows ownership, creation, collaboration, and assigned review. Visibility alone must not grant administrative edits.                                    |
| Finance                | Company financial authority; does not gain people administration or broad work access.                                                                                    |
| Viewer                 | Read-only work visibility; deny mutations, collaborator actions and finance records.                                                                                      |
| References             | Owners, reviewers, departments, projects, parents, dependencies, goals, attachments, and notifications must resolve inside the current company and applicable role scope. |
| Approval               | An accountable owner cannot approve their own required work review. An expense creator cannot approve/reject/pay that expense, including when the creator is a founder.   |

Task edits use optimistic versions to reject stale writes. Original deadlines must remain intact and deadline changes require a reason. Audit records support operational accountability; they are ordinary database records, not an independently tamper-proof ledger. The application database and its administrators are trusted components. Do not claim separate physical tenant databases or PostgreSQL row-level-security enforcement unless those are added and verified.

Company mutations acquire a database lock and reload the actor's membership before checking permissions and graph relationships. Membership edits validate the current target role and reporting chain within that transaction; task edits validate current parent and dependency edges. PostgreSQL uses a company-row `FOR UPDATE` lock. This serializes business mutations within a company. Ordinary messages instead lock the current session, sorted company memberships and their conversation; chat sends avoid the company business lock. Large-company throughput still needs deployment measurement.

## Evidence, exports, and notifications

The shared upload implementation accepts PDF, PNG, JPEG, WebP, plain text, and CSV up to 10 MiB per file. It checks the extension against detected content, sanitizes the filename, and stores bytes in the database. Authenticated downloads recheck the linked task's visibility and use attachment disposition, `nosniff`, and a restrictive content security policy. Office documents must be exported to an accepted format such as PDF. A format allowlist is not antivirus. Deployments that need malware scanning, organization storage quotas, or regulated retention must supply and verify those processes. [OWASP's upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) explains the distinction.

CSV data can contain spreadsheet formulas and personal information. The frontend exporter quotes cells and neutralizes formula-leading text. Exports use the selected visible task or expense set, with financial-year/status/category/department filters reflected in finance CSV output. Preserve these controls when adding export formats; treat downloaded reports as sensitive once they leave the application, because the app cannot revoke a copied CSV.

Notifications are records for the in-app inbox. Assignment, nudge, comment, or reminder creation does not establish delivery by email, SMS, WhatsApp, Slack, or a mobile push provider. No real outbound notification provider is configured by default.

## Deliberate limits

The password-based API supports optional TOTP MFA and hashed single-use recovery codes, with enrollment secrets encrypted using an operator-supplied key. Enterprise SSO and an email-driven password-reset service are not implemented. The operator recovery command requires database access, resets an existing account, revokes all its sessions, and records an audit entry; see [Operations](OPERATIONS.md). The local browser demo is for evaluation and is not an authenticated multi-user deployment. SQLite is an evaluation option; production PostgreSQL, TLS, backup restoration, monitoring, and deployment access policy remain operator responsibilities.

Recurring jobs must be run through the documented runtime strategy. A process-local ticker is not distributed scheduling. Database idempotency protects supported repeated operations; it does not make every application action safe to retry. Run only one scheduler until concurrent scheduling has been verified for the deployed database and application revision.

Workload and delivery metrics describe recorded work. Self-reported time, task counts, estimates, and deadlines are not payroll, surveillance, or an automatic employee-quality score. Review denominators, blockers, reassignment history, and task complexity before drawing personnel conclusions.

## Deployment gate

Before real use, verify unauthorized and cross-company access, department/manager scope, viewer write denial, required-review segregation, stale writes, foreign references, uploads/downloads, session expiry/revocation, rejected origins, and recurrence concurrency on the deployed runtime. Run a backup restore into an isolated database. Keep actual command results and any unresolved findings with the release; do not convert an unexecuted checklist into a claim of verification.

## Finance boundaries and remaining gaps

Money is stored in integer minor units, with company currency and fiscal-year settings locked after the first financial record. Budget approval and version checks execute under the same company lock as membership revalidation. Financial uploads have an expense-specific permission path; finance visibility does not reveal a private linked task/project ID, nor grant access to the task. Access-denied workspace queries clear cached content and refresh company memberships instead of displaying a stale denied-company snapshot.

Budget overruns can be authorized by company financial authorities with a recorded reason. Those overrides and reductions below committed spend remain visible, including negative available balances. This is a policy feature, not a hard bank spending limit. The same independent person may approve and record payment; separation into three distinct actors, configurable approval thresholds and multi-stage delegation are not implemented. The immutable creator is always excluded from approval and payment.

The application has no automatic receipt OCR, real banking, GST/VAT calculation or filing, purchase-order matching, partial payments, refunds, accrual accounting, cash-flow statement, employee reimbursements transfer service, multi-currency conversion or intercompany consolidation. Gross expenses are attributed to budgets by incurred date. Existing time logs remain append-only with no correction workflow; organization/project/goal edits do not yet have the new financial record version controls. These are explicit follow-ups in [FINANCE_UPGRADE.md](FINANCE_UPGRADE.md), not implied features of this release.

## Communication privacy and lifecycle

Conversation ACLs are distinct from task/finance ACLs. Leadership gets no private existence/content bypass. Private new/rejoined membership starts with future message history; quotes, threads, search, saved items, media, inbox and work-source projections enforce that boundary. Company membership removal is ordered against ongoing writes/delivery with database locks. Bytes already delivered/exported/in transit cannot be recalled.

Communication is company-managed and server-readable; it is not E2EE. Protected source content stays out of broad Activity/Notification text. Explicit selected publication rechecks source revision, current forwarding policy and destination authority; the server previews the current broader work audience. The task/expense record and any selected copied evidence become independent records. Neither having source access nor receiving a poll/acknowledgement authorizes assignment, task acceptance or financial approval/payment. Work links disclose no hidden target ID/count; briefings consume currently authorized published work, not private DM harvesting.

Message retries, conversion retries and primary-action claims are durable and payload-bound. Current access is checked even on replay. Leased workers can run again; this does not establish exactly-once provider delivery. Timed deadlines preserve absolute/original instants and IANA zones; DST gaps/folds require an explicit offset. Timed recurrence is deliberately rejected while original all-day recurrence remains supported. Added acceptance evidence bumps work version; a reviewer inspecting version N cannot accept version N+1.

Chat media uses private storage and fail-closed ClamAV scanning; existing task/receipt format checks remain compatible and do not become a universal antivirus service. Selected owner exports require the selected-publication policy, a purpose and an audit record; they export only current authorized messages, without historical revisions/media bytes. Text/media retention scrubs live derived content and retains non-content retry tombstones; restoration requires reapplying retention. Backups and exported copies have separate expiry/ownership.

Native tokens use platform secure storage and HTTPS in release builds. Company/account/origin changes, logout and confirmed permission/history revocation cancel requests and clear affected private authored drafts. Temporary background cancels requests and hides/clears server-fetched history and records; explicitly authored input and frozen pending sends may remain only in process RAM and return after fresh authorization. Normal same-company navigation retains isolated RAM drafts. Private authored drafts are never written to disk/localStorage. Selected capture/upload files use owned temporary cache with explicit destination and cleanup; downloads are temporary until deliberately shared. This is cooperative client cleanup, not forensic remote erasure. FCM/APNs payloads contain generic hints only. Self-hosted call signaling must pass the revocable Schach gateway, with provider signaling inaccessible from outside. Recording is disabled. Read [communication operations](COMMUNICATION_OPERATIONS.md) for the required physical-device, TLS/TURN, signed-delivery, identity and recovery gates.
