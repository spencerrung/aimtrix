import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/unread.tsx'), formats: ['es'], fileName: 'unread' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 320, height: 568 } : { width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/unread-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unread fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/unread-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  await page.bringToFront();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
});

test('read actions, saved context and reminder feedback remain reachable across themes', async ({ page }, info) => {
  test.setTimeout(60_000);
  const trigger = page.getByRole('button', { name: 'Read status', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Conversation read status' });
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(trigger).toBeInViewport({ ratio: 1 });
    await trigger.click();
    await expect(dialog.getByRole('button', { name: 'Mark conversation read' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Mark unread', exact: true })).toBeInViewport({ ratio: 1 });
    expect((await new AxeBuilder({ page }).include('[aria-label="Conversation read status"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`read-status-${theme}.png`) });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  if (info.project.name === 'mobile') {
    await trigger.click();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await page.goForward();
    await expect(trigger).toBeVisible();
    await expect(dialog).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Return to saved message' }).click();
  await expect(page.locator('[data-event-id="$saved-unloaded"]')).toBeFocused();
  await expect(page.getByText('Marked unread for later.', { exact: true })).toBeVisible();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Mark conversation read' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Conversation marked read. Unseen threads keep their unread state.');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Mark unread', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Marked unread. Your reminder stays until you mark this conversation read.');
  await expect(dialog.getByRole('button', { name: 'Return to saved message' })).toBeEnabled();
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Mark conversation read' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('private thread read failure keeps the composer and retry reachable', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const timeline = thread.locator('.thread-panel__timeline');
  await thread.getByLabel('Message thread').focus();
  await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  const retry = thread.getByRole('button', { name: 'Retry thread read status' });
  await expect(retry).toBeVisible();
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(retry).toBeInViewport({ ratio: 1 });
    await expect(thread.getByLabel('Message thread')).toBeInViewport({ ratio: 1 });
    await expect(thread.getByRole('button', { name: 'Close thread' })).toBeInViewport({ ratio: 1 });
    expect((await new AxeBuilder({ page }).include('.thread-panel').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`thread-read-error-${theme}.png`) });
  }
  // Error feedback may shrink the viewport. Retry acknowledges the previously
  // observed event without demanding another scroll or reading newer content.
  await retry.click();
  await expect(thread.getByRole('alert')).toHaveCount(0);
  await expect(thread.locator('.thread-panel__header')).not.toContainText('unread');
  await thread.getByLabel('Message thread').fill('A retained synthetic reply');
  await expect(thread.getByLabel('Message thread')).toHaveValue('A retained synthetic reply');
});
