# CI runtime budget

The target is for each hosted workflow’s execution critical path to finish within ten minutes, excluding GitHub queue time. Each job also has a ten-minute ceiling. Successful runs need headroom below that ceiling, including setup, dependent jobs and evidence upload. A timeout is a failed validation, never a substitute for reducing or splitting the workload. Queue time is separate from execution time. No self-hosted runner is configured or assumed.

## Routine checks

Quality runs lint, all unit tests, the production build, release-contract validation and privacy/feasibility proofs. Chromium browser coverage runs in two independent shards; Firefox and WebKit each run two shards. Playwright's fully parallel test distribution partitions the existing complete project/test set without changing assertions, retries or intentional platform skips. Every shard builds the static client and keeps separately named failure evidence. The stable `check` status aggregates static checks, every browser shard, mobile-shell checks and dependency review. It fails when a required gate fails, is cancelled or is skipped; dependency review is allowed to skip only on pushes. Require `check` in branch protection.

New pushes cancel obsolete Quality and desktop validation runs. Release publication retains serialization rather than cancelling a partially published release.

### Measured starting point

The October 6 captured pre-split jobs measured Quality/check 465 seconds and WebKit 496 seconds. Desktop debug jobs in run `37400522435` took Linux 109 seconds, macOS 104 seconds and Windows 170 seconds. Those cached debug builds do **not** establish signed release or cold Rust build timing. Browser sharding and separating Chromium from the unit/build gate provide headroom rather than relying on the ceiling alone.

Live Matrix run `37400522407` measured two core journeys at 1,509 seconds total, Element at 1,260 seconds, sustained sync at 674 seconds, encrypted sustained sync at 681 seconds, and the large-account profile at 1,682 seconds. Ten-minute observation windows cannot fit inside ten-minute jobs after setup. They remain full-length local release evidence, not shortened PR checks. Synthetic 10,000-room rendering remains a short routine check (22 seconds in that run).

### Native release packaging

Signed Linux release run `37236051078` took 595 seconds in its build job, plus a four-second selector and 18-second asset audit. Its log records 273 seconds of optimized Rust compilation, about 68 seconds of AppImage packaging, two seconds for deb and 158 seconds for RPM. The Linux matrix now packages AppImage/deb and RPM in parallel, retaining compiler settings and all signed formats. Only the AppImage/deb job publishes the Linux updater metadata; RPM publishes its installer and signature. The final asset audit waits for every platform/package job.

The [revised RC6 Linux release run](https://github.com/spencerrung/aimtrix/actions/runs/37406279642) passed in 559 seconds from selector start through the final asset audit: AppImage/deb took 469 seconds, RPM 526 seconds and the audit 22 seconds. The preceding combined RC6 Linux job took 631 seconds before its audit. The split therefore brings the measured full Linux execution path below ten minutes. Cold caches, macOS signing/notarization and Windows signing require their own timings. No cold or signed platform is certified under budget by a warm desktop debug result. A cancelled or timed-out build remains failed release evidence.

## Full local endurance acceptance

Use a clean checkout of the release candidate on a machine with Node 22+, Docker/Compose, available loopback ports and sufficient memory for disposable Synapse/Postgres plus Chromium. Do not point the harness at production services. Avoid concurrent profiling runs so CPU contention does not invalidate measurements. The current agent environment has no Docker, Podman or nerdctl, so this relocated command has not been exercised here. Keep the existing RC6 full CI profile evidence as the baseline; do not report a new local pass until a Docker-capable machine completes it.

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

Run `37406251487` measured Chromium shards at 221/214 seconds, Firefox at 93/99 seconds and WebKit at 340/295 seconds. Static checks exposed a missing Chromium installation for the scheduling proof; the workflow now installs it explicitly. Live run `37406251552` passed delegated authentication (156 seconds), RTC (133 seconds), cache reload (74 seconds) and synthetic scale (70 seconds), but core/Element hit the eight-minute command deadline during or shortly after the encrypted-history fixture. Those timeouts are failed evidence and require further optimization before merge.

## Live journey partitions

Hosted core and history profiles each run on two independent clean stacks. Core keeps every non-history assertion; the separate history profile runs its six setup/retry prerequisites plus encrypted history/context, private encrypted search, withheld-key guidance, Matrix-link navigation and thread-history checks. Element runs the core profile including all independent Element checks. The default local `npm run test:matrix` still executes the complete journey; no flag silently changes that default.

The history fixture sends 350 encrypted events through the real composer, exceeding the 250-row render bound while preserving context anchors 20, 40 and 240 and keeping both navigation targets outside the initial live window. Exact ordered manifests fail a run if a selected check is missing, duplicated or unexpected. A source/manifest regression test verifies that the union of hosted partitions covers every default check. Reports name the selected profile and include the final coverage check. Both profile replicas must pass. Existing assertion bodies, encryption and history navigation remain unchanged. The eight-minute command watchdog leaves time for owner-scoped cleanup and allowlisted summary uploads within the ten-minute job ceiling.
