# Message delivery and recovery

Polish 05 ([#145](https://github.com/spencerrung/aimtrix/issues/145)) gives room messages, replies, edits and thread replies explicit delivery state and recovery without replacing newer composer work.

## What the states mean

| SDK status | Aimtrix behavior |
| --- | --- |
| `QUEUED` | Queued; waiting for the SDK send queue |
| `ENCRYPTING` | Encrypting; no plaintext fallback |
| `SENDING` | Sending; awaiting the request outcome |
| `NOT_SENT` | Send not confirmed; content remains with Retry and Cancel |
| `SENT` or remote echo (`null`) | Accepted by server; this does not establish recipient reading or decryption |
| `CANCELLED` | Removed from the local conversation |

Recovery buttons stay visible on touch layouts and keyboard accessible. Delivery failure copy uses a small allowlist of error codes; these controls never display server error bodies. A lost acknowledgement can leave an uncertain outcome, so generic failure copy says “not confirmed.” A permission rejection explains permissions; rate limits suggest waiting. Existing read-position avatars remain separate from send acceptance.

Only failed sends can be cancelled. An active encryption/send request may already have progressed, and the SDK cannot provide a reliable universal cancellation outcome. Cancel removes the local failed event; it is not a server redaction or an assurance that an unacknowledged request never reached the server.

## Transaction and composer ownership

The Matrix controller assigns a transaction ID before sending and retains the original SDK event pointer. Retry calls `resendEvent` on that event, preserving its transaction, relations, mentions and existing ciphertext. It never constructs a new plaintext message from rendered text. Chronological pending-event ordering requires `findEventById`/transaction lookup, not the SDK's detached pending-list APIs. Duplicate retry submissions and stale session actions are guarded. A remote echo that arrives before an HTTP failure remains accepted.

A session-scoped event map also retains unsent thread echoes that the SDK omits from chronological timelines. It is merged by event/transaction identity and cleared on cancellation or client teardown. Accepted events remain in this map until an SDK timeline owns their server ID: the SDK can otherwise lose the first thread reply during remote-echo reconciliation. Thread summaries are immutable and account for supplemental or cancelled local replies.

Snapshots refresh delivery changes even on non-tail events, and transaction IDs stabilize the rendered row while the server replaces a local event ID. Failed edit events remain independently recoverable; they do not replace accepted message content until accepted. Ordinary reply/edit/reaction/pin actions stay unavailable on unsent local IDs.

Text stays in the composer while its request is pending. Success clears only the submitted draft generation. A retained failed SDK event becomes the recovery owner, so the unchanged submitted draft is cleared without creating a second send path. Preparation failures keep the draft. New typing, an intentionally emptied field, changed reply/edit context and navigation are protected by revisions. Late completion cannot refocus or scroll another conversation. Room and thread composers follow the same rules.

Failed events survive room navigation within the active SDK session. Cancellation removes the local echo through the SDK; logout/client shutdown discards the session and retry guards. This change does not introduce a durable outbox or persistent room/thread drafts. Reload restoration/account-isolated draft storage remain #153; staged attachment ownership, code-file upload draft completion and unified media retry remain #154. The currently bounded history window remains #146.

## Validation boundaries

The snapshot/controller/component suites exercise every SDK status, non-tail changes, transaction reconciliation, failed edits, encrypted gating, safe retry/cancel, client changes, and deferred room/thread composer completion. The browser delivery fixture bundles the real Workspace and recovery components separately from the deployable application, with synthetic data and synthetic send callbacks. It checks all three themes at desktop and Pixel 7 sizes, Axe, visible keyboard/touch controls, newer draft retention, one reconciled row and cancellation focus. These fixtures do not establish protocol interoperability.

The disposable Synapse extension separately exercises rejected encrypted sends, newer typing, offline/online reconnection, identical transaction/ciphertext retry, lost HTTP acknowledgement after a real sync echo, server event uniqueness, local cancellation and standard encrypted thread retry. Raw credentials, room contents, screenshots and traces from those live sessions remain excluded from artifacts. See [live Matrix tests](live-matrix-tests.md) for setup and privacy restrictions.

September 13, 2026 local working-tree results:

- `npm run check`: lint, **274 tests in 32 files**, TypeScript, production build and bundle budgets passed. The expected large crypto chunk warning remains.
- `npm run test:e2e`: **40 passed, 6 intentional project skips** across desktop Chromium and Pixel 7 emulation. Final delivery screenshots were inspected across Aqua, Graphite and Midnight, including visible focus and unobscured recovery controls.
- `npm run test:matrix -- --repeat=2`: **15/15 checks passed twice**, each with fresh disposable services/accounts and complete cleanup. Both encrypted room and thread retry/cancellation journeys passed.
- `npm run test:matrix:privacy`: **3/3 passed**. The diagnostic failure probe remains a separate privacy/cleanup check, not a message-delivery success claim.

Local live reports identify the pre-commit checkout; PR CI rebuilds and verifies its exact checkout. CI results are attached to the delivery PR. Spoken screen-reader behavior, physical devices, federation and production homeservers are not established by Chromium or disposable Synapse checks.
