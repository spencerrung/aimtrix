# Release policy

Aimtrix follows semantic versioning after `1.0.0`. Until then, minor versions may contain intentional UI or configuration changes, while patch versions remain backwards-compatible fixes.

## Release checklist

1. Run `npm ci`, `npm run check`, and `npm run test:e2e`.
2. Test password login, SSO callback login, E2EE recovery, attachment encryption, and a direct call against disposable Matrix accounts.
3. Update `CHANGELOG.md`, `package.json`, and the documented configuration schema.
4. Tag `vMAJOR.MINOR.PATCH`. The image workflow publishes multi-architecture images with provenance and an SBOM.
5. Review the Trivy image scan and GitHub dependency review before promoting `latest`.

Aimtrix does not run migrations or server-side state. Operators should retain their previous immutable image tag for rollback.
