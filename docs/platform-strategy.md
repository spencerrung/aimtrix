# Aimtrix platform strategy

**Status:** recommendation for the next platform phase  
**Date:** 2026-08-21  
**Scope:** desktop distribution on Linux, macOS, and Windows; mobile distribution on iOS and Android; preservation of the existing web-first Matrix client

## Executive recommendation

Do not rewrite Aimtrix as a native application. Keep the existing React/Vite client and direct-to-Matrix architecture as the product core, make the PWA excellent enough to be the default mobile experience, and add a native desktop shell only where it provides real value.

The recommended order is:

1. **Finish the PWA as the universal baseline.** It already works as an installable desktop/mobile web app and is the lowest-risk way to reach all five requested operating-system families.
2. **Build a Tauri 2 desktop shell** for Linux, macOS, and Windows once the PWA capability work below is complete. Bundle the static assets, keep the native surface small, and use Tauri for keychain, tray/badge, updater, deep links, and other OS integration—not for Matrix protocol logic.
3. **Use a Capacitor mobile shell only if store distribution is a hard requirement.** It is a better fit than React Native or Flutter for this existing web-first codebase. Before committing, run a focused iOS/Android spike for E2EE storage, WebRTC, SSO, push, and media.
4. **Do not make “native” synonymous with “background messaging solved.”** Mobile push requires Matrix pusher/push-gateway work and careful platform integration. Tauri or Capacitor by themselves do not keep a Matrix sync loop alive after iOS or Android suspends the app.

If app stores are not required immediately, stop after step 1 and ship the PWA. It will provide the broadest reach, fastest updates, and least duplicated release machinery. If native desktop is required immediately, start Tauri on desktop while the PWA remains the shared reference implementation.

## What the repository already gives us

Aimtrix is unusually well positioned for this approach:

- The application is a static React/Vite artifact with no Aimtrix backend.
- Matrix protocol ownership is concentrated in `src/matrix/MatrixController.ts`; UI components consume snapshots and actions.
- `matrix-js-sdk` owns sync, Matrix events, VoIP, media, and Rust/WASM-backed E2EE.
- Per-account sync and crypto state already use IndexedDB, with explicit database cleanup on logout/forget.
- The app already has responsive layouts, media-device selection, camera/microphone/screen sharing, SSO, notifications, a manifest, and a service worker.
- Runtime deployment configuration is public and loaded from `config.json`, so a generic packaged client can still allow users to choose their homeserver.

This is a strong shared-core boundary. A native rewrite would throw away working Matrix interoperability and create a second implementation of login, sync, encryption, media, threads, moderation, calls, and settings.

### Important gaps found in the current implementation

These are platform-readiness gaps, not reasons to rewrite:

- The service worker caches the shell and assets but has no `push` event handler, notification click routing, or push subscription registration.
- Current message and incoming-call notifications use `new Notification(...)` from the live page. They work while the JavaScript client is running, but do not provide a reliable closed-app mobile notification path.
- The access token is persisted by `src/matrix/sessionStore.ts` in `localStorage`. That is an acceptable explicit web trade-off to review, but native shells should use OS-protected keychain/keystore storage and a small credential-storage abstraction.
- The manifest has an SVG icon but no platform-specific PNG icon set, `apple-touch-icon`, screenshots, shortcuts, or install guidance. iOS home-screen installation especially needs deliberate onboarding.
- `config.json` is fetched from the web origin. Packaged clients need a clear policy for bundled defaults versus operator/user-selected homeservers; they must not silently depend on a hosted Aimtrix deployment.
- Browser APIs are used directly for media devices, notifications, clipboard, IndexedDB, service workers, and WebRTC. A platform capability layer will make wrapper behavior explicit and testable.

## Option comparison

| Option | Desktop Linux/macOS/Windows | iOS/Android | Reuse of current UI | Main advantage | Main risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| Polished PWA | Strong on Chromium; browser-dependent on macOS/Linux | Strong reach; iOS install is manual and has fewer OS integrations | Excellent | One deployable artifact, no store/signing work | Background push and OS integration vary by platform | **Build first and keep permanently** |
| Tauri 2 | Strong fit; small binaries and native webviews | Technically supported, but requires mobile-specific validation and native plugins | Excellent | Small, Rust-aligned shell with capability allowlists | WebView differences and a newer mobile path; native release/signing still required | **Desktop default; mobile spike only** |
| Electron | Very strong and consistent desktop Chromium behavior | Not a mobile solution | Excellent | Mature desktop APIs, tray/windows/updater ecosystem | Large downloads, high memory use, bundled Chromium security/update burden | Fallback if Tauri webview compatibility blocks us |
| Capacitor | Not its intended role | Strong fit for iOS/Android store packaging and native plugins | Excellent | Web-first mobile runtime with mature mobile distribution model | Two wrapper technologies if paired with Tauri; native push/background work remains | **Mobile store default if needed** |
| React Native / Flutter | Separate desktop story or rewrite | Strong native UX | Poor to partial | Maximum native control and platform conventions | Rebuild UI and bridge Matrix crypto/media/protocol behavior | Do not choose for this product |

### Progressive Web App

The PWA is not a consolation prize. For Aimtrix it is the best universal distribution layer:

- Chrome/Edge can install it as a standalone app on Linux, Windows, and macOS.
- Android can provide a WebAPK or an app-like shortcut depending on browser/device support.
- iOS/iPadOS can add it to the home screen, but users must use the Share menu; iOS does not provide the same install prompt, badges, or shortcuts as Chromium desktop/Android.
- The same URL updates instantly for every platform and preserves the existing self-hosting model.

The PWA should be treated as a first-class client, not as a wrapper prototype. Add platform-aware install instructions, proper icons and screenshots, safe-area/inset handling, offline shell states, update UX, app shortcuts where supported, `display-mode` detection, and a capability matrix that never promises unsupported behavior.

The PWA cannot, by itself, guarantee Matrix message delivery while the app is closed. That is a Matrix push integration problem, not a manifest problem.

### Tauri 2

Tauri is the best desktop wrapper candidate. It can use the existing frontend, produces substantially smaller artifacts by using the operating system webview, and provides a Rust/native boundary for a narrowly scoped set of capabilities. Tauri 2 also exposes Android and iOS build commands, but mobile should not be assumed equivalent to desktop just because the CLI supports both.

Desktop packaging would still require separate validation and signing for:

- Linux: AppImage as the broad distribution format, with optional `.deb` and `.rpm` packages.
- macOS: signed and notarized universal Apple Silicon/Intel builds where practical.
- Windows: signed installer/MSIX or equivalent, with a stable update channel.

The shell should load bundled hashed assets, use a strict capability allowlist, and never load an arbitrary remote website as its privileged application surface. Native APIs should be limited to secure credential storage, notifications/badges, tray/menu integration, updater, deep links, and window management. Matrix requests and E2EE remain in the shared web client unless a measured compatibility issue proves otherwise.

Tauri-specific risks to spike early:

- WebKitGTK on Linux, WebView2 on Windows, and WKWebView on macOS do not have identical browser behavior.
- A bundled Tauri origin must work with arbitrary homeserver CORS policies and Matrix SSO redirects.
- IndexedDB plus Rust/WASM crypto must survive app restart, upgrade, logout, and multiple accounts.
- WebRTC calls, screen sharing, authenticated media, clipboard, and file pickers need real OS testing.
- Tauri updater signing and native keychain behavior must be tested before publishing public builds.

### Electron

Electron is a credible desktop fallback, especially if consistent Chromium behavior matters more than binary size. It gives Aimtrix mature APIs for tray icons, windows, notifications, menus, deep links, and updates, and it would minimize browser-engine variance.

It is not the first choice because Aimtrix is already a static web app and does not need Node.js in the renderer. Electron ships a full Chromium/Node runtime with every build, increasing download size, memory use, update responsibility, and privileged-surface complexity. If Electron is selected, keep `nodeIntegration` disabled, use context isolation and a narrow preload bridge, load only bundled assets, and treat the main process as security-sensitive code.

Electron solves desktop packaging; it does not solve iOS or Android distribution.

### Capacitor

Capacitor is the strongest mobile wrapper option if Aimtrix must appear in the Apple App Store and Google Play while keeping the current web UI. It is designed to be added to an existing modern JavaScript project and provides native iOS/Android plugin boundaries while keeping browser APIs as the default.

Use it as a mobile distribution shell, not as a second Matrix client. Native plugins should cover:

- Keychain (iOS) and Keystore-backed credentials (Android).
- Push registration and notification action/deep-link routing.
- App lifecycle and background/foreground transitions.
- Camera, microphone, audio output, and share/file integration where WebView behavior is insufficient.

Capacitor does not remove App Store/Play signing, review, release, or background-execution constraints. A thin web wrapper also needs a real app experience and clear offline/error behavior; simply pointing a store package at a remote Aimtrix URL is not a reliable product plan.

### Tauri mobile versus Capacitor mobile

Tauri mobile is worth a short spike because it could reduce the number of wrapper technologies. Capacitor remains the safer default for mobile distribution because its primary ecosystem and plugin model are mobile-focused. Choose Tauri mobile only if the spike demonstrates reliable E2EE persistence, SSO, WebRTC, push, and media behavior without creating a custom native bridge that rivals the work of using Capacitor.

## Recommended target architecture

Keep one shared web client and introduce a small platform boundary:

```text
shared Aimtrix web client
  ├─ MatrixController + matrix-js-sdk + Rust/WASM crypto
  ├─ React UI + responsive PWA
  └─ platform capability interfaces
       ├─ browser adapter (PWA)
       ├─ Tauri desktop adapter
       └─ Capacitor mobile adapter, only when store distribution is approved
```

The first interfaces should be deliberately small:

- `CredentialStore`: browser persistence versus native keychain/keystore.
- `NotificationService`: foreground notifications, service-worker notifications, and native push/actions.
- `AppLifecycle`: visible/hidden, active/background, and shutdown cleanup.
- `InstallAndUpdate`: PWA update prompt versus native updater/store release.
- `DeepLinkService`: SSO callback and notification-to-room navigation.
- `DeviceMedia`: media permission, device selection, output routing, and screen capture capabilities.

The platform layer should report capabilities rather than expose a wrapper name. UI controls can then remain truthful across browser, Tauri, and Capacitor builds.

### Authentication and encryption rules

Every installed client must have its own Matrix device identity and account-scoped crypto database. Do not copy a browser token or crypto database into a native package. Refactor session persistence behind `CredentialStore`, preserve the existing explicit logout/forget cleanup, and test recovery/verification after an app upgrade.

The native keychain protects credentials at rest; it does not replace Matrix E2EE, cross-signing, secret storage, or recovery-key flows. Recovery material should remain in memory except when the user explicitly exports or restores it, as it does today.

### Background messaging rules

For a reliable mobile product, design push before designing the mobile shell:

1. Register a Matrix pusher/device endpoint through the supported Matrix APIs.
2. Use a push gateway/provider that can deliver APNs and FCM notifications without putting room content or access tokens in unsafe third-party payloads.
3. Route a notification tap to the correct room and refresh sync when the app resumes.
4. Test encrypted rooms, muted rooms, mentions, notification privacy, logout, device removal, and multiple accounts.

Do not run a permanent Matrix `/sync` loop in the background and call that mobile support. iOS and Android are allowed to suspend or terminate it. One-to-one calls also need an incoming-call strategy; a native notification alone is not a call transport.

## Delivery plan

### Phase 1: PWA product gate

- Add real PNG icon sizes, `apple-touch-icon`, screenshots, shortcuts, and install help.
- Add safe-area and keyboard/inset QA on current iOS and Android devices.
- Replace foreground-only notification assumptions with a service-worker/pusher design.
- Verify IndexedDB crypto persistence and recovery across browser restarts, private-mode failure, update activation, and storage eviction.
- Test Chromium desktop install on Linux/Windows/macOS, Safari iOS home-screen install, and Android Chrome install.
- Keep the existing hosted PWA as the reference build for every future shell.

### Phase 2: Tauri desktop spike and release

Build a disposable vertical slice before a full wrapper:

- login and SSO callback;
- encrypted sync/restart/logout;
- attachment upload/download;
- microphone/camera and one-to-one call;
- desktop notification, tray, deep link, and updater;
- generic runtime config and arbitrary homeserver CORS.

Only after that passes should the repository gain `src-tauri/`, packaging workflows, signing secrets, and release documentation. Publish Linux/macOS/Windows artifacts from signed CI builds; do not make the desktop shell the only way to use Aimtrix.

### Phase 3: mobile store decision

If the PWA meets the audience need, defer stores. If store discovery, native push, or platform policy makes stores necessary, add a mobile wrapper and run the same vertical slice on physical iOS and Android devices. Capacitor is the default mobile candidate; Tauri mobile is an alternative only if its spike is clearly lower-risk.

Mobile release readiness includes app identifiers, privacy disclosures, permission explanations, APNs/FCM credentials, push gateway operation, TestFlight/internal-track testing, crash diagnostics that do not capture Matrix content, and a documented recovery path for app reinstall/device loss.

## Decision gates

Add Tauri desktop when at least one of these is a demonstrated user need: reliable tray/unread badge, native keychain, global shortcuts, independent conversation windows, or a signed desktop download that users explicitly prefer over PWA installation.

Add a mobile store wrapper only when one of these is true: PWA installation is not reaching the intended audience, native push reliability is required, or store discovery is a product requirement. Do not add it solely because a native-looking icon feels more complete.

Do not choose React Native or Flutter unless the product deliberately accepts a second UI and Matrix implementation. That would be a new product program, not a packaging task.

## Sources

Primary framework and platform references checked for this analysis:

- [Tauri: What is Tauri?](https://v2.tauri.app/start/) — shared frontend, native webview architecture, desktop/mobile scope.
- [Tauri: Develop](https://v2.tauri.app/develop/) — desktop/mobile development and native IDE/device requirements.
- [Tauri CLI reference](https://v2.tauri.app/reference/cli/) — desktop, Android, and iOS build/bundle commands.
- [Electron: Process model](https://www.electronjs.org/docs/latest/tutorial/process-model) — main/renderer/preload security boundary and native API model.
- [Capacitor documentation](https://capacitorjs.com/docs) — existing web project integration and iOS/Android native runtime/plugin model.
- [web.dev: PWA installation](https://web.dev/learn/pwa/installation) — desktop, iOS, Android, and store-install behavior.
- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/) — browser CORS requirements, pushers, sync, authentication, and E2EE endpoints.

This document is an architecture recommendation, not a claim that live Synapse, APNs, FCM, WebRTC, or app-store interoperability has been exercised. Those are explicit gates in the plan above.
