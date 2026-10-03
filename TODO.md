# Aimtrix release gate and backlog

Checked items record the implemented scope described on that line, not universal protocol or release verification. The [capability baseline](docs/capability-baseline.md) separates implementation from unit/mock, browser, live Matrix and native/provider evidence. Unresolved depth and validation remain explicit below; a control or closed issue alone does not establish interoperability.

The [polish and modern-comforts roadmap](docs/polish-plan.md) provides the ordered GitHub issue queue for the next implementation program. It supplements this release/compatibility inventory; its baseline audit reconciles implementation and validation evidence without removing existing obligations.

The [first-use encryption confidence pass](docs/first-use-encryption.md) implements the onboarding and recovery/verification UI for #160 and #161. The first-use direct-chat path now opens the newly created encrypted conversation; disposable Synapse checks its room state, first encrypted send and peer decryption alongside password-account and standard SSO fresh-device backup restore and incoming Aimtrix-to-Aimtrix SAS. [PR #218](https://github.com/spencerrung/aimtrix/pull/218) verified Element Web emoji SAS and [PR #219](https://github.com/spencerrung/aimtrix/pull/219) verified Element-to-Aimtrix QR scanning. Provider-specific SSO/UIA, reverse-direction QR, independently generated withheld-key and secret-sharing interoperability remain open.

The [browser acceptance pass](docs/browser-acceptance.md) adds Firefox/WebKit CI smoke projects and keyboard/Axe evidence for #162. Spoken screen-reader and physical-device acceptance remains open.
The [daily-client acceptance record](docs/daily-client-acceptance.md) joins the nine roadmap journeys to browser/live checks and keeps unverified core and target-specific gates visible for #164.

The [large-account performance profile](docs/large-account-performance.md) records a synthetic 10k-room baseline, bounded buddy-list and Matrix-space paging, optional index/attachment operation costs, and working interaction/memory budgets for #163. A quiet 20-minute normal-list run kept 101 rows bounded, measured 231 ms p95 and 23 MiB retained growth, and showed a flat 44 MiB heap for its final eleven minutes. A second host and live large-account initial sync remain open.
Isolated cache-enabled disposable Synapse profiles measure same-device reload after 350 synthetic messages and ten-minute incremental sync from another account. Two CI sustained-sync runs delivered all 300 events with bounded timelines, 143–186 ms p95 and 17 MiB retained growth. A production resume decision and broader account-scale evidence remain open.

The [visual reference handoff](docs/design/interaction-rules.md) records the step 02 design decisions and browser evidence. These are implementation inputs for the linked roadmap slices; the reference does not mark their production behavior complete.

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
- [x] Per-account IndexedDB Rust/WASM crypto store with an in-memory sync store; crypto initializes before sync.
- [x] Active/restored session rejection, token-free reauthentication, crypto retention, guarded account cleanup and explicit forget. See [session recovery](docs/session-recovery.md) for soft/hard logout and evidence boundaries.
- [x] Startup and signed-in offline/reconnecting/consent/storage states, non-destructive SDK reconnect, and same-account structured draft retention through reauthentication. See [private local drafts](docs/draft-storage.md).
- [x] E2EE enforcement in encrypted rooms with no plaintext fallback.

### Messaging, media, rooms, and spaces

- [x] Responsive full-viewport shell, dedicated DM scope, nested Matrix space navigation, drag/keyboard room and subspace organization, top-level space ordering, presence, aggregated unread/highlight counts, and authenticated avatars.
- [x] One contextual thread/details/search surface, bounded desktop widths, shared mobile/browser Back, retained reading anchors and drafts, accessible More/member menus, and reduced-height composition. See [conversation shell](docs/conversation-shell.md); physical keyboard/native Back acceptance remains separate.
- [x] Keyboard/touch quick switching, standard Matrix favorites, scoped unread/favorite filters, account-wide next-unread navigation, Matrix links, and Back/Forward reading positions. See [quick navigation](docs/quick-navigation.md) for privacy, failure states, and evidence boundaries.
- [x] Movable history bounded to 250 visible messages, older/newer navigation, old-event/reply context, stable reading anchors, truthful loading/retry/end states, and return to live. See [history navigation](docs/history-navigation.md); full search retains its separate gate; thread history and read reconciliation are documented below.
- [x] Independent old thread roots and bounded reply history, standard reply links, separate room/thread Back/Forward anchors, root fallbacks and focused live-tail read guards. See [thread history](docs/thread-history.md) and [shared room/thread messaging](docs/room-thread-messaging.md); Home coverage and followed-thread behavior are documented in [attention and catch-up](docs/attention-and-catch-up.md).
- [x] Text, notices, emotes, replies, edits, redaction, reactions, pins, typing state, and read-receipt sending.
- [x] Home catch-up with bounded notification/thread discovery, filters, exact context return, explicit coverage and cross-device Aimtrix thread-follow preferences. See [attention and catch-up](docs/attention-and-catch-up.md).
- [x] Private main/thread read tracking, focused live-tail advancement, consistent mute/highlight badges, explicit read/unread reminders and saved message context. See [read state](docs/unread-state.md) for cross-device semantics and older-server/physical-device boundaries.
- [x] Image/video/audio/file rendering and authenticated encrypted-attachment decryption.
- [x] Capability-gated reviewed voice recording and loaded-image navigation, with a disposable encrypted-room exchange in the live harness; physical-device and independent-client acceptance remain open. See [voice/media evidence](docs/voice-and-media-navigation.md). — [#168](https://github.com/spencerrung/aimtrix/issues/168).
- [x] Encrypted/unencrypted uploads with limits, progress, cancellation, and retry.
- [x] Shared safe formatted-message rendering/actions across rooms, replies and thread roots, with permission checks, accessible failure feedback and truthful unsupported-message fallbacks. See [room/thread messaging](docs/room-thread-messaging.md).
- [x] Shared room/thread editor tools and account/homeserver-scoped structured local drafts, draft indicators/list, full edit restoration and revision-safe send cleanup. Browser draft plaintext/privacy, quotas, conflicts and logout cleanup are explicit in the [draft contract](docs/draft-storage.md).
- [x] Multiple reviewed attachments with captions, ordering, per-file encrypted progress/cancellation/retry and explicit reload reattachment; attachment bytes are never persisted with drafts. See [room/thread messaging](docs/room-thread-messaging.md) for protocol and validation boundaries.
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
- [x] Interoperable `m.sticker` send/render with original-endpoint SVG retrieval, encrypted-room sticker upload/decryption via `content.file`, original Aqua starter pack, and operator-installed manifest support.
- [x] Optional provider-neutral GIF search/preview/download/Matrix-upload flow with encrypted-room support.
- [x] Media data-saver and animated-GIF autoplay gating.
- [x] Private namespaced Matrix account-data sync for portable Aimtrix preferences; hardware IDs remain local.

### Frutiger Aero and profile-expression program

#### Aqua + Aero art direction

- [x] Extend Aqua with an original Frutiger Aero token layer: sky cyan, clean water, fresh greens, glass highlights, soft sunlight, and restrained bubble motifs.
- [x] Add Aero atmosphere to the title bar, space rail, buddy list, timeline, drawers, login, and settings without reducing contrast or room density.
- [x] Add reduced-motion-safe ambient bubbles and profile-card effects; keep Graphite and Midnight visually independent.
- [x] Add desktop/mobile visual and Axe coverage for refreshed Aqua surfaces.

#### Decorated Aimtrix profile page

- [x] Replace the small self-profile popover with a responsive profile-card dialog and live preview.
- [x] Keep Matrix display name/avatar/presence standard while storing Aimtrix-only decoration privately and documenting its visibility.
- [x] Add original landscape banner presets, validated Matrix image upload, authenticated preview, reset, and failure states.
- [x] Add avatar frames, card surfaces, a short bio, effect controls, and up to three pinned profile stickers.
- [x] Sync decorations through namespaced Matrix account data with local demo/offline fallback and strict parsing.
- [x] Make the profile editor keyboard/mobile accessible and honor reduced motion/data saver preferences.

#### Sticker library

- [x] Ship multiple original lazy-loaded packs with distinct Aero and web-garden art direction, manifests, names, and descriptions.
- [x] Reuse installed packs in both the composer and profile decorator with loading, empty, and manifest failure states.
- [x] Add personal pack installation/removal by validated same-origin or HTTPS manifest URL; keep operator-installed packs available but immutable.
- [x] Validate manifest item shape and safe image URLs, deduplicate packs/stickers, bound pack size, and cache only on demand.
- [x] Document pack authoring, trust boundaries, portability, and original-asset policy.
- [x] Add parser, persistence, interaction, and browser tests for profile decoration and sticker packs.

### Conversation polish and room-backdrop program

#### Read-position indicators

- [x] Map standard unthreaded Matrix `m.read` receipts to the latest rendered message at or before each reader's receipt.
- [x] Render compact authenticated avatar bubbles on that message, exclude the current user, cap crowded rows, and provide accessible reader names.
- [x] Refresh receipt positions during sync, provide representative demo data, and cover missing/private/out-of-window receipts safely.

#### Room and direct-message backgrounds

- [x] Add original low-distraction backdrop presets plus validated Matrix image upload and authenticated custom-image retrieval.
- [x] Keep text readable with a fixed backdrop presentation that lets artwork pop, opaque/translucent message surfaces, and no user-controlled contrast-breaking opacity.
- [x] Let every DM participant choose their own private per-room backdrop through namespaced account data without changing the other participant's view.
- [x] Store shared group-room and inherited space backdrops in documented namespaced state with graceful behavior in clients that ignore it.
- [x] Let room/space administrators choose Managers only, Decorators, or Everyone by updating the custom state event's Matrix power-level threshold.
- [x] Add a real Decorator role at power level 25, below moderators, and expose assignment only to users allowed to change power levels.
- [x] Show permission, upload, save, reset, inheritance, unsupported, and non-E2EE media guidance truthfully in the room drawer and responsive dialog.

#### Navigation and profile entry points

- [x] Remove the visual drag badge from movable space icons while retaining pointer drag and `Alt+Arrow` reordering.
- [x] Add a Decorate profile page action to profile settings while preserving the self-card entry point.
- [x] Add unit, controller, desktop/mobile Playwright, Axe, visual, documentation, bundle, and final-container coverage for this program.

### Direct voice and video

- [x] Feature-gated one-to-one Matrix VoIP call start, incoming state, answer, reject, and hangup.
- [x] Voice/video, microphone mute, camera mute, selected devices, speaker routing, screen sharing, notifications, and browser video/PiP controls.
- [x] Display MatrixRTC focus discovery and document TURN and LiveKit/JWT requirements without vendor hardcoding.

### Browser, accessibility, and QA

- [x] Shared native modal/picker focus, nested dismissal, guarded confirmations, failed-action retention and cancellable initiated verification; see [interaction behavior and evidence boundaries](docs/accessible-interactions.md). Broader screen-reader/browser acceptance remains #162.

- [x] Conservative installable PWA shell and explicit update/reload prompt.
- [x] Playwright desktop/mobile coverage for navigation, messaging, emoji, stickers, settings, search, themes, and drawer behavior.
- [x] Axe WCAG A/AA desktop checks and responsive/focus-visible acceptance coverage.
- [x] Mocked Matrix controller tests for room state, moderation, uploads, progress, and push rules.
- [x] Chromium visual feedback loops and a CI browser gate.
- [x] Bundle budgets and bounded large-room rendering.
- [x] Tauri desktop and Capacitor mobile shells, credential/lifecycle/deep-link adapters, and packaging foundations implemented; PWA retained. Native/device release validation remains under [#175](https://github.com/spencerrung/aimtrix/issues/175).

## Post-0.1 compatibility backlog

These retain compatibility depth and validation obligations alongside additive features. The issue links identify execution owners; later roadmap order does not waive an existing release requirement. No hidden placeholder counts as an implementation.

### Matrix messaging depth

- [x] Add Matrix threads with root summaries, focused timelines, standard `m.thread` replies, and separate thread receipts.
- [x] Personal saves and browsable room collections: reference saves, state-backed pins, and explicitly loaded-window media/links from [PR #196](https://github.com/spencerrung/aimtrix/pull/196), with live cross-device and permission-loss acceptance in [PR #208](https://github.com/spencerrung/aimtrix/pull/208). See [retrieval contract](docs/collections-history-retrieval.md). — [#156](https://github.com/spencerrung/aimtrix/issues/156).
- [x] Homeserver-backed unencrypted history search and filters beyond the loaded timeline: implementation in [PR #196](https://github.com/spencerrung/aimtrix/pull/196), with live cross-room and exact-context acceptance in [PR #208](https://github.com/spencerrung/aimtrix/pull/208). — [#157](https://github.com/spencerrung/aimtrix/issues/157).
- [x] Complete live key-availability and device acceptance for the opt-in local encrypted-history index. [PR #209](https://github.com/spencerrung/aimtrix/pull/209) passed two clean disposable Synapse runs with devices that can and cannot decrypt older history. See [its privacy contract and evidence](docs/private-encrypted-search.md). Native storage-provider acceptance remains [#175](https://github.com/spencerrung/aimtrix/issues/175). — [#158](https://github.com/spencerrung/aimtrix/issues/158).
- [x] Basic emphasis, inline/fenced code, code-file previews/copy, safe text links, link previews, and authored Matrix formatting/mention metadata. General incoming rich HTML remains a separate partial capability.
- [ ] Complete sanitized incoming `formatted_body` HTML, spoilers and extensible event rendering; validate polls and locations across independent clients and deeper relation/closure cases. Poll and static-location controls, rendering, mocked protocol coverage, and a disposable encrypted-room exchange are implemented; see [social messages](docs/polls-and-locations.md). — [#152](https://github.com/spencerrung/aimtrix/issues/152), [#166](https://github.com/spencerrung/aimtrix/issues/166), [#167](https://github.com/spencerrung/aimtrix/issues/167).
- [x] Explicit per-event delivery, original-transaction retry/cancel and room/thread text draft protection. — [#145](https://github.com/spencerrung/aimtrix/issues/145); [behavior and evidence](docs/message-delivery.md).
- [ ] Validate per-event decryption and withheld-key diagnostics against real cross-client key-request/withholding cases, beyond mocked reason-code tests. — [#161](https://github.com/spencerrung/aimtrix/issues/161).
- [x] Validate aliases, history visibility, join rules/knocking, guest access, room upgrades, and server ACL editing on disposable Synapse. [PR #215](https://github.com/spencerrung/aimtrix/pull/215) checks ordinary member denial and server readback; [PR #216](https://github.com/spencerrung/aimtrix/pull/216) checks an Aimtrix knock request and encrypted upgrade; [PR #217](https://github.com/spencerrung/aimtrix/pull/217) checks a 50-power moderator grant, setting write, owner-only denial and demotion. Other homeservers remain an interoperability boundary. See [community onboarding](docs/community-onboarding.md). — [#165](https://github.com/spencerrung/aimtrix/issues/165).
- [x] Validate suggested-child controls, canonical-parent selection, explicit space removal and denied second-write rollback on disposable Synapse. [PR #215](https://github.com/spencerrung/aimtrix/pull/215) checks the standard graph and removal; [PR #216](https://github.com/spencerrung/aimtrix/pull/216) checks rollback. Concurrent remote moderators and other homeservers remain separate interoperability boundaries. — [#165](https://github.com/spencerrung/aimtrix/issues/165).
- [x] Room all/mentions/nothing, keyword/thread rules, account DND, local quiet time and safe delivery troubleshooting. — [#159](https://github.com/spencerrung/aimtrix/issues/159); [behavior and boundaries](docs/attention-and-catch-up.md). Actual closed-app provider acceptance remains [#176](https://github.com/spencerrung/aimtrix/issues/176).

### Encryption and identity depth

- [ ] Validate Aimtrix QR display with an independent scanner and cross-client cancellation; [PR #219](https://github.com/spencerrung/aimtrix/pull/219) completed the Element-generated QR to Aimtrix camera-scan direction, and disposable Aimtrix-to-Aimtrix incoming SAS is exercised separately. — [#161](https://github.com/spencerrung/aimtrix/issues/161).
- [ ] Validate independently generated withheld-key and secret-gossip behavior, key-request guidance, and recovery reset across further UIA variants. The disposable Synapse harness exercises a standard withheld-key event and confirmed password-account reset; the installed Rust SDK disables automatic room-key requests. — [#161](https://github.com/spencerrung/aimtrix/issues/161).
- [ ] Test delegated OIDC/MSC3861 native flows beyond standard Matrix SSO token login. — [#174](https://github.com/spencerrung/aimtrix/issues/174).

### Group calls

- [ ] Implement group MatrixRTC memberships and LiveKit focus authorization. — [#169](https://github.com/spencerrung/aimtrix/issues/169).
- [ ] Add room call activity, participant grid, active speaker, member controls, reconnect state, and group-call E2EE indicators. — [#169](https://github.com/spencerrung/aimtrix/issues/169).
- [ ] Add automated WebRTC tests with fake media plus disposable Synapse/LiveKit/TURN interoperability coverage. — [#143](https://github.com/spencerrung/aimtrix/issues/143), [#169](https://github.com/spencerrung/aimtrix/issues/169).

### Product-contract decisions

- [x] Decide that private profile decoration stays private; public or room-scoped expression is deferred pending explicit audience, capability and deletion evidence. — [#170](https://github.com/spencerrung/aimtrix/issues/170); [decision](docs/product-contract-decisions.md).
- [ ] Run and review the disposable Chromium close/restart/freeze/offline/time-zone proof in CI before closing the scheduling decision. The current direction rejects guaranteed scheduled sending and timed reminders in the backend-free release. — [#172](https://github.com/spencerrung/aimtrix/issues/172); [draft decision](docs/product-contract-decisions.md).
- [x] Select operator-managed Matrix bot/bridge room membership for the first integration path, with no client catalog or provider secrets in public config. — [#173](https://github.com/spencerrung/aimtrix/issues/173); [decision](docs/product-contract-decisions.md).

### Scale, portability, and release validation

- [x] Add disposable Synapse/Dex integration infrastructure and CI for password/standard SSO, encrypted multi-device sync, authenticated encrypted uploads, and moderation; see [live evidence](docs/live-matrix-tests.md).
- [ ] Extend disposable Synapse integration coverage to backup restore and complete release journeys. — [#143](https://github.com/spencerrung/aimtrix/issues/143), [#164](https://github.com/spencerrung/aimtrix/issues/164).
- [ ] Add Firefox and WebKit browser matrices and screen-reader/manual keyboard audits. — [#162](https://github.com/spencerrung/aimtrix/issues/162).
- [ ] Add 10k-room and long-running sync profiling beyond the current bundle/timeline bounds. — [#163](https://github.com/spencerrung/aimtrix/issues/163).
- [ ] Virtualize the rendered timeline if profiling shows the bounded 250-event list still limits very large rooms. — [#146](https://github.com/spencerrung/aimtrix/issues/146), [#163](https://github.com/spencerrung/aimtrix/issues/163).
- [x] Measure baseline live send/receive latency and verify shared/private backdrop application against disposable Synapse; scope and timings are recorded in [live evidence](docs/live-matrix-tests.md).
- [ ] Extend latency/backdrop evidence to broader release topologies and scale targets. — [#143](https://github.com/spencerrung/aimtrix/issues/143), [#164](https://github.com/spencerrung/aimtrix/issues/164).
- [ ] Complete clean-machine and physical-device native install/upgrade, secure-store, media and lifecycle validation for the existing Tauri/Capacitor implementations; retain platform-specific capability limits. — [#175](https://github.com/spencerrung/aimtrix/issues/175).

- [ ] Verify real closed-app Web Push/APNs/FCM delivery and token/lifecycle behavior for claimed platforms; existing adapters and privacy proofs remain implemented. — [#176](https://github.com/spencerrung/aimtrix/issues/176).

## Chosen self-hosting defaults

- Canonical development host: `aimtrix.alucard.dev`.
- Canonical image: `docker.io/spencerrung/aimtrix`.
- GIF integration: disabled unless an operator supplies a CORS-compatible provider endpoint.
- Calls: disabled unless an operator explicitly enables them and provides dependable TURN.
- Personal Aimtrix-only personalization: private account data; explicitly shared room/space backdrops use documented namespaced state.
- Matrix-standard events and account data take precedence over custom schemas.
