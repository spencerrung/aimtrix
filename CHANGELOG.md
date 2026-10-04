# Changelog

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
