import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/history.tsx'), formats: ['es'], fileName: 'history' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.route('**/history-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>History fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/history-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
});

test('older pages, reply context and return to live work across themes', async ({ page }, info) => {
  test.setTimeout(60000);
  const timeline = page.getByRole('region', { name: 'Messages', exact: true });
  const target = timeline.locator('[data-event-id="$history-10"]');
  await expect(timeline.locator('[data-event-id="$history-399"]')).toBeVisible();
  await page.getByRole('button', { name: 'Jump to replied message from History Buddy' }).click();
  await expect(target).toBeFocused();
  await expect(page.getByText('Showing the selected message and its surrounding conversation.')).toBeVisible();
  const viewport = (await timeline.boundingBox())!;
  const selected = (await target.boundingBox())!;
  expect(viewport.height).toBeGreaterThan(page.viewportSize()!.height * 0.3);
  expect(selected.y).toBeGreaterThanOrEqual(viewport.y);
  expect(selected.y + selected.height).toBeLessThanOrEqual(viewport.y + viewport.height);
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const latest = page.getByRole('button', { name: 'Jump to latest messages', exact: true });
    await latest.focus();
    await expect(latest).toBeFocused();
    expect((await new AxeBuilder({ page }).include('.history-context').include('.jump-to-latest').analyze()).violations).toEqual([]);
    const composer = await page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true }).boundingBox();
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.screenshot({ path: `/tmp/aimtrix-06-${info.project.name}-${theme}-history.png` });
  }
  await page.getByRole('button', { name: 'Load newer messages', exact: true }).click();
  await expect(timeline.locator('[data-event-id="$history-85"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Jump to latest messages', exact: true }).click();
  await expect(timeline.locator('[data-event-id="$history-399"]')).toBeVisible();
  await expect(target).toHaveCount(0);
  for (let pageIndex = 0; pageIndex < 8 && await timeline.locator('[data-event-id="$history-0"]').count() === 0; pageIndex++) {
    const older = page.getByRole('button', { name: 'Load older messages', exact: true });
    await expect(older).toBeEnabled();
    const firstEvent = await timeline.locator('[data-event-id]').first().getAttribute('data-event-id');
    await older.evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => timeline.locator('[data-event-id]').first().getAttribute('data-event-id')).not.toBe(firstEvent);
    await expect(page.getByText('Loading older messages…', { exact: true })).toHaveCount(0);
    expect(await timeline.locator('.timeline-message').count()).toBeLessThanOrEqual(250);
  }
  await expect(timeline.locator('[data-event-id="$history-0"]')).toHaveCount(1);
  await expect(page.getByText('Beginning of available history.')).toHaveCount(1);
  await expect(timeline.locator('[data-event-id="$history-399"]')).toHaveCount(0);
});

test('incoming events and content resizing preserve the detached reading anchor', async ({ page }) => {
  const timeline = page.getByRole('region', { name: 'Messages', exact: true });
  const anchor = timeline.locator('[data-event-id="$history-335"]');
  await anchor.evaluate((row) => row.scrollIntoView({ block: 'start' }));
  await expect(page.getByRole('button', { name: 'Jump to latest messages', exact: true })).toBeVisible();
  const top = (await anchor.boundingBox())!.y;
  // The fourth page adds at the older edge and trims the newer edge: total
  // row count stays 250, so scrollHeight deltas cannot preserve this anchor.
  for (let index = 0; index < 4; index++) {
    const older = page.getByRole('button', { name: 'Load older messages', exact: true });
    await expect(older).toBeEnabled();
    const firstEvent = await timeline.locator('[data-event-id]').first().getAttribute('data-event-id');
    await older.evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => timeline.locator('[data-event-id]').first().getAttribute('data-event-id')).not.toBe(firstEvent);
    await expect(page.getByText('Loading older messages…', { exact: true })).toHaveCount(0);
    await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(2);
  }
  await expect(timeline.locator('.timeline-message')).toHaveCount(250);
  await expect(timeline.locator('[data-event-id="$history-399"]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('history-fixture-incoming')));
  await expect(timeline.getByText('A new synthetic arrival', { exact: true })).toHaveCount(0);
  // Simulate an image/decryption expansion above the visible row. This fixture
  // exercises the actual ResizeObserver/anchor behavior without network timing.
  await timeline.locator('[data-event-id="$history-330"]').evaluate((row) => {
    const expanded = document.createElement('div'); expanded.style.height = '180px'; row.append(expanded);
  });
  await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Jump to latest messages', exact: true }).click();
  await expect(timeline.getByText('A new synthetic arrival', { exact: true })).toBeVisible();
});
