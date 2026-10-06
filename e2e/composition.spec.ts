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
  if (info.project.name.includes('mobile')) await page.getByRole('button', { name: /Welcome Lounge/ }).click();
});

test('room and thread drafts restore after reload with honest file reattachment', async ({ page }, info) => {
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('A synthetic draft that survives reload');
  await page.getByLabel('Choose attachment', { exact: true }).setInputFiles({ name: 'retained.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
  const tray = page.getByRole('region', { name: 'Attachments', exact: true });
  await tray.getByLabel('Options for retained.txt').click();
  await tray.getByLabel('Caption for retained.txt').fill('A retained caption');
  await page.reload();
  if (info.project.name.includes('mobile')) await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await expect(composer).toHaveText('A synthetic draft that survives reload');
  await expect(tray.getByText('Reattach file', { exact: true })).toBeVisible();
  await expect(tray.getByLabel('Caption for retained.txt')).toHaveValue('A retained caption');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled(); // The retained text can still be sent while files need reattachment.
  await page.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await thread.getByRole('textbox', { name: 'Message thread', exact: true }).fill('Thread idea saved separately');
  await page.reload();
  if (info.project.name.includes('mobile')) await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: /2 replies/ }).click();
  await expect(thread.getByRole('textbox', { name: 'Message thread', exact: true })).toHaveText('Thread idea saved separately');
  if (info.project.name.includes('mobile')) await thread.getByRole('button', { name: 'More message tools', exact: true }).click();
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
  await tray.getByLabel('Options for retry.txt').click();
  await tray.getByRole('button', { name: 'Move retry.txt earlier', exact: true }).click();
  await expect(tray.locator('li').first()).toContainText('retry.txt');
  await tray.getByLabel('Options for first.txt').click();
  await tray.getByLabel('Caption for first.txt').fill('Portable caption');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(tray.getByRole('button', { name: 'Retry retry.txt', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { compositionFixture: { uploads: string[] } }).compositionFixture.uploads)).toEqual(['first.txt']);
  await tray.getByRole('button', { name: 'Retry retry.txt', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { compositionFixture: { uploads: string[] } }).compositionFixture.uploads)).toEqual(['first.txt', 'retry.txt']);
  await expect(tray).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('attachment-tray.png') });
});

test('desktop room and thread tools are visible without opening the plus menu', async ({ page }, info) => {
  if (info.project.name.includes('mobile')) test.skip();
  for (const kind of ['room', 'thread'] as const) {
    if (kind === 'thread') await page.getByRole('button', { name: /2 replies/ }).click();
    const surface = kind === 'thread' ? page.getByRole('complementary', { name: 'Thread', exact: true }) : page.getByRole('main', { name: 'Conversation with Welcome Lounge' });
    await expect(surface.getByRole('button', { name: 'More message tools' })).toBeHidden();
    for (const name of ['Attach a file', 'Add emoji', 'Insert code block']) {
      await expect(surface.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`${kind}-visible-tools.png`) });
  }
});

test('captioned image leaves the attachment tray after its send is confirmed', async ({ page }) => {
  const tray = page.getByRole('region', { name: 'Attachments', exact: true });
  await page.getByLabel('Choose attachment', { exact: true }).setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: Buffer.from('synthetic image') });
  await tray.getByLabel('Options for picture.png').click();
  await tray.getByRole('textbox', { name: 'Caption for picture.png' }).fill('Synthetic caption');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { compositionFixture: { uploads: string[] } }).compositionFixture.uploads)).toContain('picture.png');
  await expect(tray).toHaveCount(0);
});

test('staged files and expanded tools leave room and thread composers reachable on short screens', async ({ page }, info) => {
  for (const kind of ['room', 'thread'] as const) {
    await page.setViewportSize({ width: 412, height: 915 });
    // Resize notifications are asynchronous in WebKit. Navigate explicitly
    // instead of sampling visibility before the responsive route has settled.
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
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
      const sendFiles = surface.getByRole('button', { name: kind === 'thread' ? 'Send thread reply' : 'Send message', exact: true });
      await sendFiles.scrollIntoViewIfNeeded();
      await expect(sendFiles).toBeInViewport({ ratio: 1 });
      await expect(composer).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${kind}-attachments-${size.width}x${size.height}.png`) });
    }
  }
});

for (const width of [320, 390, 430]) test(`inline image previews keep room and thread Send usable with a visual keyboard at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#1769ac'; ctx.fillRect(0, 0, 80, 60);
    ctx.fillStyle = '#9bddf5'; ctx.fillRect(8, 8, 40, 28);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  for (const kind of ['room', 'thread'] as const) {
    await page.evaluate(() => {
      Object.defineProperties(window.visualViewport!, { height: { configurable: true, value: 844 }, offsetTop: { configurable: true, value: 0 } });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
    if (kind === 'thread') await page.getByRole('button', { name: /2 replies/ }).click();
    const surface = kind === 'thread' ? page.getByRole('complementary', { name: 'Thread', exact: true }) : page.getByRole('main', { name: 'Conversation with Welcome Lounge' });
    const form = surface.getByRole('form', { name: kind === 'thread' ? 'Thread message composer' : 'Message composer', exact: true });
    const input = surface.getByLabel(kind === 'thread' ? 'Choose thread attachment' : 'Choose attachment', { exact: true });
    const name = `${kind}-synthetic.png`;
    await surface.getByRole('button', { name: 'More message tools' }).click();
    await input.setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(surface.getByRole('button', { name: 'More message tools' })).toHaveAttribute('aria-expanded', 'false');
    const image = form.getByRole('img', { name: `Preview of ${name}` });
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(80);
    await expect(form.locator('.composer__field .attachment-tray')).toBeVisible();
    const editor = form.getByRole('textbox', { name: kind === 'thread' ? 'Message thread' : 'Message Welcome Lounge', exact: true });
    await editor.focus();
    await page.evaluate(() => {
      Object.defineProperties(window.visualViewport!, { height: { configurable: true, value: 360 }, offsetTop: { configurable: true, value: 40 }, scale: { configurable: true, value: 1 } });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).toHaveAttribute('data-compact-viewport', 'true');
    const send = form.getByRole('button', { name: kind === 'thread' ? 'Send thread reply' : 'Send message', exact: true });
    for (const control of [image, editor, send, form.getByRole('button', { name: `Remove ${name}` })]) {
      await expect.poll(() => control.evaluate((node) => {
        const b = node.getBoundingClientRect(), v = window.visualViewport!;
        return b.top >= v.offsetTop && b.bottom <= v.offsetTop + v.height && node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
      })).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`${kind}-inline-single-${width}-keyboard.png`) });
    await input.setInputFiles(['second.txt', 'third.txt'].map((suffix) => ({ name: `${kind}-${suffix}`, mimeType: 'text/plain', buffer: Buffer.from('synthetic') })));
    const options = form.getByLabel(`Options for ${kind}-third.txt`);
    await options.focus(); await page.keyboard.press('Enter');
    await form.getByLabel(`Caption for ${kind}-third.txt`).fill('Synthetic caption');
    await form.getByRole('button', { name: `Move ${kind}-third.txt earlier` }).click();
    await expect(form.locator('.attachment-tray li').nth(1)).toContainText(`${kind}-third.txt`);
    await form.getByRole('button', { name: `Remove ${kind}-second.txt` }).click();
    await options.click();
    await editor.focus();
    await expect(send).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${kind}-inline-multiple-${width}-keyboard.png`) });
    if (info.project.use.hasTouch) await send.tap(); else await send.click();
    await expect(form.locator('.attachment-tray')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { compositionFixture: { uploads: string[] } }).compositionFixture.uploads)).toContain(name);
  }
});

test('code conversion stages one file and main Send does not duplicate the code as text', async ({ page }, info) => {
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('const synthetic = true;');
  if (info.project.name.includes('mobile')) await page.getByRole('button', { name: 'More message tools', exact: true }).click();
  await page.getByRole('button', { name: 'Insert code block', exact: true }).click();
  await page.getByRole('button', { name: 'Send code as file', exact: true }).click();
  await expect(composer).toHaveText('');
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).toContainText('snippet.txt');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { compositionFixture: { uploads: string[] } }).compositionFixture.uploads)).toEqual(['snippet.txt']);
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).toHaveCount(0);
});
