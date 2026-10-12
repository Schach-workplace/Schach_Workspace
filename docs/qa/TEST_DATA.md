# Fictional test data and actors

Use a unique run prefix such as `QA-20261012-A`. Add it to titles, invoice
references and filenames so testers can find and clean their own fixtures.
Keep actual generated IDs in your private run record; this guide uses aliases.

## Actor and company matrix

| Alias | Setup | Purpose |
| --- | --- | --- |
| Platform operator | Platform administrator; also a member of QA Alpha when needed | Create companies; separately test global suspension. Platform admin does not gain private chat access. |
| Alpha leader | Founder/CEO/company admin in QA Alpha | Company administration and eligible independent review; excluded from private conversations unless explicitly admitted |
| Alpha head | `head`, Engineering department | Department work and qualifying independent expense decisions |
| Alpha manager | `manager`, reporting scope containing Owner A | Reporting-scope tasks; no blanket company finance/private access |
| Owner A | `member`, Engineering | Own tasks/expenses; private conversation participant |
| Member B | `member`, Engineering | Second independent source participant/report recipient; departure and suspension tests |
| Reviewer R | Eligible current independent task/decision reviewer | Accept/request changes; must differ from creator/owner where required |
| Finance F | `finance` | Company financial authority; task/private access still follows ordinary scope |
| Viewer V | `viewer` | Read-only work; no finance; no private access without source eligibility |
| Outsider O | Member only of QA Beta | Cross-company denial checks |
| Dual member D | Separate memberships in Alpha and Beta | Company switch, scoped drafts and one-company departure |

The isolated seed starts **Schach Engineers** and **Meridian Works**. You may
use those as Alpha and Beta aliases. Some seed accounts have several
memberships; confirm actual membership before calling someone an outsider.
Create additional accounts such as `qa.owner.a@example.invalid` in the
disposable environment. Set fresh test-only passwords privately. Onboarding
creates accounts directly; invitation email delivery is not implemented.

Create a separate **empty** company for currency/financial-year setup tests:
the seeded companies already contain budgets/expenses and their finance
settings may correctly be locked. Use current People screens/context to choose
roles and reviewers; do not infer eligibility from company rank alone.

## Reusable records

| Alias | Fixture |
| --- | --- |
| Project P | Alpha project with an eligible owner, department and target date |
| Task T | Required-review task owned by A, independent reviewer R, two checklist items and valid start/deadline |
| Parent/dependency pair | Same-company visible parent, prerequisite and successor; preserve original versions |
| Timed T | Company zone Asia/Kolkata, explicit UTC instant and original commitment; capture actual accepted timestamp |
| All-day T | Civil due date in the company zone; compare acceptance in that zone |
| Private C | Conversation with A/B/R; Alpha leader/Outsider are deliberately excluded; fixed history intervals |
| Source M | One harmless fictional message in C; publication policy requires explicit task disclosure review |
| Budget E | Engineering active envelope in one financial year, sufficient capacity for the normal positive flow |
| Expense X | A's fictional purchase, independent financial reviewer, exact amount and required receipt/exception |
| Historical H | Completed observed period with known facts and separately documented legacy gaps |
| Saved definition S | Eligible independent owner plus recipients A/B; schedule and immutable outputs |
| Goal G | Explicit baseline/target/unit/direction, accountable owner and reviewed accessible evidence |

## Boundary values

- INR `1234.56` = **123456 paise**, never binary float. Keep a separate case for
  invalid precision, negative/overflow amounts and malformed separators.
- Budget illustration: allocated 100000 minor units; approved unpaid 20000;
  paid 30000; pending 10000. Used = 50000, available = 50000, exposure = 60000.
  Recording payment moves approved to paid without changing used a second time.
- Timed acceptance **five minutes after the original instant is late**, even on
  the same date. A manual test may need a short future deadline and a measured
  wait; never change a shared host clock or forge production acceptance history.
- A deadline edit on the same civil date can still be a revision. Preserve the
  original instant/zone and require a reason/current optimistic version.
- DST test company: America/New_York; 2026-03-08 02:30 is a gap, and
  2026-11-01 01:30 is repeated. Record deliberate UTC offsets. These fixed-date
  test fixtures are separate from ordinary future-date manual task setup.
- CSV formula text: a fictional title beginning `=1+1`; exported text must be
  neutralized according to the endpoint. Test only harmless literals, never an
  external command or live link.
- More than one page of tasks/messages; a report whose CSV exceeds 64 KiB for
  chunk-boundary revocation. Use owning automated fixtures for large/race cases.
- Text: `QA माप · Engineering`, apostrophes, commas and newline-containing CSV
  fields. Keep all content fictional.
- Files: a harmless small text receipt, synthetic PNG receipt, a fake short
  authorized voice clip, and a reviewed bank CSV with repeated identical rows
  as **distinct occurrences**. Scanner rejection fixtures must be prepared by
  the operator's approved test procedure in the disposable stack.

## Reset and cleanup

Cancel pending scratch/jobs, dismiss overlays and clear fault injection before
changing actors. Preserve accepted/paid/audited fixture records until evidence
is captured; do not rewrite immutable history to clean it. Recreate a fresh
isolated environment for irreversible departure, account suspension,
credential/MFA change, natural expiry, restore or destructive schema scenarios.
Retain test keys for canonical recovery throughout a run. The old native
acceptance fixture and its consumed inference cap are never a reset mechanism.
