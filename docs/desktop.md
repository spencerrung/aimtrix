# Desktop wrapper evaluation

Aimtrix remains a web/PWA project for the 0.x line. A Tauri 2 wrapper was evaluated but is not shipped yet.

## Why the PWA is the default

- One stateless artifact serves desktop and mobile clients.
- WebCrypto, IndexedDB, notifications, media devices, screen sharing, and service workers already cover the current feature set.
- A wrapper would add platform signing, updater, WebView variance, and another security boundary before Aimtrix needs native-only APIs.

## Tauri adoption gate

Add a wrapper only when at least one release feature requires native keychain storage, system-wide shortcuts, a reliable tray/unread badge, or independent conversation windows. If adopted, the wrapper must load bundled assets rather than a remote origin, use a strict capability allowlist, keep Matrix tokens in the OS keychain, and preserve the same runtime configuration schema. Multi-window conversations should share one Matrix session process rather than opening independent crypto stores.
