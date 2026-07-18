# Aimtrix release gate and backlog

A checked item has a working implementation and a graceful failure/unsupported state. Protocol features are not considered complete merely because a control exists.

## 0.1 release gate

### Repository, runtime, deployment, and supply chain

- [x] React 19, strict TypeScript, Vite, ESLint, Vitest, deterministic npm lockfile, and bundle budgets.
- [x] Validated public runtime configuration with no required Aimtrix backend or secret-bearing defaults.
- [x] Stateless unprivileged nginx image with SPA routing, health endpoint, CSP, and runtime config mounting.
- [x] Compose, generic Kubernetes guidance, and previously verified `linux/amd64`/`linux/arm64` builds.
- [x] GitHub quality/browser/multiarch workflows, dependency review, Dependabot, image provenance, SBOM, and Trivy scanning.
- [x] Semantic release policy, rollback guidance, and MIT license.

### Authentication, lifecycle, and encryption

- [x] Homeserver discovery, custom/default homeserver policy, password login, and password non-retention.
- [x] SSO/CAS discovery, redirect, token callback restoration, and callback URL cleanup.
- [x] Per-account IndexedDB sync and Rust/WASM crypto stores; crypto initializes before sync.
- [x] Session restore/logout/forget, expired-token handling, object URL cleanup, and account database cleanup.
- [x] Actionable offline/reconnecting/unknown-token/consent/storage failure states.
- [x] E2EE enforcement in encrypted rooms with no plaintext fallback.

### Messaging, media, rooms, and spaces

- [x] Responsive full-viewport shell, DMs/rooms/invites/spaces, presence, unread/highlight counts, and authenticated avatars.
- [x] Initial history plus continuous upward scrollback with a bounded 250-event rendered timeline.
- [x] Text, notices, emotes, replies, edits, redaction, reactions, pins, typing state, and read-receipt sending.
- [x] Image/video/audio/file rendering and authenticated encrypted-attachment decryption.
- [x] Encrypted/unencrypted uploads with limits, progress, cancellation, and retry.
- [x] Join by alias/ID, public-directory search, invite accept/reject, leave, room creation, encrypted room creation, direct-chat creation, and space creation.
- [x] Room name/topic/avatar, irreversible encryption enablement, push-rule mute, invite, member list, and leave controls.
- [x] Power-gated kick/ban/unban and member/moderator role controls.
- [x] Loaded-timeline message search and real recent-media previews in Moments.

### Critical Matrix settings

- [x] Profile display name/avatar, presence, and away-message editing.
- [x] Homeserver, Matrix ID, device ID, Client API versions, RTC focus discovery, and local storage state.
- [x] Device list, rename, emoji SAS verification, UIA sign-out, and current-device identification.
- [x] Cross-signing, secret-storage, and key-backup state.
- [x] New recovery setup/export and existing recovery-key restore held only in memory.
- [x] Ignored-user management.
- [x] Desktop notifications, original generated sounds/volume, room mute, read-receipt, and typing privacy controls.
- [x] Microphone/camera/speaker selection, autoplay, data saver, and configured upload limits.
- [x] UIA password change and explicitly confirmed account deactivation/erasure request.

### Personality and optional media

- [x] Aqua, Graphite, and Midnight themes plus candy accents, density, message scale, motion, drawer defaults, buddy cards, and banners.
- [x] Lazy searchable Unicode emoji catalog with device-local recents.
- [x] Interoperable `m.sticker` send/render, original Aqua starter pack, and operator-installed manifest support.
- [x] Optional provider-neutral GIF search/preview/download/Matrix-upload flow with encrypted-room support.
- [x] Media data-saver and animated-GIF autoplay gating.
- [x] Private namespaced Matrix account-data sync for portable Aimtrix preferences; hardware IDs remain local.

### Direct voice and video

- [x] Feature-gated one-to-one Matrix VoIP call start, incoming state, answer, reject, and hangup.
- [x] Voice/video, microphone mute, camera mute, selected devices, speaker routing, screen sharing, notifications, and browser video/PiP controls.
- [x] Display MatrixRTC focus discovery and document TURN and LiveKit/JWT requirements without vendor hardcoding.

### Browser, accessibility, and QA

- [x] Conservative installable PWA shell and explicit update/reload prompt.
- [x] Playwright desktop/mobile coverage for navigation, messaging, emoji, stickers, settings, search, themes, and drawer behavior.
- [x] Axe WCAG A/AA desktop checks and responsive/focus-visible acceptance coverage.
- [x] Mocked Matrix controller tests for room state, moderation, uploads, progress, and push rules.
- [x] Chromium visual feedback loops and a CI browser gate.
- [x] Bundle budgets and bounded large-room rendering.
- [x] Tauri/multi-window evaluation documented; PWA retained for 0.x.

## Post-0.1 compatibility backlog

These are additive follow-ups, not hidden placeholders in the 0.1 UI.

### Matrix messaging depth

- [ ] Add Matrix threads with thread timelines, unread state, and thread receipts.
- [ ] Add homeserver-backed full-history search and filters beyond the loaded timeline.
- [ ] Render sanitized `formatted_body` HTML, code blocks, spoilers, polls, locations, and extensible events.
- [ ] Add read-receipt avatars and per-event delivery/decryption diagnostics.
- [ ] Add aliases, history visibility, join rules/knocking, guest access, room upgrades, and server ACL editing.
- [ ] Add spaces hierarchy editing, room-to-space assignment, ordering, and suggested children.
- [ ] Add per-room mention/keyword push-rule editing and notification troubleshooting.

### Encryption and identity depth

- [ ] Handle incoming verification requests and QR scan/show flows in addition to initiated emoji SAS.
- [ ] Add key-request diagnostics, withheld-key reasons, secret-sharing approval, and recovery reset guidance for every server variant.
- [ ] Test delegated OIDC/MSC3861 native flows beyond standard Matrix SSO token login.

### Group calls

- [ ] Implement group MatrixRTC memberships and LiveKit focus authorization.
- [ ] Add room call activity, participant grid, active speaker, member controls, reconnect state, and group-call E2EE indicators.
- [ ] Add automated WebRTC tests with fake media plus disposable Synapse/LiveKit/TURN interoperability coverage.

### Scale, portability, and release validation

- [ ] Add disposable Synapse integration CI for password/SSO, encrypted multi-device sync, backup restore, uploads, and moderation.
- [ ] Add Firefox and WebKit browser matrices and screen-reader/manual keyboard audits.
- [ ] Add 10k-room and long-running sync profiling beyond the current bundle/timeline bounds.
- [ ] Revisit Tauri only when native keychain, tray, global shortcuts, or independent conversation windows justify its security and release cost.

## Chosen self-hosting defaults

- Canonical development host: `aimtrix.alucard.dev`.
- Canonical image: `docker.io/spencerrung/aimtrix`.
- GIF integration: disabled unless an operator supplies a CORS-compatible provider endpoint.
- Calls: disabled unless an operator explicitly enables them and provides dependable TURN.
- Aimtrix-only personalization: private account data; public sharing is not used.
- Matrix-standard events and account data take precedence over custom schemas.
