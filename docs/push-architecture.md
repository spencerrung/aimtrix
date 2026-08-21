# Matrix push and notification architecture

Status: accepted for the 0.x platform direction

This decision covers notifications after Aimtrix is backgrounded or closed. Foreground browser `Notification` calls remain a convenience only; they cannot replace Matrix pushers.

## Decision

Aimtrix will use the standard Matrix pusher API and an existing Matrix push gateway implementation, with **event-id-only** payloads as the privacy baseline. Aimtrix will not operate a bespoke event relay in the first mobile release.

The initial gateway integration target is Sygnal (the maintained Element-HQ fork of the Matrix reference push gateway), deployed by the Aimtrix operator for the Aimtrix application IDs. An operator who cannot use that gateway must provide a compatible Matrix Push Gateway endpoint in the runtime configuration; the client will not silently fall back to direct APNs/FCM delivery.

This gives homeservers the standard push-rule decision point, works with arbitrary homeservers, and keeps APNs/FCM credentials out of the client and homeserver configuration. It also makes the privacy boundary explicit: the push gateway receives identifiers and counts, not message bodies.

## Why not the alternatives

| Route | Decision | Reason |
| --- | --- | --- |
| Foreground `Notification` | Rejected as delivery architecture | Stops when the browser or app is suspended. Retained for the current foreground experience. |
| Direct APNs/FCM from Aimtrix | Rejected | Bypasses homeserver push rules, does not work for arbitrary homeservers, and would put provider credentials or a custom relay in the product boundary. |
| Aimtrix-owned bespoke gateway | Deferred | It would need APNs/FCM credentials, abuse controls, token lifecycle, multi-region delivery, and a privacy contract before it provides value over Sygnal. |
| Homeserver polling/background sync | Rejected | Mobile operating systems suspend it and it cannot provide reliable closed-app delivery. |
| Matrix pusher + compatible gateway | **Chosen** | Standard interoperability boundary with provider credentials owned by the gateway operator. |

## Registration flow

Each Matrix device opts in independently. Push registration is never inferred from login and is disabled until the platform permission and the user's notification preference both allow it.

1. The native client obtains an APNs device token or FCM registration token. The PWA obtains a Web Push subscription only when a configured Web Push gateway and VAPID public key are available.
2. Aimtrix creates a stable `pushkey` for that provider and registers it with the authenticated homeserver using `POST /_matrix/client/v3/pushers/set`:

   ```json
   {
     "pushkey": "provider-token-or-webpush-key",
     "kind": "http",
     "app_id": "dev.alucard.aimtrix",
     "app_display_name": "Aimtrix",
     "device_display_name": "Spencer's phone",
     "lang": "en",
     "append": true,
     "data": {
       "url": "https://push.example.org/_matrix/push/v1/notify",
       "format": "event_id_only",
       "default_payload": {
         "aps": { "content-available": 1 }
       }
     }
   }
   ```

   `append: true` prevents a registration on one Aimtrix device from replacing another pusher with the same app identity.
3. The homeserver evaluates the user's Matrix push rules. Muted rooms and rules that do not notify do not reach the gateway.
4. For a notification that passes those rules, the homeserver sends `POST /_matrix/push/v1/notify` to the registered gateway. With `event_id_only`, the payload contains the room/event identifiers and counts but no event content.
5. The gateway forwards the minimal payload to APNs, FCM, or Web Push. The native app or service worker wakes, opens the relevant web/native route, and the client syncs and decrypts locally before showing any message preview.

The event ID is a routing hint, not trusted notification content. The client must fetch the event over the authenticated Matrix session and verify/decrypt it before displaying sender, room, body, mention, or call details.

## Notification privacy contract

| Situation | Gateway/provider may receive | Gateway/provider must not receive |
| --- | --- | --- |
| Encrypted message | `room_id`, `event_id`, unread/highlight counts, pusher metadata | Access tokens, recovery keys, ciphertext, plaintext body, sender/room preview |
| Unencrypted message | The same event-id-only fields | Message body by default; Aimtrix will not opt into full-content payloads |
| Mention or keyword | The same fields after the homeserver's push-rule decision | The matched keyword or message preview |
| Muted room | Nothing for the muted event | A notification that contradicts the user's mute rule |
| Call invite | Event ID/count metadata only | SDP, call credentials, access tokens, or a promise of native CallKit presentation |

The first release shows a generic notification such as “New Matrix activity” until the app has synced and locally evaluated the event. User-configurable sounds, previews, and badges are applied locally. A future native notification service extension may replace the generic text only if it can preserve this contract.

The gateway stores no event payloads. Logs must exclude pushkeys, room IDs, event IDs, and notification bodies; metrics may contain aggregate delivery counts and latency. Pushkey rejection removes the stale pusher from the homeserver on the next client maintenance pass.

## Lifecycle and failure handling

- **Refresh:** on every provider-token refresh or Web Push subscription change, replace the pusher with the new pushkey and keep the old one until the homeserver acknowledges the replacement.
- **Logout:** call `/pushers/set` with the same `pushkey` and `app_id`, `kind: null`, while the access token is still valid; then clear the local provider subscription.
- **Device removal:** remove the pusher during explicit device removal where the server permits it. A deleted Matrix device must not be allowed to keep receiving pushes; the gateway also removes provider tokens rejected by APNs/FCM/Web Push.
- **Gateway failure:** the homeserver retains the pusher and retries according to its push-gateway behavior. Aimtrix must show a truthful “notifications unavailable” state rather than retrying with direct provider calls.
- **Tap routing:** native taps carry only an opaque room/event route. Web Push taps open the configured HTTPS origin with a validated room/event query. The app treats all routes as untrusted input and requires an authenticated session before selecting a room.
- **Duplicate delivery:** notification IDs and Matrix event IDs are deduplication hints only. Sync remains authoritative, and local notification presentation is idempotent.

## Credential ownership and environments

| Piece | Owns | Does not own |
| --- | --- | --- |
| Aimtrix client | Provider permission, token/subscription, pusher registration, local decrypt/rules, tap routing | APNs keys, FCM service accounts, access-token forwarding |
| Matrix homeserver | Authenticated pusher records, push rules, retry/rejection handling | APNs/FCM private credentials |
| Aimtrix/Sygnal gateway | App ID mapping, provider dispatch, short-lived delivery metrics | Matrix access tokens, room history, event decryption keys |
| APNs/FCM/Web Push | Device delivery | Matrix account or room data |

APNs `.p8` keys, FCM service-account JSON, VAPID private keys, and gateway signing/configuration secrets belong in the deployment secret store, never in `public/config.json`, Git, browser code, or issue fixtures. Development and production use separate app IDs, provider projects, bundle IDs, push keys, and gateway endpoints. Rotation is a deployment operation: provision the new credential, verify delivery, then revoke the old credential; provider tokens are re-registered as they refresh.

## Ownership boundaries

- **Aimtrix:** platform permission UX, pusher registration/removal, local notification privacy, Matrix sync/decryption, and deep-link validation.
- **Homeserver:** authentication, pusher storage, push-rule evaluation, and calls to the gateway.
- **Gateway:** validate the app/provider contract, forward the minimal notification, remove rejected tokens, and expose aggregate health metrics.
- **Provider:** deliver to the device according to APNs/FCM/Web Push rules.

## Proof and remaining external dependency

`npm run proof:push` runs a disposable local HTTP gateway and sends a representative `event_id_only` Matrix notification through it. The proof asserts that the request can be accepted without `content` or an `access_token`, and prints the exact privacy boundary it verifies.

It intentionally does **not** claim closed-app delivery. A live proof requires all of the following external pieces that are not present in this repository: a disposable account on a supported homeserver, an authenticated pusher registration, a configured Sygnal/Web Push endpoint, a native bundle with APNs/FCM credentials or a VAPID deployment, and a real suspended device. No production credentials or live notification traffic belong in this PR; the live test is a release-gate task for the native/mobile implementation.

## References

- [Matrix Client-Server API: pushers](https://spec.matrix.org/latest/client-server-api/#post_matrixclientv3pushersset)
- [Matrix Push Gateway API](https://spec.matrix.org/latest/push-gateway-api/)
- [Sygnal application notes](https://github.com/element-hq/sygnal/blob/main/docs/applications.md)
- [Sygnal](https://github.com/element-hq/sygnal)
