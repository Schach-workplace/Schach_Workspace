# Milestone 3 fix round 2 — pending thread dependency guard

BASE: `c5d2b2520d56a0b316bd47bff90ef1a35b9c7a8b`. Final checked HEAD: `1d74c31132b8246603dbc853556ca29b1a134e4f`. Sole original implementer; no subagents. Scope: the single remaining Important from task-3-fix-1-review.md. All original eight findings and confirmed local coverage gaps were accepted as addressed by that review and are not reworked here. Controller owns independent re-review, tracked plan publication, integration and rebuilt native snapshot.

## Defect and minimal repair

A thread request opened from reply R remembered only R.id. If root S was removed/edited while the response was pending, the source invalidation cleared quote presentation but did not invalidate the request; the old response restored S and a thread composer. Target replacement guards alone could not recognize a dependency known only from the response.

NativeConversation now records content-free per-ID invalidation stamps within its current owner. beginSource captures requested message, known replyTo root, launch invalidation revision, request token, current history-engine identity and root/foreground/client ownership. Known dependency invalidation advances the request token immediately. Before a response can publish, all returned root/message IDs and replyTo dependencies must have no invalidation newer than the launch revision. The same guard serves explicit thread buttons and unloaded message targets. A fresh read started after a change is allowed; unrelated source changes do not globally cancel an otherwise current thread. Stamps and known pending dependency IDs reset on root/foreground ownership changes. This holds no new fetched-body cache.

Existing clearDraftSources still removes unsafe quote/error presentation while preserving authored bodies and the original frozen pending send object, including its client key/reply/mention fields. Permission/history cleanup remains fail-closed through existing NativeClient/Workspace controls. No generic404 suppression, server authorization change, global draft discard, second history state machine, or automatic replay of additive evidence was introduced.

## Portable RED → GREEN

The product tests live in `mobile/src/NativeConversation.test.tsx`, use relative imports/current product components, and reuse the existing mocked RN callbacks plus real native history state machine. The initial mistaken shell cwd prevented the file edit; its unchanged passing run was not counted as RED. The actual RED log is `/tmp/task3-fix2-red.log`: four intended assertion failures, five existing/control cases passing, exit1. Each failing response restored an invalidated root/reply body after the sync invalidation had already run. Production changes followed this RED.

Final focused `/tmp/task3-fix2-green.log`:9/9, exit0, verbose case output:

| Case | Regression assertion |
|---|---|
| Known R.replyToId=S, delete S while R thread GET held | deleted root/composer body never reappears; main and thread authored RAM/frozen payloads remain |
| Unloaded target R, root S learned only from result, delete S while GET held | returned dependency stamp rejects old root |
| Returned reply dependency learned only from result, delete that reply while GET held | old thread snapshot/reply body cannot publish |
| Edit root S while R thread GET held, release old revision | old body does not replace fresh authorized loaded root; subsequent fresh reauthorized thread retry opens current root |
| Unrelated source invalidation while GET held | current thread opens normally and authored text remains |
| Existing tests | recoverable same-payload retry, stable virtual IDs/viewed bottom reads, changed-height relative anchor and rapid target replacement remain passing |

The new scenarios assert the exact frozen payload object is retained and the authored body survives in both main conversation and scoped thread RAM. These are mounted native component/logic fixtures; they do not claim device pixels, native transport or OS lifecycle certification.

## Verification and scope

Required final native sequence uses `set -e` and completed with exit0:

- `npm test`:88 tests/22 files pass; `/tmp/task3-fix2-native-tests.log`.
- `npm run typecheck`: exit0, no diagnostics; `/tmp/task3-fix2-native-types.log`.
- `npm run lint`: exit0, no diagnostics; `/tmp/task3-fix2-native-lint.log`. React compiler checks remain enabled.
- `env -u NO_COLOR -u FORCE_COLOR npm run export`: exit0; fresh Android+iOS Hermes bundles, `/tmp/task3-fix2-native-export.log`. Color environment variables were removed solely to avoid conflicting-color noise; no compiler/export diagnostics were suppressed.
- Changed-file Prettier check and git diff --check: exit0; `/tmp/task3-fix2-format-check.log`.

Only NativeConversation.tsx and its product test changed. No Expo/RN API or dependency/configuration was added. Web/shared/backend/browser/PG fixtures were not rerun because their code/contracts were unchanged. Fix1 actual HTTP results and documented134-request/~309KB contextual replay costs remain their original evidence; this native-only patch does not invent new runtime measurements. No root8080/user data/server restart/push/merge/provisioning/deployment occurred.

## Interface and milestone 4 handoff

No exported primitive/client/route/query/refresh interface changed. NativeConversation's local beginSource(id, knownRoot?) returns a validity predicate accepting the authorized `{root:Message,messages:Message[]}` result. The predicate binds current history owner/foreground/client/request generation and validates every dependency's invalidation stamp since launch. resetSources updates those stamps before clearing affected presentation. Existing PersonPicker/DeadlinePicker/Sheet/Page, useRamInput compare-retire, canonical shared drafts/history, NativeClient typed errors/contextual thread404, internal task/message targets and Workspace refresh scopes remain exactly the fix1 handoff. Consumers should use those owners and current source dependencies rather than build another fetched cache.

## Limitations and next gate

Independent scoped re-review remains required. Actual device keyboard/safe areas/readers/large text/virtualized frames/anchor pixels/camera bytes/activity recreation/native bearer transport/provider push duplicates/audio/two-device TURN/iOS compilation/organization signing remain unchecked. The independently compiled c5d2b25 Android snapshot is the pre-fix2 baseline and is superseded for current source certification; controller rebuilds the accepted fixed snapshot. Hermes export proves bundling only. No milestone checkbox was changed.

## Scoped commit and clean tree

Commit `1d74c31132b8246603dbc853556ca29b1a134e4f` (`fix(connect): invalidate pending native thread dependencies`),2 files. Commit exit0; git status --porcelain empty after commit. Final native test/typecheck/lint/export sequence exit0, focused9/9 and full88/22 as above. Ignored report remains outside tracked source. Ready for controller scoped review of BASE→this exact HEAD.
