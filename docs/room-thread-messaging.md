# Room and thread messaging

The room timeline, thread replies and original thread message use the same renderer and action model. Room and thread composition share the rich editor, mentions, lazy emoji and sticker packs, configured GIF search, code blocks, image paste and attachment staging. The existing Aqua themes and contextual conversation shell remain the presentation contract.

## Incoming formatting and actions

Incoming `m.room.message` HTML is parsed into a bounded allowlist, never inserted as raw HTML. Supported content includes paragraphs, emphasis, lists, quotations, code, safe links, Matrix mentions and revealable spoilers. Reply fallback elements are removed. Unknown HTML containers contribute only safe descendant text; executable content, arbitrary styling and remote tracking images are excluded. MXC emoticons use the authenticated media path and respect data saver. Hidden spoiler media is not mounted until revealed. The parser limits text to 65,536 UTF-16 code units, 2,048 nodes and 24 nesting levels; overflow falls back to plain text.

Text, notices and emotes retain their kind through edits. Unknown user-facing `m.room.message` kinds have a truthful unsupported card and readable fallback body when available. Technical relations and state events remain outside the message timeline. This is not implementation of polls or locations.

Keyboard and touch actions share copy text/link, reply, thread, reactions, pinning, editing and deletion. A room message can also set the existing private unread reminder. Thread unread reminders and saves remain absent until their own backing contracts land. Room power levels determine message/state-event permissions; deletion uses the SDK's redaction permission check. Operations resolve messages from live or detached history and recheck the active session and permissions after asynchronous work. Failures stay beside the affected message or inside the deletion confirmation.

## Drafts

See [the private local draft contract](draft-storage.md) for the account/homeserver scope, schema, limits, storage failure, sequential-tab conflict and logout behavior. Draft bodies and quoted context are plaintext in this browser profile. They are never uploaded as Matrix account data. Room and thread drafts retain mention identities, reply/edit context, inline emoji occurrences and code mode. Cancelling or completing an edit restores the preceding composition. Completing an older send cannot clear a newer composition.

A draft indicator in the buddy list and the Drafts list provide a route back to unfinished room or thread work. Storage failures keep editing usable and visibly distinguish unsaved tab memory from durable saving. Drafts do not sync between devices. Truly simultaneous writes from separate browser processes are not transactional.

## Staged attachments

Choosing or pasting files adds them to a review tray. Files can be removed, reordered and given individual captions before explicitly sending. Image previews require a deliberate click; their temporary object URLs are revoked on removal, completion or account unmount. SVG files are never embedded as previews. Files are processed one at a time, with encryption, upload and event-send phases shown separately. This preserves review order and bounds memory/network pressure.

A failed item can retry without resending successful items. An uploaded file and failed SDK event retain their transaction and encrypted content for retries within the current session. Cancellation is available before the event send starts; an event already being sent cannot truthfully promise cancellation. Cancelled failed local events are removed through the SDK. Session changes revoke outstanding work. Room membership, permissions and encryption are rechecked across asynchronous boundaries, including SDK remembered encryption state.

Captions use the standard Matrix media `body` plus `filename` convention; the original filename remains the download name. File encryption uses the standard encrypted attachment descriptor and encrypted room event, without publishing a plaintext media reference into an encrypted room. Attachment encryption stays lazy. Public runtime upload limits and existing authenticated retrieval remain in force. See [Matrix media captions](https://spec.matrix.org/v1.16/client-server-api/#media-captions).

Only file descriptors are durable: filename, type, size, caption, order and interrupted-send indication. File bytes, browser file handles, attachment encryption keys and preview URLs are not stored in drafts. Reload requires explicit reattachment. An interrupted send asks the user to check the conversation first because acceptance may be unknown. Quota or storage denial is not a promise that descriptors survived reload.

## Validation boundaries

Unit tests cover hostile formatted content, action permissions, account/lifecycle races, structured storage, delayed send cleanup, composition behavior, staged-file ordering/retry/cancellation and encrypted attachment metadata. Browser tests exercise desktop/mobile rendering, accessibility, shared controls, reload/reattach, attachment retry and reduced-height layouts using synthetic content.

The disposable Synapse/Dex harness is the live protocol gate. Its browser devices and direct Matrix API peer are distinct from a third-party Matrix client's UI. Native hardware, platform clipboard providers and broader third-party client rendering still require their separate acceptance checks. Test reports must state which gates actually ran; fixture success alone does not prove those boundaries.
