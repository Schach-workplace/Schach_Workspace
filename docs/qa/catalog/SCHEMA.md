# QA catalog format

This catalog describes proposed manual acceptance scenarios. Every new test run
starts **NOT_RUN**; existing automated results are references, not manual passes.

Each catalog JSON contains `modules`. Each module has `id`, `title`, `purpose`,
`entry_points`, `actors`, `workflow`, `source_refs`, `automation_refs`,
`limitations`, `cases`, and `diagram`.

Each case has:

- `id`: stable module prefix and three digits, for example `TASKS-001`.
- `module`: the module ID.
- `title`, `priority`: P0, P1, or P2.
- `gate`: LOCAL, LOCAL_CONFIG, DEVICE, or PRODUCTION.
- `modes`: applicable Web, API, Android, iOS, or Operator surfaces.
- `actors`, `preconditions`, `test_data`.
- `steps` and matching `expected_results`: ordered arrays of equal length.
- `cleanup`: how to leave the isolated QA fixture usable.
- `source_refs` and `automation_refs`: actual repository paths.

LOCAL uses an isolated server/API fixture. LOCAL_CONFIG also needs a configured
scanner, local model, keys, storage, or media provider. DEVICE needs a build and
physical device or a specifically recorded emulator qualification. PRODUCTION
requires the named staged deployment/provider acceptance environment. A missing
prerequisite is BLOCKED, never PASS. Browser demo is an illustration, not an
authority/revocation/authentication test environment.

A diagram has `id`, `title`, `module`, `nodes`, and `edges`. Nodes have unique
camelCase `id`, `label`, and `kind` (start, action, decision, result, error).
Edges have `from`, `to`, and optional `label`. This one model produces editable
Mermaid and offline SVG so the diagrams and descriptions stay consistent.

No real credentials, tokens, company IDs, private source prose, or copied user
database content belongs in the QA pack. Use separately provisioned fictional
QA actors and companies. Do not run mutations or fault injection on the running
workspace or restore the completed historical native fixture.
