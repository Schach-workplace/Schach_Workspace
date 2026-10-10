# Rulings made during execution

Ordered record, including the cost if wrong. These policies are development defaults or explicit gates, not production certification.

1. Work in the existing extraction and retain the ledger/evidence — no Git metadata exists; Git-dependent worktree/commit scripts cannot execute — cost if wrong: source provenance relies on baseline hashes rather than commits.

2. Adopt recommended integrated server-readable domain, join-forward private history, no leadership bypass, private publication deny, PostgreSQL outbox, explicit-offset timed deadlines under full-roadmap authorization. Cost if wrong: policy/provider changes require migrations and client changes.

3. New migrations use 3 core, 4 durable messaging, 5 deadlines; migrations applied during native tests are immutable. Cost if wrong: additional versions rather than reusing planned version 4 for deadlines.

4. User chose self-hosted LiveKit + native Android/iOS, India residency, remaining limits to be recommended. LiveKit docs explicitly say self-hosted removal does not invalidate cached tokens. Implement a Schach-authorized signaling gateway and keep provider signaling private; gate real cached/refreshed-token denial at that boundary. Cost if wrong: direct provider signaling would bypass revocation, so never expose it publicly.

5. Proposed development limits 25-MiB communication media, 500-MiB per-user quota, unused uploads 24 hours and bound media 90 days. Existing task/receipt 10-MiB controls unchanged. Make rollout limits configurable and validate inventory before cutover; cost if wrong: rollout capacity/retention must be adjusted before real data adoption.

6. Use server-owned split action IDs, separate upload retry records, durable provider cleanup jobs and content-free push hints; native push needs operator-owned FCM/APNs credentials — prevents forged splits/duplicates/disclosure — cost if wrong: schema/provider integrations need another migration.

7. Recommend India-hosted single gateway/worker pilot with encrypted private filesystem media, TOTP with single-use recovery codes; 25-GiB company quota, 365-day text retention, 90-day media retention configurable — concrete conservative limits — cost if wrong: capacity/retention changes require inventory review; multi-gateway fanout remains a measured rollout gate.

8. Keep self-hosted Encore physical/resource names both workspace with CLI 1.58.6/SDK 1.57.13 — exporter and runtime map differently, confirmed from installed runtime parse.go and actual failing/successful exports — cost if wrong: future upgrades need retesting; existing physical names need a planned migration rather than an unsolicited rename.

9. Disable recording/transcription and leave physical OS incoming-call/background, signed iOS/Android, provider push and India TLS/TURN/cutover as explicit release gates — no consent/device/provider inventory available; blueprint advanced expansions need their own design — cost if wrong: a team cannot retire its previous call workflow until these gates are executed.

10. Recommend RPO 15 minutes, RTO 4 hours, 35-day backups and single-gateway pilot ceilings (100 foreground sockets/20 call participants; inventory 10 companies×50 people,500 devices) — configurable conservative starting policy, local measurements only — cost if wrong: restore/load/provider budget must be revised before adoption.

11. Retain this extraction's private ledger/evidence instead of deleting it on completion — no Git commits exist to preserve verification history — cost if wrong: extra local disk usage; release packaging excludes scratch and secrets.

12. Native advanced split declaration, selected owner exports and desktop administration stay in web; native listed daily flows are implemented but OS/push/screenshare parity is a physical rollout gate — costs if wrong: teams needing those native flows must validate/develop them before cutover.

13. Fixed structured readership is creator plus current-revision declared recipients (decision creator+independent reviewer), intersected with current source/history rights; responses/results remain visible only to that fixed audience — avoids implicit disclosure to unselected conversation readers — cost if wrong: a separately declared wider result policy requires a schema/UI design.

14. Physical signed mobile/push/background/incoming/Bluetooth/TURN remain unverified release gates — reviewer could not judge absent devices/provider identities — cost if wrong: cutover fails on real networks/devices, so do not retire fallback.

15. India TLS/infrastructure, fanout/capacity, measured RPO/RTO and organizational cutover need operational evidence — unavailable in this local extraction — cost if wrong: sizing/recovery/adoption targets need revision before use.

16. Recording/transcription and AI/guests/history imports/E2EE remain disabled or separate designed expansions — reviewer set aside those optional expansions, no consent/import inventory available — cost if wrong: organizations requiring these cannot cut over on this release.

17. Do not force npm's suggested Expo/RN downgrades to suppress mobile audit findings — nonbreaking audit fix retains30 findings (19high11moderate), key upstream advisories currently have no patched releases — cost if wrong: dependency risk persists until compatible patches/remediation/review; record as release gate rather than claim clean audit.

18. User explicitly requested running the app and pushing to GitHub organization Schach-workplace; authenticated organization has no visible repositories. Initialize a main repository in this extraction and create private Schach_Workspace using the authenticated author's GitHub noreply identity; do not fabricate earlier commit history — cost if wrong: destination/name/visibility can require an authorized repository move or access adjustment.

## Deferred minors

None reported by the independent reviewer.
