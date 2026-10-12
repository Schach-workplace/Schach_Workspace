# Controlled recovery and revocation tests

Run only against a newly owned disposable fictional QA environment. Do not
inject failures into port 8080, another team's database, or a production
provider. Use two separate browser profiles for the initiating person and the
authorized operator. Keep request bodies/keys/session details in memory only.

## Unknown acknowledgement after a genuine commit

Prefer the existing owning browser/runtime harness listed in the case's
automation references. It deliberately loses the response **after** the real
server commits and checks the original canonical request. Simply going offline
before a request does not prove a committed-but-unknown result.

For a single JSON business action on the disposable browser, a QA engineer can
install this limited DevTools wrapper. Replace only the exact fictional action
path; do not use login, credential onboarding, uploads, or a wildcard endpoint.
The wrapper does not print or persist its opaque submitted body.

```js
const qaPath = '/api/companies/REPLACE_WITH_QA_ALIAS_ID/tasks';
if (!['127.0.0.1', 'localhost'].includes(location.hostname) || location.port === '8080') {
  throw new Error('An isolated loopback QA server is required');
}
const qaFetch = window.fetch;
let qaDropNext = true, qaOriginalBody = null, qaRequests = 0, qaSameBody = true;
window.fetch = async (...args) => {
  const url = new URL(String(args[0]), location.href);
  const opts = args[1] || {};
  const selected = url.origin === location.origin && url.pathname === qaPath &&
    ['POST', 'PATCH'].includes(opts.method) && typeof opts.body === 'string';
  if (selected) {
    qaRequests++;
    if (qaOriginalBody === null) qaOriginalBody = opts.body;
    else qaSameBody = qaSameBody && opts.body === qaOriginalBody;
  }
  const response = await qaFetch(...args);
  if (selected && qaDropNext && response.ok) {
    qaDropNext = false;
    throw new TypeError('QA: acknowledgement lost after real response');
  }
  return response;
};
// Inspect only this metadata after the deliberate original-body retry:
// ({requests: qaRequests, identicalOriginalBody: qaSameBody, dropped: !qaDropNext})
// Clear before switching actors, ending the run, or testing another action:
// window.fetch = qaFetch; qaOriginalBody = null; qaDropNext = false;
```

The meaningful assertion is one canonical task/expense/import/decision after
two identical submitted attempts, with unchanged target/version/amount/deadline
and no automatic approval/payment. A confirmed conflict is different: require
deliberate latest-version inspection rather than retrying a rebased body.
Credential-bearing People flows use their existing owning harness; never copy
a password-bearing attempt into a generic observer or defect report.

## Pending reads and late responses

Use the existing delayed-read harness rather than indiscriminate network
throttling. Record whether the hold is before the upstream request or after a
previously authorized response; these test different boundaries. In the second
browser profile, commit a real authorized source reassignment, private
membership removal, session revocation, or company departure. Wait for its
successful commit before releasing the held request. Never rewrite an epoch,
source expiry, job result, or permission row to revive the old grant.

Check that fetched private output/options are withheld during current checks,
that permitted authored controls retain focus/input only within the same
authorized principal/source, and that genuine loss clears the affected state.
A late success cannot restore the old source or close another company's new
editor. After a positive current check, retained authored fields remain their
original inspected versions; a new latest token never replaces consent.

## Export and provider boundaries

- Current-state CSV: the owning test commits loss synchronously between writer
  chunks and checks that later frozen private rows do not leave the server.
  A hand-timed browser cancel does not establish the same ordering. Already
  written/in-flight bytes and downloaded copies cannot be recalled.
- Historical artifacts: exercise complete original included-source/session/
  owner/recipient/definition/schedule checks, including the first chunk.
- Chat media: the current handler performs authorized transfer inside its
  communication transaction; do not assert the report-specific chunk protocol
  or lock-free transfer for that endpoint. Document delivered/in-flight limits.
- OCR/inference: use a deterministic owned provider-wait/lease fixture to commit
  source/session loss before publication. No new inference in an old completed
  acceptance fixture and no resetting its consumed generation cap.
- Natural expiry: use a new test fixture and measure the genuine interval, or
  explicitly record a controlled owning-fixture expiry. Controlled expiry is
  not a natural full-TTL wall-clock certification.

If the harness cannot prove the required commit ordering, mark the case BLOCKED
for the deterministic check, retain ordinary UI observations separately, and
assign the missing fixture to the QA engineer.
