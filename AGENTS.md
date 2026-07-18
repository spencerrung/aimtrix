# Aimtrix contributor guide

Aimtrix is an original, web-first Matrix client with an Aqua/AIM-inspired interface and modern behavior.

## Commands

- Install with `npm ci`; Node.js 22 or newer is required.
- Development: `npm run dev`
- Required local gate: `npm run check`
- Browser and accessibility gate: `npm run test:e2e`
- For container changes, run an actual unprivileged container, check `/_health`, and verify the response security headers.
- For release/container work, validate both `linux/amd64` and `linux/arm64` with Buildx; never push unless explicitly asked.

## Architecture rules

- Keep the deployable application static. Runtime instance settings belong in `public/config.json`, not build-time environment variables.
- Use standard Matrix events whenever the protocol supports a feature. Any Aimtrix-specific events must be documented under `docs/` and degrade safely in other clients.
- E2EE is a baseline requirement. Do not add code paths that silently send plaintext into encrypted rooms.
- Treat access tokens, recovery keys, room contents, and profile data as private. Never log them or place them in fixtures.
- The Matrix client lifecycle is owned by `src/matrix/`; UI components consume view models and actions rather than constructing SDK clients.
- Keep optional, media-heavy features lazy. Do not bundle large GIF, emoji, or sticker catalogs into the initial application chunk.
- Use original visual assets. Do not copy AOL/AIM, Apple, Element, Cinny, or Discord artwork or sounds.
- Preserve keyboard access, visible focus states, reduced-motion support, and semantic labels.

## Working agreement learned during the prototype

- Treat the accepted product direction and `TODO.md` as the working contract. Re-read them before a broad pass and do not silently narrow the requested scope to a smaller milestone.
- Spencer prefers a substantial, coherent implementation pass over a stream of partial milestones. Unless genuinely blocked or asked for progress, keep working through implementation, QA, fixes, and documentation before reporting back.
- Do not repeatedly ask questions that prior feedback has already settled. Current settled direction includes a full-viewport hosted client, roughly 65/35 Aqua-era character versus modern behavior, a playful space rail and personality drawer, foundational E2EE, stateless self-hosting, and working controls only.
- Never add a visible placeholder merely to imply future breadth. A button must complete its real protocol path, expose a truthful unsupported state, or remain hidden behind validated runtime capability/configuration.
- Critical Matrix settings are product functionality, not a decorative settings screen. Implement the SDK operation, UIA/recovery flow where applicable, loading/error/success states, destructive confirmation, and refresh of server state together.
- Prefer finishing related vertical slices end to end. For example, media work includes authenticated download, encrypted upload/decryption, rendering, limits, progress, cancellation, retry, data saver, tests, and operator documentation—not just an attachment icon.
- Keep the backlog complete and honest. Separate the current release gate from additive follow-up work; never mark protocol interoperability complete solely because mocked tests pass.
- Use sub-agents for independent review when available. If the configured service is unavailable, record the limitation briefly and replace it with concrete local review loops rather than stopping the task.
- Final reports should be concise but specific: summarize completed behavior, list exact validation results, disclose untested live-infrastructure boundaries, and mention that no commit/deployment occurred unless requested.

## Implementation and feedback loops

- Inspect `matrix-js-sdk` types and source before implementing unfamiliar APIs. Prefer typed standard events and documented SDK lifecycle methods over guessed payloads or homeserver-specific behavior.
- Keep encrypted behavior end to end. Authenticated MXC retrieval, attachment encryption metadata, secret-storage callbacks, recovery-key handling, verification phases, and client shutdown cleanup all need review when their surrounding flow changes.
- Keep the application backend-free by default. Optional GIF/sticker providers use validated public runtime contracts and must not require secret keys in browser configuration.
- After each substantial batch, run the smallest useful tests immediately, fix regressions, then run the complete gates. Do not postpone all validation until the end of a large change.
- Exercise user-visible changes in Chromium at desktop and mobile sizes. Inspect screenshots, not just test exit codes; verify layout, drawer behavior, composer reachability, and that responsive CSS has not hidden required controls.
- Add or extend Playwright coverage when a feedback loop exposes a real regression. Keep asynchronous picker elements stable across lazy data replacement by using stable keys and accessible names.
- Avoid positional responsive selectors such as `:nth-of-type` for functional controls. Give optional control groups explicit classes so adding a new button does not accidentally hide a different control on mobile.
- A successful image build is not a container smoke test. Start the final image as its unprivileged user and hit its endpoints. Files copied from this NAS may retain restrictive modes; explicitly make nginx configuration and static assets readable in the image.
- Keep Vitest and Playwright suites separate (`e2e/**` is excluded from Vitest) and report intentional skips distinctly from passes.
- Maintain bundle budgets while accepting that the Rust crypto WASM and IndexedDB crypto chunk are intentionally substantial. Heavy optional catalogs and attachment crypto should remain lazy.
- When live Synapse, SSO, TURN, or LiveKit infrastructure is unavailable, add mocked protocol tests and document the remaining live interoperability check; do not claim that boundary was exercised.

## Repository hygiene

- Check `git status --short --branch` before editing and preserve all existing work. This repository may still have no initial commit, so untracked files are source work, not disposable artifacts.
- Do not edit generated `dist/`, Playwright output, coverage output, `wasm/pkg`, or `node_modules/`.
- Keep `package-lock.json` in sync and use npm.
- Add tests for configuration, Matrix controller operations, view-model transformations, and user-visible interaction logic.
- Do not commit production homeserver credentials, access tokens, recovery material, private room data, or GIF-provider keys.
- Do not commit, push, publish an image, deploy, or alter live Matrix/Kubernetes infrastructure unless explicitly asked.
