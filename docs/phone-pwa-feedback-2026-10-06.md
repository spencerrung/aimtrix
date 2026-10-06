# Phone PWA feedback — October 6, 2026

This pass follows physical-iPhone feedback on RC6. Existing browser passes missed important daily-use failures. Private screenshots and their room contents are not test fixtures.

## Acceptance contract

| Report | Required behavior and regression evidence |
| --- | --- |
| Oversized interface | More visible conversations and timeline content at 320, 390 and 430 CSS pixels. Search and filtering share one row; header, rail, bottom navigation and avatar gutters shrink while primary targets remain 44px. Preserve pinch zoom and explicit message-size preferences; editable text remains at least 16px to avoid focus zoom. |
| Blurred top edge | Keep app content below the safe area, use an opaque iOS status-bar request and opaque page/header background, and prevent document scrolling beneath the system edge. Exercise safe-area and visual-keyboard offsets. Physical installed-iOS blur must be checked separately; desktop WebKit does not emulate the system status bar. |
| Missing image reactions | Search and select configured image emoji, including Bufo entries, from room and thread reactions. Send a real standard Matrix annotation, preserve labels, render authenticated media, and remove the exact existing reaction. Keep provider/pack assets lazy and media preferences respected. |
| Stuck return to latest | An explicit latest transition owns viewport reconciliation until the fresh live snapshot arrives. A stale scroll callback cannot detach it again. Failures expose retry; switching rooms invalidates old completion. Test the controller/UI race and the browser button disappearing after success. |
| Attachment form occupies conversation | Render local thumbnail cards inside the message composer, with one Send action for text/files. Keep removal, captions, ordering, retry/cancel and upload state available without a permanent separate form. Verify room and thread composition with one/multiple files and the keyboard open. |

## Layout and status-bar decisions

The phone conversation header decreases from 64px to 52px; bottom-navigation targets decrease from 56px to 44px. Tall timeline images are bounded to 260px/38dvh and remain openable in the existing viewer. Search and conversation filtering share a row, while a 50px buddy row preserves readable text and avatar context. These changes reduce chrome and padding instead of shrinking the entire page or disabling zoom.

The app frame owns the safe-area inset once and is fixed to the tracked visual viewport. The document itself does not scroll. The status-bar meta value requests opaque black as documented by [Apple](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html); content uses the [WebKit safe-area contract](https://webkit.org/blog/7929/designing-websites-for-iphone-x/). Installed-iOS behavior can differ from browser emulation, so the physical-device outcome remains explicit in release evidence.

## Validation record

The local integrated unit/build gate passed 1,160 tests in 106 files, lint, TypeScript and bundle budgets. A focused production Chromium run passed 38 applicable checks with 16 intentional platform skips; the reviewed 320/390px visual baselines and keyboard attachment screenshots cover layout and reachability. The new custom-MXC check passed as part of a disposable Synapse core journey (46 checks), including authenticated retrieval and receiver reload. Independent review also verified concurrent attachment edits and attachment-only history return; regression tests exercise the actual workspace.

[PR #258](https://github.com/spencerrung/aimtrix/pull/258) records final full browser, hosted, local endurance and deployment results with source revisions. The longer profiles remain full length and run outside hosted Actions. Earlier RC6 passes do not establish that these reported failures were fixed. Physical installed-iOS status-bar blur and independent-client custom-image presentation remain separate acceptance boundaries.
