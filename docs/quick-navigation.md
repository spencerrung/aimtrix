# Quick navigation

Polish 10 · [#150](https://github.com/spencerrung/aimtrix/issues/150)

The titlebar search button opens the quick switcher from the conversation, room list, or contextual drawer. Ctrl+K on Windows/Linux and Command+K on Apple platforms also open it from a composer. The switcher searches joined rooms, existing direct conversations, and spaces already available to the current account. `#` limits results to rooms; `@` limits results to existing direct chats. It does not search a public user directory or create a conversation implicitly.

Text matches rank first, followed by recent destinations, explicit favorites, unread attention, and stable name/address ordering. The list is bounded to 50 results. Arrow keys, Home/End, Enter, and Escape work with a labeled combobox; selection survives snapshot reordering. Recent destinations are bounded to 30 and remain in memory for the mounted account. They are not uploaded or retained after sign-out.

## Favorites and unread navigation

The conversation-header star writes the standard `m.favourite` room tag through the Matrix controller. Each room's writes are serialized and guarded against a changed session. Existing favorite ordering/metadata and unrelated room tags are preserved. The room list uses the server's `m.tag` sync as its source of truth; request success alone does not invent a synced favorite. Pending, success, and retryable failure feedback accompany the action. Demo favorites remain local to the demo session.

The buddy list's All, Unread, and Favorites filter applies to the current space. Filtering preserves the current conversation and its composer even if that conversation is hidden from the filtered list. A filtered Matrix space shows a flat list of its matching conversations; All retains its space tree. The existing New & Favorite grouping includes rooms needing attention as well as explicitly starred rooms, while the Favorites filter uses only explicit stars.

Alt+Shift+Up/Down moves to the previous/next unread conversation across the account, wraps, and excludes the current conversation. It follows the existing mute/highlight/reminder badge policy. The switcher footer provides Next unread, Back, Forward, Open Matrix link, and keyboard help as touch controls. Ctrl+/ or Command+/ opens help outside editable fields. Global shortcuts ignore composition, repeat/default-prevented events, and other open dialogs; unread/help shortcuts leave editable fields alone.

## Matrix links and reading position

Standard `https://matrix.to/#/…` and `matrix:` room, alias, event, and user destinations share validation and controller resolution. Explicit malformed event paths are rejected as a whole. Aliases resolve through the SDK. Room navigation requires joined membership; a person link opens an existing joined direct conversation. The Open Matrix link dialog retains failed input and can offer an explicit Start conversation action for a person. That action reuses the encrypted direct-room creation flow. Opening a link never joins a room automatically.

Ordinary primary clicks on Matrix links in messages use the client navigation flow. Modified clicks keep normal browser behavior. Browser, push, Tauri, and Capacitor routes carry the same targets, including aliases and routing hints. Event-only legacy notifications remain supported when their room can be found among loaded events. Native SSO callbacks retain their separate handling. Unrelated URL parameters and opaque shell history state survive warm navigation.

A linked event opens the existing bounded history/context loader, with removed, inaccessible, loading, and retry states. Cached latest messages cannot advance read tracking while event navigation is pending. Replies use the same context navigation. Late alias resolution and return-to-live completion cannot override newer navigation or a changed account.

Back and Forward retain up to 100 in-memory destination entries, including distinct messages in the same room. Each entry can retain a first-visible event and its pixel offset, or a live-tail position. Restoring an unloaded reading position fetches context through the existing history owner. Opening or closing a contextual drawer does not recenter the main timeline. Branching after Back prunes forward destinations. Browser history stores opaque pointers; room/event IDs and reading anchors stay in memory and cannot be recovered by another account. Restricted browser-history environments retain an in-memory fallback. The separately persisted last room/space behavior is unchanged; durable drafts remain #153.

## Evidence boundaries

Protocol/parser/controller tests cover standard tags, lifecycle, invalid targets, membership, and alias/direct resolution. Component tests cover ranking, IME/platform shortcuts, filter ownership, failure feedback, and stale asynchronous navigation. Chromium fixtures exercise keyboard/touch controls, themes/accessibility, draft retention, old-event context, and Back/Forward reading offsets. The disposable Synapse harness includes favorite sync/reload/isolation and old encrypted event links through a real room alias; see [live Matrix tests](live-matrix-tests.md).

Physical desktop/mobile deep-link dispatch, OS Back behavior, software keyboards, and cross-client favorite UI ordering remain separate device/interoperability checks. Protocol mocks and browser emulation do not establish those boundaries. Full directory search, durable drafts, unloaded thread navigation, and broad search remain separate roadmap work.
