# Architecture

## Boundaries

Aimtrix is a static single-page application. It talks directly to a Matrix homeserver and, when calls are enabled, MatrixRTC infrastructure discovered through Matrix configuration. There is no required Aimtrix application server.

```text
browser
  ├─ Aimtrix UI and local preferences
  ├─ matrix-js-sdk sync and Matrix events
  ├─ IndexedDB sync/crypto stores
  └─ optional MatrixRTC and media providers
       │
       ├─ Matrix homeserver / media repository
       └─ discovered LiveKit focus and TURN services
```

## Source ownership

- `src/config/`: loading, validating, and exposing public runtime settings.
- `src/matrix/`: SDK construction, authentication, crypto initialization, lifecycle, and conversion into UI-safe view models.
- `src/features/`: product surfaces such as authentication and the workspace.
- `src/components/`: reusable presentation components without Matrix SDK ownership.
- `src/styles/`: global reset, accessibility rules, and tokenized Aqua themes.

The UI should not depend throughout the tree on mutable Matrix SDK objects. The Matrix boundary produces immutable snapshots so React updates remain predictable and transformation logic can be tested without a homeserver.

## Matrix lifecycle

For a restored or newly authenticated session:

1. Construct a per-account persistent sync store.
2. Create the SDK client with the access token, user ID, and device ID.
3. Initialize Rust/WASM crypto before starting sync.
4. Attach lifecycle, room, timeline, and decryption listeners.
5. Start sync with lazy-loaded members and a conservative initial timeline.
6. Publish sanitized UI snapshots.

Logging out stops the client, attempts server logout, clears local credentials, and clears account-specific SDK stores. Access tokens and message content must never be logged.

## Runtime configuration

`/config.json` is fetched with `cache: no-store` before rendering. It is public configuration, not a secret mechanism. The production container permits this file to be replaced with a ConfigMap or bind mount while hashed application assets remain immutable.

Configuration is validated and merged with conservative defaults. Invalid URLs, unsupported themes, negative sizes, or unknown feature values fall back safely and produce a user-readable startup warning rather than arbitrary script behavior.

## Media

Aimtrix itself remains stateless. Sent attachments, stickers, and selected GIFs are uploaded to the Matrix media repository and referenced by `mxc://` URIs. Encrypted-room attachments are encrypted before upload and decrypted only after authenticated media retrieval. Heavy catalogs are loaded only when their picker opens. Data saver gates media retrieval, and animated GIFs require a click when autoplay is disabled.

## Custom behavior

Use standard Matrix events for messages, edits, replies, reactions, presence, calls, stickers, pins, room state, and moderation. Portable local personalization is privately synchronized in `dev.alucard.aimtrix.preferences.v1`; camera, microphone, and speaker IDs remain device-local. The account-data value contains appearance, density, motion, drawer, notification, receipt, typing, autoplay, and data-saver preferences. Other clients remain usable when they ignore it.
