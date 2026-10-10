### Finding Verdicts

1. **Native structured records disappear after an ordinary workspace refresh. — ADDRESSED.** `mobile/src/Structured.tsx:68` places scope setup and cleanup together in the layout effect, eliminating the old passive cleanup overwrite. Per-request sequencing and generation checks at lines 78, 95, and 106 reject superseded results; foreground/confirmed-scope rendering at line 290 hides stale records. The actual component regression at `mobile/src/Structured.test.tsx:40` covers successful same-source refresh, pending concealment, denial, background, and obsolete generation.

2. **Escalation never starts for an existing open item when the user enables it after initial delivery. — ADDRESSED.** `backend/platform/attention_jobs.go:131` now scans bounded current open items regardless of initial completion, rotating scan position at line 180. `scheduleAttentionReminder` at line 352 independently reuses/requeues each stage while preserving delivered receipts and active leases; cancellation at line 370 retains stage identity for later reenablement. Final delivery recomputes the current escalation interval at line 294. Real-PATCH worker tests at `backend/platform/attention_jobs_test.go:256` and line 351 cover enable-after-initial, interval increases independently of the scheduling batch, disable/reenable with replacement target, concurrent deduplication, and changing recipient quiet windows.

3. **Successful demo routing can silently lose the target card. — ADDRESSED.** `frontend/src/data/demo.ts:1350` permits routed updates under current source readability without changing task ownership. Target reuse at line 1536 requires matching source revision and a successful current target projection. Real adapter tests at `frontend/src/data/attention-demo.test.ts:67`, line 97, and line 141 cover visible owner-to-recipient handoff, obsolete target rejection, membership revocation, and task collaboration revocation with unchanged membership, including denied canonical route replay.

4. **The actual Android thread closes immediately after a successful send/read refresh. — ADDRESSED.** `mobile/src/NativeConversation.tsx:236` distinguishes ordinary creation events from material invalidation, compares loaded dependency revisions/removal at line 252, and merges incoming replies into the retained thread at line 264. `shared/communication/history.ts:156` prevents a same-page creation from downgrading an edit; line 182 adds creation metadata while retaining all original changed IDs. Actual component/history-sequence tests at `mobile/src/NativeConversation.test.tsx:527` and line 596 verify canonical send retirement, retained visible reply, incoming creation, and invalidation on true edit/removal or delayed creation with a revised source. Controller runtime JSON confirms exact native commit `dcce5c6963b546e1a7b5fc6e1dd2e7b52cd986d8`: thread remains open, reply visible, authored input cleared, canonical count 1, virtual Android API36, physicalDevice false. Native/shared source is unchanged through reviewed HEAD `b21386f904eb39d725b4401b72acadb628b8a159`.

### New Breakage in the Fix Diff

- None found. Shared history's callback adds only optional metadata (`shared/communication/history.ts:71`); the existing web consumer at `frontend/src/communication/store.tsx:163` continues receiving the unchanged full ID list. Native still uses the original strict invalidation path when metadata is absent and for edits/removals; shared drain retains missing-source removal/reconciliation handling (`shared/communication/history.ts:227`).

### Out-of-Scope Observations

- None. Physical Android/iOS, screen-reader, signing, provider, and background-delivery checks remain explicit rollout gates, without inferred passes. Previously accepted unchanged task/finance controls plus final SQLite/PostgreSQL integration evidence satisfy the controller's resolution of the original unchanged-control verification note.

### Checks

- Reviewed original four findings, fix brief, final clean fix report, and the single supplied fix package `review-9f0e287..b21386f.diff` once; no Git regeneration, subagents, broad suite reruns, or tracked checkout edits.
- Named shared callback compatibility/invalidation check: inspected the unchanged web callback at `frontend/src/communication/store.tsx:163`. The fix hunk cut off the middle of `ConversationHistory.drain`; read its focused current body at `shared/communication/history.ts:115`–255 to verify creation metadata does not suppress removed/missing-source invalidation or skip authorized fetches. No broader code review.
- Read covering output: `/tmp/task4-fix1-native-green.log` (21 tests/3 files), `/tmp/task4-fix1-native-full.log` (103 tests/27 files), `/tmp/task4-fix1-escalation-green.log` (pass), `/tmp/task4-fix1-backend-full-sqlite.log` (46.322s pass), `/tmp/task4-fix1-backend-full-pg.log` (72.263s pass), `/tmp/task4-fix1-web-full.log` (154 tests/32 files), `/tmp/task4-fix1-demo-source-revoke.log` (final real-demo 5/5), `/tmp/task4-fix1-native-lint.log` (clean), and generated Encore startup/check log. No new focused test was necessary: the amended tests directly cover each original reproduction and related invalidation paths.
- Read `/tmp/schach-roadmap-native-runtime-20261011/m4-native-fix-1-thread-runtime.json`. Its native proof uses backend `9f0e287`, correctly distinguished from final backend worker validation. Controller separately supplied Send-above-IME evidence; this review makes no physical-device/iOS/provider claim.

### Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.**

**Spec compliance: ✅ Compliant for the reviewed milestone requirements and resolved findings; explicit rollout gates remain.**

**Task quality: Approved.**
