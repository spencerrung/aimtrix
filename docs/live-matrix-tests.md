# Disposable live Matrix tests

This is the validation foundation for [Polish 03 / #143](https://github.com/spencerrung/aimtrix/issues/143). It runs the built Aimtrix client against fresh Synapse and Dex services. It does not connect to a configured production homeserver, use an existing Matrix account, or deploy the application.

## Run locally

Requirements: Node.js 22+, npm dependencies, Docker Engine with Compose v2 or newer, and Playwright Chromium. Linux is the exercised host; Docker Desktop/native-shell behavior remains separate evidence.

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
npm run test:matrix:privacy
npm run test:matrix -- --repeat=2
npm run test:matrix -- --probe-failure
```

Build immediately before running so the harness exercises the intended application revision. The harness serves `dist/` through Vite preview and provides a temporary `/config.json` pointing only at its local Synapse. The normal `public/config.json` is unchanged. There are no Matrix response mocks, production controller hooks, or injected login tokens.

Each run creates a unique Compose project, generated credentials, two fresh service databases, and three separate Chromium contexts: Alice, Bob, and another Alice device. The repeat option destroys everything before starting the second run. The failure probe intentionally throws after real UI login, with disposable credentials and a synthetic private-content canary in the in-memory exception. It succeeds only when the expected failure is contained and cleanup completes. It does not retry a failed live journey until it passes.

Ports are allocated on `127.0.0.1`; startup fails if another process claims an allocated port. Tests do not reuse an existing server. Browser requests are restricted to the run's app, Synapse, and Dex origins. Docker images must be pulled from GHCR, but no Matrix federation listener is enabled and the federation domain allowlist is empty. The two services share a unique bridge network; the bridge is not an outbound firewall. Compose's internal-network mode is not used because Docker 29 suppressed its published host ports in local testing.

`AIMTRIX_LIVE_UID=1001 npm run test:matrix` exercises a different non-root service UID. Configuration lives in a readable child directory under a host-private `0700` temporary parent. Only that child is mounted read-only into the containers, so service readability does not depend on the host UID. Service data is held in UID-owned tmpfs. Read-only root filesystems, dropped capabilities, `no-new-privileges`, and discarded Docker logs are checked at runtime. The short-lived password-hashing helper is also unprivileged, has no network, and receives its password on stdin.

## What each journey proves

| Check | Real boundary exercised |
| --- | --- |
| Disposable services | Pinned Synapse and Dex start as non-root services; loopback binding, read-only roots, disabled Docker logs, and health endpoints are checked |
| Password login | Three application UI logins establish independent device IDs and IndexedDB crypto stores |
| Room setup | Aimtrix creates an encrypted room; helpers invite/join synthetic peers through actual Matrix APIs; server state advertises Megolm |
| Private read tracking and reminders | Two own devices observe private main/thread receipts and fully-read positions; another user cannot see those private receipts. Standard unread reminders and saved context synchronize, and enabling public receipts exposes the new main receipt. See [read state](unread-state.md). |
| Favorites | UI add/remove writes standard `m.favourite`; another own device observes sync and reload persistence, another account remains unaffected, and unrelated tags survive removal |
| Matrix navigation | Standard alias and room-ID event links open old encrypted messages through real alias/context endpoints; browser and application Back/Forward restore separate reading anchors and preserve a draft without joining or creating rooms |
| Encrypted send/receive | Alice sends through the composer; Bob and the second Alice device render the exact generated plaintext; outgoing/server events are encrypted and lack that plaintext; Bob sends a reply |
| Session reload | The second Alice browser reloads and decrypts the earlier message; peers stay online, so this does not isolate stored-key restoration from possible key re-sharing |
| Media | Aimtrix uploads encrypted bytes and sends an encrypted message; unauthenticated download fails, authenticated bytes differ from the source, and Bob's decrypted browser blob matches the original bytes exactly |
| Shared backdrop | Alice's UI save updates real room state and Bob's rendered backdrop; Bob's unauthorized state write is rejected; changing the UI policy changes Matrix power levels |
| Moderation | UI Decorator assignment, kick, ban, and unban are checked against actual power-level/member state; setup/re-invite uses API helpers |
| Private DM backdrop | Aimtrix creates the DM and saves its private backdrop through account data; Bob cannot read Alice's account data, has no private backdrop entry, and receives no shared backdrop state |
| Standard SSO | Aimtrix follows Synapse's SSO redirect, signs into a real disposable Dex provider, exchanges the resulting Matrix login token, removes it from the URL, and obtains a valid Synapse session |

Send-to-recipient and backdrop-application timings are recorded as observations from this local topology. They are bounded correctness checks, not production performance targets or a substitute for [#163](https://github.com/spencerrung/aimtrix/issues/163).

The harness uses Synapse 1.160.0 and Dex 2.45.1, pinned by multi-platform manifest digest in [stack.mjs](../tests/live-matrix/stack.mjs). Both manifests advertise `linux/amd64` and `linux/arm64`. Runtime execution on another architecture must be recorded separately; inspecting a manifest does not establish an ARM runtime pass. No Aimtrix container image is built or published by this harness.

Dex provides an actual OIDC identity service to Synapse; Aimtrix still uses standard Matrix SSO and `m.login.token`. This does **not** establish delegated OIDC/MSC3861 client authentication. The split browser/internal token endpoints and `skip_verification` are intentionally local HTTP test configuration, following Synapse's [Dex example](https://element-hq.github.io/synapse/latest/openid.html#dex) and Dex's [local connector documentation](https://dexidp.io/docs/connectors/local/). Never reuse these settings as production authentication guidance.

## Privacy and diagnostics

Only the named `matrix-test-results/run-1.json`, `run-2.json`, and `failure-probe-1.json` summaries are eligible for the CI artifact. [report.mjs](../tests/live-matrix/report.mjs) constructs that schema from an allowlist of check names, failure categories, numeric timings, image versions, platform, and Git revision. It discards arbitrary exception fields, URLs, responses, account identifiers, and extra metrics. Unit tests attempt to inject private canaries into those fields.

The live runner deliberately does not enable a Playwright reporter, trace, HAR, video, screenshot, download export, console forwarding, storage snapshot, or raw container log collection. Access tokens, OIDC secrets, generated passwords, plaintext, ciphertext metadata, and attachment bytes remain in process/browser memory or disposable service storage. Synapse logging uses a null handler; both Docker log drivers discard output. Do not add broad artifact directories or print caught SDK/Playwright errors when adding cases: those errors can contain credentials, callback URLs, or message text.

A failed summary identifies the named boundary and a coarse allowlisted category. Reproduce locally and add a safe boolean/count or narrower named check when more precision is needed. Do not disable the privacy boundary to obtain a generic browser trace. The probe intentionally demonstrates this failure path with real disposable credentials in an exception.

## Cleanup and CI

The runner attempts browser, preview-server, and Compose cleanup independently in `finally`, checks for remaining project containers/networks, and removes its private temporary directory even if teardown reports a failure. SIGINT/SIGTERM closes the active browser and allows bounded operations to unwind. Force-killing a process or stopping Docker can prevent normal teardown; a failed cleanup is a failed run.

The [Live Matrix integration workflow](../.github/workflows/matrix-integration.yml) performs privacy unit tests, builds the application, runs two clean live iterations, deliberately probes a failure, and uploads only the summaries. A final `always()` step removes any remaining containers/networks with that job's exact owner label, including the password-hashing helper. The hosted runner then discards its filesystem.

For a locally supervised run, an explicit owner permits the same fallback without touching other Docker resources:

```sh
AIMTRIX_LIVE_OWNER=local-matrix-check npm run test:matrix
AIMTRIX_LIVE_OWNER=local-matrix-check node tests/live-matrix/cleanup.mjs
```

Use a distinct owner for concurrent runs. Cleanup never invokes Docker prune, references production containers, or changes other Compose projects. A hard-killed local process can leave its `aimtrix-matrix-*` private temporary directory; remove only the directory associated with that terminated run after its services are removed.

## Extending the foundation

[stack.mjs](../tests/live-matrix/stack.mjs) owns image pins, generated settings, lifecycle, bounded HTTP calls and registration. [journeys.mjs](../tests/live-matrix/journeys.mjs) owns real browser actions and protocol assertions. Add a named check to the report allowlist with an explicit evidence claim; keep synthetic data generated at runtime. For history, receipts and recovery, reuse separate contexts and real Matrix helpers, and verify the recipient or restored device rather than only HTTP success.

SAS/incoming verification, key-backup restore, withheld keys, federation, delegated OIDC, Firefox/WebKit, physical/mobile/native shells, and large-account performance remain separate work. This baseline does not close their TODO items. Optional TURN/LiveKit and push/APNs/FCM infrastructure should use separate services, credentials, and jobs under #169/#176, so unavailable provider infrastructure cannot silently skip the baseline Matrix gate.

## Validation record

September 13, 2026 · Linux amd64 host · Node 22.23.2 · Chromium 149.0.7827.55 · Synapse 1.160.0 / Dex 2.45.1. Local tests exercised the built application and this branch's working-tree harness; CI summaries record their checkout revision.

| Gate | Result |
| --- | --- |
| Two clean live runs, `AIMTRIX_LIVE_UID=1001 npm run test:matrix -- --repeat=2` under `umask 077` | **12/12 checks passed in each run**; independent services/accounts/browser contexts; all cleanup checks passed |
| Standard service UID 1000 | Separate full **12/12** live run passed |
| `npm run test:matrix -- --probe-failure` under `umask 077` | Expected sensitive exception contained after successful real login; **5/5 setup/cleanup checks passed**; no exception content written |
| `npm run test:matrix:privacy` | **3/3 tests passed** for report allowlisting and private-canary rejection |
| `npm run check` | ESLint, **26 files / 209 unit tests**, TypeScript, production build and bundle budgets passed; build 1m 20s with the expected large crypto-chunk warning |
| `npm run test:e2e` | **32 passed, 6 intentional skips**, 2.7m; existing desktop/mobile application suite |
| Cleanup fallback rehearsal | Started a disposable labeled container/network, ran the exact-owner cleanup tool, verified both removed; other Docker resources were untouched |
| Independent review | Fixed cross-UID/config readability, independent cleanup attempts, secret-directory cleanup on failure, and owner labeling/cleanup for the hashing helper; reviewed privacy and evidence boundaries |

Observed send-to-recipient times in the two clean runs were **244ms / 246ms**; shared-backdrop application took **417ms / 407ms**. These are single local synthetic samples, not a performance SLA.

An initial parallel lint/browser run exposed ESLint scanning Playwright's disappearing generated output directory. Generated browser and Matrix report directories are now explicitly ignored; the complete gate passed afterward. During harness development, image setup and selector/timing errors were corrected before the clean runs; none are reported as passing live evidence.

Local allowlisted summaries are in `matrix-test-results/`; command logs are `/tmp/aimtrix-live-final.log`, `/tmp/aimtrix-live-probe.log`, `/tmp/aimtrix-live-check.log`, and `/tmp/aimtrix-live-e2e.log`. No source application behavior, production configuration, homeserver, Kubernetes resource, or published image was changed. CI results are tracked on the delivery PR and issue #143; this local record does not pre-claim a hosted CI run.


## Polish 04 extension

The interaction-foundation change adds explicit confirmation clicks to kick/ban journeys and a `private-profile-save` check. The latter saves through the profile editor, waits for the acknowledgement message, verifies the authenticated Matrix account-data preset, and checks that another account cannot read it. The complete harness now has 13 checks per normal run. September 13 local working-tree validation passed 13/13 twice with cleanup; the earlier 12-check records above describe the original infrastructure revision. See [interaction evidence](accessible-interactions.md) for remaining SAS/UIA/screen-reader boundaries.

## Polish 05 extension

The delivery change adds `encrypted-retry-reconnect-and-cancel` and `encrypted-thread-retry`, bringing the normal harness to 15 checks. The first rejects an encrypted send while newer text is typed, reconnects, retries the exact transaction/ciphertext, accepts it on Synapse and deliberately loses the HTTP acknowledgement after the sync echo. It verifies one server event and one recipient row, then cancels a separate rejected local send. The second retries the first reply in a new encrypted thread, verifies peer decryption and the standard relation, then cancels another thread reply and checks the count.

These checks exposed and now guard SDK chronological-thread gaps: unsent replies omitted from timelines, and accepted first replies missing after remote-echo reconciliation. Aimtrix retains original SDK events until a timeline owns them, with cancellation/session cleanup and immutable summary updates. See [delivery behavior and evidence](message-delivery.md). The 12/13-check records above remain historical evidence for their earlier revisions.

September 13 local working-tree validation passed **15/15 twice**, including both delivery journeys and complete cleanup. The full local gate passed **274 unit tests** and **40 browser tests with 6 intentional project skips**. CI reports identify their own checkout revision.


## Polish 06 extension

The `encrypted-history-and-context` journey sends 350 real encrypted messages, reloads a device, pages backward beyond the visible limit and forward again, opens an exact old event with both neighbours, checks reading position during an incoming event, returns to live, and handles a redacted target. Normal runs now contain 16 checks. See [history navigation](history-navigation.md) for the implementation and remaining evidence boundaries.

The disposable Synapse configuration sets `caches.sync_response_cache_duration` to `0s`. Synapse otherwise caches successful sync responses for two minutes: a same-device reload shortly after login can receive its old empty initial response and replay the cached incremental stream. Numeric request diagnostics reproduced that behavior; with the test cache disabled, reload returns the newest 30 events directly, so reaching older messages must exercise real history/context retrieval. This changes only the test server. Cache-enabled reconnect performance and persisted sync/resume remain separate production boundaries under #163. See the [Synapse caching documentation](https://element-hq.github.io/synapse/latest/usage/configuration/config_documentation.html#caching).

## Polish 07 extension

Two session-recovery checks bring the normal harness to 18 checks. `revoked-active-session-and-encrypted-reauthentication` revokes the second Alice device with standard Matrix logout while its SDK is running. It waits for the expiry screen, verifies room rows and the composer are removed, and checks inside the browser that the rejected access token is no longer stored. Reload must retain the token-free recovery choice. The real password form keeps the account and homeserver fixed, obtains a new device for that account, and exchanges encrypted messages with Bob. Both the outgoing wire type and recipient plaintext are checked.

`revoked-stored-session-recovery` unloads Bob's app before revoking his token with the same standard API. Initial restore must then recognize the rejected stored credential, remove it, hide room content, and offer the account-specific recovery form. These checks run after the existing journeys so revoked devices cannot interfere with unrelated evidence. Tokens remain in memory and assertions return only booleans or fixed failure labels; no credential or recovery metadata is exported.

The earlier delivery journey separately exercises an offline/online transition and retry without reauthentication. These real logout cases produce terminal token revocation; Matrix soft logout, servers with refresh-token expiry, delegated OIDC, and cross-tab/native credential-store behavior need their own evidence. Online peers remain available during reauthentication, so the encrypted exchange does not establish isolated restoration of old device keys, key-backup recovery, or verification. Cache-enabled reconnect performance remains under #163. Full live results for this extension are recorded only after its two clean runs and failure probe complete.

## Polish 10 extension

Two fixed checks extend the 19-check baseline (including Polish 09 private read tracking) to 21 checks. `standard-favorites-and-own-device-sync` adds a favorite through the first Alice UI, observes it on the second device, reloads that device, and removes it there. Authenticated tag reads verify persistence and preservation of another synthetic tag; Bob's UI and tag state verify account isolation.

`matrix-links-and-navigation-history` reuses two messages from the existing 350-message encrypted history. It creates a disposable local alias through the Matrix API, opens an alias/event matrix.to link and a room-ID/event matrix: link through Aimtrix's link dialog, and observes actual alias and context requests. Browser Back and Forward and their application controls must restore the distinct reading positions while retaining the same draft. Browser history is checked for opaque state, and navigation must not issue join or room-creation requests. Alias names, event IDs, tags, links and reading positions stay in process/browser memory and never enter reports.

Execution results are retained in allowlisted run summaries and the [Polish 10 PR validation notes](https://github.com/spencerrung/aimtrix/pull/187); fixture coverage is distinct from a passing live run. Federated alias routing, unavailable rooms, native OS link dispatch, and physical-device keyboard behavior retain their separate evidence boundaries.

## Polish 11 extension

`encrypted-thread-history-and-links` extends normal runs to 22 checks. It sends 60 additional encrypted thread replies through the real UI, reloads the second device with the old root absent from its main window, opens the root through a standard Matrix link, pages older replies and retains a thread draft. A reply link retrieves and focuses the actual old reply. A new accepted live-tail marker proves that sync published while the historical viewport stayed unchanged and sent no receipt. Jump to latest then renders the new reply and waits for the homeserver to confirm the exact thread-scoped private receipt.

Counts may truthfully use a plus sign when a complete total is unknown. The retry/cancellation journey accepts that label while still verifying one accepted reply, original transaction/ciphertext reuse, and removal of the cancelled local echo. The new history journey checks nondecreasing counts separately from its exact live-tail and receipt assertions. Event IDs, roots, drafts, encrypted wire events and receipt payloads remain in browser/process memory; only the fixed check name and aggregate result enter the report.

September 14 local validation passed 22/22 checks with complete cleanup against Synapse 1.160.0 and Dex 2.45.1; report privacy tests passed 6/6. Hosted repeat/probe evidence is recorded on the delivery PR. This establishes the disposable browser boundary, not federation, other homeserver implementations or physical native devices. See [thread history](thread-history.md).

## Polish 12–14 extension

The combined messaging batch adds four checks, bringing a normal complete run to 26 checks:

- `encrypted-staged-attachments-and-retry`: stage two files with standard captions, reject the second event, retry its original encrypted transaction/ciphertext, and verify one accepted copy of each file and decrypted bytes on another device.
- `encrypted-thread-attachment`: send a reviewed file inside a new thread and verify its caption, filename, thread relation and peer decryption.
- `durable-room-thread-drafts-and-reattach`: reload structured room/thread drafts, preserve context and captions, require explicit reattachment, then send the reattached thread file to the peer.
- `formatted-api-peer-interoperability`: receive safe formatted roots and notice replies from a direct standard Matrix API peer and read an Aimtrix formatted thread reply back through the API and another browser device. This deliberately unencrypted disposable room permits protocol-payload assertions; encrypted attachment checks remain separate. It does not claim a third-party client's UI was exercised.

The original encrypted-thread retry journey now starts in the shared thread composer. Reports still contain only fixed check identifiers and aggregate results. Draft contents, filenames, captions, attachment bytes, room/event IDs and wire payloads remain in disposable browser/process memory. Successful runs and the diagnostic failure probe are recorded on the delivery PR; no production homeserver or infrastructure is used.
