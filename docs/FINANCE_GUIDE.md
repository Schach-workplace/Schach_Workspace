# Department budgets and categorized expenses

This upgrade connects departmental work to the resources used to deliver it. Each company has its own currency, financial year, budgets, expense categories, expenses, receipts and financial history. Use the server edition for shared operations. The browser preview is an explicitly fictional, local evaluation of the same interface.

## The design decisions

A useful CEO dashboard must answer five questions: what has been allocated, what is already committed, what has actually been recorded as paid, what is awaiting a decision, and who owns the underlying expense. An undifferentiated “spent” number cannot answer those questions reliably.

The chosen model uses **one allocation envelope per department and non-overlapping period**. Categories classify expenses drawn from that envelope. This avoids adding category allocations on top of department allocations and double-counting the same budget. For example, Engineering may allocate ₹10 lakh, then classify its expenses as software, equipment, travel and professional services. The category breakdown explains where the allocation is going; it does not create extra available money.

Budgets may cover a full financial year or a smaller inclusive period within it. A department can use consecutive monthly or quarterly envelopes if preferred. Two envelopes for that department cannot overlap, even if one is draft or closed. Financial-year reporting includes the applicable active and closed allocations; draft allocations do not contribute to available funding.

Money uses integer minor units throughout the API and database. Entering `1234.56` INR stores `123456` paise exactly. No binary floating-point amount is accepted by the server. The supported currency set is INR, USD, EUR, GBP, AED, SGD, AUD and CAD. There is one currency per company and no automatic conversion or cross-company financial consolidation.

## Set up a company

1. In **Settings → Company → Edit details**, choose the currency and financial-year start. New companies default to INR and April. These settings can be changed until the first budget or expense is recorded, after which they are locked to preserve the meaning of historical figures.
2. Create departments and add people with the correct company role and reporting line. An expense must have a department. Heads, managers and members can create expenses only for their assigned department. Company financial authorities can create their own expenses against any company department.
3. In **Finance → Manage categories**, review names and receipt policies. Newly created companies start with Materials, Equipment, Travel, Software, Professional services, People & administration and Other. All default categories require receipts, with an explicit exception route when a receipt is unavailable. An upgraded version-1 server company starts without categories and can create the categories it actually needs.
4. Use **Set budget** to create each department's allocation. Select the department, name, dates, amount and draft/active state. Draft allocations can be prepared before activation. Activate the envelope before normal department-head approvals begin.
5. Assign at least one independent reviewer. An expense creator cannot approve, reject or record payment for their own expense, even if they are the founder. A single-user company therefore needs another eligible person before expenses can complete the decision workflow.

## Roles and responsibilities

| Role | Financial visibility | Budgets/categories | Approvals | Payment records |
| --- | --- | --- | --- | --- |
| Founder, CEO, company admin | Entire current company | Manage | Other people's submitted expenses; reasoned budget overrides permitted | Other people's approved expenses |
| Finance | Entire current company | Manage | Other people's submitted expenses; reasoned budget overrides permitted | Other people's approved expenses |
| Department head | Current department plus own historical expenses | Read current department | Other people's department expenses within an active sufficient budget | No |
| Manager/member | Own expenses | No departmental balance | No | No |
| Viewer | No finance records | No | No | No |

The Finance role does not grant company administration, membership editing or broad access to private work. Its task access follows the normal ownership/creation/collaboration/reviewer rules. A financial record may refer to a task that the finance reader cannot see. The hidden reference is omitted from the response and is not exposed through generated change-history text.

A head who changes departments still has access to their own older expenses. **Department finances** shows the current department's complete figures; **My expenses** shows the head's own records across departments. This separation prevents a partial subset of old expenses from becoming a misleading department balance.

## Expense lifecycle

### Create and submit

Choose **New expense** and enter a title, vendor/payee, invoice number if available, incurred date, category, gross amount and business purpose. The date must be on or before today in the company's timezone. A task or project link is optional and must be accessible, in the same company and department, and consistent with the other link.

**Save draft** keeps the record editable by its creator. Attach receipts from its detail sheet. PDF, PNG, JPEG, WebP, TXT and CSV files are supported up to 10 MiB each. The server verifies extension/content compatibility, sanitizes names and rechecks receipt access when downloading.

If a required receipt is unavailable, provide a specific exception explanation of 12–4,000 Unicode characters. A short placeholder does not satisfy the requirement. The exception is visible to the reviewer, who must enter an independent acceptance note if approving it. Receipt requirements are checked again at approval in case the category policy changed after submission.

Choose **Submit for approval** when ready. The record becomes read-only economically while submitted. The creator can **Withdraw to draft** to correct it; withdrawal clears the current submission timestamp while retaining the history. A rejected expense can be corrected and submitted again.

### Approve or reject

An eligible reviewer sees the expense, receipts, missing-receipt explanation, department budget and resulting available amount. The creator is never eligible to approve or reject it. A department head can approve a colleague's expense only when a matching active budget has enough remaining capacity.

If there is no matching active budget, it is closed, or the expense exceeds availability, a company financial authority can choose an explicit override and record a reason. The overrun remains visible; the system does not manufacture extra allocation. Rejection needs a meaningful reason and returns the expense for correction.

Approvals run under a company transaction lock with the current membership, current expense version and current budget consumption. Two requests cannot successfully spend the same remaining allocation without the required override. The source includes a simultaneous-handler regression, while native PostgreSQL multi-connection validation remains a deployment gate.

### Record a payment

After the actual payment has occurred outside the app, an eligible person can **Record payment** for an approved expense. Enter the payment date, method and external reference. Methods are bank transfer, UPI, card, cash and other. The date must be between the expense's incurred date and today.

This records the full payment and updates the status to **Paid**. It does not initiate a bank transfer or prove bank settlement. The same independent person may approve and record payment; the creator remains excluded from both actions.

Paid financial details are final. A void expense is also final. This release does not implement refunds, partial payments, reversing journals or bank reconciliation. Corrective financial transactions require an extension with a properly auditable reversal model rather than rewriting paid history.

### Void and append evidence

The creator may void a draft, rejected or submitted expense with a reason. An independent eligible reviewer may void an approved expense with a reason. Paid records cannot be voided through this workflow.

Receipt files remain append-only, including after payment or voiding, and only the creator or a company financial authority may append them. Uploading evidence increments the expense version. If a reviewer had a decision open, it must be reopened against the new version before proceeding. Existing files and previous decisions are not silently overwritten.

## Reading the numbers

The financial-year screen groups each status explicitly:

| Figure | Definition |
| --- | --- |
| Allocated | Active and closed department envelopes in the selected financial year; drafts excluded |
| Pending | Submitted expenses awaiting approval |
| Approved, unpaid | Approved expenses without a payment record |
| Paid | Expenses with a recorded full external payment |
| Used | Approved, unpaid + paid, counted once |
| Available | Allocated − used |
| Exposure | Used + pending |
| Unbudgeted used | Approved/paid expenses without a matching included non-draft envelope |

Draft, rejected and void expenses do not consume the allocation. Pending submissions are visible exposure and do not silently reserve funds. Payment moves an expense from approved to paid; it does not consume the budget a second time. Amounts follow **expense date**, even if payment is recorded in another financial period. The screen therefore reports budget utilization, not a cash-flow statement.

### Example

Suppose Engineering has a ₹10,00,000 allocation. It has ₹2,00,000 paid, ₹1,00,000 approved but unpaid, and ₹50,000 submitted:

| Result | Amount |
| --- | ---: |
| Budget used | ₹3,00,000 |
| Budget available | ₹7,00,000 |
| Pending approval | ₹50,000 |
| Total exposure | ₹3,50,000 |

If the approved ₹1,00,000 is later marked paid, used remains ₹3,00,000 and available remains ₹7,00,000. Only the approved/paid breakdown changes.

Click a department to inspect its envelopes, category spending and expenses. Filter the ledger by status, category, creator or text. **Export expenses** exports the selected financial-year and filter scope, including creator, vendor, amount, dates, status and payment/reference information. CSV formula-leading text is neutralized. Exported files remain outside the application's access-revocation control after download.

## Budget changes and history

Before activation, a draft's department and dates can be revised. After activation, those boundaries are permanently frozen, including after closure. An active budget can be closed and a closed budget can be reopened with a reason. Closing prevents ordinary approval against it; already approved payment records can still be entered.

An authorized amount reduction below committed spend is permitted with a meaningful reason. Existing obligations remain recorded and available becomes negative. This is more informative than hiding the overrun or erasing expense history. Review the old/new allocation and reason in finance history.

Every financial update/transition uses a version. When a version conflict occurs, load the latest record and review the new information before retrying. Budget/category/expense history records actors, times and relevant changes. The UI receives the latest 1,000 visible financial events; older history remains in the database. It is an application audit trail, not an externally tamper-proof ledger.

## Mobile workflow

Use **More → Finance** from the bottom navigation. Department cards and summary tiles reflow, the ledger scrolls within its panel, and the expense sheet fills available height. Core tasks—save a draft, attach a receipt, submit, review and record payment—remain available without desktop-only drag interactions. Device rendering and real keyboard/touch validation must still be performed on the chosen deployment; DOM simulations do not certify layout.

## Upgrading an existing installation

The ZIP includes both standalone and Encore migration 2, matching byte for byte. A new Compose database applies migrations 1 and 2 in order. Initialization scripts do not run again for an existing database volume.

For an existing standalone PostgreSQL version-1 installation:

1. Retain a recoverable database backup and a copy of the currently deployed release. Rehearse the upgrade against an isolated restored database.
2. Stop application writers and the scheduler during the controlled schema change. Use a migration database identity with the required privileges.
3. From the extracted repository root, apply only migration 2:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f backend/migrations/2_department_finance.up.sql
   ```

4. Record the applied version in the deployment's migration ledger. Deploy the new backend and API-mode frontend together.
5. Verify sign-in, company and role scopes, old tasks/evidence, finance setup, an independent test expense review, and receipt download in the restored/test environment before opening real access.

Keep existing data volumes intact. Do not run the version-1 creation script again. Do not apply a down migration as an upgrade or financial reversal: migration 2 down deletes financial history. Encore applies its mirrored numbered migrations through its managed migration workflow; follow `encore/README.md` for its actual environment configuration.

Existing companies receive INR/April defaults with no invented budget/expense records. Choose the correct currency/year before recording new financial activity. The browser preview preserves stored v1 demo work and adds empty finance collections/default categories; Reset sample data deliberately replaces the browser demo with the new fictional fixture.

## Scope and next extensions

This release handles department budget control and gross expense accountability. It does not claim to replace an ERP or accounting ledger. The next useful extensions are configurable approval thresholds/delegation, invoice OCR with human verification, purchase orders and matching, audited payment reversals, accounting exports/integration, server-paged historical reports, SSO/MFA and configured external notifications. Requirements, accounting policy and deployment validation should determine their order.

The inspection register also retains two older work-module gaps: auditable time-entry corrections, and optimistic versions for organization/project/goal edits. They are recorded as open follow-ups rather than reported as completed finance features.

## Design references

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): least privilege, object scope and per-request permission checks informed the access model.
- [OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html): server-controlled transitions and authorization against the data being decided informed the decision model.
- [Stripe currency documentation](https://docs.stripe.com/currencies): an example of integer minor-unit amount conventions. No Stripe integration is included.

These are design references, not certifications of this application. Executed evidence is in `VERIFICATION.md` and the reproducible verification harnesses.

## Optional receipt and statement assistance

Manual expense entry remains available. Finance → Receipt extraction stages a private file; reserve, reselect the same bytes, stage and request scanning. After clean assessment, opt into local extraction. Existing expense receipts offer clean assessment and extraction separately. Review candidates as suggestions: type or select the title/vendor/invoice/date/amount, choose the actual category and destination, resolve each listed uncertainty and review linked work. Review the current finance audience and explicitly publish an independent evidence copy before creating/updating a **draft**. Submission, independent approval and payment remain separate controls.

A camera first reserves a real private receipt source, then binds the freshly authorized camera bytes once. Cancelled camera capture cancels that reservation. A confirmation failure offers retry of the same frozen intent; prior work may exist. Open current private sources after refresh failure. Never recapture merely to replay an already bound reservation. Fetched candidates/source details disappear during current-access rechecks; same-principal authored review stays in session RAM and expires on denial/logout/policy change.

Duplicate review compares only accessible current source pairs. Similar invoices/content/vendor amounts are suggestions requiring judgment. Explain a false positive before dismissing it. The original exact non-void vendor/invoice rule still applies after dismissal.

Finance authority can import UTF8 CSV with an explicitly selected header/delimiter/date/decimal/grouping/amount mode and column numbers. Debits are negative, credits positive; unsupported formats/errors require correction/remapping. Review every normalized record before importing. Two equal records remain two occurrences. Reimporting the same file requires a deliberate explanation; retained rows and totals remain independent of scratch expiry.

Reconciliation links one full negative statement row to an already recorded paid expense. Select the expense deliberately and explain the review. Credits, partial amounts and ambiguities stay visible as discrepancies. Unmatch preserves the association history and recorded payment. None of these controls initiates an external transfer or edits paid economics. Individual and aggregate amounts use exact minor units, including totals above JavaScript's safe integer limit.

Native More includes Finance, Projects, Reports, Requests and Account. Account retains notification hints/device controls/quiet hours/MFA/password/recovery/sign-out. Private account outputs are withheld on current-scope changes. Camera/photo/files/physical keyboard, accessibility and iOS signing require actual device qualification; bundle export alone does not certify those paths.
