# Milestone 3 physical acceptance — UNCHECKED

No physical Android/iOS hardware is attached. Linux cannot sign or compile iOS. DOM tests and Android/iOS bundle exports establish logic and bundling only. Every gate below remains unchecked until a tester records actual results.

Record: tester/time, model/OS, build identifier, app/backend commit, origin/TLS, network topology, account/company/conversation/history scope, expected/actual outcome, screenshots/logs and cleanup. Use fictional owned data. Never include bearer tokens, credentials or real private bodies in artifacts.

## Build prerequisites

The pre-review Android evaluation build from `68cea9b` is a compile-only baseline and is superseded by fix round 1 source changes. Rebuild from the accepted fix HEAD before device acceptance. Current Hermes exports do not certify that binary, organization signing, iOS compilation, or physical behavior.

Dependencies/config changed: rebuild the binary; old APKs and Expo Go are insufficient. `npm run prebuild` generates projects; do not hand-edit them. Android: Java17, Android SDK36/build tools and `npm run android` or an explicitly configured EAS development profile. iOS: macOS, Xcode26.4+, iOS16.4+ and `npm run ios` or configured EAS development build. EAS project/profile/signing credentials require deployment ownership; no upload/signing is inferred. Organization-signed distribution, APNs/FCM credentials and deployed TLS/TURN are separate rollout gates.

## Device script

- [ ] Keyboard/safe area/back: equivalent320/375/430 widths, notch/gesture navigation; create Work, choose date/person, open chat/thread/publication, multiline typing, dismiss/Back. Focused input and primary action remain reachable. Return route is predictable. Normal A/B/module navigation and temporary background retain only authored RAM; fetched records reappear after fresh authorization.
- [ ] Large text/readers: maximum practical font scale; TalkBack/VoiceOver announce names/roles/loading/errors. Picker search, target jump, evidence actions and decisions wrap, remain reachable and have44px hit regions. Destructive removal/discard has deliberate confirmation.
- [ ] Native history/windowing: load250 variable-height rows, record visible canonical ID/top offset before each prepend (<=1 logical pixel). Receive message while reading older history, use new-message action, edit/remove row5/6, disconnect while127 events occur, reconnect. No missing middle or duplicate IDs. Read acknowledges highest actually viewed sequence only while foreground and at bottom. Observe FlatList windowing and frame timings on the actual device.
- [ ] Native stream: bearer header handshake against TLS succeeds; no URL token. Ready triggers opaque /sync catch-up. Separate deterministic server overflow test emits51-event overflow/1008. Revocation closes1008 and no old content/draft can reappear.
- [ ] Draft/lost ACK: backend commits message then proxy drops200. A→B→A and background preserve original client ID/body/reply/mentions; retry yields one canonical message. During background revoke company/conversation/device, then return or tap old push: old content/input/retry actions disappear.
- [ ] Company calendar: handset Los_Angeles/UTC while company Kolkata, midnight crossing; cancel keeps values. Test America/New_York DST gap/fold and explicit offset choice, all-day/timed toggle, picker focus/typography, person search and reviewer exclusion. Invalid timezone/date shows recoverable error.
- [ ] Camera: allow/deny/permanent deny, choose-file alternative, preview/discard and explicit destination-labelled upload. Android Don't keep activities/pending result: original authorized destination or explicit rejection, never another record. Reject HEIC/unsupported/empty/oversize (10MiB evidence/receipt,25MiB chat). Check MIME-valid actual bytes. Company change/revocation deletes owned preview. OS camera background retains destination in RAM; process death cannot silently restore it.
- [ ] Additive evidence/receipt: drop confirmation after committed append; file remains, automatic retry blocked, Recheck fetches current record before deliberate manual retry. Confirm finance version advances and earlier decision confirmation resets. No OCR/approval/amount inference.
- [ ] Voice: permission denial, interruption, playback/discard, headset/Bluetooth, incoming call/background/audio route; no cache leak/stuck recording/audio mode. Canonical media reservation/message retry survives supported navigation.
- [ ] Push: real APNs/FCM foreground/background/terminated tap; duplicates eventId, expired token, company switch, mute/quiet hours/mentions and revoked target. Body-free hints route once only after session/company/conversation authorization; no arbitrary URL routing.
- [ ] LiveKit: two independent actual devices; Wi-Fi/cellular/restrictive NAT forces TURN; audio/video/mic/camera/Bluetooth/speaker/interruptions, background/reconnect, participant removal/end and missed call. Record TLS/TURN/provider credential evidence separately.

Result per gate: passed/failed/inconclusive/unchecked with artifacts. Missing hardware or credentials remains unchecked. Export success must never be substituted for any physical gate.
