# Finance upgrade and inspection record

Base release: `864a8e4`. Upgrade branch: `build/schach-workspace-finance`.

## Decisions

- Continue the user-authorised one-pass implementation; preserve the existing release and record the design/plan in this package.
- One department allocation pool; categories classify those same expenses. This avoids counting category budgets twice.
- Financial role is independent of company administration. Ordinary viewers receive no finance records.
- Exact two-decimal money in supported currencies; no automatic FX or tax calculations.
- Paid financial fields are final; late receipts are additive and audited. Payment recording does not send bank funds.
- Budget department/period freeze after activation; amount revisions remain explicit with reasons and visible negative availability.

## Inspection register

| Finding | Assigned change | Status |
| --- | --- | --- |
| No department finance domain or reporting | Categories, budgets, scoped expenses, approvals, payments, receipts, exact totals | Implemented and regression checked |
| Membership revocation retained cached workspace | Hide denied data and refresh memberships | Implemented and regression checked |
| Zero-completion bars shown above zero | Honest chart values and empty states | Implemented and regression checked |
| Empty companies lack setup guidance | Actionable onboarding using real records | Implemented and regression checked |
| Incomplete ARIA tabs | Labelled button groups with pressed state | Implemented and regression checked |
| Report chart truncates long periods silently | Validate calendar dates and bucket the full selected range without a ten-year cap | Implemented and regression checked |
| Recurrence can retain a read-only reviewer | Eligibility check with actionable skipped-run evidence | Implemented and regression checked |
| Activity limited before scope filtering | Scope before recent-event limit | Implemented and regression checked |
| v1-only migration tooling | Ordered v2 upgrade and populated-v1 compatibility check | Implemented and regression checked |
| Append-only time entries lack corrections | Open follow-up: design auditable corrections; not used for financial records | Documented |
| Non-task organisation/project/goal edits lack versions | Open follow-up; all new financial edits carry versions | Documented |
| Native PostgreSQL/Encore/Docker/browser gates unavailable here | Preserve explicit deployment checks; execute supported handler/DOM/WASM checks | Documented |

## Additional review findings closed during implementation

- A private linked task/project ID could appear in generated finance change-history text; financial readers now receive neutral link-change wording when those references change.
- Demo finance mutations yielded between reading and saving. Two simultaneous decisions could both report success while one was lost. The scoped projection and mutation now run synchronously from the same fresh snapshot; competing edits and budget approvals are regression checked.
- Finance history now records before/after financial edits. Withdrawal clears current submission metadata. Explicit overrides are retained, and a head cannot supply a company override.
- Expense dates are incurred dates and cannot be in the future. Finance text maxima count Unicode characters consistently; short receipt-exception placeholders fail at draft save.
- Personal/head historical records retain receipt-uploader and decision-actor labels without opening broader work access.
- A head's department totals exclude their own expenses in a prior department; the separate personal perspective preserves access to those older records.
- Receipts appended during an open decision invalidate its version, so the reviewer must inspect the latest record.
- New companies receive real setup guidance and explicit currency/financial-year choices. Once financial records exist, those settings are frozen.

## Release contents and evidence

The upgraded source includes 2 fictional companies, 44 tasks, 14 budget envelopes, 19 expenses and 17 actual fictional receipt files embedded in the seed. Existing data is preserved by the documented version-2 upgrade; no financial history is invented for an upgraded production company.

Fresh execution details are recorded in [VERIFICATION.md](VERIFICATION.md). The independent handler checks exercise the real shared Go server, PostgreSQL WASM checks verify ordered schema/upgrade behavior, and DOM tests exercise rendered React workflows. Native PostgreSQL connections, Encore runtime boot, Docker deployment, real mobile rendering and operational restore remain explicit deployment gates.

## Prioritized next work

1. **Operational deployment:** validate native PostgreSQL, Encore or standalone hosting, TLS, backups/restore, device behavior and realistic tenant load on the chosen infrastructure.
2. **Identity and notifications:** choose SSO/MFA and notification providers, then implement their delivery/retry and account-recovery policies.
3. **Work integrity extensions:** auditable correction/voiding of time logs, and versions for organization/project/goal edits.
4. **Finance expansion:** configurable approval thresholds and delegates, purchase-order matching, verified OCR, reversal records, bank/accounting integration, and historical reporting APIs.

The present finance workflow uses one independent approver and an external payment record. It does not perform bank transfers, tax filing, automated employee scoring, cash-flow accounting or physical database provisioning per company.
