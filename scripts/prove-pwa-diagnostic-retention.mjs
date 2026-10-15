// A child test must actually fail; success here means its allowlisted evidence
// survived the assertion exit and fixture/server cleanup.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

assert(process.env.PWA_RELEASE_BUILDS, 'Set PWA_RELEASE_BUILDS to the pinned release manifest');
const directory = resolve(process.argv[2] ?? '/tmp/aimtrix-pwa-diagnostic-proof');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(resolve(directory, 'assertion-exit-'));
const result = spawnSync('npm', ['run', 'test:e2e', '--', 'e2e/pwa-release-upgrade.spec.ts',
  '--project=desktop', '--grep=with unavailable', '--workers=1', '--retries=0', '--output', output, ...process.argv.slice(3)], {
  env: { ...process.env, PWA_DIAGNOSTIC_FAILURE_PROBE: '1' }, stdio: 'inherit',
});
assert.equal(result.status, 1, 'Expected exactly a failing Playwright child, not a successful or interrupted run');
const files = (await readdir(output, { recursive: true })).filter((name) => name.endsWith('/pwa-diagnostics.json'));
assert.equal(files.length, 1, 'One retained diagnostic report is required');
const report = JSON.parse(await readFile(resolve(output, files[0]), 'utf8'));
assert.equal(report.status, 'failed');
assert.equal(report.intentionalAssertionExit, true, 'The deliberate assertion must have been reached');
assert.equal(report.builds.length, 2);
assert(report.assetResponses.some((request) => request.path === report.builds[1].entry && request.status === 503 && request.availability === 'unavailable'));
assert(report.snapshots.some((snapshot) => snapshot.changedWorker?.state === 'redundant'));
const last = report.snapshots.at(-1);
assert.equal(last.visibility, 'visible');
assert.equal(last.standalone, true);
assert.equal(last.active?.state, 'activated');
assert.equal(last.controller?.state, 'activated');
assert.equal(last.waiting, null);
assert.equal(last.installing, null);
assert(last.caches.includes(report.builds[0].cache));
assert(!last.caches.includes(report.builds[1].cache));
assert.equal(report.captureFailureCount, 0);
process.stdout.write(`${JSON.stringify({ expectedAssertionFailure: true, retainedWorkerAndCacheState: true, retainedAssetFailure: true, report: resolve(output, files[0]) }, null, 2)}\n`);
