import process from 'node:process';
import { URL } from 'node:url';
import console from 'node:console';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { createStack, command, invariant } from './stack.mjs';
import { runJourneys } from './journeys.mjs';
import { checkNames, failureCategories, makeReport } from './report.mjs';

// No Playwright reporter, traces, HAR, videos, storage snapshots, or screenshots.
// All exceptions are discarded at this boundary; only a fixed check ID is reported.
const args = process.argv.slice(2);
invariant(args.every((arg) => ['--repeat=2', '--probe-failure'].includes(arg)), 'unsupported-option');
const probe = args.includes('--probe-failure');
const repeats = args.includes('--repeat=2') ? 2 : 1;
const output = resolve('matrix-test-results');
await mkdir(output, { recursive: true });
const revision = await command('git', ['rev-parse', 'HEAD']);
let interrupted = false;
let activeBrowser;
const interrupt = () => { interrupted = true; void activeBrowser?.close(); };
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
for (let run = 1; run <= repeats; run++) {
  let stack, server, browser;
  let stage = 'setup';
  let failed = false;
  const checks = [];
  const metrics = {};
  const check = async (name, action) => {
    invariant(checkNames.has(name), 'check-name');
    stage = name;
    invariant(!interrupted, 'interrupted');
    console.log(`Matrix live: ${name}`);
    const started = Date.now();
    try { await action(); checks.push({ name, passed: true, durationMs: Date.now() - started }); }
    catch (error) {
      const category = failureCategories.filter((entry) => entry !== 'other').find((entry) => error instanceof Error && error.message.includes(entry)) || 'other';
      checks.push({ name, passed: false, category, durationMs: Date.now() - started }); throw new Error('check-failed', { cause: error });
    }
  };
  try {
    stack = await createStack();
    await check('disposable-stack', () => stack.start());
    await check('application-server', async () => {
      const runtime = { brandName: 'Aimtrix', defaultHomeserver: { serverName: 'aimtrix.test', baseUrl: stack.origins.synapse }, allowCustomHomeservers: false,
        features: { demoMode: false, calls: false, gifs: false, stickers: false }, emojiPacks: { enabled: false }, stickerPacks: [], media: { maxUploadBytes: 1048576 } };
      await readFile('dist/index.html');
      server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: Number(new URL(stack.origins.app).port), strictPort: true, open: false },
        plugins: [{ name: 'disposable-matrix-runtime', configurePreviewServer(vite) { vite.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] === '/config.json') { response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(runtime)); }
          else next();
        }); } }],
      });

      browser = await chromium.launch(); activeBrowser = browser;
    });
    await runJourneys({ browser, stack, check, forceFailure: probe, metrics });
    invariant(!probe, 'probe-must-fail');
  } catch {
    failed = true;
    // The probe throws after successful login with actual disposable credentials in
    // its exception. Neither that exception nor ordinary test errors leave memory.
    if (probe && stage === 'password-login-three-devices' && checks.at(-1)?.passed) stage = 'diagnostic-failure-probe';
    console.log(`Matrix live: stopped at ${stage}`);
  } finally {
    const started = Date.now();
    const cleanups = await Promise.allSettled([browser?.close(), server?.close(), stack?.stop()]);
    const cleaned = cleanups.every((result) => result.status === 'fulfilled');
    checks.push({ name: 'cleanup', passed: cleaned, durationMs: Date.now() - started });
    if (!cleaned) failed = true;
    activeBrowser = undefined;
  }
  const expectedFailure = probe && stage === 'diagnostic-failure-probe' && checks.at(-1)?.passed;
  const report = makeReport({ revision, platform: `${process.platform}/${process.arch}`, browser: 'Chromium', run, probe,
    passed: !interrupted && (expectedFailure || !failed), failureStage: failed ? stage : null, checks, metrics });
  const serialized = JSON.stringify(report, null, 2);
  // Belt-and-braces check in addition to the allowlisted report fields.
  invariant(!stack || Object.values(stack.credentials).every((value) => !serialized.includes(value)), 'diagnostic-secret-leak');
  invariant(!serialized.includes('private-room-canary'), 'diagnostic-content-leak');
  const destination = resolve(output, `${probe ? 'failure-probe' : 'run'}-${run}.json`);
  await writeFile(destination, `${serialized}\n`, { mode: 0o600 });
  invariant(await readFile(destination, 'utf8') === `${serialized}\n`, 'report-write');
  console.log(`Matrix live: ${report.passed ? 'PASS' : 'FAIL'} (${checks.filter((item) => item.passed).length}/${checks.length} checks; cleanup ${checks.at(-1)?.passed ? 'complete' : 'failed'})`);
  if (!report.passed) { process.exitCode = 1; break; }
}
process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
