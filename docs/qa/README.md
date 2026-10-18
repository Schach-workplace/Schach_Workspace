# Schach Workspace team QA pack

Start with [the searchable offline guide](index.html) and [the Excel workbook](test-scenarios.xlsx).
This pack contains **224 proposed scenarios, 21 module/journey guides and 245 workflow diagrams**.
Every scenario starts **NOT_RUN**. These are test instructions, not a claim that your team has executed them.
The application source baseline is `191526bd2fda1970809529ab1d30b7cd54508512`.

## First team run

1. Follow [environment setup](TEST_ENVIRONMENT.md) to create an isolated fictional server, normally at port 9080. Keep the retained workspace at port 8080 out of mutation tests.
2. Prepare [test data and role matrix](TEST_DATA.md). Use separate browser profiles for independent actors and another company for isolation checks.
3. Copy the workbook for your release/environment. Follow [the team runbook](TEAM_RUNBOOK.md) in dependency order; filter by module, priority and environment gate.
4. Record each numbered observation in **Execution log**. Summary calculates statuses from that sheet. Record defects using [the defect template](defect-template.md) and [defect log](defect-log.csv).
5. Review [release signoff](release-signoff.md). Missing prerequisites are BLOCKED with an owner; partial runs do not become PASS.

## Files your team can use

| File | Use |
| --- | --- |
| [index.html](index.html) | Offline searchable scenarios, module filters, source references and diagrams; open after extracting the complete pack |
| [test-scenarios.xlsx](test-scenarios.xlsx) | Seven sheets: instructions, scenarios, execution log, summary, module coverage, device matrix and defects |
| [test-scenarios.csv](test-scenarios.csv) | All cases with actors, prerequisites, data, steps, paired expected results and cleanup |
| [execution-log.csv](execution-log.csv) | Spreadsheet-neutral recording template |
| [MODULE_INDEX.md](MODULE_INDEX.md) | Every module and its case count, guide and flow links |
| [WORKFLOW_GUIDE.pdf](WORKFLOW_GUIDE.pdf) | Printable module flows and 12 cross-module journeys; vector diagrams can be zoomed |
| [WORKFLOW_GUIDE.html](WORKFLOW_GUIDE.html) | Offline source of the printable guide |
| `modules/*.md` | Detailed module guides including every numbered scenario |
| `diagrams/*.svg` and `diagrams/*.mmd` | Ready-to-view vector diagrams and editable Mermaid for each module and each scenario |
| [FAULT_INJECTION.md](FAULT_INJECTION.md) | Controlled lost acknowledgements, conflicts, expiry and revocation; use only supported owned fixtures |
| [AUTOMATED_CHECKS.md](AUTOMATED_CHECKS.md) | Existing code test references and safe reproduction commands |
| [catalog/catalog.json](catalog/catalog.json) | Machine-readable complete catalog with stable case IDs |
| [validation-result.json](validation-result.json) | Documentation artifact checks; separate from application acceptance |

The offline guide makes no network requests while viewing. Source-code links require access to the private GitHub repository when clicked. Relative source links in Markdown resolve in the repository; the standalone ZIP includes the QA pack only. Extract the entire ZIP to keep local diagrams and catalog scripts together. Setup/build/validation scripts require the full repository checkout at the documented location; they are not standalone application installers. The ZIP manifest permits file integrity checking.

## Screen coverage

The 13 navigation screens in `frontend/src/App.tsx` map to the following guides:

| Screen | Guide |
| --- | --- |
| Connect | CONNECT, MEDIA, CALLS, INTELLIGENCE |
| Overview | OVERVIEW |
| My work | WORK |
| All tasks | TASKS |
| Projects | PROJECTS |
| Calendar | CALENDAR |
| Workload | WORKLOAD |
| Goals | GOALS |
| Finance | FINANCE |
| Reports | REPORTS |
| People | PEOPLE |
| Inbox | INBOX |
| Settings | SETTINGS |

AUTH covers sign-in/session/MFA boundaries. MOBILE covers native usability and private-content lifecycle across screens. SECURITY and OPERATIONS cover cross-cutting authority/runtime controls. JOURNEYS contains 12 complete flows across module boundaries, including onboarding → task → historical report, private message → reviewed task, budget → independent payment, receipt assistance → canonical draft, statement import → association/unmatch, report → Inbox, departure/handover, and mobile/provider failure recovery.

Module diagrams describe the implemented business flow, including denial paths. Scenario diagrams show the exact testing sequence; expected results remain in the numbered case table. They do not depict a suggestion as an approval, a token as a completed call, or a task as a verified goal outcome.

## Environment gates and boundaries

| Gate | Cases | Meaning |
| --- | ---: | --- |
| LOCAL | 136 | Isolated fictional API; controlled race harness where explicitly required |
| LOCAL_CONFIG | 68 | Additional private keys/storage/scanner/model/call configuration as named |
| DEVICE | 16 | Named Android/iOS device, build and physical usability/background qualification |
| PRODUCTION | 4 | Deployment/network/capacity/restore qualification in an owned staging environment |

147 cases are P0 and 77 are P1. Run all applicable P0 cases, including privacy, negative permissions, original deadline/money, independent decisions and retry controls. Web pixels do not prove native dp/focus/keyboard behavior. Actual LiveKit/TURN media, APNS/FCM, signed iOS/Android release authentication, India TLS, measured restore and provider accuracy/capacity retain their explicit gates. Call recording and automatic call transcription are disabled. Historical results in [VERIFICATION](../VERIFICATION.md) are source-qualified evidence, not new manual results.

## Maintain this pack

Edit the four source catalogs following [SCHEMA](catalog/SCHEMA.md), then run from the repository root:

```bash
python3 docs/qa/tools/build_pack.py
python3 docs/qa/tools/validate_pack.py
```

Rendering the PDF requires Chromium; opening the workbook for interoperability checks requires a spreadsheet application. Generated HTML, Markdown, CSV, XLSX, SVG and Mermaid contain the same case IDs. Regeneration resets distributed templates to NOT_RUN; keep actual team execution copies outside this generated directory. Never overwrite a completed run with the template.


The [18 October premium mobile, Development and Knowledge supplement](PREMIUM_MOBILE_GROWTH.md) adds39 proposed cases and three workflow diagrams for the new source. Its manual cases also start NOT_RUN; it does not silently change this pack’s original224 statuses.
