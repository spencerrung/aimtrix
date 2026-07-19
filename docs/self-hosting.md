# Self-hosting Aimtrix

Aimtrix is a stateless static application. It does not need a database or PVC. Matrix messages and uploaded media remain on the configured homeserver; browser IndexedDB holds local sync and encryption state.

## Requirements

- A Matrix homeserver reachable over HTTPS.
- CORS-compatible Client-Server API access from the Aimtrix origin.
- `/.well-known/matrix/client` delegation when users enter a Matrix server name that differs from the API host.
- A persistent HTTPS origin. Browser encryption storage, camera, microphone, notifications, and service-worker features are restricted on insecure origins.

## Container

Build and run locally:

```bash
docker compose up --build
```

The container:

- listens as an unprivileged user on port `8080`;
- serves `/_health` for liveness and readiness probes;
- serves hashed assets with immutable one-year caching;
- serves HTML and `config.json` with revalidation/no-cache behavior;
- supports `linux/amd64` and `linux/arm64` through Buildx.

## Runtime configuration

Copy `config/config.example.json`, edit it, and mount it read-only at:

```text
/usr/share/nginx/html/config.json
```

This file is downloaded by every browser. Never put access tokens, passwords, recovery keys, private provider credentials, or other secrets in it.

For one homeserver, set both its permanent Matrix server name and API URL:

```json
{
  "defaultHomeserver": {
    "serverName": "example.com",
    "baseUrl": "https://matrix.example.com"
  },
  "allowCustomHomeservers": false
}
```

Unspecified keys inherit conservative application defaults. See the complete example for feature and media settings.

### Optional GIF provider

GIF search stays hidden unless both `features.gifs` is true and `gifProvider.searchEndpoint` is configured. The endpoint receives `q` and `limit` query parameters and must return either an array or `{ "results": [...] }`. Each result is:

```json
{
  "id": "provider-id",
  "title": "Description",
  "previewUrl": "https://cdn.example/preview.webp",
  "mediaUrl": "https://cdn.example/original.gif"
}
```

The provider and media CDN must allow browser CORS. Aimtrix downloads a selection and uploads it to Matrix, including attachment encryption in encrypted rooms. Do not place a private provider key in `config.json`; use a restricted public browser key or an operator-managed search gateway.

Aimtrix bundles the original Aqua Starter, Aero Days, and Web Garden packs. Operators can add immutable packs with `stickerPacks`, each containing a display `name` and same-origin or HTTPS `manifestUrl`. Users can also register personal manifests from the profile decorator; those registrations sync only in private Aimtrix account data.

A pack manifest uses this bounded format:

```json
{
  "name": "My original pack",
  "description": "Optional author note",
  "stickers": [
    { "id": "wave", "name": "Hello wave", "src": "./wave.svg" }
  ]
}
```

Aimtrix accepts at most 48 valid, uniquely identified items per pack. Sticker sources may be relative to the manifest, same-origin, HTTPS, or authenticated `mxc://` media; unsafe protocols and malformed items are discarded. Manifests are fetched without credentials and only when a user opens that pack. The manifest host must permit browser CORS.

Configured and personally registered manifests are an artwork trust boundary: they can cause a browser to request images from their declared HTTPS origins and may reveal the user's IP address to those hosts. Install packs only from trusted authors. Packs should contain original or properly licensed art; do not redistribute third-party chat artwork without permission.

## Kubernetes shape

A typical homelab deployment needs only:

- one `ConfigMap` containing `config.json`;
- one stateless `Deployment` exposing container port `8080`;
- one `ClusterIP` service;
- one TLS ingress;
- liveness and readiness probes using `/_health`;
- CPU and memory requests/limits.

Mount only the configuration file using `subPath`:

```yaml
volumeMounts:
  - name: config
    mountPath: /usr/share/nginx/html/config.json
    subPath: config.json
    readOnly: true
```

No Synapse PVC changes are required to deploy the client. GIFs, stickers, attachments, profile banners, and custom conversation backdrops consume homeserver media storage when uploaded. Operators should set Synapse media retention, quotas, and upload limits appropriate to their storage. Backdrop media and namespaced room/account state are not E2EE and should be treated as non-sensitive decoration.

Aimtrix's shared backdrop permission selector writes a threshold for `dev.alucard.aimtrix.room_background.v1` into standard `m.room.power_levels`. Threshold 25 is presented as the Decorator role, 50 remains Moderator, and room administrators retain their existing level. Power levels apply to every event and moderation action at or below that number, not only Aimtrix decoration. Administrators should inspect custom room thresholds before assigning Decorator. Space backdrops are state on the space itself and do not grant space members additional authority in child rooms.

## Calling

Calling controls appear only when `features.calls` is true. Aimtrix currently supports interoperable one-to-one Matrix VoIP calls: incoming/outgoing state, answer/reject, voice/video, mute, selected camera/microphone/speaker, screen sharing, hangup, notifications, and browser picture-in-picture through video controls.

A homeserver should provide working TURN credentials through the Matrix Client-Server API; direct peer connectivity is not reliable across NAT. Aimtrix displays discovered `org.matrix.msc4143.rtc_foci` entries in Matrix settings, but group MatrixRTC/LiveKit calls are not yet started by this release. Operators needing group calls should provide a LiveKit/JWT focus and retain another MatrixRTC client until that TODO is complete.

## Content Security Policy

The bundled nginx policy permits HTTPS and secure WebSocket connections to arbitrary origins because Aimtrix can log into arbitrary homeservers. It still prohibits third-party scripts. A single-homeserver operator may replace `https:` and `wss:` in `connect-src` with explicit homeserver and RTC origins, and similarly restrict media origins.
