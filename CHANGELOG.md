# Changelog

## 0.3.0-rc.4 — 2026-10-04

PWA device-testing candidate replacing `0.3.0-rc.3` after the first hosted feedback pass.

- Replace repeated outgoing delivery prose with accessible server-sent and receipt-backed read marks, while keeping failed sends recoverable.
- Open captioned images from authenticated original media, with an explicit failure and retry state instead of a cropped thumbnail.
- Fit the buddy-list filter, give Home activity room identity and safe formatted previews, make live nudges perceptible within sound/motion settings, and restore reading anchors across live room and DM switches.

The prior homelab image `v0.3.0-rc.3` remains available for rollback. Physical-device and provider-specific acceptance remains open.

## 0.3.0-rc.3 — 2026-10-04

PWA device-testing candidate replacing `0.3.0-rc.2`.

- Clear remote group-call video when a screen-share publication ends. The disposable two-browser LiveKit journey now checks camera and synthetic screen publication, subscription, and cleanup in both compatibility and Matrix 2.0 modes.
- Extend disposable cross-homeserver account isolation and delegated-auth refresh/revocation evidence. The remaining physical-device, real-provider, and broader interoperability acceptance criteria stay open in the roadmap.

The prior homelab image `v0.3.0-rc.2` remains available for rollback, as does the earlier known-good `v0.2.6` image.

## 0.3.0-rc.2 — 2026-10-04

PWA device-testing candidate replacing `0.3.0-rc.1`.

- Allow same-origin geolocation in the hosted response policy, so the location picker can request device position after browser permission. Manual coordinates remain available if permission is denied.
- Assert the deployed HTML and health response policies in the multi-architecture container smoke test.
- Let the tag-driven desktop draft workflow use an already matching package version. Desktop promotion still requires its separate physical-device gate.

The prior known-good homelab image remains immutable `v0.2.6`; `0.3.0-rc.1` also remains available for comparison. The physical-device and provider-specific acceptance boundaries listed below remain open.

## 0.3.0-rc.1 — 2026-10-04

PWA release candidate for homelab and physical-device acceptance. This is the first candidate after the 0.2.6 release and includes the modernization work merged through `2dbd6ee`.

### Added

- A unified conversation shell, stronger room and thread navigation, Home catch-up, private read state, saved collections, and encrypted local history search.
- Shared room and thread messaging tools, richer safe formatting, polls, static locations, voice recording, and media navigation.
- Delegated Matrix OAuth sign-in, first-use encryption guidance, recovery and verification improvements, and isolated multiple-account switching.
- Opt-in encrypted MatrixRTC group calls with modern sticky membership and standalone token support. The compatibility call mode remains the default.
- Browser, disposable Synapse, Element peer, native-adapter, large-account, and multi-architecture container verification coverage.

### Release boundaries

- This candidate is for the hosted PWA. Desktop and mobile installation/promotion still require their separate signed-artifact and physical-device gates.
- Actual device acceptance, provider-specific SSO and push, broader cross-homeserver/client interoperability, and TURN-required call routing remain open in `TODO.md` and the linked acceptance documents.
- Operators can restore the previous immutable `v0.2.6` image if this candidate fails on their deployment.
