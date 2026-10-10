# Independent review and fix verification

Reviewed range: d20063b..5a71abd, first roadmap milestone only. Reviewer independently ran 11 web and 8 native targeted tests. Initial verdict: two Important findings, no Critical findings; fixes required.

1. Cached sibling report inputs could reappear after another filter's 403, and returning to a cached company could release data before authorization refetch. Regressions `never releases a cached sibling report after authorization denial` and `reauthorizes before releasing a previously cached company report` both failed on the prior behavior. Fix: remove inactive company/user report caches on 401/403 and require a successful fetch after observer scope entry before rows/exports are available. Both pass; full web suite 96/96, builds pass.
2. Native Work keyed form state on an absent workspace role, so polling outages/background clearing work destroyed drafts. Regression `retains the draft across temporary workspace absence and recovery` failed before the fix. Fix: retain the last confirmed role in guarded state; identity/company/confirmed policy epoch changes still reset the view. Outage and confirmed-epoch regressions pass; full native suite 20/20, typecheck/lint and both Hermes exports pass.

No second independent review or post-fix reviewer approval is claimed. Findings were fixed by the implementer and verified with regressions as the inline execution workflow requires.

## Considered scope rulings

- Pagination, aggregation, global polling removal and historical snapshots are subsequent roadmap milestones. The current API's company-task scan and unbounded date-range response remain documented interim limits; cost if retained at scale: larger queries/payloads.
- Physical-device keyboard, accessibility, back navigation and signed distribution remain rollout gates. Current evidence establishes source/export and orchestration behavior; cost if omitted: device-specific failures may go undetected.
- Existing native client generation checks cancel stale cross-company asynchronous writes; preserve that boundary. Cost if changed without tests: writes may target stale company state.
- The report API retains the existing task read-authorization boundary for already executing requests; no new stronger concurrent-read revocation guarantee is claimed. Cost if stronger guarantees are needed: add transactional read/policy validation across the common business read APIs.

## Additional limits

Native task creation prevents overlapping taps and never automatically retries a failed POST. The underlying general task creation API does not yet supply the communication conversion engine's durable retry key; an uncertain response requires checking existing work before manual resubmission. General task write idempotency belongs in the subsequent task/data milestone. Existing independent review, versions and finance controls remain server-enforced.
