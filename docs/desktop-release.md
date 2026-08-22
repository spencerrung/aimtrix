# Desktop release runbook

## Supported artifacts

The release workflow produces:

- Linux x86_64 AppImage, `.deb`, and `.rpm` bundles.
- macOS Apple Silicon and Intel `.dmg` bundles plus updater archives.
- Windows x86_64 NSIS and MSI installers.

The Tauri updater uses the AppImage, macOS `.app.tar.gz`, and Windows installer updater artifacts. Every updater entry in `latest.json` must contain an HTTPS URL and an inline signature. Native OS signing is separate from Tauri updater signing: a notarized or Authenticode-signed installer still needs a valid Tauri `.sig`.

## Release flow

1. Confirm the target commit is on `main` and the version is a new `vMAJOR.MINOR.PATCH` tag.
2. Confirm the protected release environment has the secrets and the `TAURI_UPDATER_PUBLIC_KEY` variable from the long-lived signing key.
3. Push the tag or dispatch **Desktop release** with an existing tag. The workflow injects the tag version into temporary package/Cargo metadata and generates an ignored release-only Tauri config.
4. Wait for all five platform builds and the audit job. The audit validates all updater targets, downloads the draft assets, writes `SHA256SUMS`, generates an SPDX SBOM, and creates GitHub build provenance attestations.
5. Download the draft assets and perform the clean-machine checklist below. Publish the draft only after every required check passes.

No release workflow runs for pull requests, and the desktop shell workflow intentionally remains an unsigned compile gate. Local `npm run desktop:build` output is development-only and must never be used as a release artifact.

## Clean-machine checklist

- Install and launch each OS artifact without a pre-existing Aimtrix profile.
- Complete password login and SSO, then verify the `aimtrix://sso` callback and a room/event deep link.
- Join an encrypted room, restart the app, and verify crypto/session state survives.
- Verify authenticated media, microphone/camera, calls, desktop notifications, tray behavior, and single-instance forwarding.
- Install the next release over the previous one and verify the keyring, IndexedDB crypto store, settings, and pending session remain intact.
- From the running older build, check for the update, confirm metadata, explicitly install it, and verify the app relaunches into the new version.
- Change one downloaded updater signature or installer checksum and confirm validation fails; do not bypass signature checks.
- Exercise offline startup and a failed update; the existing app must remain usable.
- Use explicit **forget session** before uninstalling and verify sensitive local state is removed. Reinstall and confirm it starts clean.
- Keep the previous immutable release available and verify the documented rollback download/install path.

The release is not production-ready until the native runtime checks above have been run on clean environments. CI proves packaging and metadata; it cannot prove Gatekeeper, SmartScreen, WebKitGTK runtime behavior, hardware media, or real Matrix interoperability.

## Key and rollback policy

The public updater key is embedded in release builds. The private key must stay in the protected GitHub environment and a separate operator backup. Losing or replacing it without a migration path permanently strands already-installed clients from future updates.

Never overwrite a published release or move an existing tag. Roll back by selecting the prior immutable release and distributing that installer explicitly. Do not use the updater to downgrade unless a future updater policy adds an explicit, tested downgrade comparator.
