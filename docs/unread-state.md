# Read state and reminders

Aimtrix distinguishes notification counts, reading positions, and deliberate reminders. Reading the visible main conversation clears only its notifications; reading a visible thread clears only that thread. The room total supplied by the Matrix SDK already includes its threads. Home, direct messages, and spaces sum each included room once, without adding thread counts again.

A muted room keeps its underlying unread state. Ordinary unread notifications do not contribute to its attention badge; highlights still do. Disabled mute rules do not mute. A deliberate **Mark unread** reminder contributes at least one attention indicator even in a muted room. A reminder with no unread notifications is shown as a dot, not a fabricated message count. Spaces can overlap; their badges describe their own membership and must not be summed into a global total.

## Private bookkeeping

The **Send read receipts** setting controls public visibility, including threads. When enabled, Aimtrix sends `m.read`; when disabled, it sends `m.read.private`. Each receipt explicitly names its main or thread scope. Aimtrix uses the SDK HTTP client for the standard receipt endpoint and waits for server confirmation, avoiding the SDK convenience method's premature synthetic receipt. Failed requests must not clear encrypted highlights or appear as successful read state.

Main conversation reads also advance the private `m.fully_read` marker using the SDK read-markers operation, without its optional unthreaded receipt fields. Writes are ordered within a conversation and do not rewind a known later position. Failed marker writes can be retried independently of a successful receipt. Reads finishing after a session change do not update the new session.

Private receipts require Matrix v1.4 or the `org.matrix.msc2285.stable` feature flag. On older servers, a main conversation read uses only `m.fully_read`. A marker proven to cover the latest accepted main event in the loaded live timeline clears the displayed main counts while retaining unread threads. This rule also reconciles private markers received from another device. Missing or older history does not provide enough evidence to reconstruct unread counts. Unsupported private thread tracking reports an error and retry; Aimtrix never substitutes a public or unthreaded receipt. Capability lookup and receipt endpoint failures remain failures.

Passive reading requires a visible, focused document, the active conversation or thread surface, and the bottom of its live timeline. History, pending message context, search, covered panes, background tabs, and dialogs do not advance passive reads. The UI reports the event it actually displayed, so a subsequent arrival stays unread. **Mark conversation read** is an explicit action that updates the latest main position and clears its deliberate reminder; unseen threads retain their unread state.

## Mark unread and saved return points

**Read status** in the conversation header provides **Mark conversation read**, **Mark unread**, and, when available, **Return to saved message**, with pending, success, error, and retry behavior. Mark unread saves the first visible message as a return point. Returning uses ordinary message-context navigation, including older unloaded messages and its existing loading, unavailable, and retry states.

A reminder remains until explicitly cleared. Merely viewing the conversation or returning to its saved message does not remove it. An older read request must not clear a newer reminder. Another device's account-data updates invalidate the room snapshot and update the reminder.

Aimtrix writes standard room account data `m.marked_unread`:

```json
{
  "unread": true,
  "dev.alucard.aimtrix.return_point": { "event_id": "$synthetic-message:example.test" }
}
```

The namespaced extension contains only a validated event ID, scoped to that room's account data. It does not include message contents. Other clients can honor the standard boolean and safely ignore the return point. Aimtrix honors reminders from other clients without requiring the extension; malformed extensions are ignored. Stable `m.marked_unread` takes precedence over legacy `com.famedly.marked_unread`, including a stable false value. Clearing writes `{ "unread": false }` to the stable event. Marking unread never rewinds receipts or the fully-read marker. This is a room reminder, not a standardized per-thread bookmark.

## Evidence boundaries

Unit coverage exercises aggregation, private fallback, marker parsing and precedence, SDK receipt handling, operation ordering and failure, session guards, and focused/visible interaction rules. Browser coverage exercises the actual controls, saved context, and responsive layout. The disposable Synapse journey covers two own devices and another user, private main and thread scope, private receipt isolation, public receipt opt-in, and reminder synchronization. Only allowlisted summaries are retained by the live harness.

Passing these gates does not establish interoperability with every homeserver or third-party client. Older-server behavior is covered with protocol mocks; physical mobile/native focus and background transitions, missing older thread retrieval, and provider-specific notification delivery retain their separate acceptance gates.
