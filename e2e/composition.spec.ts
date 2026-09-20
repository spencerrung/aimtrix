import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/composition.tsx'), formats: ['es'], fileName: 'composition' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n');
  css = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css')).map((item) => item.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/composition-fixture', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="en" data-theme="aqua"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Composition fixture</title><style>' + css + '</style></head><body><div id="root"></div><script type="module">' + script + '</script></body></html>' }));
  await page.goto('/composition-fixture');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
});

test('room and thread drafts restore after reload with honest file reattachment', async ({ page }, info) => {
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('A synthetic draft that survives reload');
  await page.getByLabel('Choose attachment', { exact: true }).setInputFiles({ name: 'retained.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
  const tray = page.getByRole('region', { name: 'Attachments', exact: true });
  await tray.getByLabel('Caption for retained.txt').fill('A retained caption');
  await page.reload();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await expect(composer).toHaveText('A synthetic draft that survives reload');
  await expect(tray.getByText('Reattach file', { exact: true })).toBeVisible();
  await expect(tray.getByLabel('Caption for retained.txt')).toHaveValue('A retained caption');
  await expect(tray.getByRole('button', { name: 'Send attachments', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await thread.getByRole('textbox', { name: 'Message thread', exact: true }).fill('Thread idea saved separately');
  await page.reload();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: /2 replies/ }).click();
  await expect(thread.getByRole('textbox', { name: 'Message thread', exact: true })).toHaveText('Thread idea saved separately');
  await thread.getByRole('button', { name: 'More message tools', exact: true }).click();
  await expect(thread.getByRole('button', { name: 'Add emoji', exact: true })).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Insert code block', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('shared-thread-composer.png') });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
});

test('reviews, reorders and retries one file without resending successful files', async ({ page }, info) => {
  const input = page.getByLabel('Choose attachment', { exact: true });
  await input.setInputFiles(['first.txt', 'retry.txt', 'remove.txt'].map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from('synthetic') })));
  const tray = page.getByRole('region', { name: 'Attachments', exact: true });
  await tray.getByRole('button', { name: 'Remove remove.txt', exact: true }).click();
  await tray.getByRole('button', { name: 'Move retry.txt earlier', exact: true }).click();
  await expect(tray.locator('li').first()).toContainText('retry.txt');
  await tray.getByLabel('Caption for first.txt').fill('Portable caption');
  await tray.getByRole('button', { name: 'Send attachments', exact: true }).click();
  await expect(tray.getByRole('button', { name: 'Retry retry.txt', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { compositionFixture: { uploads: string[] } }).compositionFixture.uploads)).toEqual(['first.txt']);
  await tray.getByRole('button', { name: 'Retry retry.txt', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { compositionFixture: { uploads: string[] } }).compositionFixture.uploads)).toEqual(['first.txt', 'retry.txt']);
  await page.screenshot({ path: info.outputPath('attachment-tray.png') });
});

test('staged files and expanded tools leave room and thread composers reachable on short screens', async ({ page }, info) => {
  for (const kind of ['room', 'thread'] as const) {
    await page.setViewportSize({ width: 412, height: 915 });
    const openRoom = page.getByRole('button', { name: /Welcome Lounge/ });
    if (await openRoom.isVisible()) await openRoom.click();
    if (kind === 'thread') await page.getByRole('button', { name: /2 replies/ }).click();
    const surface = kind === 'thread' ? page.getByRole('complementary', { name: 'Thread', exact: true }) : page.getByRole('main', { name: 'Conversation with Welcome Lounge' });
    await surface.getByLabel(kind === 'thread' ? 'Choose thread attachment' : 'Choose attachment', { exact: true }).setInputFiles(Array.from({ length: 4 }, (_, index) => ({ name: `${kind}-${index}.txt`, mimeType: 'text/plain', buffer: Buffer.from('synthetic') })));
    await surface.getByRole('button', { name: 'More message tools', exact: true }).click();
    const composer = surface.getByRole('textbox', { name: kind === 'thread' ? 'Message thread' : 'Message Welcome Lounge', exact: true });
    await composer.fill('Reachable with staged attachments');
    for (const size of [{ width: 568, height: 320 }, { width: 412, height: 360 }]) {
      await page.setViewportSize(size);
      await expect(composer).toBeInViewport({ ratio: 1 });
      await expect(surface.getByRole('button', { name: kind === 'thread' ? 'Send thread reply' : 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(surface.getByRole('button', { name: 'Insert code block', exact: true })).toBeInViewport({ ratio: 1 });
      const sendFiles = surface.getByRole('button', { name: kind === 'thread' ? 'Send thread attachments' : 'Send attachments', exact: true });
      await sendFiles.scrollIntoViewIfNeeded();
      await expect(sendFiles).toBeInViewport({ ratio: 1 });
      await expect(composer).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${kind}-attachments-${size.width}x${size.height}.png`) });
    }
  }
});
