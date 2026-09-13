# Accessible interaction foundations

Roadmap [Polish 04 / #144](https://github.com/spencerrung/aimtrix/issues/144) implements the focus and feedback contract from [the design rules](design/interaction-rules.md). It preserves the existing Aqua, Graphite and Midnight presentation.

## Shared behavior

- `Dialog` uses native modal dialogs for top-layer stacking and background inertness. Tab and Shift+Tab stay inside; Escape dismisses the current surface. Initial focus uses an enabled, visible control, with an explicit safe-action override. Closing restores the opener or a visible control in the remaining dialog/conversation.
- `DialogClose` and `useDialogBusy` keep a submitting dialog open until its result is available. Settings, room creation, profile editing, backdrop editing and the image viewer use the shared dialog. Nested device verification and destructive confirmations use the same mechanism.
- `Popover` gives reaction, emoji, sticker and GIF pickers normal form navigation, initial focus, outside dismissal and Escape return. Its tested menu option adds Arrow/Home/End navigation for action lists; these form pickers retain ordinary input semantics. Message-action redesign remains #152.
- Drawer tabs have one tab stop, Arrow/Home/End selection and a named tab panel. Settings sections and conversation-type controls remain ordinary buttons rather than declaring incomplete tab semantics.
- `ConfirmDialog` starts on Cancel, prevents duplicate submission, keeps errors available for retry and protects an operation already submitted. It covers device sign-out, account deactivation, message deletion, member removal/ban, leaving a room and enabling room encryption.

## Action feedback and cancellation

Failed invitations keep the entered Matrix ID and announce the failure in the currently visible drawer. Room actions disable conflicting controls while pending. Room creation announces an empty directory result and successful completion. Profile/banner/pack operations retain edits on failure and protect pending uploads. Clipboard and reaction failures have readable feedback.

Matrix settings serialize operations through a synchronous submission latch. Device-removal UIA announces the password requirement and focuses the revealed input; a rejected password stays available to correct. Profile success is cleared when edited again. Signed-in decorated-profile saves await the Matrix account-data acknowledgement before closing the editor; failure keeps the draft available for retry. Writes are ordered per originating Matrix client; shutdown clears queued fallback saves, and a changed session cannot receive an earlier account’s queued decorations. Demo changes remain local.

Verification is cancellable while waiting for remote acceptance, emoji display, or peer confirmation. Cancellation travels through an optional AbortSignal into the Matrix controller, cancels the SDK request and removes phase listeners/timers. Closing settings aborts waiting verification. Late completion after cancellation cannot announce success or dismiss a newer verification. This changes lifecycle handling, not supported verification methods; incoming verification and QR flows remain #161.

## Validation boundary

Component/controller tests cover nested dismissal, safe initial focus, pending destructive actions, retries, failed invite retention, directory empty state, menu keyboard selection, verification cancellation phases, late confirmation, and device-removal UIA. JSDOM supplies only a minimal dialog shim; browser modality and geometry are checked in Chromium.

Browser checks exercise desktop and Pixel 7 layouts, all three themes, reduced motion, focus containment/return and Axe for settings, room creation, profiles and backdrops. Screenshot review includes the mobile profile save action and its focus outline. The migrated surfaces also received contrast fixes and an accessible name for the motion selector.

The disposable Synapse/Dex harness exercises the changed room/backdrop/moderation and acknowledged private-profile save flows with real encrypted sessions. It does not yet exercise a second client's live SAS UI, device-removal UIA, account deactivation, or recovery. Verification and those settings flows have mock/controller evidence here. Spoken NVDA/VoiceOver output and physical-device input remain manual acceptance under #162/#175; DOM live-region assertions are not a spoken screen-reader audit.

September 13, 2026 local validation on the implementation working tree:

- `npm run check`: lint, TypeScript, 226 tests in 31 files, production build and bundle budgets passed. The expected crypto chunk-size warning remains.
- `npm run test:e2e`: 36 passed, 6 intentional project-specific skips. Desktop/mobile screenshots were inspected; the new modal checks passed Axe in all themes. The landscape test now waits for acknowledged timeline detachment before measuring resize preservation.
- `npm run test:matrix -- --repeat=2`: two fresh runs passed 13/13 checks each; cleanup completed. The new check proves the acknowledged profile preset and rejects another user's account-data read.
- `npm run test:matrix:privacy`: 3/3 privacy/allowlist checks passed. Diagnostics remain fixed labels and numeric metrics.
- Measured local send/receive latency was 260/254 ms and shared-backdrop latency 447/405 ms. These are observations, not service guarantees.

Committed CI results are recorded with the implementation PR. Local reports precede the commit; CI establishes evidence for its actual checkout revision.
