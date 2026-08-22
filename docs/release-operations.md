# Cross-platform release operations

This is the operating process for Aimtrix's hosted PWA, Tauri desktop client, and Capacitor mobile sources. It separates what CI can prove from what requires a disposable live homeserver, a physical device, or a store review. Passing a mock or compile gate is never recorded as live interoperability.

## Release channels

| Client | Development | Candidate | Stable | Rollback |
| --- | --- | --- | --- | --- |
| PWA | Branch/PR preview and local Vite server | A reviewed merge to `main`, with the immutable image available for inspection | The approved immutable multi-architecture image deployed by the operator's normal GitOps/release process | Reconcile the previous immutable image tag; never rebuild over a known-good tag |
| Tauri desktop | Unsigned local `desktop:dev` / debug compile | Protected `vMAJOR.MINOR.PATCH` tag creates a draft GitHub Release | Publish the draft only after clean-machine, signature, updater, and live Matrix gates | Distribute the previous immutable GitHub Release; do not retag or force a downgrade |
| Capacitor mobile | Local synced Android/iOS projects | Signed internal Android build or TestFlight/Play internal track | Store release after physical-device, provider, privacy, and store-review gates | Halt promotion, roll back store availability where supported, and keep the prior internal/store build available |

All clients share the same web artifact and Matrix controller. A native release is additive; it does not replace the hosted PWA or authorize a production deployment by itself.

## Version and ownership rules

- Use a SemVer `MAJOR.MINOR.PATCH` version. Until `1.0.0`, minor versions may contain intentional UI/configuration changes; patch versions remain compatible fixes.
- The release tag is the source of truth for desktop. The workflow injects it into temporary package/Cargo metadata and never commits generated release config.
- Keep Android `versionCode` and iOS `CURRENT_PROJECT_VERSION` monotonically increasing alongside the human-readable version.
- A release owner cuts the version, a second reviewer checks evidence and privacy/store metadata, and an operator performs the promotion or rollback. One person may hold multiple roles only for a documented emergency.
- Never commit or paste access tokens, Matrix passwords, recovery material, push-provider keys, Apple certificates, Windows PFX files, updater private keys, or store credentials.

## Shared automated gate

Run from a clean Node 22 checkout:

```bash
npm ci
npm run release:validate
npm run check
npm run proof:push
npm run proof:push-sw
PLAYWRIGHT_PREVIEW=1 npm run test:e2e
```

The required CI evidence is the Quality workflow run, including its retained Playwright traces/screenshots on failure, unit/build output, push privacy proofs, dependency review, and mobile project synchronization checks. The release contract validator checks that public runtime config contains no secret-shaped keys, required operating docs exist, and CI keeps the release validator plus browser evidence artifact wiring.

### Automated versus external evidence

| Gate | Automated evidence | External evidence still required |
| --- | --- | --- |
| Shared web behavior | Lint, 148+ unit tests, production bundle budgets, Chromium desktop/mobile Playwright, Axe, service-worker and push privacy proofs | Browser versions not represented by Chromium, Safari install/push behavior, deployed-origin cache behavior |
| Desktop packaging | Linux/macOS/Windows compile matrix, signed release workflow, updater metadata, checksums, SBOM, provenance | Clean OS install, Gatekeeper/SmartScreen, keyring persistence, updater tamper rejection, media/calls, live Matrix |
| Mobile packaging | Capacitor sync, identifiers, manifests, privacy files, web shared-core gate | Physical iOS/Android build, signing, permissions, keyboard/safe area, push providers, app-store review |
| Matrix protocol | Mocked controller/platform tests and privacy proofs | Disposable live homeserver login/SSO, E2EE recovery, sync, media, calls, pusher delivery, logout |

## Release procedure

1. Open the release issue and record the target commit, version, channel, owner, reviewer, and required external evidence.
2. Run the shared automated gate locally. Push the branch/PR; do not merge while required checks or dependency review are red.
3. Review `docs/privacy-and-store-disclosures.md` against the actual diff, manifests, runtime config, and provider setup. Update the store forms before submission, not after rejection.
4. Merge to `main`. For the PWA, follow the existing immutable image/GitOps process. For desktop, push a protected `vMAJOR.MINOR.PATCH` tag or dispatch the desktop release workflow with an existing tag. For mobile, create a signed internal build from the same commit.
5. Inspect release artifacts: platform coverage, signatures, `latest.json`, `SHA256SUMS`, SBOM, provenance, version/build numbers, and absence of secrets. Keep desktop releases as drafts until the manual gate passes.
6. Run the live Matrix interoperability gate with disposable accounts and the physical client gate on the target devices. Record redacted evidence using the template below.
7. A second reviewer checks the evidence, privacy/store declarations, known issues, and rollback target. Only then publish the desktop draft or promote the mobile/PWA candidate.
8. Announce the exact version, supported targets, known limitations, updater channel, and rollback path. Do not announce a capability whose external evidence is still missing.

## Live Matrix interoperability gate

Use a disposable account, a disposable encrypted room, and a homeserver configuration representative of the intended release. Record the homeserver software/version and app commit; redact all identifiers that are not needed to reproduce the failure.

- [ ] Password login and SSO callback complete; SSO login tokens disappear from the URL/history.
- [ ] Session restore, expired-token recovery, logout, explicit forget-session, and account switching behave correctly.
- [ ] Encrypted sync initializes, survives restart/upgrade, decrypts a message, and restores from the documented recovery flow.
- [ ] An encrypted attachment uploads, downloads, decrypts, and cleans up temporary/decrypted resources.
- [ ] A one-to-one call starts, answers, rejects, mutes, changes camera/microphone, and reconnects with TURN/LiveKit configured.
- [ ] Notification permission, Matrix push rules, pusher registration/removal, token rotation, generic event-id-only payload, and tap routing work with the configured gateway/provider.
- [ ] Deep-link cold start and warm handoff open only validated room/event routes; arbitrary URLs and tokens are rejected or ignored.

No live gate evidence belongs in Git if it contains room content, tokens, recovery keys, provider credentials, or unredacted private IDs. Store the date, versions, test case IDs, result, and redacted error category in the operator's protected incident/evidence system.

## Physical client gate

### Desktop

Use `docs/desktop-release.md`. Install the signed artifact on a clean Linux, macOS, and Windows environment; test keyring/session persistence, SSO/deep links, E2EE restart/upgrade, media/calls, notifications, tray/single instance, updater install, tampered signature rejection, uninstall, and rollback.

### Mobile

Use `docs/mobile-release.md` and `docs/platform-acceptance.md`. On at least one current iOS/iPadOS device and one current Android device, test signed install/upgrade, password/SSO, secure storage, E2EE/recovery, push permission and tap routing, token rotation/logout, camera/microphone/files, calls, keyboard/composer reachability, safe areas, background resume, forced termination, and offline/reconnect.

### PWA browsers

Run Chromium CI plus manual Safari/iOS, Android Chrome, Windows Edge/Chrome, and macOS browser checks when those targets are in the support statement. Verify install mode, service-worker update/draft protection, storage restart, permission denial/retry, reduced motion, and notification claims. Browser-mode foreground notifications must not be described as closed-app push.

## Support and incident response

1. Classify the report as `configuration`, `authentication`, `sync`, `encryption`, `media`, `call`, `notification`, `storage`, or `platform`.
2. Ask for app version/commit, client/platform/OS/browser version, homeserver software, reproduction steps, and the visible error category. Do not ask for a password, token, recovery key, room export, or raw support bundle.
3. Reproduce with a disposable account and private test room. Preserve only redacted logs and aggregate timing/status data.
4. For a privacy or E2EE regression, stop promotion, disable the affected candidate/channel where possible, notify the release owner, and record the first known-good immutable version.
5. For a bad PWA image, reconcile the previous immutable image. For desktop, direct users to the previous GitHub release and stop the updater promotion. For mobile, halt store/internal promotion and use the store's rollback/availability controls.
6. Rotate a credential only through the protected secret store. Updater key rotation requires a migration plan; replacing it blindly strands installed clients.
7. Close the incident with root cause, affected versions/platforms, evidence location, user-facing disclosure decision, and a regression test or runbook change.

## Known support boundaries

- The hosted PWA remains the supported fallback while native physical-device or store evidence is incomplete.
- Desktop Linux depends on the runner/distribution's WebKitGTK runtime; Windows depends on WebView2; macOS depends on system WebKit.
- Closed-app push, APNs/FCM delivery, TURN/LiveKit calls, SSO interoperability, and multi-device E2EE are live/provider boundaries, not proven by mocked CI.
- Store availability, privacy manifests, data-safety answers, and permission rationale are release artifacts that must be reviewed against actual behavior for every client version.

## Evidence record template

```text
Release/version:
Commit/tag:
Client/platform/OS/browser or WebView:
Homeserver/provider versions:
Tester / reviewer:
Automated CI run:
Live test cases and result:
Physical-device test cases and result:
Redacted failure categories:
Known limitations:
Rollback target:
Promotion decision / date:
```
