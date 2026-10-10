# Schach Workspace: department finance and gap closure

## Intent and execution

The user requested a complete inspection and implementation of missing elements, explicitly including department budgets and categorised expenses. The existing instruction to deliver the whole tool in one pass remains the execution preference. This design records the choices used for implementation; no external deployment or bank payment is authorised or performed.

The goal is one connected account of work, departmental resources and spending. The selected design adds a financial-control module to the existing Go/GORM/Encore service and React app. An external accounting integration would add credentials and reconciliation dependencies; a simple unapproved expense list would leave leadership unable to distinguish requests, obligations and payments. This release implements the complete internal expense workflow with explicit accounting boundaries.

## Core decisions

- One currency per company: INR by default; supported two-decimal currencies are INR, USD, EUR, GBP, AED, SGD, AUD and CAD. Financial year starts in April by default (configurable month 1–12). Currency and financial-year month cannot change after any budget or expense exists.
- All amounts are integer minor units (paise/cents), from 1 to 1,000,000,000,000 for expenses; budgets allow zero. Human decimal input is parsed exactly and rejects more than two decimals. No FX conversion or automatic tax computation is represented.
- A budget is a department envelope for an inclusive date period entirely within one company financial year. Envelopes for the same department cannot overlap, including closed/draft ones. Category spending is a grouping of the same expenses, not an additional allocation pool.
- Budget states: draft → active → closed; closed can reopen to active with a reason. Active cannot revert to draft. Department and period boundaries freeze after activation. Amount revisions after activation and closure/reopening require a reason and preserve audit history; a below-used revision visibly produces negative availability. No deletion of financial history.
- Expense states: draft → submitted → approved → paid; submitted may be rejected or withdrawn to draft; rejected may be edited and resubmitted. Draft/rejected/submitted may be voided by their creator; independent approvers may void approved entries with a reason. Paid and void entries are final, with no destructive reversal shortcut.
- Approved expenses represent commitments; recording payment moves the same amount to paid. Used = approved-unpaid + paid, counted once. Pending = submitted, separately. Available = allocated − used; exposure = used + pending. Reports use expenseDate, not payment date, for budget attribution.
- Categories have active and receiptRequired flags. Required receipts are checked at submission and approval. A recorded receipt exception reason of at least 12 characters permits submission but always requires an explicit independent approval note of at least 12 characters. Receipts are append-only and scoped to the expense.
- Expense creator is immutable. No actor can approve, reject, or record payment on their own expense. Fields affecting the decision freeze after submission; withdrawal/rejection permits correction and another approval. Every field update/transition uses a version and refreshed permissions under the existing company transaction lock. Append-only receipts are an additive exception: uploads do not supply an expected version, but atomically advance the expense version, making older approval snapshots stale.
- No budget, a closed budget, or insufficient available budget requires an explicit override by founder/CEO/admin/finance with a reason of at least 12 characters. Department heads cannot override. Pending requests do not reserve money; approval rechecks the latest available budget within the lock.
- Expense dates represent incurred costs and cannot be later than company-local today. All new finance text maxima count Unicode characters; controlled reasons/notes require 12–4,000 characters.
- Recording payment requires a nonempty reference, payment method and valid payment date (expenseDate ≤ paidDate ≤ company-local today). This records an external payment; it does not transfer money.
- Duplicate non-void vendor/invoice combinations (case/space normalised within company) are rejected. If no invoice number is available it may be blank. An existing expense number cannot be reused to bypass the check by changing the person or department.

## Financial permissions

Add company role `finance`. It has company finance visibility, category/budget management, expense approval and payment recording, but does not acquire people/company administration or broad task editing.

| Role | Financial read | Create/edit | Approve | Record payment | Budget/category management |
| --- | --- | --- | --- | --- | --- |
| Founder / CEO / admin | Company | Own drafts/rejected | Other people's expenses | Other people's approved expenses | Yes |
| Finance | Company | Own drafts/rejected | Other people's expenses | Other people's approved expenses | Yes |
| Head | Own department + own expenses | Own drafts/rejected in own department | Other people's expenses in own department, within active budget | No | Read own department budgets |
| Manager / member | Own expenses | Own drafts/rejected in own department | No | No | None |
| Viewer | No finance data | No | No | No | No |

Creator and role boundaries are enforced on the server, not only by hidden UI controls. Explicit financial scope is `company`, `department`, `personal`, or `none`. Personal views never display incomplete company/department budget totals. Finance reads cannot expose otherwise-hidden tasks/projects through links. Linked task/project references must be accessible and department-consistent when written; hidden references are removed on read.

## Shared API and type contract

WorkspaceData gains arrays `expenseCategories`, `budgets`, `expenses`, `financeEvents`, and `financeScope`. All arrays are present, including for empty/unauthorised scopes. Company gains `currency` and `fiscalYearStartMonth`. Notification gains `expenseId` (empty for existing task notifications).

ExpenseCategory: `id, companyId, name, color, active, receiptRequired, version`.

Budget: `id, companyId, departmentId, name, startDate, endDate, amountMinor, currency, status, notes, createdBy, createdAt, updatedAt, version`.

Expense: `id, companyId, code, departmentId, categoryId, title, description, vendor, invoiceNumber, expenseDate, amountMinor, currency, projectId, taskId, createdBy, status, receiptExceptionReason, submittedAt, reviewedBy, reviewedAt, reviewNote, budgetOverrideReason, paidBy, paidAt, paidDate, paymentMethod, paymentReference, createdAt, updatedAt, version, receipts`.

Receipt has the existing Attachment metadata shape (`id, fileName, mimeType, size, uploadedBy, createdAt`) with a separate expense receipt store and download route. FinanceEvent: `id, companyId, departmentId, entityType, entityId, userId, action, detail, createdAt`. Events are scoped before limiting to the latest 1,000 and the interface discloses that recent-history limit. Full rows remain in the database.

All below are relative to `/api/companies/{companyId}` and return the existing MutationResult on success (200):

- POST `/expense-categories`; PATCH `/expense-categories/{id}` with version.
- POST `/budgets`; PATCH `/budgets/{id}` with version and `reason` for controlled changes.
- POST `/expenses`; PATCH `/expenses/{id}` with version; edits only by immutable creator in draft/rejected.
- POST `/expenses/{id}/transition` with `{version, action, note?, overrideReason?, paidDate?, paymentMethod?, paymentReference?}`. Actions: submit, withdraw, approve, reject, pay, void. Reject and void require notes of at least 12 Unicode characters; approved void requires an independent authorised approver.
- POST `/expenses/{id}/receipts`, multipart `file`, existing safe format/10 MiB limits. Upload by creator or company finance authority; version advances and event records uploader. No destructive receipt replacement.
- GET `/expense-receipts/{id}`, authenticated company and expense-scoped bytes.

New expenses always start draft. Server supplies identity, currency snapshot, actor, code, version and timestamps. Creation input includes the descriptive/reference/amount/date/receiptExceptionReason fields, not authoritative workflow fields. Budget create status may be draft or active for budget managers. Allowed paymentMethod values: bank_transfer, upi, card, cash, other.

## Interface

Dedicated Finance view with financial-year selection, summary, department budget drill-down, category breakdown, searchable/filterable expense ledger, budget/category forms, expense details/receipts/history and permission-aware transition actions. Show exact period and currency. Personal views say Your expenses. Approval form shows amount, vendor, category, budget impact, missing-receipt exception and override note before confirmation. Paid amounts are recorded payments, with no claim of bank reconciliation.

Add finance entry points to leadership overview and expense notifications. Existing mobile navigation and reusable dialog styles apply. Empty company onboarding links departments → people → projects/tasks and budget/category setup without invented sample metrics.

## Confirmed existing gaps to fix

1. Workspace 403 membership revocation leaves React Query's previous data visible: immediately hide/remove denied company data and refresh allowed memberships.
2. Accepted-work chart minimum-height bars imply activity for zero values: use true zero and explicit empty states.
3. Incomplete ARIA tab semantics: use ordinary labelled button groups with aria-pressed where full tabs are not implemented.
4. Report chart silently truncates periods over 3,660 days while totals do not: validate calendar dates and bucket the entire selected period consistently, without an arbitrary ten-year cap.
5. New companies lack actionable setup guidance: add a real-data onboarding checklist.
6. Recurrence can clone a reviewer who became read-only: skip the invalid recurrence and record an actionable notification/audit event.
7. Task activity scope must be applied before the recent 1,000-row limit.
8. Version-1-only migration tooling: add immutable migration 2, ordered upgrades and reverse-order rollback, including a populated-v1 upgrade check.

## Verification and boundaries

Tests cover money precision, fiscal boundaries, overlap, scope, cross-company IDs, immutable creator/self-approval, duplicate invoice, required receipt/exception, stale writes, concurrency around budget capacity, paid immutability and totals that never double count. Exercise actual shared handlers plus frontend DOM flows, rebuild API/demo bundles and standalone preview, and extend the PostgreSQL WASM migration probe.

This is an internal budget and expense-control module. It is not a general ledger, tax-filing system, payroll engine, purchase-order/inventory system, bank connection or reconciled accounting statement. Multi-currency conversion, refunds/partial payments, full accounting integration and external email/SSO/MFA remain explicit follow-up integration work. Existing native PostgreSQL/Encore/Docker/browser environment restrictions remain documented, not reclassified as passes.
