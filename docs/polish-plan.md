# Aimtrix polish and modern comforts

Status: implementation roadmap · September 11, 2026

Tracking issue: [#140 — ordered implementation program](https://github.com/spencerrung/aimtrix/issues/140)

Step 02 deliverable: [Aqua/Aero visual references and interaction rules](design/interaction-rules.md), including a standalone interactive prototype, responsive/theme samples, and an issue-mapped implementation contract. Reference QA is separate from shipped-client and live Matrix acceptance.

## Product goal

Aimtrix should be a dependable daily Matrix client that people enjoy spending time in. Preserve its full-viewport hosted experience, roughly 65/35 Aqua-era character versus modern behavior, original Aero artwork, playful space rail, buddy list, personality drawer, foundational E2EE, and static self-hosting.

The next implementation program makes everyday journeys complete: catching up, composing across interruptions, following conversations, finding older information, and understanding whether an action worked. Glass, gloss, candy accents, backdrops, and expressive profiles remain part of the product.

The initial audience decision is to prioritize shared daily needs across friends, communities, and work teams; the expansion work can be reordered when audience feedback clarifies demand. No calendar estimates are implied.

## Scope and existing commitments

Issues 01–24 define the proposed **polished daily-client target**. Issues 25–34 preserve compatibility work and organize additional capabilities or bounded product decisions. Issues 35–36 preserve native-release and live-provider acceptance obligations. Sequence numbers express preferred implementation order, not severity, deadlines, or a requirement to finish every earlier issue first.

This roadmap supplements [TODO.md](../TODO.md). It does not reset completed work or silently remove earlier release, protocol, platform, or deployment commitments. A later sequence number does not waive an existing acceptance requirement.

The repository already contains Tauri desktop and Capacitor mobile foundations. Their remaining device, signing, distribution, and interoperability requirements remain governed by [desktop guidance](desktop.md), [mobile guidance](mobile.md), and the [platform acceptance matrix](platform-acceptance.md). Planning must reconcile older backlog descriptions with these implementations before creating replacement work.

## Evidence and uncertainty

The planning review examined repository source, architecture, tests, and backlog; included independent source review; exercised the local demo in desktop Chromium and Pixel 7 emulation; and inspected screenshots of conversations, threads, settings, navigation, and mobile composition.

The review identified these priorities:

| Finding | Evidence boundary | Planned response |
| --- | --- | --- |
| Event failure may appear as generic pending/sending | Source-supported concern requiring targeted reproduction | Explicit event states and retry/cancel behavior |
| Older history may become inaccessible despite pagination and a 250-event display limit | Source-supported concern requiring targeted reproduction | Movable bounded history and event-context retrieval |
| Signed-in sync errors may lose useful distinctions | Source-supported concern requiring targeted reproduction | Offline, reconnect, expiry, and recovery states |
| Drafts live in React state and do not survive reload | Implementation limitation | Account-scoped durable structured drafts |
| Search covers loaded messages | Implementation limitation | Dedicated search with explicit server/local coverage |
| Thread composition has fewer tools than room composition | Implementation limitation | Shared composer and contextual draft state |
| Dialog behavior lacks consistent shared focus management | Implementation limitation | Accessible primitives applied to real workflows |
| Thread and details surfaces compete for conversation space | Local demo observation | Deliberate contextual panels and mobile routes |

The audit did not run the full quality suites, authenticate against a live homeserver, prove provider push delivery, exercise live calls, or validate native devices. Local demo and mocked behavior do not establish protocol interoperability.

The [capability baseline](capability-baseline.md), produced under issue 01, records implementation status separately from validation status. Use **implemented / partial / absent** for behavior and **mocked / browser-verified / live-verified / untested** for evidence, with dated references where available.

## Behavioral references

Borrow useful behavior from mature chat products while retaining original visual assets and Aimtrix's character.

| Reference | Behavior to adapt |
| --- | --- |
| [Slack Activity](https://slack.com/help/articles/19693583638803-Get-your-work-done-from-the-Activity-view) | One clear place to review relevant mentions, conversations, and threads |
| [Slack messaging and drafts](https://slack.com/help/articles/201457107-Send-and-read-messages) | Unfinished composition stays recoverable and findable |
| [Slack Later](https://slack.com/help/articles/360042650274-Save-messages-and-files-for-later) | Saving something provides a reliable path back to its context |
| [Discord Quick Switcher](https://support.discord.com/hc/en-us/articles/115000070311-Quick-Switcher) | Fast keyboard navigation among people, rooms, and spaces |
| [Discord Server Guide](https://support.discord.com/hc/en-us/articles/13497665141655-Server-Guide-FAQ) | Communities explain their purpose and offer a clear first conversation |
| [Mattermost threads](https://docs.mattermost.com/end-user-guide/collaborate/organize-conversations) | Conversations remain easy to follow and resume outside the main timeline |
| [Mattermost saves and pins](https://docs.mattermost.com/end-user-guide/collaborate/save-pin-messages) | Personal follow-up and shared room reference material have distinct homes |

These references describe direction, not a commitment to reproduce every feature or interface.

## Visual and interaction direction

Give the conversation first claim on available space. At ordinary desktop widths, threads, search, and room details share a contextual side panel. An exceptionally wide layout may support an explicit user-controlled multi-panel option. Closing a surface restores useful prior context.

Mobile follows deliberate list → conversation → thread/details routes with predictable Back behavior and restored scroll and draft state. Keep the composer reachable with the software keyboard open. Decide whether the rail remains visible during typing from measured usable height and navigation testing.

Establish consistent typography, spacing, borders, shadows, icon sizing, pressed/disabled states, and visible focus. Make conversation text and unread indicators the strongest reading cues. Validate grouped busy-room messages and expressive DM bubbles against existing preferences before changing their presentation.

Move role management behind member actions and secondary composition tools into a discoverable menu. Preserve touch and keyboard access. Keep security and destructive language precise; playful copy and motion belong in low-stakes moments.

The personality drawer remains useful for presence, self-expression, room atmosphere, and shared media. Existing profile decoration is private account data. Public decoration requires a separate audience, storage, and interoperability decision.

Issue 02 produces desktop conversation, desktop thread, and mobile conversation references with busy, empty, and failure states before broad styling changes. Each subsequent slice applies these references and includes screenshot inspection.

## Work packages

### A. Conversation trust and interaction foundations

Complete event sending/failure/decryption states, reliable retry and cancellation, actionable session failures, bounded history navigation, old-event context, and accessible feedback. Preserve new typing when an earlier send fails and preserve reading position when media or new events arrive.

Extract common dialogs, menus, and view-model responsibilities as real workflows require them. A broad architectural rewrite is not an entry requirement.

### B. Navigation and catching up

Deliver the responsive shell, quick switcher, favorites, navigation history, unread filters, mark-read/mark-unread, old thread retrieval, and a purposeful Home/thread activity view. Define badge semantics and private read bookkeeping once, including cross-device reconciliation and muted rooms.

Deep links, reply links, notification routes, and activity entries must open actual event context. Rendering a search result or background panel must not silently mark its room read. Label incomplete activity coverage truthfully.

### C. Composition across interruptions

Unify room/thread tools and account-scoped structured drafts, including mention identities, reply/edit context, visible draft indicators, and a draft list. Define local persistence, storage-failure behavior, successful-send cleanup, account isolation, and logout deletion.

Add staged attachments with previews, multiple files, removal, progress, cancellation, and individual retry. Preserve authenticated media, encryption, lazy loading, data saver, touch access, keyboard shortcuts, and IME behavior. Durable text drafts do not imply indefinite persistence of attachment bytes.

### D. Finding and revisiting information

Build a shared safe message renderer and consistent actions, browsable saved messages/pins/files/media/links, and dedicated filtered search. Results paginate, cancel, explain coverage, and return to context outside the live tail. Redacted or inaccessible content has useful fallbacks.

Server-backed search and encrypted local search are distinct implementations. E2EE content must not leave the device for plaintext indexing. Define indexing/backfill coverage, key availability, storage limits, progress, cleanup, and account isolation before claiming full-history encrypted search.

### E. Notifications, onboarding, and account confidence

Complete all/mentions/nothing and thread notification choices, keyword rules, DND, troubleshooting, deduplication, and route handling. Preserve the accepted [event-ID-only push architecture](push-architecture.md); foreground notifications and closed-app delivery carry different evidence requirements.

Guide server-aware login, empty accounts, first encrypted conversation, verification, and recovery. Include incoming verification, QR, withheld-key/key-request diagnostics, secret-sharing approval, and recovery reset guidance. Protocol actions include appropriate UIA, loading/error/success states, and refreshed server state.

### F. Compatibility and expansion

Retain community welcome/discovery/moderation and advanced room/space administration; polls; locations; voice messages and richer media; MatrixRTC group calls; public-profile design; multiple accounts; scheduling/reminder feasibility; integrations discovery; and delegated OIDC compatibility.

Advanced administration includes aliases, history visibility, join rules/knocking, guest access, room upgrades, server ACLs, suggested children, canonical parents, and removal from every space. Group calls include membership/focus authorization, devices, participants, reconnect behavior, and E2EE indicators.

Public profiles, scheduling, and integrations begin with explicit decisions rather than visible placeholders. Scheduling must define delivery when the application is closed. OIDC compatibility and independently useful expansion can proceed earlier when capacity and dependencies permit.

## Ordered issue index

Priority uses the existing GitHub labels: **P0** foundational/blocking, **P1** important daily-client or compatibility work, **P2** additive expansion. The tracker checklist is the editable execution queue.

| Order | Issue | Track | Prerequisites |
| --- | --- | --- | --- |
| 01 | [#141 — Reconcile the capability backlog and validation evidence](https://github.com/spencerrung/aimtrix/issues/141) | Core / baseline · P0 | Independent |
| 02 | [#142 — Define Aqua/Aero visual references and interaction rules](https://github.com/spencerrung/aimtrix/issues/142) | Core / design · P0 | Independent |
| 03 | [#143 — Establish disposable live Matrix integration infrastructure](https://github.com/spencerrung/aimtrix/issues/143) | Core / validation foundation · P0 | Independent |
| 04 | [#144 — Unify accessible dialogs, menus and action feedback](https://github.com/spencerrung/aimtrix/issues/144) | Core / interaction foundations · P0 | [02](https://github.com/spencerrung/aimtrix/issues/142) |
| 05 | [#145 — Make message delivery failures actionable and retry-safe](https://github.com/spencerrung/aimtrix/issues/145) | Core / conversation trust · P0 | Independent |
| 06 | [#146 — Make bounded history navigable and support event context](https://github.com/spencerrung/aimtrix/issues/146) | Core / conversation trust · P0 | Independent |
| 07 | [#147 — Distinguish session expiry from connectivity failures](https://github.com/spencerrung/aimtrix/issues/147) | Core / conversation trust · P0 | Independent |
| 08 | [#148 — Apply the conversation-first desktop and mobile shell](https://github.com/spencerrung/aimtrix/issues/148) | Core / navigation · P1 | [02](https://github.com/spencerrung/aimtrix/issues/142), [04](https://github.com/spencerrung/aimtrix/issues/144) |
| 09 | [#149 — Unify unread state and private read bookkeeping](https://github.com/spencerrung/aimtrix/issues/149) | Core / attention · P1 | Independent |
| 10 | [#150 — Add quick switching, favorites and contextual navigation](https://github.com/spencerrung/aimtrix/issues/150) | Core / navigation · P1 | [04](https://github.com/spencerrung/aimtrix/issues/144), [06](https://github.com/spencerrung/aimtrix/issues/146), [08](https://github.com/spencerrung/aimtrix/issues/148), [09](https://github.com/spencerrung/aimtrix/issues/149) |
| 11 | [#151 — Complete thread root retrieval and history navigation](https://github.com/spencerrung/aimtrix/issues/151) | Core / threads · P1 | [06](https://github.com/spencerrung/aimtrix/issues/146), [08](https://github.com/spencerrung/aimtrix/issues/148), [09](https://github.com/spencerrung/aimtrix/issues/149) |
| 12 | [#152 — Unify message rendering and contextual actions](https://github.com/spencerrung/aimtrix/issues/152) | Core / message presentation · P1 | [04](https://github.com/spencerrung/aimtrix/issues/144), [06](https://github.com/spencerrung/aimtrix/issues/146) |
| 13 | [#153 — Unify room and thread composition with durable drafts](https://github.com/spencerrung/aimtrix/issues/153) | Core / composition · P1 | [04](https://github.com/spencerrung/aimtrix/issues/144), [05](https://github.com/spencerrung/aimtrix/issues/145), [08](https://github.com/spencerrung/aimtrix/issues/148) |
| 14 | [#154 — Stage and manage multiple encrypted attachments](https://github.com/spencerrung/aimtrix/issues/154) | Core / media composition · P1 | [05](https://github.com/spencerrung/aimtrix/issues/145), [13](https://github.com/spencerrung/aimtrix/issues/153) |
| 15 | [#155 — Build Home catch-up and followed-thread activity](https://github.com/spencerrung/aimtrix/issues/155) | Core / attention · P1 | [09](https://github.com/spencerrung/aimtrix/issues/149), [10](https://github.com/spencerrung/aimtrix/issues/150), [11](https://github.com/spencerrung/aimtrix/issues/151) |
| 16 | [#156 — Add personal saves and browsable room collections](https://github.com/spencerrung/aimtrix/issues/156) | Core / retrieval · P1 | [10](https://github.com/spencerrung/aimtrix/issues/150), [12](https://github.com/spencerrung/aimtrix/issues/152) |
| 17 | [#157 — Add filtered history search with exact context jumps](https://github.com/spencerrung/aimtrix/issues/157) | Core / search · P1 | [10](https://github.com/spencerrung/aimtrix/issues/150), [12](https://github.com/spencerrung/aimtrix/issues/152) |
| 18 | [#158 — Implement privacy-aware local search for encrypted history](https://github.com/spencerrung/aimtrix/issues/158) | Core / search · P1 | [06](https://github.com/spencerrung/aimtrix/issues/146) |
| 19 | [#159 — Complete notification controls and delivery troubleshooting](https://github.com/spencerrung/aimtrix/issues/159) | Core / notifications · P1 | [07](https://github.com/spencerrung/aimtrix/issues/147), [09](https://github.com/spencerrung/aimtrix/issues/149), [10](https://github.com/spencerrung/aimtrix/issues/150) |
| 20 | [#160 — Guide login, first conversation and recovery setup](https://github.com/spencerrung/aimtrix/issues/160) | Core / onboarding · P1 | [04](https://github.com/spencerrung/aimtrix/issues/144), [07](https://github.com/spencerrung/aimtrix/issues/147) |
| 21 | [#161 — Complete incoming verification and decryption recovery](https://github.com/spencerrung/aimtrix/issues/161) | Core / encryption confidence · P1 | [04](https://github.com/spencerrung/aimtrix/issues/144), [07](https://github.com/spencerrung/aimtrix/issues/147), [20](https://github.com/spencerrung/aimtrix/issues/160) |
| 22 | [#162 — Expand browser, keyboard and accessibility acceptance](https://github.com/spencerrung/aimtrix/issues/162) | Core / ongoing validation · P1 | Independent |
| 23 | [#163 — Profile large accounts and long-running conversations](https://github.com/spencerrung/aimtrix/issues/163) | Core / scale · P1 | Independent |
| 24 | [#164 — Verify the polished daily-client release journeys](https://github.com/spencerrung/aimtrix/issues/164) | Core / acceptance gate · P1 | 01–23: all core work |
| 25 | [#165 — Complete community onboarding and room administration](https://github.com/spencerrung/aimtrix/issues/165) | Expansion / existing compatibility · P2 | [04](https://github.com/spencerrung/aimtrix/issues/144), [10](https://github.com/spencerrung/aimtrix/issues/150), [20](https://github.com/spencerrung/aimtrix/issues/160) |
| 26 | [#166 — Add interoperable polls as a complete conversation feature](https://github.com/spencerrung/aimtrix/issues/166) | Expansion / social messages · P2 | [12](https://github.com/spencerrung/aimtrix/issues/152), [13](https://github.com/spencerrung/aimtrix/issues/153) |
| 27 | [#167 — Add explicit, private-by-default location sharing](https://github.com/spencerrung/aimtrix/issues/167) | Expansion / social messages · P2 | [12](https://github.com/spencerrung/aimtrix/issues/152), [13](https://github.com/spencerrung/aimtrix/issues/153) |
| 28 | [#168 — Add voice-message recording and richer media navigation](https://github.com/spencerrung/aimtrix/issues/168) | Expansion / media · P2 | [12](https://github.com/spencerrung/aimtrix/issues/152), [14](https://github.com/spencerrung/aimtrix/issues/154) |
| 29 | [#169 — Deliver group MatrixRTC calling with live interoperability](https://github.com/spencerrung/aimtrix/issues/169) | Expansion / existing compatibility · P2 | [04](https://github.com/spencerrung/aimtrix/issues/144), [07](https://github.com/spencerrung/aimtrix/issues/147), [08](https://github.com/spencerrung/aimtrix/issues/148) |
| 30 | [#170 — Decide a shareable profile-expression contract](https://github.com/spencerrung/aimtrix/issues/170) | Expansion / product decision · P2 | Independent |
| 31 | [#171 — Support isolated multiple Matrix accounts](https://github.com/spencerrung/aimtrix/issues/171) | Expansion / accounts · P2 | [07](https://github.com/spencerrung/aimtrix/issues/147), [10](https://github.com/spencerrung/aimtrix/issues/150), [13](https://github.com/spencerrung/aimtrix/issues/153), [19](https://github.com/spencerrung/aimtrix/issues/159) |
| 32 | [#172 — Decide reliable reminders and scheduled sending](https://github.com/spencerrung/aimtrix/issues/172) | Expansion / feasibility decision · P2 | [16](https://github.com/spencerrung/aimtrix/issues/156), [19](https://github.com/spencerrung/aimtrix/issues/159) |
| 33 | [#173 — Prioritize Matrix-native integrations and team workflows](https://github.com/spencerrung/aimtrix/issues/173) | Expansion / discovery decision · P2 | Independent |
| 34 | [#174 — Validate delegated OIDC and native authentication compatibility](https://github.com/spencerrung/aimtrix/issues/174) | Compatibility / existing backlog · P1 | [03](https://github.com/spencerrung/aimtrix/issues/143), [07](https://github.com/spencerrung/aimtrix/issues/147), [20](https://github.com/spencerrung/aimtrix/issues/160) |
| 35 | [#175 — Complete native desktop and mobile release evidence](https://github.com/spencerrung/aimtrix/issues/175) | Compatibility / platform validation · P1 | [07](https://github.com/spencerrung/aimtrix/issues/147), [10](https://github.com/spencerrung/aimtrix/issues/150), [19](https://github.com/spencerrung/aimtrix/issues/159), [22](https://github.com/spencerrung/aimtrix/issues/162) |
| 36 | [#176 — Verify live push delivery across browser and native providers](https://github.com/spencerrung/aimtrix/issues/176) | Compatibility / push validation · P1 | [19](https://github.com/spencerrung/aimtrix/issues/159) |

Start with the baseline and references, while the live harness, browser coverage and baseline profiling can run independently. Search-index implementation can start after history work; it coordinates the storage contract with 13 and integrates the results surface from 17 before completion. Native/provider gates 35–36 apply to their corresponding release claims.

## Dependency and execution rules

- Start the disposable Synapse/SSO harness, cross-browser/accessibility expansion, and baseline profiling alongside the audit and visual references. Add feature-specific scenarios as their behavior lands.
- History/context retrieval underpins reliable old-event routes, thread resumption, search, saves, and pins. Existing working routes remain available during this work.
- Agree unread/private-receipt semantics before finalizing Home/thread counts and notification behavior. Independent implementation can proceed once that contract is explicit.
- Draft persistence and cleanup contracts underpin shared composition and staging. Shared rendering and media handling underpin richer event types and voice messages.
- Local encrypted indexing can proceed alongside search presentation once history and storage contracts exist. Search must expose incomplete coverage honestly during rollout.
- Build call test infrastructure independently of call UI work. Live group-call acceptance requires both the protocol implementation and Synapse/LiveKit/TURN infrastructure.
- Native evidence gates the corresponding native release; provider evidence gates closed-app delivery claims. Their availability does not block unrelated browser polish.
- Treat stated issue dependencies as required inputs. Treat sequence and related-issue links as coordination guidance. Do not create a single serial chain through all 36 issues.

Implement substantial coherent slices that include protocol behavior, UI states, accessibility, regression coverage, visual review, and documentation. Avoid closing a slice because its first control renders.

## Architecture, privacy, and capability constraints

- Keep the deployable application static and runtime settings in validated public `config.json`. Optional integrations cannot require browser-held provider secrets.
- Keep SDK lifecycle ownership in `src/matrix/`; UI consumes view models/actions. Inspect SDK types/source before unfamiliar API work.
- Use standard Matrix events and supported SDK methods. Document unavoidable namespaced behavior and safe fallback in other clients.
- Never silently send plaintext into encrypted rooms. Preserve authenticated MXC retrieval and attachment encryption/decryption throughout changed media flows.
- Treat room content, profile data, tokens, recovery material, and provider credentials as private. Keep sensitive material out of logs, fixtures, issues, and evidence artifacts.
- Namespaced account data is not E2EE storage. Do not synchronize sensitive plaintext drafts or search indexes through it. Saved-reference and public-profile designs must document their metadata exposure.
- Keep optional catalogs and attachment crypto lazy, preserve bundle budgets, and clean up clients, local account data, temporary files, and object URLs through lifecycle changes.
- Every visible control completes its supported operation or exposes an honest unsupported state. Hide optional controls behind validated runtime capability/configuration where appropriate.

## Definition of done and evidence

The daily-client acceptance gate exercises these complete journeys:

1. First login, verification/recovery, and a first encrypted conversation.
2. Returning after a day away, catching up, and reconciling reads across devices.
3. Starting a DM and composing across room switches, thread switches, reload, and interruption.
4. Uploading encrypted media with cancellation, failure, and retry.
5. Following a thread and returning to old replies and surrounding history.
6. Retrieving an older message through search, saved items, pins, or links.
7. Tuning notifications and understanding permission, privacy, and delivery limits.
8. Recovering from offline, expired-session, storage, and undecryptable-event states.
9. Completing the applicable journeys with keyboard access and on a narrow touch layout.

For implementation batches, run focused regressions promptly, then `npm run check` and `npm run test:e2e`. Keep Vitest and Playwright suites separate and report intentional skips distinctly. Relevant push changes also run `npm run proof:push` and `npm run proof:push-sw`.

Inspect desktop/mobile screenshots, including all themes, empty/busy rooms, long content, expanded panels, reduced motion, and keyboard-sized viewports. Extend Firefox/WebKit coverage and perform manual keyboard/screen-reader review. Record actual browser/device coverage rather than inferring it from emulation.

Use disposable live Matrix accounts for multidevice E2EE, backup/restore, verification, media, threads, moderation, reads, and send/receive latency/backdrops. SSO/OIDC, provider push, TURN/LiveKit, and native targets require their own relevant infrastructure. Record unavailable boundaries explicitly; mocked proofs do not close live acceptance requirements.

Profile realistic large accounts, 10k-room workloads, and long-running sync. Introduce timeline virtualization if profiling justifies it; retain bounded rendering and crypto-aware bundle budgets throughout.

For container/release changes, build `linux/amd64` and `linux/arm64`, start the final image as its unprivileged user, verify `/_health` and response security headers, and check readable configuration/assets. Follow existing platform and release runbooks for signed native artifacts, upgrades, rollback, and physical-device validation.

## Maintaining the roadmap

GitHub issues own the detailed scope, dependencies, acceptance criteria, and current evidence. This document owns product direction, package boundaries, ordering guidance, and the issue index. [TODO.md](../TODO.md) remains the release/compatibility inventory.

When beginning an issue, reproduce its baseline, inspect current code and related closed work, and confirm that prerequisites still apply. When scope changes, update the issue and affected links rather than leaving abandoned requirements implicit.

Close implementation issues only when their acceptance criteria are satisfied and evidence is linked. An explicit follow-up issue may carry an unavailable target-specific live/device boundary, but the corresponding release claim remains gated and the tracker must show that limitation. Issue 24 remains open while any core acceptance criterion is unresolved, including required live password/standard-SSO and multi-device Matrix evidence. Native and provider evidence are separately gated by issues 35–36.

Update the tracker and TODO with implementation and validation status separately. Keep decision issues honest: a documented feasibility decision does not mean the proposed feature is implemented. Preserve deferred compatibility requirements in the inventory and review ordering after each coherent package.

Implementation authorization does not imply permission to publish, deploy, alter live infrastructure, or commit/push future changes. Follow the user instruction for each execution task and the repository contributor agreement.
