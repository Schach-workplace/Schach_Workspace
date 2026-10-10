# Independent review and fix evidence

One fresh-context reviewer examined the entire implementation read-only. The reviewer reported six Important findings, zero Critical and zero Minor findings. The implementer retained those grades, reproduced each failure and fixed them in one pass. The reviewer did not execute tests or re-review the fixes; the focused RED→GREEN reproductions and subsequent complete suites are the verification.

| Finding | Change and regression |
| --- | --- |
| Reused call identity suppressed a second completed removal job | Immutable provider identity per grant; `TestCallCleanupIsolatedAcrossRejoinAndRepeatedRevocation/completed` RED→GREEN |
| Delayed provider cleanup could remove a newer authorized join | Old grants are atomically revoked/enqueued; distinct identities isolate delayed cleanup; the same regression's delayed case RED→GREEN |
| Structured records/results disclosed to unselected conversation readers | Creator/current-revision fixed recipients intersect current source/history access before limit; `TestFixedRecordAudienceDoesNotIncludeOtherConversationReaders`, all four kinds RED→GREEN |
| Derived private UI survived confirmed revocation | Browser scope/epoch/version invalidation remounts derived views; native denied policy contact cancels generations and clears private views; rendered `ConnectPrivacy.test.tsx` and native client regressions RED→GREEN |
| Native startup removed registered push configuration | Omitted paired push fields preserve registration; explicit paired empty fields disable it; `TestDeviceReregistrationPreservesPushUnlessExplicitlyCleared` RED→GREEN |
| Expired media could become task/expense evidence before cleanup | Publication/download share current eligibility; `TestExpiredMediaCannotBecomeTaskOrExpenseEvidence` preview+commit RED→GREEN |

After the fix pass: PostgreSQL109/109, SQLite103 pass/6 deliberate skips, both full race suites, browser75/75 and native7/7 pass. Current real provider/scanner/load, exported Encore, proxy/restart and actual SQL/private-media restore probes pass. See [result.json](result.json) for scopes and timings.

The subsequent requested live-app check found an additional standalone content-policy defect: blob voice previews were blocked. Native Chromium captured the `media-src` violation before the change. Adding only `media-src 'self' blob:` made recording/preview/discard pass; both complete non-race Go suites and a fresh Compose build also pass. The subsequent header change does not alter the concurrency code tested by the race suites.

No minor findings were deferred. [All rulings and costs](rulings.md) are recorded separately. Physical device, real push, India infrastructure/TURN, capacity, recovery objectives and organizational cutover remain release gates; optional recording/transcription and advanced expansions were not silently enabled.
