/* global process, window, console */
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { cpus, totalmem, platform, release } from 'node:os';
import { resolve } from 'node:path';

const events = Number(process.argv.find((arg) => arg.startsWith('--events='))?.split('=')[1] ?? 5_000);
const pageSize = Number(process.argv.find((arg) => arg.startsWith('--page-size='))?.split('=')[1] ?? 100);
const attachmentBytes = Number(process.argv.find((arg) => arg.startsWith('--attachment-bytes='))?.split('=')[1] ?? 1_048_576);
if (!Number.isSafeInteger(events) || events < 1 || events > 5_000) throw new Error('events must be between 1 and 5,000');
if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('page-size must be between 1 and 500');
if (!Number.isSafeInteger(attachmentBytes) || attachmentBytes < 1 || attachmentBytes > 16_777_216) throw new Error('attachment-bytes must be between 1 and 16,777,216');

const result = await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  build: {
    write: false,
    lib: { entry: resolve('scripts/fixtures/profileOptionalCosts.ts'), formats: ['es'], fileName: 'profile-optional-costs' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output;
const script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(180_000);
  await page.route('**/optional-index-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Optional index profile</title>' }));
  await page.goto('http://127.0.0.1:4173/optional-index-fixture');
  await page.addScriptTag({ type: 'module', content: script });
  const metrics = await page.evaluate(([count, size]) => window.profilePrivateIndex(count, size), [events, pageSize]);
  const cryptoMetrics = await page.evaluate((bytes) => window.profileAttachmentCrypto(bytes), attachmentBytes);
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    workload: { events, pageSize, attachmentBytes, synthetic: true },
    host: { platform: `${platform()} ${release()}`, cpus: cpus().length, cpuModel: cpus()[0]?.model, totalMemoryGiB: Math.round(totalmem() / 2 ** 30) },
    browser: `Chromium ${browser.version()}`,
    ...metrics,
    ...cryptoMetrics,
  }, null, 2));
} finally {
  await browser.close();
}
