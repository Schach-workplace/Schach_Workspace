# Premium mobile and growth verification

Read [the verification record](record.md), [machine-readable results](result.json), [39-case supplemental QA/flows](../../docs/qa/PREMIUM_MOBILE_GROWTH.md), and the [live handoff](../../docs/HANDOFF.md#16-premium-mobile-continuation--18-october-2026). The [skill manifest](skills.json) records all nine requested installed design skills and pinned upstream hashes.

`preview/serve.mjs` renders actual native components with explicit fictional Workspace/client/native-boundary adapters, never production data. Run it on owned localhost5187, then `node verification/mobile-premium-2026-10-18/capture.mjs`. Capture owns a temporary Chromium profile/debug port19387, blocks external requests and records horizontal overflow, heading clipping, runtime exceptions and console errors. Inspect PNGs too: geometry probes do not cover every layout defect. CSS enlarged text is a proxy; physical font scaling, keyboards/screen readers/safe areas/native sharing are separate gates. Closed secondary native workflows are fixture placeholders, not claims of rendering those flows.

`browser-smoke.mjs` requires `--allow-demo-mutations` and `SCHACH_SMOKE_URL` pointing to a **new owned fictional loopback server**, never8080 or production. It creates three pilot plans and a Knowledge draft, then exercises actual compiled web independent publication and current citations against the real API. Its own headless browser blocks external requests. Unit mocks and this bounded integration flow do not certify all manual journeys.

Both harnesses stop only their owned browser process groups. Temporary application/Encore/PostgreSQL ownership and cleanup are recorded in the handoff; never broadly terminate matching personal browsers or existing containers.
