# Large-account performance, September 27, 2026

This synthetic profile covers the browser-facing portion of #163 without private account data. It generates 10,000 rooms and a bounded 250-event conversation. The change renders 100 rooms at a time in each buddy group and 100 direct children at a time in each Matrix space branch. A selected room beyond the current page remains visible, counts and search still cover all rooms, and each named load-more button moves keyboard focus to its first new item. Changing the query, filter, or space starts at the first page; returning to a previous scope may restore its loaded page. The timeline window and reading anchors are unchanged.

Run `node scripts/profile-large-account.mjs --rooms=10000 --cycles=100` for the flat list, add `--space` for a Matrix space with 10,000 children, run `node scripts/profile-snapshot.mjs --rooms=10000 --cycles=100` for the view-model builder, and run `node scripts/profile-optional-costs.mjs --events=5000 --page-size=100 --attachment-bytes=1048576` for opt-in search and attachment costs. The browser profile measures initial render, scroll, search, navigation, a hidden-room update, 100 more hidden-room updates, 100 visible-room/timeline updates, DOM size, long tasks, and retained heap after forced collection. The snapshot profile uses 10,000 empty mock SDK rooms and invalidates one room cache version per cycle. None connects to a homeserver.

The flat baseline is merged commit `5f0e181`. To reproduce its comparison, use this branch's fixture and profiler for both runs, temporarily substitute only `src/features/workspace/Workspace.tsx` from `git show 5f0e181:src/features/workspace/Workspace.tsx`, run the flat command, and restore the branch version. The figures below used that procedure. Reference host: Linux 7.2.7 CachyOS, Intel Xeon E3-1240 v5 at 3.50 GHz, 8 logical CPUs, 31 GiB RAM; Playwright Chromium 149.0.7827.55. These are one-run wall-clock observations including browser and harness overhead, not cross-machine guarantees.

| Flat 10,000-room workload | Baseline | Paged list |
| --- | ---: | ---: |
| Initial render | 9,900 ms | 1,598 ms |
| Buddy-list / timeline scroll | 225 / 146 ms | 59 / 50 ms |
| Search for room 9,999 | 1,032 ms | 305 ms |
| Navigate to room 9,999 | 757 ms | 787 ms |
| Hidden-room update, median / p95 across 100 | 105 / 123 ms | 112 / 134 ms |
| Visible-room/timeline update, median / p95 across 100 | 148 / 161 ms | 152 / 184 ms |
| Initial DOM nodes / room rows | 118,799 / 10,000 | 19,800 / 100 |
| Total recorded long-task time | 36,215 ms | 25,704 ms |
| Retained heap growth after 200 updates and GC | 9 MiB | 9 MiB |

With 10,000 direct children in a Matrix space, the paged run rendered 100 room rows initially. Opening the space took 535 ms; list/timeline scroll took 58/67 ms, search 239 ms, and navigation 677 ms. Hidden update median/p95 was 120/151 ms and visible update median/p95 was 157/170 ms across 100 cycles each; retained heap growth was 8 MiB. The old component did not expose the synthetic Friends space through the same control, so this is a post-change profile rather than a direct space baseline.

The 10,000-room view-model profile took 92 ms for its first snapshot and 37 ms median / 49 ms p95 for 100 snapshots with one changed room. Its caches held 10,000 room message entries and 10,000 member entries. The browser publication numbers include the React fixture's 10,000-room array update and do not isolate the view-model builder.

Working budgets for this reference workload are initial render under 3 seconds, room search under 500 ms, navigation under 1 second, either scroll under 100 ms, hidden and visible publication p95 under 200 ms, snapshot p95 under 75 ms, and retained heap growth under 10 MiB after 200 updates. The row budget is 100 per flat group, plus a selected out-of-page room; a four-group list can therefore have up to 401 rows. Each expanded Matrix space branch has its own 100-child page, plus a selected out-of-page child. Browser regression checks cover row bounds, keyboard paging, search, selection, and phone reachability; timing remains in this repeatable profile rather than a noisy CI wall-clock assertion. Recheck these budgets on additional hardware before making a release claim.

Optional costs were separately profiled in Chromium with synthetic data. Unlocking the opt-in private index took 134 ms; indexing its 5,000-event cap in 100-event pages took 1,662 ms total, the last page 62 ms, search 569 ms, and status 61 ms. Browser origin storage was about 1,753 KiB for this run. Encrypting and decrypting a 1 MiB attachment took 11 and 9 ms, with a verified byte-for-byte round trip. The benchmark bundles its crypto import into the fixture, so those times measure operations, not production module fetch. The production attachment crypto chunk is 4,200 bytes before gzip; optional emoji/sticker catalogs load on demand. The normal bundle gate enforces 800 KiB per JS chunk, 105 KiB per CSS chunk, and 8 MiB for WASM.

Live long-running Matrix sync, larger memberships and dense histories, multi-device effects, and real device/provider behavior remain unmeasured. Synthetic publication and browser evidence cannot close those boundaries for #163. The bounded cache-enabled reload below adds one live initial-sync observation.

## Cache-enabled same-device reload profile

The disposable live harness now has an isolated `npm run test:matrix -- --profile-cache-reload` mode. Unlike the regular integration runs, its Synapse uses the default two-minute successful `/sync` response cache. It signs in to a fresh Aimtrix device, creates a synthetic room, sends 350 synthetic messages from another session, then reloads the same browser device. The allowlisted report records seeding time, reload readiness within 90 seconds, elapsed reload time, and the number of `/sync` responses. No token, room ID, message body, response body, or browser trace enters the artifact. CI runs this as a separate job so the normal history/context suite can keep its cache-disabled setup.

The [October 1 PR #211 CI run](https://github.com/spencerrung/aimtrix/actions/runs/36948114569) passed this profile on Linux/x64 Chromium with pinned Synapse 1.160.0: seeding 350 synthetic messages took 4,246 ms; same-device reload reached the newest message in 2,058 ms and observed 47 `/sync` responses. The test enforces a 90-second bound. This is one CI observation, not a cross-machine latency budget or evidence of sustained sync health. The profile does not change the production sync store or claim a performance fix. The SDK's `IndexedDBStore` persists room state and saves on a five-minute cadence, so adopting it requires a deliberate privacy, quota, account-isolation, and cleanup review in addition to a measured improvement. Long-running sync and real-device memory remain separate boundaries for #163.
