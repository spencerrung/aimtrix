import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { defaultRuntimeConfig } from '../src/config/runtimeConfig';

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false,
    resolve: { alias: [{ find: /^matrix-js-sdk$/, replacement: resolve('e2e/fixtures/startupSdk.ts') }] },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    build: { write: false, lib: { entry: resolve('e2e/fixtures/startup.tsx'), formats: ['es'], fileName: 'startup' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

async function open(page: Page) {
  await page.route('**/startup-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Startup fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/startup-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  await expect(page.getByRole('heading', { name: 'Loading your conversations' })).toBeVisible();
}

async function sync(page: Page, state: string) {
  await page.evaluate((state) => (window as any).startupFixture.clients.at(-1).emit('sync', state, null, { error: new Error('synthetic timeout') }), state);
}

test('initial sync timeout keeps loading visible, retries safely, cancels and resumes', async ({ page }, info) => {
  await open(page);
  await sync(page, 'RECONNECTING');
  await expect(page.getByRole('status')).toContainText('first sync has not completed');
  await expect(page.getByRole('heading', { name: 'Conversations ready' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry now' }).focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).startupFixture.clients[0].counts.retried)).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `/tmp/aimtrix-oct14/startup/${info.project.name}-retry.png` });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel loading' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Conversation loading paused' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).startupFixture.clients[0].counts.stopped)).toBe(1);
  await sync(page, 'PREPARED'); // Late callbacks from a cancelled client have no authority.
  await expect(page.getByRole('heading', { name: 'Conversations ready' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume loading' }).click();
  await expect(page.getByRole('heading', { name: 'Loading your conversations' })).toBeVisible();
  await sync(page, 'PREPARED');
  await expect(page.getByRole('heading', { name: 'Conversations ready' })).toBeVisible();
  await sync(page, 'ERROR');
  await expect(page.getByRole('status')).toHaveText('offline');
});

test('loading controls fit a short viewport and expired startup requires sign-in', async ({ page }, info) => {
  await open(page);
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 320 : 1280, height: 360 });
  await sync(page, 'ERROR');
  const cancel = page.getByRole('button', { name: 'Cancel loading' });
  await cancel.focus();
  await expect(cancel).toBeFocused();
  const bounds = await cancel.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(info.project.name === 'mobile' ? 320 : 1280);
  await page.screenshot({ path: `/tmp/aimtrix-oct14/startup/${info.project.name}-short.png` });
  await page.evaluate(() => (window as any).startupFixture.clients[0].emit('sync', 'ERROR', null, { error: { errcode: 'M_UNKNOWN_TOKEN' } }));
  await expect(page.getByRole('heading', { name: 'Your Matrix session expired' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conversations ready' })).toHaveCount(0);
});

test('real SDK and Rust crypto cancel a pending startup preflight and resume the saved device', async ({ page }) => {
  let releaseVersions!: () => void;
  const versionsHeld = new Promise<void>((resolve) => { releaseVersions = resolve; });
  let firstVersions = true;
  await page.addInitScript(() => {
    localStorage.setItem('aimtrix.matrix-session.v1', JSON.stringify({ baseUrl: 'https://matrix.example.test',
      serverName: 'example.test', userId: '@synthetic:example.test', deviceId: 'SYNTHETIC', accessToken: 'synthetic-only' }));
  });
  await page.route('**/config.json', (route) => route.fulfill({ json: { ...defaultRuntimeConfig,
    defaultHomeserver: { serverName: 'example.test', baseUrl: 'https://matrix.example.test' },
    features: { ...defaultRuntimeConfig.features, groupCalls: false, calls: false } } }));
  await page.route('https://matrix.example.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/versions')) {
      if (firstVersions) { firstVersions = false; await versionsHeld; }
      await route.fulfill({ json: { versions: ['v1.11'], unstable_features: {} } }).catch(() => undefined);
    } else if (url.pathname.endsWith('/sync')) {
      if (url.searchParams.has('since')) return; // Hold the incremental long poll.
      await route.fulfill({ json: { next_batch: 'synthetic-next', rooms: {}, account_data: { events: [] }, to_device: { events: [] } } });
    } else if (url.pathname.endsWith('/keys/upload')) {
      await route.fulfill({ json: { one_time_key_counts: { signed_curve25519: 50 } } });
    } else if (url.pathname.endsWith('/filter')) {
      await route.fulfill({ json: { filter_id: '1' } });
    } else if (url.pathname.endsWith('/pushrules/')) {
      await route.fulfill({ json: { global: { override: [], underride: [], sender: [], room: [], content: [] } } });
    } else await route.fulfill({ json: {} });
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Loading your conversations' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Join or create room' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel loading' }).click();
    await expect(page.getByRole('heading', { name: 'Conversation loading paused' })).toBeVisible();
    releaseVersions();
    await page.getByRole('button', { name: 'Resume loading' }).click();
    await expect(page.getByRole('button', { name: 'Join or create room' })).toBeVisible({ timeout: 30000 });
  } finally { releaseVersions(); }
});
