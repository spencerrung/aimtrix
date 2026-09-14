# Thread history and navigation

Aimtrix opens standard Matrix thread roots and replies independently of the room’s loaded message window. A Matrix message link is resolved against its joined room, decrypted when necessary, and classified using standard `m.thread` relations or root metadata. Ordinary quoted replies remain room-message destinations. Opening a link never joins a room automatically.

## Reading and navigation

The thread uses the shared contextual shell: a desktop side panel and a dedicated conversation-sized surface on smaller screens. Its root remains available when the room timeline moves. Removed roots show an explicit removal message; inaccessible roots and failed requests provide retry. Available replies and the thread draft remain usable.

Older and newer controls page a bounded reply window. Each retained thread holds at most 250 visible replies and a bounded set of relation events; at most 32 thread histories are retained for the current account. Network walks have request and raw-event limits, including the fallback for homeservers without forward thread pagination. Reaching a retrieval limit does not claim that all server history was searched.

Thread links, Back/Forward entries, and ordinary thread reopening retain separate reading positions from the room timeline. An explicit reply link takes precedence over the thread’s last position; browser traversal restores the position saved for that entry. Anchors survive paging, incoming events, media sizing and drawer resizing. Jump to latest explicitly resumes the current live replies. Pending requests are guarded by account, room, root and navigation generation; UI restoration waits for the matching snapshot to publish.

## Matrix state and privacy

The controller owns bounded relation pages, SDK event mapping and decryption. Background thread reads use standard relations/context requests without constructing or paginating an SDK Thread: the SDK’s automatic sender receipts can otherwise clear encrypted highlights when old self-authored replies are loaded. UI code consumes root/reply summaries, history state, participation, latest activity and independently computed live-tail metadata. Historical windows do not substitute their last visible reply for the actual latest reply. When a complete server total is unavailable, a plus sign marks a reply-count lower bound; participation stays unknown unless server metadata or an accepted own reply establishes it.

Opening or paging a thread sends no read receipts. Automatic thread reads require a visible, focused, live thread viewport showing the accepted tail. Historical pages, pending navigation and hidden panels cannot advance read state. A failed receipt retries its original observed event; it does not advance to a new arrival merely because the retry succeeded. Private/public receipt preferences and unsupported-server behavior follow [read state](unread-state.md).

Normal thread replies use the SDK’s standard threaded send path and the existing encrypted delivery queue. Removed roots do not require inventing quoted text or sender mentions. Sending from history returns to the latest replies; editing preserves the historical position. Failed sends retain the draft or the retryable local echo, and errors appear inside the thread surface. Unified rich room/thread composition and durable drafts remain [#153](https://github.com/spencerrung/aimtrix/issues/153).

Accepted replies remain visible exactly once when SDK synchronization takes ownership during initial history loading. Replies arriving during root lookup, failed lookup or reopening survive the first server page, while loading continues to block read receipts. Historical windows retain their selected replies.

## Evidence boundaries

Focused controller, snapshot, shell and viewport tests cover unloaded roots, bounded paging, decryption, redaction, relation updates, lifecycle cancellation, exact thread receipt scope and separate navigation positions. Synthetic browser journeys cover old-root and reply links, paging anchors, drafts, retries, hidden/history receipts, Back/Forward, three themes, accessibility, desktop, mobile and short landscape layouts.

Disposable Synapse interoperability evidence is recorded with the live Matrix suite; mocked tests alone do not establish protocol interoperability. Physical iOS/Android/desktop navigation, other homeservers, provider push and large federated histories remain separate acceptance boundaries. The application remains static and backend-free; no new operator settings are required.

## Validation record

September 14, 2026, Linux amd64:

- `npm run check`: 742 tests across 53 files, ESLint, TypeScript, production build and bundle budgets passed.
- `npm run test:e2e`: 93 passed, 7 intentional desktop/mobile project skips. Thread-specific coverage contributes 18 passing scenarios; desktop, mobile, three-theme and short-landscape screenshots were inspected.
- `npm run test:matrix:privacy`: 6 passed. The disposable Synapse/Dex run passed 22/22 checks with cleanup complete, including real encrypted old-root/reply retrieval, pagination and confirmed private thread receipts.
- A real SDK regression test loads an old self-authored encrypted reply and verifies that unread highlights remain unchanged, no SDK Thread is constructed or paginated, and no receipt is sent.

Local runtime evidence exercised the working-tree build; delivery CI validates the committed revision. Physical native devices, other homeservers and federation remain outside this run. Full shared message/root rendering and action parity continue under #152; durable composition and Home activity retain their own issues.
