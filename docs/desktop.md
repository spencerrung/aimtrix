# Desktop wrapper evaluation

Status: Tauri 2 feasibility spike complete; **do not add a native project yet**.

Aimtrix remains a web/PWA project for the 0.x line. The spike proves that the current Vite output can be pointed at Tauri's bundled-asset model, but it does not pass the Linux native build on this host and has no Windows or macOS evidence. That is enough to reject a premature `src-tauri/` addition, not enough to claim Tauri interoperability.

## Spike evidence

Run date: 2026-08-22

Host:

- CachyOS Linux rolling, x86_64, Hyprland/Wayland
- Node 22.23.2, npm 12.0.2
- Rust 1.96.1, Cargo 1.96.1, stable toolchain
- Tauri CLI 2.11.4 (`tauri` crate 2.11.3 in the generated scaffold)
- `webkit2gtk-4.1` and `javascriptcoregtk-4.1` development packages are absent

The temporary spike did not touch this repository's dependencies or add files. It:

1. Built the current Aimtrix production assets with `npm run build`.
2. Copied `dist/` to a temporary directory.
3. Generated a Tauri 2.11 scaffold with `frontendDist: "../dist"`.
4. Changed the generated placeholder identifier to `dev.alucard.aimtrix`.
5. Ran `tauri info` and `tauri build --debug --no-bundle`.

| Check | Result | Evidence / blocker |
| --- | --- | --- |
| Current Vite production build | **Pass** | `npm run build`; bundle budgets passed |
| Static asset embedding model | **Pass, static only** | Tauri accepted the local `frontendDist: "../dist"` configuration |
| Tauri scaffold generation | **Pass** | CLI generated `tauri.conf.json`, Rust entrypoint, and capability file |
| Linux Tauri compile | **Blocked** | `pkg-config` could not find `webkit2gtk-4.1` and `javascriptcoregtk-4.1` |
| Linux WebKitGTK runtime | **Untested** | Native build did not produce an executable |
| Windows WebView2 / C++ build | **Untested** | No Windows host or runner used in this spike |
| macOS WKWebView / signing | **Untested** | No macOS host or Xcode available |
| Login, SSO, restore, logout, forget | **Not exercised in Tauri** | The web-layer paths remain covered by existing tests; no native shell existed to run them |
| Rust/WASM crypto and IndexedDB restart/upgrade | **Not exercised in Tauri** | Requires a built WebKit shell and a disposable account/profile |
| Attachments, media permissions, calls, screen share | **Not exercised in Tauri** | Requires native runtime and hardware/provider setup |
| Deep links and shutdown cleanup | **Design viable; not exercised** | Requires installed bundles and OS registration |
| Binary size, startup, memory | **Not measured** | No native artifact was produced |

The reproducible Linux failure is:

```text
The system library `javascriptcoregtk-4.1` required by crate `javascriptcore-rs-sys` was not found.
The system library `webkit2gtk-4.1` required by crate `webkit2gtk-sys` was not found.
```

Tauri's prerequisites document lists `libwebkit2gtk-4.1-dev` and the other Linux build dependencies. Installing system packages was intentionally not folded into this application change; the next real spike needs a dedicated Linux runner/container plus Windows and macOS runners.

## Platform findings

Tauri's webview is not one runtime:

| Target | Webview dependency | Risk for Aimtrix |
| --- | --- | --- |
| Linux | System `webkit2gtk` | Distro packaging and WebKitGTK version variance; the current host is blocked before runtime |
| Windows | Edge WebView2 | Better Chromium alignment and auto-updating runtime, but installer/runtime provisioning and media/notification behavior still need testing |
| macOS | System WKWebView | WebKit follows the OS; older macOS versions stop receiving newer WebKit behavior |

The PWA keeps one browser-tested artifact and currently covers the feature surface without native signing, WebView provisioning, or OS-specific capability review. Tauri's value only becomes concrete when an actual release requirement cannot be met by the PWA.

## Security review boundary

The generated scaffold's default capability grants only `core:default`. The eventual Aimtrix shell must tighten this rather than enable broad plugin defaults:

- `frontendDist` must be a checked-in build output path; production must never point at `https://aimtrix.alucard.dev` or another remote page.
- Development may use a localhost `devUrl`; release builds must not retain a remote origin or remote capability allowlist.
- Capabilities must be scoped to the main window and split by platform. File dialogs, notifications, clipboard, deep links, tray, global shortcuts, and secure storage each need the narrowest plugin permission they require.
- Matrix credentials belong in an OS keychain/secure-storage plugin, not Tauri Store, localStorage, or an unrestricted Rust command.
- Rust commands must validate inputs and return sanitized errors. Tauri capabilities reduce frontend blast radius but do not protect against malicious Rust code, lax scopes, compromised dependencies, or WebView vulnerabilities.
- Multiple windows must share one Matrix client/session and one crypto lifecycle; opening independent SDK clients risks duplicate sync and separate crypto stores.

## Adoption gate

Do not merge `src-tauri/` or Tauri dependencies until a disposable native spike passes the critical path on all three desktop targets:

1. Build the current `dist/` as bundled local assets.
2. Login, SSO callback, restore, logout, forget-session, and expired-token cleanup.
3. Rust/WASM crypto initialization, encrypted sync, attachment encryption/decryption, restart, and upgrade persistence.
4. File picker, authenticated MXC media, camera/microphone, screen sharing, audio output, and one-to-one WebRTC.
5. Notification permission/delivery, clipboard, deep-link cold start/warm handoff, single-instance behavior, and clean shutdown.
6. Capability audit, CSP/asset-origin review, signed artifacts, binary size/startup/memory measurements, and a reproducible release build.

The PWA remains the chosen implementation until one of these native-only needs is real: OS keychain integration, reliable tray/unread badge, system-wide shortcuts, or independent conversation windows. A native shell is not justified merely because it is possible.

## Electron fallback trigger

Use Electron only if Tauri's system-WebView dependency or capability model blocks a required feature after the adoption gate, and only after measuring the cost. Electron would trade Tauri's smaller binary and system WebView for a bundled Chromium runtime, larger artifacts, higher memory use, and a larger privileged surface. It is not the default fallback for an unrun Tauri test.

## References

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri configuration](https://v2.tauri.app/reference/config/)
- [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)
