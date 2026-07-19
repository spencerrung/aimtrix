# Architecture

## Boundaries

Aimtrix is a static single-page application. It talks directly to a Matrix homeserver and, when calls are enabled, MatrixRTC infrastructure discovered through Matrix configuration. There is no required Aimtrix application server.

```text
browser
  ├─ Aimtrix UI and local preferences
  ├─ matrix-js-sdk sync and Matrix events
  ├─ in-memory sync store, per-account IndexedDB Rust crypto store
  └─ optional MatrixRTC and media providers
       │
       ├─ Matrix homeserver / media repository
       └─ discovered LiveKit focus and TURN services
```

## Source ownership

- `src/config/`: loading, validating, and exposing public runtime settings.
- `src/matrix/`: SDK construction, authentication, crypto initialization, lifecycle, and conversion into UI-safe view models.
- `src/features/`: product surfaces such as authentication, the workspace, profile pages, and media pickers.
- `src/components/`: reusable presentation components without Matrix SDK ownership.
- `src/settings/`: strictly parsed local/private personalization models.
- `src/styles/`: global reset, accessibility rules, and tokenized Aqua/Aero themes.

The UI should not depend throughout the tree on mutable Matrix SDK objects. The Matrix boundary produces immutable snapshots so React updates remain predictable and transformation logic can be tested without a homeserver.

## Matrix lifecycle

For a restored or newly authenticated session:

1. Create the SDK client with the access token, user ID, and device ID (in-memory sync store; the persistent per-account store belongs to Rust crypto).
2. Initialize Rust/WASM crypto before starting sync.
3. Attach lifecycle, room, timeline, receipt, decryption, local-echo, and account-data listeners.
4. Start sync with lazy-loaded members, a conservative initial timeline, and chronological pending-event ordering so sent messages render immediately as pending local echoes.
5. Publish sanitized UI snapshots.

Publishes are coalesced into one animation frame and rebuilt incrementally: event listeners bump per-room version counters, and the snapshot builder reuses cached per-room message/member summaries whenever a room's version and timeline fingerprint are unchanged. Rebuilt message lists reconcile against the previous list so unchanged messages keep object identity, which lets memoized timeline components skip rendering.

Logging out stops the client, attempts server logout, clears local credentials, and clears account-specific SDK stores. Access tokens and message content must never be logged.

## Runtime configuration

`/config.json` is fetched with `cache: no-store` before rendering. It is public configuration, not a secret mechanism. The production container permits this file to be replaced with a ConfigMap or bind mount while hashed application assets remain immutable.

Configuration is validated and merged with conservative defaults. Invalid URLs, unsupported themes, negative sizes, or unknown feature values fall back safely and produce a user-readable startup warning rather than arbitrary script behavior.

## Space hierarchy

Joined-space state provides the immediate `m.space.child` and `m.space.parent` graph. When a user selects a top-level space, Aimtrix also queries the standard room-hierarchy endpoint so nested subspaces and rooms that are visible but not yet joined can appear in the buddy sidebar. The UI keeps subspaces out of the top-level rail, resolves descendant rooms cycle-safely, preserves Matrix `order` values, aggregates unread state, and offers an explicit join action for hierarchy previews.

Users with sufficient room-state power can enter arrange mode to drag, keyboard-reorder, or move children between joined spaces. Aimtrix persists mixed room/subspace ordering through standard `m.space.child` content and updates `m.space.parent` for moved subspaces where permitted. Top-level spaces have no Matrix parent to carry an order, so their private order is synchronized through `dev.alucard.aimtrix.space_order.v1`. Home and the dedicated Direct Messages scope are fixed local views and are never written as Matrix spaces.

## Read positions and conversation backdrops

Aimtrix renders standard unthreaded `m.read` receipts. For each other joined member, the latest receipt is mapped to the nearest rendered message at or before the receipt event. Receipts outside the loaded timeline, private receipts that were not shared, thread receipts, and missing members are not guessed. The view model bounds readers per message and the UI shows five overlapping authenticated avatars plus an overflow count.

Group-room backdrops use `dev.alucard.aimtrix.room_background.v1` state with an empty state key and a strictly parsed `{ "preset" }` or `{ "preset": "none", "mxc_url" }` value. The same event on a space provides a backdrop inherited by rooms while they are viewed inside that space; an explicit room backdrop takes precedence. Other Matrix clients safely ignore this namespaced state.

Who can send backdrop state is enforced by the room or space's standard `m.room.power_levels` `events` map. Aimtrix exposes manager-only, Decorator, and all-member thresholds. Decorator is power level 25, below Aimtrix moderators at 50. Because Matrix power levels are room-wide rather than scoped roles, assigning Decorator can also grant any unrelated operation whose threshold is 25 or lower; the UI warns administrators to review power levels first. A space role does not silently grant authority in its children—the space event controls the inherited space backdrop, while a room event remains governed by that room.

Direct-message choices are intentionally per-user. They are stored under `dev.alucard.aimtrix.direct_backgrounds.v1` account data keyed by room ID, allowing every participant to choose a different view without a last-writer-wins shared state event. Account data, room state, and uploaded backdrop media are homeserver-private rather than end-to-end encrypted and must not contain sensitive images.

Backdrop artwork is rendered at fixed low intensity beneath high-opacity, blurred message surfaces. Users cannot raise artwork opacity or remove the protected reading surface. Data saver suppresses custom remote backdrop retrieval.

## Media

Aimtrix itself remains stateless. Sent attachments, stickers, selected GIFs, and custom profile banners are uploaded to the Matrix media repository and referenced by `mxc://` URIs. Encrypted-room attachments—including `m.sticker` uploads—are encrypted before upload and referenced by standard `content.file` encryption metadata; encrypted stickers sent by other clients are decrypted after authenticated media retrieval as well. SVG media (including sticker artwork) is always fetched from the original download endpoint because homeservers cannot thumbnail it. Sticker manifests and heavy catalogs are validated and loaded only when their picker opens. Data saver gates non-local profile artwork and message media retrieval, and animated GIFs require a click when autoplay is disabled.

## Custom behavior

Use standard Matrix events for messages, edits, replies, reactions, receipts, presence, calls, stickers, pins, room state, and moderation. Portable client preferences are privately synchronized in `dev.alucard.aimtrix.preferences.v1`; camera, microphone, and speaker IDs remain device-local. `dev.alucard.aimtrix.profile.v1` carries a short bio, banner reference/preset, avatar frame, card/effect choices, up to three sticker references, and personal sticker-manifest registrations. These decorations are intentionally a private self-page, not a claim that Matrix exposes portable public banners. Like standard Matrix account data and profile media, this is homeserver-private rather than end-to-end encrypted and must not hold secrets. `dev.alucard.aimtrix.space_order.v1` contains only an ordered array of top-level Matrix space IDs. Other clients remain fully usable when they ignore these private account-data events.
