import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false,
    resolve: { alias: [{ find: /^matrix-js-sdk$/, replacement: resolve('e2e/fixtures/cryptoSdk.ts') }] },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    build: { write: false, lib: { entry: resolve('e2e/fixtures/cryptoOwnership.tsx'), formats: ['es'], fileName: 'crypto' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

async function open(page: Page, account = 'one') {
  await page.route('**/crypto-fixture?*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Crypto ownership fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto(`/crypto-fixture?account=${account}`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
}

test('simultaneous windows exclude one client, safely take over, and recover after abrupt owner loss', async ({ context }, info) => {
  const first = await context.newPage(); const second = await context.newPage();
  await Promise.all([open(first), open(second)]);
  await expect.poll(async () => Promise.all([first, second].map((page) => page.getByRole('heading', { name: 'This account is open in another window' }).count())).then((counts) => counts.reduce((sum, n) => sum + n, 0))).toBe(1);
  const blocked = await first.getByRole('heading', { name: 'This account is open in another window' }).count() ? first : second;
  const owner = blocked === first ? second : first;
  await expect(owner.getByRole('status')).toHaveText('Started clients: 1');
  expect(await blocked.evaluate(() => (window as any).cryptoFixture.counts.initialized)).toBe(0);
  await expect(blocked.getByRole('heading')).toBeFocused();
  expect((await new AxeBuilder({ page: blocked }).analyze()).violations).toEqual([]);
  await blocked.screenshot({ path: `/tmp/aimtrix-264-${info.project.name}-blocked.png` });
  await blocked.getByRole('button', { name: 'Use this window' }).click();
  await expect(blocked.getByRole('status')).toHaveText('Started clients: 1');
  await expect(owner.getByRole('heading', { name: 'This account is open in another window' })).toBeVisible();
  expect(await owner.evaluate(() => (window as any).cryptoFixture.counts.stopped)).toBe(1);
  await blocked.close(); // No graceful controller shutdown: the browser must release the lock.
  await expect.poll(() => owner.evaluate(async () => (await navigator.locks.query()).held?.length ?? 0)).toBe(0);
  await owner.getByRole('button', { name: 'Retry here' }).click();
  await expect(owner.getByRole('status')).toHaveText('Started clients: 2');
});

test('different accounts run independently and the refusal remains reachable in a short keyboard viewport', async ({ context }, info) => {
  const owner = await context.newPage(); const other = await context.newPage(); const blocked = await context.newPage();
  await open(owner); await expect(owner.getByRole('status')).toHaveText('Started clients: 1');
  await open(other, 'two'); await expect(other.getByRole('status')).toHaveText('Started clients: 1');
  await open(blocked);
  await expect(blocked.getByRole('heading', { name: 'This account is open in another window' })).toBeVisible();
  await blocked.setViewportSize({ width: info.project.name === 'mobile' ? 390 : 1280, height: 360 });
  const retry = blocked.getByRole('button', { name: 'Retry here' });
  await retry.focus(); await expect(retry).toBeFocused();
  await blocked.keyboard.press('Tab');
  await expect(blocked.getByRole('button', { name: 'Use this window' })).toBeFocused();
  await blocked.screenshot({ path: `/tmp/aimtrix-264-${info.project.name}-short.png` });
  const size = await blocked.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(size.width).toBeLessThanOrEqual(size.viewport);
});

test('renderer termination releases ownership without application cleanup', async ({ context }) => {
  const owner = await context.newPage(); const contender = await context.newPage();
  await open(owner); await expect(owner.getByRole('status')).toHaveText('Started clients: 1');
  await open(contender);
  await expect(contender.getByRole('heading', { name: 'This account is open in another window' })).toBeVisible();
  const session = await context.newCDPSession(owner);
  const crashed = owner.waitForEvent('crash');
  void session.send('Page.crash').catch(() => undefined);
  await crashed;
  // Chromium may host both same-origin pages in the crashed renderer. Use a fresh realm
  // in this same storage profile, before closing the crashed target, to prove lock release.
  const replacement = await context.newPage();
  await open(replacement);
  await expect(replacement.getByRole('status')).toHaveText('Started clients: 1');
});
