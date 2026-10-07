# Matrix media lifetime and acceptance

Matrix media now has an **unused cache budget of zero bytes and zero entries**. Each `resolveMedia` call owns a releasable promise. Calls with the same source, size/original mode, MIME type and encryption metadata share the download and Blob URL. The URL stays valid while at least one owner remains. The final release removes the request, revokes its URL and aborts unfinished authenticated retrieval. Reopening released media fetches it again. Failed requests remain retryable.

`useMediaSource` and `useMediaSourceState` own this lifetime for React consumers. Source changes, old timeline-message eviction, leaving a room, hiding a revealed spoiler, and closing or navigating an image viewer release the corresponding owner. Equivalent immutable encryption metadata preserves the existing owner rather than revoking the still-rendered URL. A viewer closing cannot revoke a URL that another mounted consumer still uses. Account teardown clears all entries and aborts pending work; late responses and decryption completions cannot create a replacement URL for the old account.

Direct controller callers must keep the **original returned promise** and call its `release()` when their media consumer finishes, including cancellation before resolution. An `async` wrapper or `.then()` produces a different promise without that method. React surfaces should use the hooks. Plain promises remain supported for non-owning demo/fixture resolvers; the Matrix controller always supplies `release()`.

The policy bounds retention from past navigation, not the total working set of mounted media. Active images, audio/video, avatars, and viewer originals remain pinned; forcibly evicting them would break rendering, playback or downloads. Active bytes depend on the distinct mounted sources and the configured per-file limit. Fetch/decrypt buffers and browser-decoded image/audio/video memory are transient or browser-managed and are outside the live-Blob-URL budget. Decryption already running in WebCrypto cannot be interrupted; its abandoned result is discarded before a Blob URL is created. Data saver, authenticated MXC retrieval, original-only SVG/audio/video retrieval, attachment integrity verification, lazy attachment crypto and encrypted-room sending remain unchanged. No media or credentials are persisted by this cache.

## Automated evidence for #271

The controller/hook regression mounts forty distinct synthetic 1 MiB audio attachments in one uninterrupted session. Before the fix, all forty URLs survived unmount: **40 MiB retained, zero revocations**. After the fix, the workload peaks at **1 MiB**, releases each obsolete resource and ends at **zero URLs/bytes and zero resolver entries**. Additional tests cover simultaneous and pending consumers, release/reacquisition, retry after failure, Strict Mode and pre-microtask cleanup, account teardown, exact real-library encryption/decryption, abandonment during async decryption, viewer-original release and equivalent snapshot metadata.

The Chromium browser fixture uses the real controller and production React workspace against synthetic authenticated media responses. Desktop and Pixel 7 emulation page through forty history windows, each with a valid 1 MiB SVG and a playable 1 MiB WAV, open/close every original viewer, and change to an empty room and back. Its enforced budget is **3 MiB peak live Blob URLs**, **2 MiB with the viewer closed**, and **zero URLs/bytes after leaving the final room**. It requires all 122 URLs to be revoked and all 122 downloads to carry the synthetic authorization header. It verifies image decoding/audio metadata, playback remaining active across viewer closure, Axe, reachable composition at short desktop/mobile viewports, and captures viewer, details, short-keyboard and final-room screenshots. Counters exist only in the test fixture; no production diagnostic exposes media or tokens.

These measurements count live object URLs and their backing Blob sizes, not physical renderer RSS or an OS crash threshold. The fixture does not run a live homeserver, cross-device exchange, installed PWA, service-worker suspension or native playback. Those boundaries are independent of the unit decryption proof.

## Physical low-memory phone acceptance record

| Field | Record |
| --- | --- |
| Date / issue | October 7, 2026 / #271 |
| Device, RAM, OS, browser/PWA version | Unavailable in the worker environment |
| Execution / result | **Not run**; Chromium Pixel 7 emulation does not establish physical phone acceptance |
| Remaining check | Repeat the workload below on a physical low-memory phone in browser and installed PWA modes |

Use a disposable Matrix account and synthetic media only. Record the exact phone model/RAM, OS, browser/PWA version, application revision, configured per-file limit and whether the session was installed or in-browser. Browse at least forty distinct 1 MiB attachments across rooms and old history, open and close full-size images, and explicitly play audio/video. Return to an empty room without signing out; verify obsolete requests/URLs are gone using temporary local instrumentation and record OS/browser memory observations separately. Repeat a foreground/background cycle and then return to earlier media to verify fresh retrieval, encryption, playback and download. Record any OS kill/reload, stale image, broken playback, error, navigation latency and final cleanup; remove instrumentation and disposable account data afterwards. This pending record must not be represented as a passed physical-device gate.
