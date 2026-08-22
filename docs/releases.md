# Release policy

Aimtrix follows semantic versioning after `1.0.0`. Until then, minor versions may contain intentional UI or configuration changes, while patch versions remain backwards-compatible fixes.

## Release checklist

1. Run `npm ci`, `npm run check`, and `npm run test:e2e`.
2. Test password login, SSO callback login, E2EE recovery, attachment encryption, and a direct call against disposable Matrix accounts.
3. Update `CHANGELOG.md`, `package.json`, and the documented configuration schema.
4. Tag `vMAJOR.MINOR.PATCH`. The image workflow publishes multi-architecture images with provenance and an SBOM.
5. Review the Trivy image scan and GitHub dependency review before promoting `latest`.

Aimtrix does not run migrations or server-side state. Operators should retain their previous immutable image tag for rollback.

The cross-platform operating process, privacy/store disclosure contract, live interoperability gate, physical-device gate, evidence template, support process, and rollback ownership live in [release operations](release-operations.md). Run `npm run release:validate` before cutting a release; CI runs the same contract check and preserves browser evidence artifacts.

## Desktop release

Desktop releases are tag-driven and remain draft releases until the clean-machine gate is complete. The workflow is `.github/workflows/desktop-release.yml`; it builds signed Linux x86_64, macOS Apple Silicon, macOS Intel, and Windows x86_64 artifacts, then audits the generated updater metadata, checksums, SBOM, and provenance.

Create or dispatch a protected `vMAJOR.MINOR.PATCH` tag. The workflow requires these repository secrets/variables:

- `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — Tauri updater signing key and password.
- `TAURI_UPDATER_PUBLIC_KEY` — repository variable containing the matching public key.
- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` — Developer ID signing and notarization.
- `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` — base64-encoded PFX and password.

The Tauri updater key is long-lived trust material. Back up the private key securely before the first release; rotating it requires a migration strategy because installed clients will reject updates signed by an unknown key. Never commit any private key, certificate, password, or generated release config.

The draft release must contain `latest.json`, platform installers, updater signatures, `SHA256SUMS`, and the SBOM. Before publishing the draft, test a fresh install, launch, SSO/deep link, E2EE restore, notification, media/call path, upgrade from the previous release, explicit forget-session cleanup, uninstall, and rollback to the previous immutable release. A failed update must leave the existing install usable. Verify a modified installer or signature is rejected before approving publication.

Rollback means directing users to the previous immutable GitHub release; do not replace or retag an existing release. The updater intentionally follows the latest stable release, so a rollback is an explicit operator decision rather than a silent downgrade.

## Dependabot policy

`.github/workflows/dependabot-automerge.yml` enables squash auto-merge only for Dependabot patch updates. Major and minor updates remain manual so they can receive a compatibility review.

Repository settings must allow auto-merge, and the `main` branch rules should require `Quality / check` and `Quality / dependency-review` before merging. Auto-merge then waits for those checks and leaves failing updates open for review.
