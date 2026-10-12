# Team end-to-end test run

The catalog is a set of **proposed manual scenarios**, initially NOT_RUN.
Automated references help reproduce controls; they are not recorded passes for
your team, device, environment or release.

## Run in dependency order

1. Prepare the isolated environment and actors in TEST_ENVIRONMENT and TEST_DATA.
2. Smoke: AUTH, SETTINGS/company switch, OVERVIEW, WORK and readable task data.
3. Core workflow: TASKS, PROJECTS, CALENDAR, WORKLOAD and GOALS.
4. Communication: CONNECT, structured decisions/daily work, MEDIA and INBOX.
5. Financial workflow: FINANCE; then REPORTS and recipient-bound report delivery.
6. Administration: PEOPLE onboarding/access review; save revocation/departure for
   separate fixtures so earlier positive cases still have eligible actors.
7. Optional providers: INTELLIGENCE and CALLS when configuration is verified.
8. Cross-module JOURNEYS, SECURITY and unknown-ACK/conflict/revocation recovery.
9. MOBILE on required Android/iOS builds and devices; OPERATIONS/staging gates.

Run every P0 in the applicable environment, not just the happy path. A LOCAL
case may need an operator-controlled harness for a deterministic race; follow
its preconditions and do not substitute a hand-timed click for committed
ordering proof. The CSV/workbook includes a gate column to identify prerequisites.

## Test execution sheet

Open `test-scenarios.xlsx` or import `test-scenarios.csv` into your spreadsheet.
The `Execution log` sheet is editable and the workbook Summary counts statuses.
Use a fresh copy for each release/environment/device matrix. The offline
`index.html` can search/filter scenarios without an internet connection.

For each case record Run ID, source SHA/build, environment, actor/role, tester,
date/time, device/browser, status, actual observations, sanitized evidence link,
defect ID and blocked/skip reason. Case IDs remain stable across the pack.

| Status | Meaning |
| --- | --- |
| NOT_RUN | No observation for this run |
| PASS | All numbered expected results observed in the named environment |
| FAIL | At least one expected result contradicted; defect/evidence recorded |
| BLOCKED | A named prerequisite is absent, unavailable, or unsafe to exercise |
| SKIPPED | Deliberate non-applicability/deferral with owner, reason and signoff |

If a long scenario partly passed and later blocked, keep the partial results
in Actual observations and mark the whole case BLOCKED. Do not hide a failed
step by replacing it with a later pass. Retests have separate run evidence.

## Evidence and defect quality

Use `defect-template.md` and `defect-log.csv`. A useful defect records the
smallest reproducible trigger, expected/actual behavior, current source/build,
role/company aliases, network/provider state and whether the canonical business
action committed. Avoid recording private message text, passwords, cookies,
tokens, raw inference input/output, dumps or copied production records. Keep
unredacted QA evidence private and share only reviewed sanitized material.

Distinguish these outcomes:

- **Application defect:** the required behavior fails with its prerequisites met.
- **Environment/configuration blocker:** provider, TLS, signing, device, test
  account, compiler or private fixture is missing; name it, do not mark PASS.
- **Harness defect:** wrong route/filter/selector or unproven timing/order;
  correct the harness and retain the failed attempt separately.
- **Documented limit:** unsupported feature or execution guarantee; assess
  against the stated contract rather than an invented success expectation.

See FAULT_INJECTION for controlled acknowledgement loss and source revocation.
An unknown result must retry the original key/body/target; a confirmed version
conflict needs deliberate current-version review. Those are different paths.

## Release signoff

Use `release-signoff.md`. Suggested release condition: applicable P0 cases pass;
no open privacy/company-isolation/approval/exact-money/idempotency/commitment
defects; P1 coverage and any deferral reviewed by the product owner. This is a
team acceptance proposal, not an existing production certification.

Separate local implementation acceptance from physical Android/iOS, signed
release HTTPS auth/MFA/recovery, India deployment/TLS, real LiveKit/TURN calls,
APNS/FCM, representative Hindi/domain model accuracy, measured capacity and
backup/restore objectives. A blocked external gate stays open until observed.
RPO 15 minutes, RTO four hours and 35-day retention are proposed targets to
measure in your deployment, not historical guarantees.
