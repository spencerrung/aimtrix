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
npm run test:matrix -- --profile-sustained-sync
npm run test:matrix -- --profile-large-account
```

Build immediately before running so the harness exercises the intended application revision. The harness serves `dist/` through Vite preview and provides a temporary `/config.json` pointing only at its local Synapse. The normal `public/config.json` is unchanged. There are no Matrix response mocks, production controller hooks, or injected login tokens.

Each run creates a unique Compose project, generated credentials, two fresh service databases, and three separate Chromium contexts: Alice, Bob, and another Alice device. The repeat option destroys everything before starting the second run. The failure probe intentionally throws after real UI login, with disposable credentials and a synthetic private-content canary in the in-memory exception. It succeeds only when the expected failure is contained and cleanup completes. It does not retry a failed live journey until it passes.

Ports are allocated on `127.0.0.1`; startup fails if another process claims an allocated port. Tests do not reuse an existing server. Browser requests are restricted to the run's app, Synapse, and Dex origins. Docker images must be pulled from GHCR, but no Matrix federation listener is enabled and the federation domain allowlist is empty. The two services share a unique bridge network; the bridge is not an outbound firewall. Compose's internal-network mode is not used because Docker 29 suppressed its published host ports in local testing.

The optional Element interoperability journey also permits its local Element origin. Its browser contexts allow Element's service worker, which authenticates Matrix media downloads; Aimtrix contexts keep service workers blocked in this harness. The same disposable-origin route applies to Element's worker-owned network requests.

`AIMTRIX_LIVE_UID=1001 npm run test:matrix` exercises a different non-root service UID. Configuration lives in a readable child directory under a host-private `0700` temporary parent. Only that child is mounted read-only into the containers, so service readability does not depend on the host UID. Service data is held in UID-owned tmpfs. Read-only root filesystems, dropped capabilities, `no-new-privileges`, and discarded Docker logs are checked at runtime. The short-lived password-hashing helper is also unprivileged, has no network, and receives its password on stdin.

## What each journey proves

| Check | Real boundary exercised |
| --- | --- |
| Disposable services | Pinned Synapse and Dex start as non-root services; loopback binding, read-only roots, disabled Docker logs, and health endpoints are checked |
| Password login | Three application UI logins establish independent device IDs and IndexedDB crypto stores |
| Room setup | Aimtrix creates an encrypted room; helpers invite/join synthetic peers through actual Matrix APIs; server state advertises Megolm |
| Community administration | The browser changes room access, aliases, directory listing and ACLs with server readback and ordinary-member denial. It creates a parent space and subspace, recommends a room, checks both standard graph links, selects the nested subspace to make its parent canonical, then removes the links. The [#216 live CI run](https://github.com/spencerrung/aimtrix/actions/runs/37074557296) passed Aimtrix knock, encrypted upgrade and peer access guidance, and denied second-write rollback in two clean runs. [PR #217](https://github.com/spencerrung/aimtrix/pull/217) adds a moderator power-level transition and owner-only denial. |
| Private read tracking and reminders | Two own devices observe private main/thread receipts and fully-read positions; another user cannot see those private receipts. Standard unread reminders and saved context synchronize, and enabling public receipts exposes the new main receipt. See [read state](unread-state.md). |
| Favorites | UI add/remove writes standard `m.favourite`; another own device observes sync and reload persistence, another account remains unaffected, and unrelated tags survive removal |
| Matrix navigation | Standard alias and room-ID event links open old encrypted messages through real alias/context endpoints; browser and application Back/Forward restore separate reading anchors and preserve a draft without joining or creating rooms |
| Encrypted send/receive | Alice sends through the composer; Bob and the second Alice device render the exact generated plaintext; outgoing/server events are encrypted and lack that plaintext; Bob sends a reply |
| Session reload | The second Alice browser reloads and decrypts the earlier message; peers stay online, so this does not isolate stored-key restoration from possible key re-sharing |
| Media | Aimtrix uploads encrypted bytes and sends an encrypted message; unauthenticated download fails, authenticated bytes differ from the source, and Bob's decrypted browser blob matches the original bytes exactly |
| Social messages and voice | In one encrypted room, Alice creates a poll, Bob votes, Alice ends it, and both refresh the resulting state; Alice shares a static point that Bob decrypts; a synthetic browser recorder proves no upload before send, encrypted attachment bytes on Synapse, and Bob's decrypted audio download matches the source. This tests Aimtrix clients and fake capture, not independent-client rendering or a physical microphone. |
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

The separate `matrixrtc-live-peer` job provisions disposable Synapse and a pinned LiveKit SFU, then joins two Chromium clients to an encrypted Matrix room with generated accounts and fake microphone/camera media. Its short-lived test authorizer validates each real Matrix OpenID token and signs a LiveKit JWT with a generated key. In both compatibility and modern membership modes, the job checks encrypted audio, camera and synthetic screen-video subscription, unpublishing, membership reconciliation, and capture cleanup. The screen-share check routes a separate fake camera track through `getDisplayMedia`; it does not exercise a physical display picker. The job writes only an allowlisted `group-rtc.json` result and injects the MSC4143 transport advertisement because the pinned Synapse image does not provide that optional endpoint. This proves the media and membership path against real services, while leaving real JWT-service compatibility, TURN-only routing and connection-loss recovery, federation, and newer homeserver-mediated MSC4195 authorization as distinct live boundaries.

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

The separate `--profile-cache-reload` mode keeps that two-minute cache enabled and records only numeric readiness and request-count metrics after 350 synthetic messages and a same-device reload. Its CI artifact is `matrix-cache-reload-summary-*`; a readiness timeout records `cacheReloadReadyWithin90s: 0` and fails the CI job. The response count includes only `/sync` requests started after reload. This is measurement infrastructure, not a production sync-resume fix. See [large-account performance](large-account-performance.md) for the storage tradeoff and remaining acceptance work.

The isolated `--profile-large-account` mode seeds joined rooms before starting its browser timer, verifies that the server's joined-room IDs match the created set, then requires a successful browser `/sync` and the full published UI count in a fresh device. It measures cold sign-on, bounded unfiltered rows, deep-room navigation and retained heap. Its own CI job targets 10,000 rooms and also repeats the synthetic 10,000-room Chromium fixture on a second host; [PR #231 passed](https://github.com/spencerrung/aimtrix/actions/runs/37137462095) the first complete live 10,000-room measurement. With `AIMTRIX_LIVE_SUSTAINED=1`, the job also seeds dense history in a deep room, verifies older-message paging and return to latest, and runs ten minutes of exact incremental delivery with row and heap checks. The live room count, seeding time and browser measurements are kept separate in allowlisted numeric artifacts; see [large-account performance](large-account-performance.md). Local Docker is required to run this mode outside CI.

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

## Polish 15 and 19 extension

Two attention checks bring normal runs to 28 checks (29 with the optional Element UI peer):

- `notification-rules-and-own-device-sync` changes all four room alert modes through settings and reads their standard push rules back from Synapse. Account DND is observed on a second device, then disabled; a synthetic keyword rule is added and removed with server readback.
- `home-activity-and-follow-own-device-sync` mutes and unmutes a thread with server readback, follows it in Home, and observes the private room account-data preference on another device. Synthetic mention and thread activity render while both clients are on Home. Hiding the followed thread on the second device updates the first; passive Home viewing must send no receipts for the new events. Opening the exact mention and returning restores the Home filter.

Only fixed check names and failure stages enter the report. Rule payloads, account data, message text and event IDs stay in disposable process/browser memory. These checks establish behavior against the pinned Synapse instance; they do not establish closed-app Web Push, APNs/FCM delivery, federation or physical native behavior. Those provider acceptance boundaries remain tracked separately.

### Optional Element Web UI peer

`npm run test:matrix -- --element-ui` adds Element Web as a disposable independent client and is a separate required CI job for pull requests. It signs Bob in before encrypted messages are sent, sends an encrypted readiness message through Element's composer and receives it in Aimtrix, then checks that Element decrypts an ordinary Aimtrix message. Element's timeline is checked for Aimtrix's encrypted poll, rendered location map, and voice-message fallback. The voice check then opens the exact accepted encrypted event and requires Element's native player to switch from Play to Pause and back to Play on completion. The poll journey uses Element's native radio control to cast an encrypted vote, requires Aimtrix to count it, replaces the same account's vote from a separate Aimtrix device, and requires both clients to show the replacement before Aimtrix ends the poll and Element disables voting. A separate unencrypted room checks poll create, Element vote, Aimtrix count, and Element closure without encryption; it also requires an invalid replacement to remove the earlier vote and a server-accepted late vote to leave the closed count unchanged. Element sends a manual pin in the encrypted room and Aimtrix must decrypt and render its `geo:` link. The disposable Element serves a blank local map style so this check makes no third-party tile requests. The location assertion establishes a decrypted static point, not populated map tiles. The voice recorder fixture contains a generated 3-second Opus tone in WebM, so the uploaded bytes are a valid audio file; the playback assertion exercises the pinned Element Web browser, not physical microphone or speaker hardware. The existing `element-ui-formatted-interoperability` check also verifies readable emphasis, inline code, quotations and lists, sends a message from Aimtrix's composer, then sends formatting back through Element's actual composer and verifies it in Aimtrix. The adjacent API-peer check independently covers formatted roots, thread replies and outbound thread content. Execution results must identify whether each Element check actually ran.

The official `vectorim/element-web:v1.12.28` image is pinned to multi-platform manifest digest `sha256:a8f415462ab8d2600a592ba1b92bea51efe5a4d10eb738aab9bed769f7099613`. Installation/configuration follow the project's [container documentation](https://github.com/element-hq/element-web/blob/v1.12.28/docs/install.md) and [runtime configuration contract](https://github.com/element-hq/element-web/blob/v1.12.28/docs/config.md). Its published static application runs unchanged; a test nginx configuration serves it on an allocated loopback port as the same unprivileged UID, with a read-only root, dropped capabilities, tmpfs, and disabled logs. Browser requests remain limited to the disposable origins. This optional image is pulled from Docker Hub; the normal Synapse/Dex images come from GHCR.

Element's session lives only in its disposable Chromium context. No Element assets, browser storage, screenshots, message contents or credentials are copied into Aimtrix or test reports. The report includes the pinned Element image only when requested. Normal Compose cleanup verifies removal of the additional container and its network together with the other services. This check establishes the exercised Element version's browser rendering; it does not establish native Element, federated homeservers or every third-party client.

## Collections and history retrieval acceptance

Three checks exercise the implementation from [PR #196](https://github.com/spencerrung/aimtrix/pull/196) against disposable Synapse. `saved-reference-own-device-and-context` saves an event through Aimtrix, verifies that account data contains only opaque room/event references, sees and opens it on a second device, removes it there, and confirms removal on the first device. It also saves in a disposable room, leaves that room, verifies the inaccessible result has no preview, and removes the reference despite lost access. `shared-pins-and-member-permission` pins through the room owner, reads standard `m.room.pinned_events` state and the member's Collections drawer, verifies the ordinary member cannot change pin state, and checks unpin sync. `old-cross-room-server-search-and-context` pushes two matching messages beyond the initial 30-event timeline window in separate unencrypted rooms, searches with a sender filter across joined rooms, checks the encrypted room is excluded from the server request, and opens the exact older result without search rendering sending a read receipt for either target.

Only fixed check names, categories, durations and aggregate metrics enter reports. Account-data references, search terms, event IDs, room IDs, and returned content stay in the disposable process and browser. The checks establish behavior on the pinned Synapse image, not other homeservers or complete encrypted-history search; the latter has its separate local-index gate in [#158](https://github.com/spencerrung/aimtrix/issues/158).

The [PR #208 live integration run](https://github.com/spencerrung/aimtrix/actions/runs/36659600779) passed both clean 36-check Synapse runs, its diagnostic privacy probe, and the separate Element Web peer job. The three retrieval checks passed in each clean Synapse run and the Element peer run.

## Private encrypted-history search acceptance

`private-encrypted-search-key-availability` uses the existing disposable encrypted room after 350 historical messages. Alice's second browser device indexes older history it can decrypt, reports indexed dates, finds an old result locally, and opens its exact context. Charlie joined before those messages but had no browser session receiving their keys; his first signed-in browser indexes the same room and must report skipped undecryptable history without claiming the old result is searchable. It must still send a new encrypted message and delete its local index. The harness checks every captured outbound request body during both indexing/search phases for the generated history prefix and local passphrase, and rejects server `/search` requests for the encrypted room. These values stay in process memory and are excluded from the allowlisted report. The [PR #209 live integration run](https://github.com/spencerrung/aimtrix/actions/runs/36794550139) passed the check in both clean 37-check Synapse runs and the Element Web peer run; the privacy diagnostic probe also passed. This does not replace native storage-provider or other-homeserver evidence.

## First-use encryption confidence acceptance

`first-use-encrypted-direct-conversation` starts from a fresh account's Home guide, chooses **Start an encrypted chat**, creates a direct room with another disposable account and checks the standard `is_direct`, invite, `m.room.encryption` and `m.direct` state. It requires Aimtrix to open the newly created conversation without a list search, sends the first message through that composer, checks the outbound event stays encrypted, and requires the peer Aimtrix device to decrypt it. The report retains only the fixed check name/category and duration; room IDs, Matrix IDs, message content and tokens remain in disposable process/browser memory.

`password-two-device-recovery-setup-and-restore` sets up recovery through Aimtrix, waits for a nonempty Synapse key backup and standard secret-storage default key, then signs in a fresh Alice device. The test identifies the old encrypted event by ID in that device's loaded timeline, requires an undecryptable guidance state before restore, imports at least one room key, clears the entered recovery key, and requires the same event to show its original message afterward. The key, passphrase, event text, and account identifiers stay in process/browser memory. A second check, `incoming-two-device-sas-verification`, initiates from account settings, accepts on another fresh Aimtrix session, compares all seven emoji, confirms on both sides, and requires completion. The optional `element-ui-incoming-sas-verification` uses the pinned, independently distributed Element Web UI to request verification of a new Alice device, compares all seven emoji with Aimtrix's incoming challenge, and requires both clients to complete. `element-ui-incoming-qr-verification` starts a separate Element request, waits for Aimtrix to accept it before opening the camera, presents Element's QR image through a synthetic video stream to Aimtrix's real decoder, and requires confirmation and completion on both clients. The synthetic stream advances explicit frames and checks that the QR reaches the video preview; sanitized failures distinguish camera delivery, decoder acceptance and Element reciprocation without saving the image. `element-ui-aimtrix-declines-verification` starts a new Element request, declines it in Aimtrix, and requires Element's cancellation notice and removal of Aimtrix's incoming prompt. `element-ui-withdraws-verification` starts another request, closes Element's verification dialog, and requires Aimtrix to clear its incoming prompt. The ephemeral QR image stays in browser memory and is never saved in reports or fixtures. These checks do not establish physical-camera behavior, the reverse QR direction, or other homeserver interoperability. The pinned [Element Web v1.12.28 verification panel](https://github.com/element-hq/element-web/blob/v1.12.28/apps/web/src/components/views/right_panel/VerificationPanel.tsx) has no QR scanner control, so the reverse direction needs another independent scanner.

`standard-sso-recovery-guidance` uses the real Dex-backed Synapse SSO account. It first sends a message in a newly encrypted room. If that server accepts recovery setup, a distinct SSO login must see the exact old event but not its plaintext before restore, then decrypt that event after restoring with the generated key. If Synapse requires an authorization flow Aimtrix cannot complete, it requires explicit trusted-client guidance, retained input, and no pretend key export. This does not prove every homeserver's UIA or delegated OIDC variant. Independently generated withholding, secret gossip, the reverse QR direction, physical camera handling, and native secure-storage behavior remain separate acceptance checks for #160 and #161.

`withheld-key-guidance-live` uses one of Alice's encrypted payloads with a fresh, intentionally unshared Megolm session ID, then posts that opaque payload as a room event after Charlie's fresh device exists. It requires an undecryptable encrypted placeholder before sending a standard `m.room_key.withheld` to-device event for that session with `m.unverified` through Synapse. This avoids the SDK's historical-message classification and isolates withheld-key handling. The check requires Aimtrix to replace its missing-key state with the specific verify-this-session guidance while keeping the event ciphertext unreadable. This exercises real SDK sync, decryption retry, and view-model rendering; the test deliberately constructs the missing session and protocol event, so it does not prove Element or another sender's trust policy emits it. The installed Rust SDK disables automatic room-key requests; do not present coming-online peer recovery as an assured protocol path without separate proof.

`confirmed-recovery-reset-and-key-replacement` runs at the end of the disposable password-account journey because resetting encryption changes that account's backup and identity. It requires a destructive confirmation, a different generated key and server backup version, rejection of the old key without clearing its input, and successful restore with the new key. The keys remain in test/browser memory and are never written to reports. This covers password UIA on disposable Synapse; SSO and provider-specific UIA reset paths remain open.
