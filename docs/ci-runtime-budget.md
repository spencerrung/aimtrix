# CI runtime budget

The target is for each hosted workflow’s execution critical path to finish within ten minutes, excluding GitHub queue time. Each job also has a ten-minute ceiling. Successful runs need headroom below that ceiling, including setup, dependent jobs and evidence upload. A timeout is a failed validation, never a substitute for reducing or splitting the workload. Queue time is separate from execution time. No self-hosted runner is configured or assumed.

## Routine checks

Quality runs lint, all unit tests, the production build, release-contract validation and privacy/feasibility proofs. Chromium browser coverage runs in two independent shards; Firefox runs two shards and WebKit runs three shards. Playwright's fully parallel test distribution partitions the existing complete project/test set without changing assertions, retries or intentional platform skips. Every shard builds the static client and keeps separately named failure evidence. The stable `check` status aggregates static checks, every browser shard, mobile-shell checks and dependency review. It fails when a required gate fails, is cancelled or is skipped; dependency review is allowed to skip only on pushes. Require `check` in branch protection.

New pushes cancel obsolete Quality and desktop validation runs. Release publication retains serialization rather than cancelling a partially published release.

The October 8 integration expands the compatibility set to 174 WebKit cases, including 44 composition and 32 popover cases. Three WebKit shards retain all 174 cases (58 each); Firefox retains 87 cases across two shards and Chromium retains 354 across two shards. The job ceiling, test assertions, retries and intentional platform skips remain unchanged.

### Measured starting point

The October 6 captured pre-split jobs measured Quality/check 465 seconds and WebKit 496 seconds. Desktop debug jobs in run `37400522435` took Linux 109 seconds, macOS 104 seconds and Windows 170 seconds. Those cached debug builds do **not** establish signed release or cold Rust build timing. Browser sharding and separating Chromium from the unit/build gate provide headroom rather than relying on the ceiling alone.

Live Matrix run `37400522407` measured two core journeys at 1,509 seconds total, Element at 1,260 seconds, sustained sync at 674 seconds, encrypted sustained sync at 681 seconds, and the large-account profile at 1,682 seconds. Ten-minute observation windows cannot fit inside ten-minute jobs after setup. They remain full-length local release evidence, not shortened PR checks. Synthetic 10,000-room rendering remains a short routine check (22 seconds in that run).

### Native release packaging

Signed Linux release run `37236051078` took 595 seconds in its build job, plus a four-second selector and 18-second asset audit. Its log records 273 seconds of optimized Rust compilation, about 68 seconds of AppImage packaging, two seconds for deb and 158 seconds for RPM. The Linux matrix now packages AppImage/deb and RPM in parallel, retaining compiler settings and all signed formats. Only the AppImage/deb job publishes the Linux updater metadata; RPM publishes its installer and signature. The final asset audit waits for every platform/package job.

The [revised RC6 Linux release run](https://github.com/spencerrung/aimtrix/actions/runs/37406279642) passed in 559 seconds from selector start through the final asset audit: AppImage/deb took 469 seconds, RPM 526 seconds and the audit 22 seconds. The preceding combined RC6 Linux job took 631 seconds before its audit. The split therefore brings the measured full Linux execution path below ten minutes. Cold caches, macOS signing/notarization and Windows signing require their own timings. No cold or signed platform is certified under budget by a warm desktop debug result. A cancelled or timed-out build remains failed release evidence.

## Full local endurance acceptance

Use a clean checkout of the release candidate on a machine with Node 22+, Docker/Compose, available loopback ports and sufficient memory for disposable Synapse/Postgres plus Chromium. Do not point the harness at production services. Avoid concurrent profiling runs so CPU contention does not invalidate measurements. The October 6 phone-feedback pass provisioned a temporary, user-owned rootless Docker 29.8.2 / Compose 5.6.0 daemon for disposable local validation. No system Docker service, production Matrix service or cluster configuration is involved. Retain the RC6 full CI profile evidence for historical comparison. The RC7 local results below now provide plain and encrypted sustained-sync evidence, while explicitly retaining the failed 10,000-room readiness gate.

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
npm run test:matrix:privacy
npm run test:matrix:endurance
```

The endurance command runs unchanged ten-minute plain and encrypted sync windows, then the 10,000-room initial-sync/history/sustained-delivery profile. It fails on the first failed profile, preserves its allowlisted JSON summary, and cleans up owner-labelled disposable services. It does not turn a shorter sample into endurance evidence. To rerun one profile:

```sh
npm run test:matrix -- --profile-sustained-sync
npm run test:matrix -- --profile-encrypted-sustained-sync
AIMTRIX_LIVE_ROOM_COUNT=10000 AIMTRIX_LIVE_SUSTAINED=1 npm run test:matrix -- --profile-large-account
```

For every release candidate, attach `sustained-sync-1.json`, `encrypted-sustained-sync-1.json`, and `large-account-1.json` from `matrix-test-results/` to the release evidence. Record the exact commit, date, host CPU/memory/OS, elapsed duration, pass/fail and any missing profile. The reports already include revision/host and numeric measurements. Keep previous release results available for comparison. Never upload service databases, credentials, browser storage, room traces or unrestricted container logs. A missing local run remains an explicit release acceptance gap; green PR jobs do not imply endurance completion.

If an Actions job approaches eight minutes, examine step timings and split independent work before it hits the ceiling. Cold native builds and signed packaging must be measured independently; if they cannot complete within budget, run them on a provisioned capable machine and retain signed artifacts, checksums and exact-source provenance. Do not invent a self-hosted label or silently skip native packaging to obtain a green release.

## First revised run

Run `37406251487` measured Chromium shards at 221/214 seconds, Firefox at 93/99 seconds and WebKit at 340/295 seconds. Static checks exposed a missing Chromium installation for the scheduling proof; the workflow now installs it explicitly. Live run `37406251552` passed delegated authentication (156 seconds), RTC (133 seconds), cache reload (74 seconds) and synthetic scale (70 seconds), but core/Element hit the eight-minute command deadline during or shortly after the encrypted-history fixture. Those timeouts were failed evidence and required further optimization; they are retained here alongside the later RC7 results below.

## Live journey partitions

Hosted core and history profiles each run on two independent clean stacks. Core keeps every non-history assertion; the separate history profile runs its six setup/retry prerequisites plus encrypted history/context, private encrypted search, withheld-key guidance, Matrix-link navigation and thread-history checks. Element runs the core profile including all independent Element checks. The default local `npm run test:matrix` still executes the complete journey; no flag silently changes that default.

The history fixture sends 350 encrypted events through the real composer, exceeding the 250-row render bound while preserving context anchors 20, 40 and 240 and keeping both navigation targets outside the initial live window. Exact ordered manifests fail a run if a selected check is missing, duplicated or unexpected. A source/manifest regression test verifies that the union of hosted partitions covers every default check. Reports name the selected profile and include the final coverage check. Both profile replicas must pass. Existing assertion bodies, encryption and history navigation remain unchanged. The eight-minute command watchdog leaves time for owner-scoped cleanup and allowlisted summary uploads within the ten-minute job ceiling.


## Final RC7 measured results

The completed October 6 Actions runs were checked through their read-only job timestamps. All four workflows below concluded successfully. These are measured results for the recorded runs, not guarantees for cold caches or other platforms.

| Workflow | Measured result |
| --- | --- |
| [Quality 37480220402](https://github.com/spencerrung/aimtrix/actions/runs/37480220402) | Slowest job: WebKit shard 2, **6m25s**. First job start through the final aggregate check: **6m34s**. |
| [Live Matrix 37480220401](https://github.com/spencerrung/aimtrix/actions/runs/37480220401) | Slowest job: history replica 1, **6m18s**. First job start through final completion: **6m31s**. |
| [Linux release 37488090198](https://github.com/spencerrung/aimtrix/actions/runs/37488090198) | Selector start **15:30:33 UTC** through asset-audit completion **15:38:43 UTC**: **8m10s** total. RPM: **6m11s**; AppImage/deb: **7m32s**. |
| [Image publication 37488228473](https://github.com/spencerrung/aimtrix/actions/runs/37488228473) | Verification/publication job: **2m15s**. |

The elapsed workflow spans include the observed gaps between dependent jobs; queue time before the first job starts is excluded. The Linux release measurement includes its selector and final asset audit, rather than reporting only the longest packaging job. Signed macOS/Windows and cold-cache execution still require their own evidence.

Local RC7 plain and encrypted sustained-sync profiles each passed their full **300-event, at-least-600-second** workload. The local 10,000-room profile failed full-room readiness at **364,467 ms** against its unchanged **300,000 ms** ceiling. That failure was explicitly disclosed in [PR #258](https://github.com/spencerrung/aimtrix/pull/258) and the [RC7 release](https://github.com/spencerrung/aimtrix/releases/tag/v0.3.0-rc.7); [#259](https://github.com/spencerrung/aimtrix/issues/259) remains pending. Green hosted workflows do not clear this local scale gate or establish completion of the later 10,000-room history/sustained phases. See the [large-account record](large-account-performance.md#october-6-2026-controlled-live-recheck) for the failure and diagnostic comparison.
