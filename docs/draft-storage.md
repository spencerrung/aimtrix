# Private local draft contract

Structured drafts belong to one exact Matrix user ID and normalized homeserver base URL, including any base path. Room and thread slots include their room ID; a thread root alone never identifies a slot. This is device-local browser storage. Draft bodies, quoted messages, mention identities, filenames and emoji metadata are private content, stored as plaintext in the browser profile. Matrix room encryption does not encrypt browser draft storage. Nothing in this format is uploaded as Matrix account data, sent to analytics, or included in logs.

The UI must explain local saving and any failure to save. A successful write with `status.mode === 'volatile'` means the current tab still retains the edit; reload, closing the tab or SSO navigation can lose unsaved changes. A corrupt or unsupported record remains untouched while the current tab uses memory. Never claim those new changes are durable. Browser/profile clearing also removes durable drafts.

## Data and ownership

`StructuredDraftStore.open({ userId, homeserver })` returns a `DraftSession`. The session exposes cloned records through `read(context)` and `list()`. Each record contains a body, selected mention identities, exact inline emoji occurrences, code mode/language, optional reply context, optional edit target and original composition, and staged attachment descriptors. The original composition includes its reply and staged descriptors so cancelling an edit can restore the complete prior state; it cannot recursively contain another edit.

Attachment descriptors contain a generated staging ID, filename, MIME type, size, last-modified time, optional code language and caption, and an interrupted-send flag. File/Blob objects, encrypted file keys, upload bytes, object URLs and preview data URLs are not serialized. On hydration every descriptor requires explicit reattachment; do not imply that an attachment will send automatically. An interrupted send must ask the user to check the conversation before reattaching because server acceptance may be unknown. Inline emoji sources permit original public HTTP(S), MXC or origin-relative assets; blob/data/credential-bearing sources and invalid/overlapping occurrence offsets are rejected. Unknown object properties are discarded during serialization.

Limits are 64 drafts per account, 1 MiB of UTF-8 JSON per account, 65,536 UTF-16 code units per text/quote, 100 mentions, 200 emoji occurrences and 20 staged attachments per composition. Exhaustion refuses the new write instead of silently evicting another unsent draft. No content index is maintained.

## Revision and lifecycle integration

Every write and remove requires the revision last read from that slot (`undefined` for a new slot). After a send succeeds, remove only the submitted revision. A later edit must survive a delayed send completion. A conflict result includes the current record where available; preserve unsaved UI input and offer a truthful retry/recovery path instead of blindly overwriting the other revision.

The store reads current persisted revisions before mutation and publishes storage-event changes through `subscribe` / `getVersion`. This detects sequential cross-tab conflicts and deletion. LocalStorage has no transaction primitive: truly simultaneous writes in separate browser processes cannot be guaranteed atomic. The UI must not promise collaborative cross-tab editing. Account epochs prevent an already-open tab from recreating a draft account after observing logout deletion or a replaced account record.

`suspend()` revokes callbacks held by an unmounted authentication boundary while retaining current memory for same-account reauthentication. Reopening the same account restores that memory, including quota/denied-storage fallbacks. Opening a different account revokes old handles and loads only that account's data. `session.isActive()` distinguishes a revoked owner from usable volatile fallback; discard editor overrides when it becomes false. Do not hydrate a real account's drafts into demo mode.

On explicit sign-out or confirmed forget, call `clear()` before the asynchronous Matrix operation. It revokes handles and clears memory immediately, then removes the active account key. `clear(scope)` can delete recovery-account drafts without first hydrating them; a late cleanup for an older account does not revoke a newer active account. A false `cleared` result means the browser denied deletion; show that local data could not be removed and that clearing site data is needed. Never claim deletion succeeded. A subsequent signed-out transition must not erase this failure notice. Token expiry/recoverable authentication is suspension, not explicit deletion.

The storage getter is lazy and guarded. Quota errors retain edits in memory; a later successful write can persist them. If another tab changes the disk record while this tab has unsaved changes, the store reports a conflict without discarding memory. A denied getter/read/write never prevents the login/recovery UI from rendering.

## Schema and later private search (#158)

The key prefix is `aimtrix.private-drafts.v1:` followed by an encoded canonical scope. Version 1 stores the scope, an account epoch and bounded draft records. The supported version-zero migration accepts only explicitly scoped `{ context, body }` records; it never guesses a thread's room from old text-only maps. Existing `VolatileDrafts` never wrote a persistent format, so it has no disk data to migrate. Newer unknown versions are not overwritten.

Private search must reuse the normalized account/homeserver identity and the explicit logout/forget deletion boundary, but own a separate versioned store and independently reviewed encryption, backfill, quotas and cleanup. Drafts are not search history and must not be indexed implicitly. This change neither adds a search index nor promises encrypted at-rest browser storage.
