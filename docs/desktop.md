# Desktop client

Status: Tauri 2 shell implemented; **cross-platform native release validation is still pending**.

Aimtrix remains web-first and the hosted PWA stays supported. The checked-in Tauri shell packages the same Vite client as local bundled assets; it does not create a second Matrix implementation or make the PWA depend on Tauri.

## Current implementation

The desktop shell lives under `src-tauri/` and uses a strict `main`-window capability allowlist. The shared TypeScript platform boundary selects it only when Tauri's runtime marker is present; browser and Capacitor builds keep their existing adapters.

- Matrix sessions and pending SSO state use an OS-protected keyring through narrowly allowlisted Rust commands. Secure-storage failures return generic errors and never expose credential values.
- SSO callbacks use the registered `aimtrix://sso` scheme. Room/event routes use validated query parameters, work on cold and warm starts, and are delivered through the existing push-route event.
- Native notifications use Tauri's notification plugin with an action-specific handler that focuses Aimtrix and invokes the original room route callback. Message content remains subject to the existing generic native notification policy.
- Window focus/blur drives lifecycle-aware refresh behavior. Close-requested stops Matrix sync and releases media/object-URL resources before the process exits.
- A native tray menu exposes **Show Aimtrix** and **Quit Aimtrix**. A single-instance plugin forwards a second launch to the existing window instead of starting another Matrix sync client.
- Desktop media continues through the browser WebView API and reports a truthful unsupported state when the host WebView does not expose it.
- Updater wiring is intentionally left to the signed packaging issue (#90): this shell does not pretend unsigned local builds have a trusted update channel.

The shell is deliberately not store-ready. Signing, notarization, update endpoints, artifact provenance, clean-machine install/upgrade testing, and release channels remain the packaging/release work.

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

## Native release gate

Do not call the desktop client production-ready until a disposable native run passes the critical path on all three desktop targets:

1. Build the current `dist/` as bundled local assets.
2. Login, SSO callback, restore, logout, forget-session, and expired-token cleanup.
3. Rust/WASM crypto initialization, encrypted sync, attachment encryption/decryption, restart, and upgrade persistence.
4. File picker, authenticated MXC media, camera/microphone, screen sharing, audio output, and one-to-one WebRTC.
5. Notification permission/delivery, clipboard, deep-link cold start/warm handoff, single-instance behavior, and clean shutdown.
6. Capability audit, CSP/asset-origin review, signed artifacts, binary size/startup/memory measurements, and a reproducible release build.

The shell now provides the native-only foundations that motivated this work: OS keychain integration, a reliable tray/window lifecycle, and desktop deep-link registration. That does not replace the hosted PWA or waive physical and clean-machine validation.

## Local commands

```bash
npm run desktop:info   # report host prerequisites and Tauri targets
npm run desktop:dev    # run the Vite client inside Tauri
npm run desktop:build  # build a packaged desktop artifact
```

The current Linux workstation is still missing `webkit2gtk-4.1`, so `desktop:info` reports that prerequisite and a local Rust build stops before compiling the application crate. The checked-in desktop workflow installs that dependency on Ubuntu and compiles the same shell on Linux, macOS, and Windows. No signing keys or release credentials belong in this repository.

## Electron fallback trigger

Use Electron only if Tauri's system-WebView dependency or capability model blocks a required feature after the adoption gate, and only after measuring the cost. Electron would trade Tauri's smaller binary and system WebView for a bundled Chromium runtime, larger artifacts, higher memory use, and a larger privileged surface. It is not the default fallback for an unrun Tauri test.

## References

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri configuration](https://v2.tauri.app/reference/config/)
- [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)
