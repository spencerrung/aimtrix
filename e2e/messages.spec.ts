import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/messages.tsx'), formats: ['es'], fileName: 'messages' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/messages-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Message presentation</title></head><body><div id="root"></div></body></html>' }));
});

test('rich room, reply and root messages stay equivalent without fetching remote markup resources', async ({ page }, info) => {
  const trackingRequests: string[] = [];
  await page.route('https://tracker.invalid/**', (route) => { trackingRequests.push(route.request().url()); return route.fulfill({ status: 204 }); });
  await page.goto('/messages-fixture'); await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  for (const label of ['Room', 'Thread reply', 'Thread root']) {
    const surface = page.getByRole('region', { name: label, exact: true });
    await expect(surface.getByText('Shared rich formatting')).toBeVisible();
    await expect(surface.getByRole('link', { name: 'Buddy', exact: true })).toHaveAttribute('href', 'https://matrix.to/#/@buddy:test');
    await expect(surface.getByText('Discard duplicated reply')).toHaveCount(0);
    await expect(surface.getByText('The synthetic secret')).toHaveCount(0);
    await surface.getByRole('button', { name: 'Reveal spoiler: plot', exact: true }).click();
    await expect(surface.getByText(/The synthetic secret/)).toBeVisible();
    await expect(surface.getByText('is a surprise.', { exact: true })).toHaveCount(0);
    await surface.getByRole('button', { name: 'Reveal spoiler: ending', exact: true }).click();
    await expect(surface.getByText('is a surprise.', { exact: true })).toBeVisible();
    await expect(surface.locator('img,iframe,script,[onclick],a[href^="javascript:"]')).toHaveCount(0);
  }
  expect(trackingRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('shared-rich-messages.png'), fullPage: true });
});

test('message menus support keyboard/touch, safe clipboard failures and local mutation feedback', async ({ page }, info) => {
  await page.goto('/messages-fixture'); await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  const room = page.getByRole('region', { name: 'Room', exact: true });
  const trigger = room.getByRole('button', { name: 'More message actions', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Message actions', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Copy text', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(room.getByRole('status')).toHaveText('Message link copied.');
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.messageFixture.copied)).toEqual(['https://matrix.to/#/!synthetic%3Atest/%24synthetic-0']);
  await trigger.click(); await menu.getByRole('menuitem', { name: 'Pin message', exact: true }).click();
  await expect(room.getByRole('alert')).toHaveText('Pin message failed. Try again.');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Synthetic clipboard denial'); } } });
    document.execCommand = () => false;
  });
  await trigger.click(); await menu.getByRole('menuitem', { name: 'Copy text', exact: true }).click();
  await expect(room.getByRole('alert')).toHaveText('Copy text failed. Try again.');
  await trigger.click();
  if (info.project.name === 'mobile') {
    for (const button of await menu.getByRole('menuitem').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath('message-action-menu.png') });
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
});

test('rich messages and menus meet contrast and semantics in all themes', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto('/messages-fixture'); await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  const room = page.getByRole('region', { name: 'Room', exact: true });
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await room.getByRole('button', { name: 'More message actions', exact: true }).click();
    const violations = (await new AxeBuilder({ page }).include('main').include('.message-action-menu').withTags(['wcag2a', 'wcag2aa']).analyze()).violations;
    expect(violations.map(({ id, nodes }) => ({ id, examples: [...new Set(nodes.map((node) => node.failureSummary))].slice(0, 8) }))).toEqual([]);
    await page.screenshot({ path: info.outputPath(`messages-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
});
