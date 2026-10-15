# Retained PWA upgrade evidence

This record addresses [#290](https://github.com/spencerrung/aimtrix/issues/290), following the [RC8 release record](https://github.com/spencerrung/aimtrix/issues/289). The public RC7→RC8 check timed out without retaining worker or asset diagnostics. Its cause remains unknown; it did not establish data loss. No public deployment or real Matrix account is used by the local proof below.

## Reproducible release transition

`scripts/prepare-pwa-release-builds.mjs` exports unmodified sources at RC7 `0d0852d50f3673c0101c3af2fe79d552d0371006` and RC8 `eb7edb19ddde1387e260dcec2835dfcd59ee213d`, installs each release's own lockfile, and runs its build/bundle gate. It writes a manifest containing source revisions, lockfile/HTML/worker SHA-256 values and cache identities. These are local source builds, not extracted published image files or a claim of byte identity with the public deployment. The script needs those commits in the local Git object database and never checks out or modifies the working branch.

Install the workspace dependencies and build the current application first (`npm ci`, `npm run build`); the normal Playwright preview server uses that output. Full Playwright Chromium must be installed because its headless-shell binary cannot perform PWA installation.

```sh
node scripts/prepare-pwa-release-builds.mjs /tmp/aimtrix-pwa-releases
# Use the actual releases.json path printed by the preceding command.
PWA_RELEASE_BUILDS=/tmp/aimtrix-pwa-releases/builds-<generated>/releases.json \
  PLAYWRIGHT_PREVIEW=1 npm run test:e2e -- e2e/pwa-release-upgrade.spec.ts
```

The opt-in suite runs six cases, each with a new persistent Chromium profile. It uses full Chromium's real `PWA.install` and `PWA.openCurrentPageInApp` commands, verifies standalone display mode, and uninstalls the app before deleting the disposable profile. A loopback HTTP server initially serves RC7, then switches to RC8 without altering either release's assets or worker. Desktop and Pixel-sized mobile emulation each exercise:

| Asset delivery | Required result |
| --- | --- |
| Complete RC8 assets | A real installing worker becomes waiting; the running RC7 app shows its update notice. |
| RC8 entry requested from an old replica | The new hashed entry returns 404; installation becomes redundant, the old active worker/cache remain, and no update notice claims success. Restoring complete availability and calling `registration.update()` retries the same unchanged RC8 worker successfully. |
| Required entry temporarily unavailable | The 503 response rejects installation with the same protection and retry behavior. |

Every case retains the synthetic draft while the update waits, checks the explicit volatile-draft/encryption warning, cancels and verifies unchanged draft/waiting state, then accepts. Acceptance intentionally discards the demo's volatile draft with prior consent. The RC8 entry loads, only its shell cache remains, and it starts offline after clearing and disabling Chromium's HTTP cache. This is not an authenticated durable-draft, E2EE store, or homeserver recovery test.

## Diagnostics survive assertion exits

The production lifecycle suite and release suite use `e2e/pwa/diagnostics.ts`. Each completed observation is atomically written to `pwa-diagnostics.json` in that test's output directory; teardown adds the final test status and attaches the report even when assertions fail. A bounded final checkpoint cannot wait indefinitely for `navigator.serviceWorker.ready` after a failed installation. A process kill may leave status `running`, but already completed observations remain on disk.

The report contains only enumerated worker states for `/sw.js`, active/waiting/installing/controller observations, numbered pages, visibility and standalone mode, build cache identities, elapsed times, known static-asset paths with numeric HTTP status, and error counts. It retains worker `redundant` transitions and distinguishes controlled 404/503 asset failures from transport failures. Unknown cache names, request queries, fragments, headers, bodies, raw errors, local/session storage and IndexedDB contents are excluded. The two build identities map observed cache names to releases; the report does not pretend the same `/sw.js` URL alone identifies a worker version. Unit tests enforce the data allowlist. Browser traces and screenshots are appropriate only for these disposable synthetic tests, not arbitrary signed-in/public sessions.

The negative proof deliberately fails a real Playwright assertion after a 503 installation rejection, then verifies the retained failed status, redundant worker, active/controller state, old cache retention, absent candidate cache, visibility, standalone mode and failed asset response:

```sh
PWA_RELEASE_BUILDS=/tmp/aimtrix-pwa-releases/builds-<generated>/releases.json \
  PLAYWRIGHT_PREVIEW=1 node scripts/prove-pwa-diagnostic-retention.mjs /tmp/aimtrix-pwa-negative
```

The child test must fail and the proof script must exit zero. Keep its intentional failure distinct from normal passing gates. Extra Playwright arguments, such as `--config /path/to/isolated.config.ts`, can follow the output directory. On a shared host, run browser commands under the agreed network `flock`; Docker network changes must not overlap them.

## Separate startup defect

An additional controlled-page probe found a missing notice while RC8 was already waiting. The initial diagnostic fixture observed the original page only, so it cannot establish that newcomer's event timing. Independently, a deterministic App regression proves a notification race: `watchServiceWorker()` emits a transient update event, but `App` subscribes from a React effect, and an announcement before the effect is lost. The test announces the waiting worker before mounting. The fix subscribes first and then reads the browser's existing registration, showing a waiting worker only when the page has a controller. It does not activate or reload automatically, and ignores a lookup that resolves after unmount.

The current-source two-build lifecycle suite covers the newly opened page with a real waiting worker on desktop and mobile emulation. This repair applies to a subsequent build; the pinned RC7 and RC8 proof assets remain unchanged. Neither this race nor the deliberately induced asset failures diagnoses the original public check, whose missing evidence cannot be recovered.

## October 15, 2026 local evidence

Evidence was generated under `/tmp/aimtrix-oct14/pwa/` with Node 25.6.1 on Linux. Both pinned release builds passed their typecheck/build/bundle commands. The first release browser run passed all six installed upgrade cases; two additional startup probes failed. The desktop probe opened a working new page with no update notice. The mobile probe transitioned before RC7 Workspace readiness and requested removed RC7 assets, so it was an invalid startup test setup; the current-source regression now waits for the visible workspace before transitioning. Both failed-run reports and the deterministic failing-before-fix unit log are retained.

Final current-source gates, negative retention proof and screenshot review are recorded after validation. Desktop installation here is actual headless Linux Chromium installation; the phone-sized cases emulate a phone inside that browser. Physical iOS/Android installation, OS suspension/cold launch, software keyboards, native packaging, authenticated draft/crypto recovery and another public rollout remain separate acceptance boundaries in the [platform matrix](platform-acceptance.md). Local evidence can satisfy #290's diagnostic/recheck follow-up without rewriting the historical rollout result or closing those device gates.
