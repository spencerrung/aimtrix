/* global process, window, document, performance, console */
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { setTimeout as pause } from 'node:timers/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const rooms = Number(process.argv.find((arg) => arg.startsWith('--rooms='))?.split('=')[1] ?? 10_000);
const seconds = Number(process.argv.find((arg) => arg.startsWith('--seconds='))?.split('=')[1] ?? 600);
if (!Number.isSafeInteger(rooms) || rooms < 1 || rooms > 20_000) throw new Error('rooms must be between 1 and 20,000');
if (!Number.isSafeInteger(seconds) || seconds < 10 || seconds > 1800) throw new Error('seconds must be between 10 and 1,800');

const result = await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  build: {
    write: false,
    lib: { entry: resolve('e2e/fixtures/largeAccount.tsx'), formats: ['es'], fileName: 'sustained-account' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output;
const script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
const css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');

const percentile = (values, percent) => {
  const ordered = [...values].sort((left, right) => left - right);
  return Math.round(ordered[Math.max(0, Math.ceil(ordered.length * percent) - 1)] ?? 0);
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await page.route('**/sustained-account-fixture*', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sustained account fixture</title></head><body><div id="root"></div></body></html>',
  }));
  await page.goto(`http://127.0.0.1:4173/sustained-account-fixture?rooms=${rooms}`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  await page.waitForFunction(() => window.largeAccountFixture?.readyAt > 0, undefined, { timeout: 180_000 });
  const lastRoom = `Synthetic room ${String(rooms - 1).padStart(5, '0')}`;
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill(lastRoom);
  await page.getByRole('button', { name: new RegExp(lastRoom) }).click();
  await page.getByRole('main', { name: `Conversation with ${lastRoom}` }).waitFor();
  const initialRows = await page.locator('.buddy-row').count();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heapMiB = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics = await cdp.send('Performance.getMetrics');
    const bytes = metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value;
    return bytes === undefined ? null : Math.round(bytes / 2 ** 20);
  };
  const samples = [{ elapsedSeconds: 0, heapMiB: await heapMiB() }];
  const latencies = [];
  const started = performance.now();
  let nextSample = 30_000;
  let revision = 0;
  while (performance.now() - started < seconds * 1000) {
    const cycleStarted = performance.now();
    await page.evaluate((target) => window.largeAccountFixture.publish(target), revision % 2 ? 'hidden' : 'visible');
    revision += 1;
    await page.waitForFunction((expected) => window.largeAccountFixture.revision === expected, revision, { timeout: 30_000 });
    latencies.push(performance.now() - cycleStarted);
    const elapsed = performance.now() - started;
    if (elapsed >= nextSample) {
      samples.push({ elapsedSeconds: Math.round(elapsed / 1000), heapMiB: await heapMiB() });
      nextSample += 30_000;
      if (await page.locator('.buddy-row').count() > initialRows + 1) throw new Error('rendered room rows grew during sustained updates');
      await page.getByRole('main', { name: `Conversation with ${lastRoom}` }).waitFor();
    }
    await pause(Math.max(0, 1000 - (performance.now() - cycleStarted)));
  }
  samples.push({ elapsedSeconds: Math.round((performance.now() - started) / 1000), heapMiB: await heapMiB() });
  const finalDomNodes = await page.evaluate(() => document.querySelectorAll('*').length);
  const growth = samples[0].heapMiB === null || samples.at(-1).heapMiB === null
    ? null : samples.at(-1).heapMiB - samples[0].heapMiB;
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    build: { kind: 'Vite production-style fixture', revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() },
    workload: { rooms, selectedTimelineEvents: 250, requestedSeconds: seconds, completedSeconds: samples.at(-1).elapsedSeconds,
      publishCycles: revision, intervalMs: 1000, alternatingHiddenAndVisible: true, synthetic: true },
    host: { platform: `${platform()} ${release()}`, cpus: cpus().length, cpuModel: cpus()[0]?.model, totalMemoryGiB: Math.round(totalmem() / 2 ** 30) },
    browser: `Chromium ${browser.version()}`,
    timingsMs: { publishMedian: percentile(latencies, 0.5), publishP95: percentile(latencies, 0.95), publishMax: Math.round(Math.max(...latencies)) },
    memory: { retainedHeapGrowthMiB: growth, samples },
    initialRows, finalRows: await page.locator('.buddy-row').count(), finalDomNodes,
  }, null, 2));
} finally {
  await browser.close();
}
