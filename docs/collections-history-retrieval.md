# Collections and history retrieval

[PR #196](https://github.com/spencerrung/aimtrix/pull/196) adds a personal saved-message list, room collections, and a filtered search surface. [PR #208](https://github.com/spencerrung/aimtrix/pull/208) records their live Matrix acceptance for [#156](https://github.com/spencerrung/aimtrix/issues/156) and [#157](https://github.com/spencerrung/aimtrix/issues/157).

## Personal saves and shared pins

Aimtrix writes personal saves to `im.aimtrix.saved_events.v1` Matrix account data as `{ items: [{ roomId, eventId, savedAt }] }`. It stores no message text, sender, media URL, or decrypted attachment in this event. Account data is **not end-to-end encrypted**: the homeserver can see which event references are saved. The parser discards unknown fields, invalid entries, and duplicates; the list is capped at 200, with the newest first. There is no earlier Aimtrix save format to migrate. Other clients ignore this namespaced account data safely.

Saving verifies that the event belongs to a joined room and can be resolved. Removing a reference remains possible after leaving or losing room access. Opening a save uses the existing event-context route; unavailable, removed, or inaccessible events show the history fallback. The list displays room name and save time, then fetches content only after opening the event. It never keeps a stale message preview.

Shared pins continue to use the standard `m.room.pinned_events` room state and its existing power-level checks. The Collections drawer reads current pin IDs from that state and can open pins outside the loaded timeline. Files/media and links show items from the bounded, loaded conversation window; the drawer labels this coverage and offers existing older-history navigation when available. Encrypted media uses authenticated decryption through the shared media resolver. Data saver requires an explicit preview load.

## Search coverage

History search sends `content.body` queries to the homeserver only for rooms that are currently joined and not encrypted. Room and sender filters are sent to Matrix search; type narrows event types. Dates and the links/media distinction are applied to returned pages, so a page may have no displayed matches even when more server pages exist. The panel exposes pagination, cancellation, retry, and an approximate server count before local filters. Results open through exact event-context navigation.

Messages already loaded in joined rooms are also searchable, including decrypted messages from encrypted rooms. The panel labels this narrow coverage. It does not send decrypted content to server search, create a plaintext search index, or claim full encrypted-history coverage. The local encrypted index remains [#158](https://github.com/spencerrung/aimtrix/issues/158). Rendering search results does not advance read state; opening an event follows the existing focused-history rules.

## Evidence and boundaries

Parser and controller tests cover opaque metadata, bounds, account action behavior, encrypted-room exclusion, filter encoding, redaction, and paging results. Desktop/mobile Chromium journeys cover save, return, removal, collections, search state, and contextual navigation; screenshots were inspected. The [disposable live harness](live-matrix-tests.md) checks opaque saved-reference sync between two devices, exact context return, removal after leaving a room, pinned-state sync and member denial, and old unencrypted cross-room search with an exact context jump and no passive read receipt. [Hosted CI](https://github.com/spencerrung/aimtrix/actions/runs/36659600779) passed two independent clean Synapse runs (36 checks each), the privacy diagnostic probe, and the Element Web peer run. This establishes those journeys on the pinned disposable stack. Other homeservers, full encrypted-history indexing, and native-device/provider behavior remain separate boundaries in [#158](https://github.com/spencerrung/aimtrix/issues/158), [#175](https://github.com/spencerrung/aimtrix/issues/175), and [#176](https://github.com/spencerrung/aimtrix/issues/176).
