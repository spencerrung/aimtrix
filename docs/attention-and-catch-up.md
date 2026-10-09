# Home activity and notification controls

Home opens from the sparkle button in the title bar or the Home space. It gathers unread conversations, highlighted notifications and threads in one surface, with All activity, Unread, Mentions and My threads filters. Browse conversations opens the room list directly, including on narrow screens. Drafts opens the existing private draft list. Event rows use authenticated Matrix context navigation; browser Back restores the filter and scroll position. The conversation is unmounted while Home is visible, so hidden timelines cannot advance their receipts.

Activity cards use the room's avatar and color where available and render a bounded, inert preview of supported Matrix formatting. Reply fallback quoting is removed, while links and spoilers stay non-interactive in Home; opening the conversation shows the full message. Encrypted or unavailable activity retains an explicit placeholder.

## History and read state

The controller owns an ephemeral activity cache, separate from SDK room and thread timelines. Standard `/notifications` requests include all notification types, with 30 entries per page and at most 20 pages per refresh. At most 500 activity records are retained. Refresh starts discovery again; Load older activity advances the notification cursor. Repeated cursors stop pagination. Failures preserve available rows and expose retry. Room membership and client-generation checks discard stale responses. Activity contents are cleared on account shutdown and are not persisted.

Thread discovery uses the homeserver's advertised thread-list support and `/rooms/{roomId}/threads?include=participated`, checking four rooms per action, at most 200 rooms and 20 pages per room. Manual follows are fetched independently. Unsupported servers use loaded participating threads. Coverage shows rooms checked, missing keys, unavailable history and retained limits. A homeserver notification list is not a complete message archive: muted/non-notifying messages may be absent, and encrypted highlights require keys. “No matching activity” refers only to the history checked.

Room/space badges retain their existing aggregate counts; activity rows never add to them. Unread filtering includes unknown read positions rather than declaring them read. Activity read state uses real public/private receipts in the appropriate main/thread scope, with exact IDs or established timeline order. The homeserver notification `read` field is retained as a hint but does not override these scoped checks. Viewing, refreshing or filtering Home sends no receipts. The explicit “Mark loaded timeline read” action uses the existing main-timeline read operation and leaves unseen thread counts alone.

Encrypted events are mapped and decrypted without inserting them into SDK timelines. Owned-event identity checks allow late keys to update cached previews; live redactions remove preview content. Exact event opening uses existing context and access checks. Cross-account responses cannot populate another account's feed.

## Following threads

“Follow in Home” is an Aimtrix catch-up preference, not a server push subscription. Participated threads appear by default; Hide from Home explicitly excludes them. This fallback is deliberate: server thread subscription discovery is not a stable API in the installed SDK.

Room account data event `dev.alucard.aimtrix.followed_threads.v1` stores:

```json
{ "version": 1, "threads": { "$synthetic-root": true, "$synthetic-hidden-root": false } }
```

Only valid event IDs and booleans are accepted, bounded to 128 preferences per room. No message bodies or profile data are stored. Local writes are serialized and read the latest server account data before updating. Other Aimtrix devices reconcile through sync; concurrent changes from different devices remain last-writer-wins. Other Matrix clients safely ignore this private account-data event. False overrides are retained so hidden participating threads do not immediately reappear.

## Notification controls

Matrix & security → Notification rules and delivery exposes authoritative homeserver rules, local quiet settings and delivery checks. Home's notification shortcut opens Matrix settings directly. Changes refresh server rules before writing and read back afterwards; partial failures retain a visible error and refresh what the server actually accepted.

- **All messages:** a standard room rule with `notify`.
- **Mentions and keywords:** an empty-action room rule; higher-priority mention/content rules still apply. The homeserver cannot inspect encrypted mentions or keywords; encrypted mentions-only delivery while the client is closed is not guaranteed.
- **Nothing:** an unconditional room override with empty actions, including suppression of mentions. Main/space badges hide ordinary and highlighted counts while preserving an explicit unread reminder.
- **Account default:** remove the canonical room customization. Unfamiliar custom rules are preserved and labeled for management in their originating client.
- **Keywords:** standard content-rule glob patterns, bounded to 120 characters. Encrypted bodies cannot be matched by the server; closed-app encrypted keyword delivery is not promised.
- **Thread alerts:** exact relation overrides allow mute or inherited room alerts on supported servers. Thread following and thread alerts remain separate controls.
- **Account DND:** the standard `.m.rule.master` switch, shared across devices until manually disabled. It has no fictitious closed-app expiration timer.
- **Local pause/quiet hours:** account-scoped device storage; one-hour pause or a daily interval in the device's local time. An interval can cross midnight; equal start/end disables the interval. This suppresses foreground alerts/sounds. Every delivered browser push must still present a visible notification; quiet-time and duplicate deliveries replace one generic notice with `silent: true` and `renotify: false`. Operating-system quiet settings control background interruptions on browser and native installations.

Exact room conditions use `event_property_is` on Matrix 1.7+; older servers use literal `event_match` only for room IDs without glob metacharacters. Thread relation conditions require the Matrix 1.10 escaped-property-path behavior. See the [Matrix push-rule specification](https://spec.matrix.org/v1.10/client-server-api/#push-rules).

## Delivery and privacy

Health reports permission, platform/configuration support, subscription presence/expiry and a matching HTTP pusher's app ID, key, gateway and `event_id_only` format. It does not expose those private keys/endpoints or claim gateway reachability/delivery. The local test has a generic title/body and no account, room, message or token data; it does not exercise the gateway.

Foreground notification callbacks capture the current opaque account generation and exact room/event route. Stale clicks are rejected. Browser worker metadata contains an opaque generation, quiet policy and bounded event-ID deduplication records, with no credentials or message contents. Failed metadata saves report that background quiet settings could not be saved; they do not silently report success. The most recently active account context owns provider display for an installation.

Browser local alerts prefer an active service worker's `showNotification`; Android Chrome does not support the `Notification` constructor. Registration lookup is bounded to the currently registered worker instead of waiting indefinitely for `serviceWorker.ready`. Where no active worker exists, desktop constructor support remains available; failed presentation is reported to the local-test UI and releases the event claim for retry. Automatic presentation failures also release the controller's event guard. See [Chrome's notification API guidance](https://developer.chrome.com/blog/notifying-you-of-changes-to-notifications#android_notifications).

Persistent local notifications carry a validated destination supplied by the authenticated foreground client, including its account selection when available. Clicking checks the opaque owner against current metadata, then delivers the route to an existing window or opens a validated URL for cold startup; another active account still requires the existing explicit account-switch flow. This notification data is distinct from the bounded policy database and contains no access token. Provider push payloads cannot set this local route. A stale owner or unavailable metadata cannot select a conversation.

Provider event identifiers alone cannot prove which account generated a delayed push. Provider notifications therefore open/focus Aimtrix generically, never select a potentially wrong-account conversation. Exact routing is retained for authenticated foreground events and ordinary validated Matrix links. Provider payloads remain `event_id_only`; this does not introduce an account token or a new gateway protocol. Duplicate event IDs are bounded and shared between the browser worker and foreground adapter. Native adapters apply owner/dedup guards to local notifications; provider delivery remains an external release boundary.

The worker fulfills `userVisibleOnly` for duplicates, quiet time, missing account metadata and metadata-storage errors through a coalesced generic notification, containing no owner, account, room, event or message data. Its click only opens/focuses the application. A single stable tag prevents separate duplicate notices from accumulating; `silent` requests no sound, but cannot override browser/OS policy. The static client cannot suppress an already-delivered background push or promise to wake later to re-enable a subscription. Account DND and disabling background notifications remain the existing server/registration controls. [WebKit requires a visible notification for each push](https://webkit.org/blog/12945/meet-web-push/); silently discarding them can revoke the subscription. Physical Safari/APNs delivery and OS presentation remain separate acceptance checks.

## Evidence boundaries

Unit, browser, disposable Matrix and provider evidence are recorded separately in the MR and live-test documentation. Mock worker/native tests establish routing, privacy, quiet-time and lifecycle behavior, not real Web Push/APNs/FCM delivery on suspended hardware. Native release and actual provider acceptance remain #175 and #176. No production Matrix, gateway or deployment changes are required by this batch.
