/* global process, window, PerformanceObserver, performance, requestAnimationFrame, document, console */
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { cpus, totalmem, platform, release } from 'node:os';
import { resolve } from 'node:path';

const rooms = Number(process.argv.find((arg) => arg.startsWith('--rooms='))?.split('=')[1] ?? 10_000);
if (!Number.isSafeInteger(rooms) || rooms < 1 || rooms > 20_000) throw new Error('rooms must be between 1 and 20,000');
const cycles = Number(process.argv.find((arg) => arg.startsWith('--cycles='))?.split('=')[1] ?? 100);
if (!Number.isSafeInteger(cycles) || cycles < 0 || cycles > 1_000) throw new Error('cycles must be between 0 and 1,000');
const largeSpace = process.argv.includes('--space');

const result = await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  build: {
    write: false,
    lib: { entry: resolve('e2e/fixtures/largeAccount.tsx'), formats: ['es'], fileName: 'large-account' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output;
const script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
const css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await page.route('**/large-account-fixture*', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Large account fixture</title></head><body><div id="root"></div></body></html>',
  }));
  await page.goto(`http://127.0.0.1:4173/large-account-fixture?rooms=${rooms}${largeSpace ? '&space=1' : ''}`);
  await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    window.__profileLongTasks = [];
    new PerformanceObserver((list) => window.__profileLongTasks.push(...list.getEntries().map((entry) => entry.duration)))
      .observe({ entryTypes: ['longtask'] });
  });
  const start = performance.now();
  await page.addScriptTag({ type: 'module', content: script });
  await page.waitForFunction(() => window.largeAccountFixture?.readyAt > 0, undefined, { timeout: 180_000 });
  const initialRenderMs = Math.round(performance.now() - start);
  const initialDomNodes = await page.locator('*').count();
  const initialRenderedRoomRows = await page.locator('.buddy-row').count();
  let spaceOpenMs;
  if (largeSpace) {
    const spaceStart = performance.now();
    await page.getByRole('button', { name: /Friends/ }).first().click();
    await page.locator('.space-tree__summary').waitFor({ timeout: 180_000 });
    spaceOpenMs = Math.round(performance.now() - spaceStart);
  }

  const scrollStart = performance.now();
  await page.locator('.buddy-groups').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const listScrollMs = Math.round(performance.now() - scrollStart);
  const timelineScrollStart = performance.now();
  await page.locator('.timeline').evaluate((element) => { element.scrollTop = element.scrollHeight / 2; });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const timelineScrollMs = Math.round(performance.now() - timelineScrollStart);

  const searchStart = performance.now();
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill(`Synthetic room ${String(rooms - 1).padStart(5, '0')}`);
  const target = page.getByRole('button', { name: new RegExp(`Synthetic room ${String(rooms - 1).padStart(5, '0')}`) });
  await target.waitFor({ timeout: 180_000 });
  const searchMs = Math.round(performance.now() - searchStart);

  const navigationStart = performance.now();
  await target.click();
  await page.getByRole('main', { name: `Conversation with Synthetic room ${String(rooms - 1).padStart(5, '0')}` }).waitFor({ timeout: 180_000 });
  const navigationMs = Math.round(performance.now() - navigationStart);

  const publishStart = performance.now();
  await page.evaluate(() => window.largeAccountFixture.publish('hidden'));
  await page.waitForFunction(() => window.largeAccountFixture.revision === 1, undefined, { timeout: 180_000 });
  const hiddenPublishMs = Math.round(performance.now() - publishStart);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBeforeCycles = (await cdp.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value;
  const hiddenCycleTimings = [];
  for (let index = 0; index < cycles; index += 1) {
    const before = performance.now();
    await page.evaluate(() => window.largeAccountFixture.publish('hidden'));
    await page.waitForFunction((revision) => window.largeAccountFixture.revision === revision, index + 2, { timeout: 180_000 });
    hiddenCycleTimings.push(performance.now() - before);
  }
  const visibleCycleTimings = [];
  for (let index = 0; index < cycles; index += 1) {
    const before = performance.now();
    await page.evaluate(() => window.largeAccountFixture.publish('visible'));
    await page.waitForFunction((revision) => window.largeAccountFixture.revision === revision, index + cycles + 2, { timeout: 180_000 });
    visibleCycleTimings.push(performance.now() - before);
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const metrics = await cdp.send('Performance.getMetrics');
  const heap = metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value;
  const browserVersion = browser.version();
  const browserMeasurements = await page.evaluate(() => ({
    domNodes: document.querySelectorAll('*').length,
    longTasks: window.__profileLongTasks.length,
    longTaskTotalMs: Math.round(window.__profileLongTasks.reduce((sum, duration) => sum + duration, 0)),
  }));
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    workload: { rooms, selectedTimelineEvents: 250, hiddenPublishCycles: cycles, visiblePublishCycles: cycles, largeSpace, synthetic: true },
    host: { platform: `${platform()} ${release()}`, cpus: cpus().length, cpuModel: cpus()[0]?.model, totalMemoryGiB: Math.round(totalmem() / 2 ** 30) },
    browser: `Chromium ${browserVersion}`,
    timingsMs: {
      initialRender: initialRenderMs, spaceOpen: spaceOpenMs, listScroll: listScrollMs, timelineScroll: timelineScrollMs, search: searchMs,
      navigation: navigationMs, hiddenPublish: hiddenPublishMs,
      hiddenPublishMedian: hiddenCycleTimings.length ? Math.round([...hiddenCycleTimings].sort((a, b) => a - b)[Math.floor(hiddenCycleTimings.length / 2)]) : undefined,
      hiddenPublishP95: hiddenCycleTimings.length ? Math.round([...hiddenCycleTimings].sort((a, b) => a - b)[Math.ceil(hiddenCycleTimings.length * 0.95) - 1]) : undefined,
      visiblePublishMedian: visibleCycleTimings.length ? Math.round([...visibleCycleTimings].sort((a, b) => a - b)[Math.floor(visibleCycleTimings.length / 2)]) : undefined,
      visiblePublishP95: visibleCycleTimings.length ? Math.round([...visibleCycleTimings].sort((a, b) => a - b)[Math.ceil(visibleCycleTimings.length * 0.95) - 1]) : undefined,
    },
    heapMiB: heap === undefined ? undefined : Math.round(heap / 2 ** 20),
    retainedHeapGrowthMiB: heap === undefined || heapBeforeCycles === undefined ? undefined : Math.round((heap - heapBeforeCycles) / 2 ** 20),
    initialDomNodes,
    initialRenderedRoomRows,
    ...browserMeasurements,
  }, null, 2));
} finally {
  await browser.close();
}
