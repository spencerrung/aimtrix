# Bounded history and event context

[Polish 06 / #146](https://github.com/spencerrung/aimtrix/issues/146) replaces the fixed recent-event tail with a movable conversation window. The Aqua interface keeps explicit older/newer controls, a beginning-of-available-history state, contextual retry feedback, and a return-to-latest action. Reply previews and incoming event links open the selected message with surrounding conversation, including targets outside the current window. Removed or inaccessible targets receive a safe explanation; an unavailable target never triggers an unbounded scan.

## Matrix and rendering contract

`src/matrix/RoomHistory.ts` belongs to the controller lifecycle. It selects events from the SDK's unfiltered room timelines, navigates their public neighbouring timelines and pagination tokens, and uses `getEventTimeline` for exact event lookup. The SDK's context lookup requests `limit=0`, so Aimtrix explicitly collects up to 25 visible messages on either side. Each ordinary navigation requests up to 50 additional visible messages. A displayed window holds at most 250 visible messages; loaded edits and reactions associated with those messages do not consume that capacity. Relevant loaded relations supplement snapshot rendering without altering pagination cursors.

Each operation has a bounded raw-event and network-request budget (10,000 events and 10 pagination requests). A relation-heavy page may therefore need another user action. Reaching that budget does not claim the server's history has ended. Pagination uses SDK decryption before classifying visible events; unavailable keys retain the existing encrypted-message state. It creates no alternate Matrix client, plaintext fallback, plaintext persistence, or server-side index.

Room, client, membership and navigation generations guard asynchronous completion. Switching rooms, requesting another context, returning to live, leaving a room, or shutting down prevents an older operation from replacing the selected conversation. A sync timeline reset refreshes live mode while preserving historical selections. These windows are in-memory view state; SDK storage/cache policies and account-scale memory profiling remain separate work under #163.

## Reading position and navigation

The UI records visible message identity and its pixel offset, with surviving neighbour fallbacks when the bounded window trims. It restores this anchor after pagination, edits, decryption and content-size changes. It does not infer position from total scroll height, which can stay constant when one end grows and the other trims. An explicit context jump focuses the target row; return to latest waits for the new live snapshot before scrolling. Reaching the bottom of an older page does not mark the live conversation read. Loaded-message search also suppresses read bookkeeping.

Search remains limited to the selected, loaded window. Full server-backed search (#157), encrypted local indexing (#158), old thread roots/history (#151), and broader unread/receipt reconciliation (#149) retain their separate acceptance gates.

## Evidence boundaries

Unit coverage exercises more than 250 messages with relations, both navigation directions, context lookup, unavailable/redacted/encrypted targets, stale requests, membership/client changes, and snapshot/draft behavior. Browser fixtures exercise the real Workspace at desktop and mobile widths, keyboard context focus, theme contrast, bounded navigation, return to live, incoming messages and simulated content expansion above the reader. Synthetic fixture screenshots contain no Matrix account data.

The disposable live harness adds `encrypted-history-and-context`: 350 messages sent through the real encrypted composer, a reloaded device paginating beyond the latest 250, forward navigation, exact old-event context with both neighbours, an incoming-message anchor check, return to live and a redacted target. The separate devices remain online, so this demonstrates available-key decryption without claiming isolated backup restoration. The harness keeps account credentials and room contents out of logs and artifacts. Federation, withheld-key recovery, other homeserver implementations, screen-reader speech and physical/native-device rendering remain untested by this slice.
