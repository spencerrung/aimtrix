# Session expiry and connection recovery

[Polish 07 / #147](https://github.com/spencerrung/aimtrix/issues/147) distinguishes authentication rejection from temporary connectivity problems. The Matrix controller inspects the SDK sync event’s error data and its authenticated-request `Session.logged_out` event. A rejected token immediately stops the account client, clears rendered room state and media URLs, and opens the Sign On Assistant. Repeated SDK errors cannot reopen the conversation. Fixed error copy avoids displaying server diagnostics or arbitrary consent URLs.

## Recovery and local data

Expiry replaces the stored credential with a token-free recovery record under the existing platform credential key. The record identifies the account, homeserver, device and soft/hard logout mode. Browser and native adapters use the same strict allowlisted parser. A reload recognizes the record without constructing a Matrix client or retrying the rejected token. Storage write failures receive explicit feedback.

The SDK’s `soft_logout` flag permits requesting the same device ID when signing into the original account. Hard revocation requests a new device. Returned account and homeserver identity must match the recovery record before crypto or sync opens; another SSO account cannot silently replace it. Failed sign-in retains the recovery record. Explicitly forgetting the account is the route to another account.

Crypto databases survive expiry and transient errors. When hard revocation creates a new device, old device database identifiers remain in account metadata so explicit local cleanup can remove them later. Retention does not automatically import the old device’s keys into the new device: recovery-key restoration or another verified device may still be necessary. Recovery and verification remain available in Matrix settings.

Unsent room and thread text is retained only in the current tab’s volatile, account-bound draft store during reauthentication. It is never written to localStorage, Matrix account data or a new plaintext database. Reloading, closing the tab, navigating away for SSO, explicit sign-out/forget or changing accounts clears it. The recovery screen and SSO action explain that navigation boundary. Reply/edit targets, pending SDK sends, selected files and uploads are not a durable outbox. No message is silently resent after reauthentication. Durable drafts and attachment staging remain #153/#154.

Live profile decoration is owned by the signed-in Matrix account and loaded from its private account data. The old global local profile cache is used only by the demo; it no longer seeds a different live account. Generic device appearance preferences remain local.

## Connectivity and cleanup

Ordinary sync failures keep the current SDK client, crypto store, conversation and drafts available. The connection banner offers a retry using the SDK’s reconnect operation. Successful sync clears the warning. Consent failures direct the user to their account page or another client, then retry. Storage failures identify local encryption/credential storage and offer retry after correcting permissions or capacity. Neither flow removes encryption keys automatically.

Shutdown, expiry, retry replacement and explicit account removal share cleanup for listeners, scheduled publications, uploads, calls, in-memory recovery material, room caches and authenticated object URLs. Async startup, downloads and account callbacks check client identity or lifecycle revision before publishing. Explicit forget/sign-out first replaces the stored token with recovery metadata before waiting on remote or local cleanup, then removes current and retained device stores and credentials; blocked or failed database deletion is reported rather than described as successful. Close other Aimtrix tabs if they still hold an account database open.

The sync/history store remains in memory. Rust encryption keys persist in per-account, per-device IndexedDB. Native credential protection does not turn the in-memory timeline or volatile drafts into durable history storage.

## Validation boundaries

Controller tests cover active and restored rejection, token-free restoration, transient sync recovery, consent/storage classification, duplicate and stale events, deferred startup/media work, account matching and cleanup. Component/browser checks exercise the recovery form, destructive confirmation, draft retention, account separation, keyboard controls and desktop/mobile themes.

The disposable Synapse/Dex harness adds real token revocation during an active session and while the app is unloaded, token-free reload, and same-account sign-in on a new device with encrypted exchange. Its peers stay online. Soft logout and unusual startup/storage failures use controlled SDK tests; isolated backup restoration, delegated OIDC/refresh-token rotation, federation, native keychain behavior and physical devices retain their separate acceptance gates. Browser screenshots use synthetic data; live artifacts contain only allowlisted check summaries.
