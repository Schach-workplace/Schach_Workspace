# Workspace efficiency and intelligence design

This design implements the user's request to plan improvements across all modules, improve mobile usability further, and begin implementation. Existing documents describe product direction; they do not grant additional access to private content. The running main application remains available while development proceeds in an isolated branch.

## Outcomes and boundaries

Employees should find the next action quickly, capture work on a phone without typing technical identifiers, follow a conversation through to its outcome, and understand every reported figure. Leaders see authorized commitments and decisions; company rank does not confer private conversation access. Finance retains exact amounts, independent review, receipt exceptions and recorded overrides. Task changes retain original deadlines, evidence requirements, independent acceptance and optimistic versions.

Keep Go/GORM/Encore/PostgreSQL and React/Expo. Do not introduce a second task engine, unrestricted global search, autonomous AI approvals or a microservice fleet. India remains the deployment region. Model/transcription provider selection, data processing terms, real device/call testing and production capacity are rollout decisions, not invented completed integrations.

## Reporting semantics

Phase one reports describe current authorized task state, not historical snapshots. Date filters select current due dates and acceptance dates in the company timezone. Timed deadlines compare absolute instants, including exact-boundary acceptance; all-day deadlines compare company calendar dates. Original and current deadline denominators exclude missing or invalid deadlines. A changed time, timezone or deadline mode counts as a revision even on the same date. Missing data is never a fabricated 100%.

The first report API returns lean task fields without task comments, attachment metadata, time entries, private conversations or finance records. It reuses the existing canRead scope for each task. It is an intermediate read model: server aggregation, cursor pagination and historical snapshots arrive subsequently. It does not claim to remove the application's global workspace polling. On company/user changes, cancellation or denied access, stale report content and exports must become unavailable immediately in the cooperative client. Network errors show a recoverable error rather than fictional data.

## Mobile usability standard

Apply to web phone layouts and native Android/iOS: touch targets of at least 44 logical pixels, usable 320–430px layouts, safe area and keyboard handling, one clear primary action, large text without clipped decisions, labelled controls, recoverable offline/network states, deliberate destructive confirmation, and accessible loading/error feedback. Native Work first gets separate creation/detail sheets, search and status filters, due-date shortcuts in company time, local time entry with explicit timezone and daylight-saving ambiguity checks, and guarded submission. Follow with real calendar/person pickers, camera/receipt capture, routed task details and virtualized lists. Physical devices must validate keyboard, focus, back navigation, screen readers, background push and calls; DOM tests cannot certify those.

## Roadmap deliverables

1. Correct current-state reports, lean authorized report inputs and basic mobile Work usability.
2. Instrument performance; separate bootstrap, task list/detail, finance list/detail and report aggregation queries; typed targeted invalidation, cursor pagination and measured indexes.
3. Refine Connect realtime updates, stable history, drafts and attention; native pickers, virtualization, capture and physical-device acceptance.
4. Build unified actionable Inbox and leadership decision queues, with deduplicated reminders, quiet hours, resolutions and owner routing.
5. Add reusable task templates/checklists, blocker routing, dependency impact and project milestones.
6. Add historical report snapshots, saved report definitions, period comparisons and revocation-aware scheduled delivery.
7. Add reviewed receipt extraction, duplicate invoice review and reconciliation; preserve finance authority and exact arithmetic.
8. Add calendar/capacity conflict suggestions and auditable goal measurement history.
9. Add onboarding presets, access review and departure handover with ownership reassignment and revocation.
10. Add opt-in permission-aware transcription, grounded summaries, draft actions and report explanations using the earlier verified read models.

Dependencies: 2 follows 1; 3 uses 2; 4 uses 2–3; 5 uses 2–4; 6 uses 2 and 5; 7 uses 2 and 4; 8 uses 2 and 5; 9 uses 4–5; 10 follows validated 3, 6–9. Use pilot measurements to order independent module releases. Do not attach calendar dates to these milestones without team capacity and rollout inputs.

## Intelligence and delivery controls

Retrieval, search, transcription jobs, cached summaries, notifications and exports must check current company/source permissions. Permission changes invalidate queued and cached private outputs; previously exported copies cannot be recalled. A summary is disclosed content and retains the task audience preview. Suggestions identify source revisions, uncertain fields and limitations. The person confirms consequential writes. Idempotent action keys survive transport retries; finance amounts and report arithmetic come from deterministic server calculations. Record model/provider version and selected authorized sources without indiscriminately logging private text.

## Measurement and acceptance

Record payload bytes, query count, p50/p95 response times, realtime lag, reconnect recovery, notification duplicates, task creation steps and completion rates. Use owned fictional fixtures and repeatable workloads; targets are set from the measured baseline. Every milestone has authorization, revocation, retry and mobile regression tests in addition to its business behavior. Preserve the actual running user's database. Production TLS/TURN/push, signed native distribution and physical-device results remain separate rollout gates.
