# Mobile wrapper evaluation

Status: **Capacitor is the selected mobile shell foundation; physical-device validation and store distribution remain deferred.**

The follow-up implementation adds reproducible Capacitor Android and iOS projects plus shared native platform adapters. The current PWA remains the supported mobile client until a physical-device pass proves that the wrapper is ready for internal distribution and justifies native release and plugin maintenance. See [the mobile release runbook](mobile-release.md) for signing and store boundaries.

## Spike evidence

Run date: 2026-08-22

Host:

- CachyOS Linux rolling, x86_64, Hyprland/Wayland
- Node 22.23.2, npm 12.0.2
- OpenJDK 26.0.2
- No Android SDK/NDK, `adb`, emulator, Xcode, `xcrun`, CocoaPods, or physical devices

The temporary spike did not touch this repository's dependencies or add native files. It used the existing production `dist/` in `/tmp/aimtrix-mobile-spike`.

| Check | Result | Evidence / blocker |
| --- | --- | --- |
| Current Vite production build | **Pass** | `npm run build`; bundle budgets passed |
| Capacitor scaffold | **Pass** | Capacitor CLI 8.5.0 initialized `dev.alucard.aimtrix` with `webDir: "../dist"` |
| Capacitor Android project | **Pass, scaffold only** | `cap add android` copied the full bundle and generated a Gradle project |
| Capacitor iOS project | **Pass, scaffold only** | `cap add ios` generated an Xcode project and Swift Package Manager package on Linux |
| Capacitor Android build | **Blocked** | The generated Gradle 8.14.3 wrapper cannot load the host's Java 26 bytecode (`Unsupported class file major version 70`); Android SDK/NDK is also absent |
| Capacitor iOS build/signing | **Blocked** | Xcode tooling is unavailable on Linux |
| Android physical device | **Not exercised** | No `adb`, emulator, or device is available |
| iOS physical device | **Not exercised** | No macOS/Xcode/device is available |
| Tauri mobile scaffold | **Partial** | Tauri CLI 2.11.4 desktop scaffolded the same bundled assets; `tauri android init` stopped at missing Android SDK/NDK |
| Tauri iOS workflow | **Unavailable here** | Tauri documents iOS commands as macOS-only; the Linux CLI did not expose `ios` |

The Android build failure is an environment/toolchain finding, not an Aimtrix source failure. The native project was generated successfully before Gradle reached the host JDK. The next device pass needs a supported JDK, Android SDK/NDK, emulator or USB device, and a macOS runner/device for iOS.

## Decision

### Capacitor implementation status

Capacitor is the better fit for Aimtrix's web-first client:

- The existing Vite output plugs directly into `webDir`; no second UI or Matrix implementation is required.
- It generates conventional Android and iOS projects that can be inspected, signed, and integrated with standard store tooling.
- Official plugins cover app lifecycle/deep links, push notifications, local notifications, filesystem, and sharing.
- The native bridge is TypeScript-facing, so the existing `AimtrixPlatform` boundary can keep Matrix protocol code in `src/matrix/` and select native services by capability.

### Defer Tauri mobile

Tauri mobile remains viable, but the spike found no evidence that it reduces Aimtrix's current complexity:

- Android needs the same Android SDK/NDK/device setup plus a Rust mobile build.
- iOS requires a macOS/Xcode environment, and the Linux CLI cannot even initialize the iOS target here.
- Secure storage, push, lifecycle, and deep-link adapters now exist in the checked-in shell; media and store behavior still require native plugins or configuration plus physical-device validation.
- The desktop Tauri spike already found an additional Linux WebKitGTK build dependency; that does not disqualify mobile, but it makes a single Tauri choice less operationally simple.

This selects Capacitor as the implementation path without claiming store readiness. Native project sources are now checked in so the device owner can build the same commit; no production signing material or store submission is included.

## Native capability inventory

| Need | Capacitor path | Security / maintenance boundary |
| --- | --- | --- |
| Lifecycle, cold start, app URL, universal/app links | [`@capacitor/app`](https://capacitorjs.com/docs/apis/app) | Accept only opaque route identifiers; never route access tokens or room content through URLs |
| APNs/FCM push registration and tap handling | [`@capacitor/push-notifications`](https://capacitorjs.com/docs/apis/push-notifications) | Keep the existing event-id-only privacy contract; device tokens are credentials and must not enter logs or notification payloads |
| Local call/update notifications | [`@capacitor/local-notifications`](https://capacitorjs.com/docs/apis/local-notifications) | Generic copy only; follow room mute, notification, logout, and permission state |
| Files and share sheet | [`@capacitor/filesystem`](https://capacitorjs.com/docs/apis/filesystem), [`@capacitor/share`](https://capacitorjs.com/docs/apis/share) | Scope temporary files, revoke object URLs, and never persist decrypted attachment bytes longer than needed |
| Matrix session credentials | [`@aparajita/capacitor-secure-storage`](https://github.com/aparajita/capacitor-secure-storage) candidate | Community plugin using iOS Keychain / Android Keystore; its web implementation is plaintext and must never replace the browser store. iOS keychain data can survive app deletion, so forget-session must explicitly clear it |
| Camera/microphone/WebRTC | Web `MediaDevices` plus native permission declarations first | Validate WKWebView/Android WebView permission prompts, audio routing, screen capture, and call resume on real devices before adding a plugin |
| Native photo capture, if required later | [`@capacitor/camera`](https://capacitorjs.com/docs/apis/camera) | Add only for a proven native capture flow; encrypted Matrix attachment handling stays in the shared client |

`@capacitor/preferences` is not an acceptable credential store. Browser `localStorage` and any plugin's web fallback are not acceptable places for Matrix access tokens or recovery material.

## Critical path still required

The following remains untested and must pass on at least one current iOS device and one current Android device before a mobile wrapper is adopted:

1. Password login, SSO callback, session restore, logout, forget-session, expired-token cleanup, and app cold start.
2. IndexedDB Rust/WASM E2EE initialization across suspend/resume, force-close, restart, update, and storage failure.
3. Encrypted attachment upload/download/decryption, temporary-file cleanup, camera/microphone permission denial and retry, audio output, and one-to-one WebRTC.
4. APNs/FCM registration, generic event-id-only notification delivery, notification tap routing, room mute/privacy rules, token rotation, logout removal, and provider failure recovery.
5. Keyboard/composer reachability, safe-area insets, dialogs, file/share flows, offline/reconnect, background resume, and reduced motion.
6. Custom homeserver discovery plus representative Synapse/Dendrite CORS and SSO behavior from both native WebView origins.
7. Debug and release builds, app signing, version/build-number upgrades, crash diagnostics with no private data, and store metadata/permission rationale.

Use disposable Matrix accounts and rooms. Record device model, OS build, browser/WebView version, homeserver, app commit, and redacted failures. Never put access tokens, recovery keys, room content, or push-provider credentials in evidence.

## Why the PWA remains first

The PWA already has responsive Chromium coverage, iOS safe-area behavior, browser push privacy proofs, E2EE persistence, and truthful unsupported states. The current evidence does not show a mobile wrapper fixing a production problem; it shows that Capacitor can package the existing web artifact and that native validation still needs hardware and platform toolchains.

Capacitor is selected for the wrapper. Keep the PWA as the supported mobile client until the critical path above is scheduled and passes on physical devices.

## References

- [Capacitor documentation](https://capacitorjs.com/docs)
- [Capacitor push notifications](https://capacitorjs.com/docs/apis/push-notifications)
- [Capacitor deep links](https://capacitorjs.com/docs/guides/deep-links)
- [Tauri mobile CLI](https://v2.tauri.app/reference/cli/)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/)
