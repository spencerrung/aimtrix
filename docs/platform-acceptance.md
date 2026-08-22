# PWA and cross-platform acceptance matrix

Status: 0.x release-gate checklist

This is the repeatable acceptance plan for the hosted Aimtrix PWA before a native shell is justified. Automated browser coverage proves browser-detectable behavior; it does not prove APNs/FCM/Web Push delivery, E2EE interoperability with a live homeserver, or OS-level install behavior. Those require the manual checks below.

## Ownership and evidence

| Owner | Responsibility | Required evidence |
| --- | --- | --- |
| CI | Run lint, unit tests, production build, Chromium desktop/mobile tests, accessibility checks, and push privacy proofs | GitHub Actions run URL and failing test artifact |
| Aimtrix maintainer | Triage client behavior, update the matrix, and rerun after relevant code or dependency changes | PR link, test output, screenshot/trace for visual failures |
| Release operator | Run the live Matrix, homeserver, gateway, and provider checks with disposable accounts | Date, app/browser/OS versions, homeserver/gateway build, redacted logs |
| Device tester | Run hardware-only install, safe-area, keyboard, media, restart, and notification checks | Device model, OS version, browser version, screen recording or checklist notes |

## Browser and device matrix

The minimum targets are intentionally conservative. “Supported” means the hosted client remains usable with the stated fallback; it does not mean every optional capability exists on every platform.

| Platform | Minimum target | Install and launch | Push / notification behavior | Media, layout, and persistence | Evidence |
| --- | --- | --- | --- | --- | --- |
| Linux Chromium | Chromium 120+ | Browser install prompt; standalone launch; restart retains local session and preferences | Foreground notifications in CI; live Web Push only with configured gateway/VAPID deployment | Camera/mic permission, keyboard navigation, reduced motion, offline banner, restart persistence | CI desktop project + manual smoke |
| Windows Chrome / Edge | Chrome or Edge 120+ | Install prompt and standalone window in each browser; verify taskbar launch | Foreground behavior in CI; run provider delivery manually | Camera/mic, focus-visible controls, keyboard shortcuts, offline/reconnect, restart | CI desktop project + Windows manual run |
| macOS Chromium | Chrome 120+ | Install prompt and standalone window | Foreground behavior in CI; run provider delivery manually | Media permissions, keyboard, restart, safe-area regression check | CI desktop project + macOS manual run |
| macOS Safari | Safari 17+ | Browser mode is supported; no Chromium install prompt; use Share → Add to Dock/Home Screen fallback where available | Browser-mode notifications are not treated as closed-app delivery; installed-web-app push must be tested separately | Media permission, keyboard, storage restart, backdrop/contrast, offline banner | Manual Safari checklist |
| Android Chrome | Chrome 120+ / current WebAPK | Install prompt; verify WebAPK or shortcut fallback; launch from icon after browser exit | Web Push requires permission, a configured gateway, and an installed supported target; no gateway means visible foreground-only state | Safe-area insets, virtual keyboard/composer reachability, media permission, restart/session persistence | CI mobile project + Android device checklist |
| iOS / iPadOS Safari | iOS/iPadOS 17+ | Manual Share → Add to Home Screen; verify standalone launch and storage | Web Push is only a release claim for an installed Home Screen web app on supported OS versions, after provider proof; browser tabs are not closed-app delivery | Safe areas, keyboard/composer, camera/mic, restart/session persistence, reduced motion | Manual iOS/iPadOS checklist |

## Automated CI coverage

Run these from the repository root:

```bash
npm run check
npm run proof:push
npm run proof:push-sw
PLAYWRIGHT_PREVIEW=1 npm run test:e2e
```

The Playwright production-preview run covers both desktop Chromium and Pixel 7 mobile emulation. The current suite covers navigation, responsive panels, messaging/local echo/editing, threads, emoji/stickers, search, profile/settings, media viewers, backdrops, focus behavior, and Axe WCAG A/AA checks. The PWA-specific suite additionally covers the browser install event fallback, explicit offline/reconnect messaging, and the update prompt's draft/encryption warning.

The two push proofs have deliberately different boundaries:

- `proof:push` checks that an `event_id_only` gateway request contains no message content or access token.
- `proof:push-sw` runs the service worker push/click handlers in isolation and checks that notification copy is generic and click data contains only opaque route identifiers.

CI runs the browser suite against the built production preview so the real service worker is registered. Local `npm run test:e2e` remains convenient for fast development and uses the Vite dev server.

## Manual device checklist

Record the date, device, OS build, browser build, homeserver, and Aimtrix commit for every run. Use disposable Matrix accounts and rooms; never paste access tokens, recovery keys, private room content, or provider credentials into evidence.

### Install and lifecycle

- [ ] Browser mode loads the shell and runtime configuration without console errors.
- [ ] Install prompt appears only when the browser exposes the install event.
- [ ] Safari/iOS shows the manual Share → Add to Home Screen instructions instead of claiming automatic install.
- [ ] Installed/standalone launch has no browser-only navigation dependency.
- [ ] Refreshing with a waiting service worker shows the update prompt; a draft warning is visible; **Later** does not reload; **Reload** activates the worker and preserves encrypted account storage.
- [ ] Closing and reopening the installed target preserves the intended local session/preferences, or shows a truthful signed-out/storage failure state.

### Matrix and encryption

- [ ] Password login and SSO callback login both complete against the disposable homeserver.
- [ ] Expired access token returns to a recoverable signed-out state without displaying private event content.
- [ ] Encrypted room messages remain encrypted end to end; no plaintext fallback appears when crypto is unavailable.
- [ ] Recovery setup/export and restore work on a second device or fresh browser profile using a disposable account.
- [ ] Attachment upload/download/decryption works in an encrypted room and does not expose keys in logs.
- [ ] One-to-one voice/video call start, answer, reject, mute, camera, speaker, screen share, and reconnect behavior are checked with TURN available.

### Notifications and push

- [ ] Foreground message/call notification preferences follow Matrix push rules and room mute state.
- [ ] Without gateway/VAPID configuration, the UI says foreground-only rather than implying closed-app delivery.
- [ ] With a configured gateway, browser permission denial, subscription failure, expired session, and logout are recoverable.
- [ ] A live `event_id_only` notification contains no message body, access token, recovery material, or ciphertext at the gateway/provider boundary.
- [ ] A suspended installed target receives a generic notification, collapses queued room events where supported, and opens the correct room after tapping.
- [ ] A provider token rotation is re-registered after app resume; disabling notifications and logout remove the pusher/subscription.

### Responsive and accessibility behavior

- [ ] Desktop and mobile layouts keep the active room, composer, thread controls, and dialogs reachable at the tested viewport sizes.
- [ ] iOS/iPadOS safe-area insets do not cover the composer, install prompt, or update prompt.
- [ ] Virtual keyboards do not hide the composer or trap focus after sending.
- [ ] Keyboard-only navigation has visible focus; Escape closes transient dialogs; reduced-motion mode suppresses decorative animation.
- [ ] Camera/microphone permissions can be granted, denied, and retried without a misleading success state.
- [ ] Offline and reconnect banners identify that Matrix history may be unavailable until sync resumes.

## Failure ownership

| Symptom | First owner | Distinguishing evidence |
| --- | --- | --- |
| Wrong room, stale route, or plaintext shown by Aimtrix | Aimtrix | Service-worker proof, browser console, route payload, client logs with content removed |
| Install prompt or standalone window differs by browser | Browser/OS | Browser version, display mode, manifest installability report, screen recording |
| Camera/mic or keyboard/safe-area failure | Browser/OS or Aimtrix | Device/viewport, permission state, reduced-motion setting, screenshot/video |
| No pusher registration or expired-session behavior | Aimtrix or homeserver | Redacted `pushers` response, client status, homeserver status/error code |
| Homeserver does not call the gateway after push rules allow | Homeserver | Redacted push-gateway request/status and push-rule evaluation |
| Gateway rejects token or provider never wakes device | Push provider/gateway | Gateway delivery/rejection code, provider project/app ID, device state |
| E2EE recovery, decryption, or call interoperability failure | Homeserver/MatrixRTC/provider boundary | Disposable account IDs, SDK/browser versions, redacted protocol error and reproduction steps |

## Re-test triggers

Re-run the relevant automated and manual rows when any of these change:

- Chromium, Safari, iOS/iPadOS, Android, or Windows/macOS major versions;
- matrix-js-sdk, Rust crypto/WASM, Vite, or service-worker cache/update logic;
- authentication, credential storage, notification, media, safe-area, or composer code;
- homeserver, push gateway, VAPID/APNs/FCM application, TURN, or LiveKit configuration;
- the hosted origin, manifest, CSP, runtime configuration, or deployed image.

The matrix is not a claim that live native/provider interoperability is complete. That release gate remains blocked until the disposable live delivery and multi-device E2EE checks have dated evidence.
