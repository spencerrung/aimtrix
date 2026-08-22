# Mobile application release

The cross-client promotion, privacy/store disclosure, evidence, and rollback process is in the [release operations runbook](release-operations.md). This document owns the mobile-specific signing, permission, provider, and physical-device gate.

Aimtrix now contains reproducible Capacitor Android and iOS project sources. These projects are internal-distribution foundations, not a store submission. No production signing material, APNs keys, FCM service accounts, or provider credentials belong in this repository.

## Application identity

| Target | Identifier | Current package version |
| --- | --- | --- |
| Android | `dev.alucard.aimtrix` | `versionName 0.1.0`, `versionCode 1` |
| iOS | `dev.alucard.aimtrix` | `MARKETING_VERSION 0.1.0`, `CURRENT_PROJECT_VERSION 1` |
| Deep-link scheme | `aimtrix://` | Routes accept only validated room/event IDs or the transient SSO login token |
| HTTPS link host | `aimtrix.alucard.dev` | Android intent filter is present; verified App Links/Universal Links still require hosted association files and signing entitlements |

The web artifact is bundled from `dist/`. The native projects do not configure a remote `server.url`, so a release cannot silently turn into a privileged wrapper around mutable remote content. Runtime homeserver and feature settings remain in the bundled `config.json` contract.

## Local workflow

```bash
npm ci
npm run build
npx cap sync

# Open the generated projects for internal development
npx cap open android
npx cap open ios
```

Android internal builds require a supported JDK, Android SDK/NDK, and a configured Firebase project when push delivery is enabled. Keep `google-services.json` out of Git. iOS builds require macOS, Xcode, a signing team, and APNs capability configuration; keep provisioning profiles and certificates in the signing system.

The current Linux development host cannot complete either native build: it has no Android SDK/NDK and only Java 26, while the generated Gradle wrapper currently rejects that bytecode; Xcode is macOS-only. The web build and native project synchronization do run locally.

## Permission contract

Permissions are requested at the user action that needs them, not at app launch:

- notifications: enabling Aimtrix notifications in settings;
- camera/microphone: starting or answering a call, or choosing a capture flow;
- photo access: choosing media to send or explicitly exporting media.

The native permission explanations are intentionally narrow. Denial must leave login, encrypted sync, messaging, and attachments usable where the platform permits them. A notification permission does not grant Matrix credentials or room access.

## Credential and crypto boundary

- Mobile Matrix sessions use iOS Keychain / Android Keystore through `@aparajita/capacitor-secure-storage`.
- Native SSO pending state uses the same protected store, so leaving the Aimtrix origin for an identity provider does not lose the homeserver target before the deep-link callback.
- The web fallback of that plugin is never used; the browser keeps its existing IndexedDB-backed session behavior.
- The native store uses a device-only, unlocked keychain accessibility setting and the namespaced `aimtrix.matrix-session.v1` key.
- Logout and forget-session remove the pusher before clearing the provider token and credential entry.
- Per-account sync and Rust/WASM crypto databases retain the existing account/device hash naming scheme. A reinstall or lost device does not claim to recover E2EE keys without Matrix recovery material.
- Push registration uses Matrix's standard pusher API and the event-id-only gateway contract. APNs/FCM tokens are pushkeys, not room data, and never appear in logs or notification copy.
- A saved notification preference re-registers the pusher after restore/resume; native token refresh events replace the new pusher and retire the prior in-memory registration when the homeserver accepts it.

## Native deep links

The `App` plugin receives `aimtrix://` and the canonical HTTPS host. The shared platform boundary validates room IDs (`!…`) and event IDs (`$…`) before updating the route. SSO callbacks use `aimtrix://sso?loginToken=…`, are converted to the local app URL only long enough for the existing Matrix token-login flow, then removed from browser history.

HTTPS App Links/Universal Links are not claimed complete until the release operator publishes and verifies:

- `https://aimtrix.alucard.dev/.well-known/assetlinks.json` for Android;
- an Apple `apple-app-site-association` file and iOS Associated Domains entitlement;
- cold-start and warm-start taps on physical devices.

Until that proof exists, Matrix push payloads must carry only opaque route data and the custom `aimtrix://` route remains the explicit native fallback.

## Internal release gate

Before TestFlight or Play internal-track distribution, run the full mobile gate from [the mobile evaluation](mobile.md):

1. Build and synchronize from a clean checkout with no remote URL or secret-bearing config.
2. Install over an earlier internal build and verify version/build-number migration.
3. Exercise password login, SSO, restore, logout, forget-session, encrypted sync, attachment crypto, and recovery on one iOS and one Android device.
4. Exercise push permission, APNs/FCM registration, Matrix pusher removal, event-id-only tap routing, token rotation, denied permission, offline resume, and account switching.
5. Exercise safe areas, keyboard/composer reachability, camera/microphone denial/retry, calls, file/share flows, background resume, and forced termination.
6. Inspect signed artifacts, privacy manifests, permission rationale, crash diagnostics, and store data-safety disclosures.

This checklist does not authorize production publishing. Store submission and live provider credentials require a separate release decision.

## References

- [Capacitor workflow](https://capacitorjs.com/docs/basics/workflow)
- [Capacitor App API](https://capacitorjs.com/docs/apis/app)
- [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)
- [Matrix push architecture](push-architecture.md)
- [Mobile wrapper evaluation](mobile.md)
