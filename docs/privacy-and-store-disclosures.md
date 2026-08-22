# Privacy and store disclosures

This document is the source of truth for the hosted PWA, Tauri desktop client, and Capacitor mobile client. Store forms and public privacy text must match the behavior below. If a release adds a provider, permission, telemetry path, or retention behavior, update this document before submission.

## Data boundaries

| Data | Where it goes | Retention / control |
| --- | --- | --- |
| Matrix account credentials and access tokens | The configured Matrix homeserver; local browser IndexedDB, desktop OS keyring, or mobile Keychain/Keystore | Logout clears the active credential and pusher where the homeserver permits it. **Forget session** is the explicit local-storage deletion path. Aimtrix does not send credentials to an Aimtrix backend. |
| Room events, encrypted payloads, and profile data | The configured Matrix homeserver and its configured media repository | Homeserver/operator retention rules apply. Aimtrix does not copy room content to analytics, crash reporting, or an Aimtrix database. |
| Encrypted attachment bytes | Matrix media repository after client-side encryption in encrypted rooms | Local decrypted object URLs and temporary files are revoked/removed after use where the platform permits it. |
| Push registration | The configured Matrix push gateway through the standard pusher API | The homeserver retains pusher state. The gateway/provider receives only the documented event-id-only routing contract; it must not receive message previews, access tokens, or recovery material. |
| Optional sticker/GIF/emoji assets | The configured same-origin or HTTPS asset host, only when a user opens or uses the picker | Provider/operator retention and privacy policy applies. No provider secret is shipped in browser configuration. |
| Desktop updater | GitHub Releases over HTTPS, only after the user selects **Check for updates** or a release UI invokes the adapter | Release metadata and signed installer assets are public. The updater does not send room content or account credentials. |
| Diagnostics | Local UI error state and operator-supplied, manually redacted evidence | No automatic crash reporter or behavioral analytics is enabled. Support evidence is opt-in and must be redacted before sharing. |

Aimtrix has no product analytics, advertising identifiers, behavioral tracking, room-content telemetry, or default third-party crash SDK. The hosted app is static and runtime settings are public configuration, not a secret store.

## Diagnostics contract

Diagnostics must help identify a failure without becoming a second data channel:

- Show a stable category and actionable next step, not raw SDK/network payloads.
- Categorize failures as `configuration`, `authentication`, `sync`, `encryption`, `media`, `call`, `notification`, `storage`, or `platform`.
- Never log or include access tokens, Matrix passwords, recovery keys, key-backup secrets, room bodies, sender/profile previews, ciphertext, pushkeys, provider credentials, or full URLs containing login tokens.
- Room IDs and event IDs are private routing data. Keep them out of automatically uploaded diagnostics; if an operator needs one for reproduction, record it separately in a redacted incident system.
- Error evidence may include app commit, client/platform version, browser/WebView/OS version, capability flags, HTTP status, Matrix `errcode`, and a redacted stack trace.
- A support bundle is created only by an operator or tester, reviewed locally, and deleted after the incident retention period. It is never silently uploaded by the client.

The correct privacy behavior for an unknown failure is a generic user-facing message plus a local retry/forget path. Do not “improve” diagnostics by serializing the Matrix controller, event objects, request headers, or local storage.

## Permission rationale

Permissions are requested at the action that needs them and can be denied without making encrypted messaging unusable:

| Permission | User-facing purpose | Never used for |
| --- | --- | --- |
| Notifications / push | Notify about Matrix activity after the user enables notifications | Uploading room content or reading notification history for analytics |
| Camera | Start a video call or capture media when the user selects that flow | Background capture or profile inference |
| Microphone | Start or answer an audio/video call | Background recording |
| Photos/files | Choose an attachment or export a user-selected file | Scanning the device or uploading unselected files |
| Clipboard | An explicit copy/paste action | Background collection |

Denial, revocation, and retry behavior must be tested on browser, desktop, and physical mobile targets. A permission grant must not be described as a grant to Matrix credentials or room access.

## Store and public metadata

| Client | Data-safety statement | Account / deletion statement | Third-party disclosure |
| --- | --- | --- | --- |
| Hosted PWA | Aimtrix sends Matrix data to the homeserver selected by the user; no Aimtrix analytics or ad tracking | Users sign out or forget local session data in Aimtrix; homeserver account/data deletion remains a homeserver operation | Matrix homeserver, configured media repository, optional push gateway, and user-selected asset providers |
| Tauri desktop | Same Matrix data boundary; OS keyring protects local credentials; signed updater contacts GitHub Releases only when invoked | Sign out/forget-session clears Aimtrix credentials according to the desktop runbook; uninstall is an OS action and does not replace forget-session | Matrix homeserver/media, configured push gateway, GitHub Releases updater, optional asset providers |
| Capacitor mobile | Same Matrix data boundary; Keychain/Keystore protects native credentials; push uses the configured Matrix gateway/provider | Sign out/forget-session removes local credentials and pusher state; uninstall and OS backup behavior must be stated per store | Matrix homeserver/media, configured push gateway, APNs/FCM or Web Push provider, optional asset providers |

Before submission, the release operator must compare the completed store form against this table, the relevant platform permission manifests, and the actual built artifact. Do not claim “no data collected” when Matrix sync, media, or push is enabled; distinguish collection by the configured homeserver/provider from Aimtrix-controlled analytics.

## Review triggers

Re-review this document and store metadata before release if any of these change:

- homeserver discovery, login/SSO, secure storage, E2EE, recovery, media, calls, or logout;
- push gateway payloads, provider credentials, notification copy, or tap routing;
- a crash reporter, analytics SDK, GIF/sticker provider, updater endpoint, or new native permission;
- local storage, cache, retention, export, account deletion, or device recovery behavior;
- the app identifier, bundle permissions, privacy manifest, Android data-safety form, Apple privacy answers, or desktop updater channel.
