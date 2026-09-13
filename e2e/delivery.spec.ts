import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/delivery.tsx'), formats: ['es'], fileName: 'delivery' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

test('failed messages keep visible keyboard and touch recovery controls across themes', async ({ page }, info) => {
  await page.route('**/delivery-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Delivery fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/delivery-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const row = page.locator('.timeline-message').filter({ hasText: 'This synthetic message needs another try.' });
  await expect(row.getByText('Send not confirmed', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit message', exact: true })).toHaveCount(0);
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('A newer synthetic draft');
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const retry = row.getByRole('button', { name: 'Retry message', exact: true });
    await retry.focus();
    await page.keyboard.press('Tab');
    await expect(row.getByRole('button', { name: 'Cancel message', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(retry).toBeFocused();
    const bounds = await retry.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect((await new AxeBuilder({ page }).include('.message-delivery').analyze()).violations).toEqual([]);
    await page.screenshot({ path: `/tmp/aimtrix-05-${info.project.name}-${theme}-delivery.png` });
  }
  await row.getByRole('button', { name: 'Retry message', exact: true }).click();
  await expect(row.getByText('Accepted by server', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(1);
  await expect(composer).toHaveText('A newer synthetic draft');
});

test('cancelling a failed message removes its local echo', async ({ page }, info) => {
  await page.route('**/delivery-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Delivery fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/delivery-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: 'Cancel message', exact: true }).click();
  await expect(page.getByText('This synthetic message needs another try.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true })).toBeFocused();
});
