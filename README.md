# Aimtrix

Aimtrix is an original, self-hostable Matrix client that combines the compact Aqua character of 2005–2007 Mac chat applications, an optimistic Frutiger Aero atmosphere, and modern messaging behavior.

The project is web-first, statically deployable, and intended to work with ordinary Matrix homeservers without an Aimtrix-specific backend.

## Status

Aimtrix is a working pre-1.0 client. It includes password and SSO login, persistent encrypted sync, recovery and device verification, replies/edits/reactions, read-position avatars, encrypted attachments, searchable emoji, standard stickers, original lazy-loaded sticker packs, private decorated profile pages, readable room/space/DM backdrops with power-level-backed Decorator roles, nested spaces, room organization, optional GIF search, room creation/directory/moderation controls, notifications, PWA installation, and feature-gated direct Matrix voice/video calls.

The remaining compatibility and scale work is tracked honestly in [TODO.md](TODO.md), particularly group MatrixRTC/LiveKit calling, threads, full server-side message search, richer push-rule editing, and broader live-homeserver interoperability coverage.

Use the login-screen demo link, or open `/?demo=1`, to explore the interface without a Matrix account.

## Development

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run dev
```

Quality gate:

```bash
npm run check
```

The development server reads runtime settings from `public/config.json`. No credentials belong in that file: everything under `public/` is served to browsers.

## Runtime configuration

Mount a replacement configuration at `/usr/share/nginx/html/config.json` in the production container. Start from [`config/config.example.json`](config/config.example.json).

Important settings include the default homeserver, whether users can choose another homeserver, demo-mode availability, initial theme, call/media feature flags, operator-installed sticker manifests, and an optional GIF search endpoint. See [self-hosting](docs/self-hosting.md) for the provider contract.

## Container

```bash
docker build -t aimtrix .
docker run --rm -p 8080:8080 aimtrix
```

Then open <http://localhost:8080>. The final image is stateless and supports both `linux/amd64` and `linux/arm64` when built through Buildx.

## Principles

- Standard Matrix behavior first, custom events only when necessary.
- Encryption is foundational rather than a later compatibility layer.
- Media-heavy features are optional and lazy-loaded.
- Era-faithful visual character with accessible, responsive behavior.
- Original artwork, sounds, and branding.

Architecture notes live in [`docs/architecture.md`](docs/architecture.md). Deployment details, security headers, calling requirements, and Kubernetes guidance are in [`docs/self-hosting.md`](docs/self-hosting.md). See also the [release policy](docs/releases.md) and [desktop-wrapper evaluation](docs/desktop.md).

Aimtrix is available under the [MIT License](LICENSE).
