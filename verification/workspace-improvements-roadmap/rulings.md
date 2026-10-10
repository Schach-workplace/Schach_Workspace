# Implementation decisions and costs

These controller decisions reconcile the product specification and implementation plans. Physical and production rollout gates remain explicit. This record is extended at each reviewed checkpoint.

Ruling: Execute all code milestones with explicit separate rollout gates for physical devices, signing and production providers — user asked all implementation and the spec explicitly separates these checks — cost if wrong: rollout delayed until those resources exist.

Ruling: Use subagent-driven execution for the extended roadmap, with one implementation worker at a time and independent preparation/review — this long execution will span compactions, and the user has not required inline work — cost if wrong: additional review overhead.

Ruling: Preserve authored native drafts only in process memory across temporary background, hide private fetched content and require current source authorization before restore — recoverability is part of requested mobile usability and backend permissions remain authoritative — cost if wrong: authored text remains in process RAM until revocation/logout/scope cleanup.

Ruling: Withhold selected fetched details during same-key polling/event reauthorization as well as new-key reads — cached private source otherwise remains visible through a pending access check — cost if wrong: brief loading/focus interruption; explicitly authored scoped RAM survives and retains its inspected version.

Ruling: platform file names in preparation are an implementation map, not a mandate to duplicate privacy/business rules — keep platform reexports/adapters and one canonical shared neutral implementation with platform integration coverage — cost if wrong: cross-toolchain module configuration and shared change blast radius, requiring both bundles/tests.

Ruling: unchanged communication/api.ts already forwards opaque cursor/query request strings and AbortSignal through the existing request helper; root native layout already uses Expo Router provider ownership. No gratuitous edit required. Inline viewport is acceptable only with changed-height regression; new dedicated history runtime fixture substitutes for old Connect smoke extension and both existing smoke controls remain applicable. Missing component/route behavior regressions are not waived; original worker must reconcile each preparation case and add uncovered cases. Cost if wrong: file-name coverage could conceal missing behavior, mitigated by explicit case mapping and scoped reviewer checks.

Ruling: keep existing unkeyed business-create API compatibility but require canonical keys in updated first-party forms and all new template/schedule routes — prevents client retry duplicates without breaking older integrations — cost if wrong: legacy third-party unkeyed requests remain explicitly unsafe to repeat.

Ruling: project milestones use explicit independent human acceptance of current criteria/task versions, and never advance goals automatically — aligns new planning records with existing independent work review — cost if wrong: additional reviewer interaction for simple milestones.

Ruling: historical snapshots separate state-as-of, verified acceptance episodes and unique tasks; legacy data is observed/unknown-before, with all-day performance using the actual event company zone — current records cannot reconstruct erased past transitions — cost if wrong: early historical reports have incomplete denominators, transparently shown.

Ruling: saved exports initially deliver IDs-only in-app per-recipient outputs, bounded16MiB CSV and configurable7-day artifacts, first-fold/next-valid-gap schedule with latest-missed-only catchup — follows existing scoped leased jobs without external disclosure assumptions — cost if wrong: users must configure external delivery later and old artifacts need regeneration.

Ruling: isolate long OCR/inference/artifact work in bounded local worker loops with short claims and final source/lease checks, preserving prompt communication revocation/call processing — existing communication runtime is serial under30s tick and must not wait on a model — cost if wrong: additional worker lifecycle/configuration to verify in both runtime adapters.

Ruling: attention resolve/routing closes that attention episode; new actions require open item while pending business decisions remain separately navigable. Explicit routing reuses an applicable open target or creates one fresh deduplicated route episode after earlier target resolution — otherwise a successful route could silently land in a closed item — cost if wrong: no direct undo-resolve action in first version, extra routed episode history. M4 plan includes canonical replay/current-source checks and regression.
