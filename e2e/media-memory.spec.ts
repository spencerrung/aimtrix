import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

const MiB = 1024 * 1024;
let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/mediaMemory.tsx'), formats: ['es'], fileName: 'media-memory' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

test('retains only mounted media through forty history pages, viewer closes and room navigation', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize(isMobile ? { width: 412, height: 915 } : { width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const live = new Map<string, number>();
    let created = 0, revoked = 0, peakBytes = 0;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob) {
        live.set(url, blob.size); created++;
        peakBytes = Math.max(peakBytes, [...live.values()].reduce((sum, bytes) => sum + bytes, 0));
      }
      return url;
    };
    URL.revokeObjectURL = (url) => { if (live.delete(url)) revoked++; revoke(url); };
    Object.defineProperty(window, 'mediaRetention', { value: () => ({ entries: live.size, bytes: [...live.values()].reduce((sum, bytes) => sum + bytes, 0), created, revoked, peakBytes }) });
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#267fc2"/><circle cx="160" cy="90" r="55" fill="#bce5ff"/></svg>';
  const image = Buffer.from(svg.padEnd(MiB, ' '));
  const audio = Buffer.alloc(MiB);
  audio.write('RIFF', 0); audio.writeUInt32LE(MiB - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(MiB - 44, 40);
  let authenticatedRequests = 0;
  await page.route('**/synthetic-media/*', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic-token');
    authenticatedRequests++;
    const isImage = route.request().url().includes('/image-');
    await route.fulfill({ contentType: isImage ? 'image/svg+xml' : 'audio/wav', body: isImage ? image : audio });
  });
  await page.route('**/media-memory-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Media memory</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/media-memory-fixture');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  const retention = () => page.evaluate(() => (window as unknown as { mediaRetention: () => { entries: number; bytes: number; created: number; revoked: number; peakBytes: number } }).mediaRetention());
  const chats = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Chats', exact: true });
  await page.getByRole('button', { name: /Welcome Lounge/ }).first().click();
  for (let index = 0; index < 40; index++) {
    const preview = page.getByRole('button', { name: `View image-${index}.svg full size` });
    await expect(preview).toBeVisible();
    await expect.poll(async () => (await retention()).bytes).toBe(2 * MiB);
    await expect.poll(() => preview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
    await expect.poll(() => page.locator('.message-audio').evaluate((audio: HTMLAudioElement) => Number.isFinite(audio.duration) && audio.duration > 0)).toBe(true);
    await preview.click();
    const viewer = page.getByRole('dialog', { name: `Viewing image-${index}.svg` });
    await expect.poll(() => viewer.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
    await page.locator('.message-audio').evaluate((audio: HTMLAudioElement) => { audio.muted = true; return audio.play(); });
    await expect.poll(async () => (await retention()).bytes).toBe(3 * MiB);
    if (index === 0) await page.screenshot({ path: info.outputPath('media-viewer.png') });
    if (index === 39) expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect.poll(() => page.locator('.message-audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
    await expect.poll(async () => (await retention()).bytes).toBe(2 * MiB);
    if (index === 0) {
      // Leaving the actual room unmounts its media; returning refetches it.
      if (isMobile) await chats.click();
      await page.getByRole('button', { name: /Quiet room/ }).first().click();
      await expect.poll(async () => (await retention()).bytes).toBe(0);
      if (isMobile) await chats.click();
      await page.getByRole('button', { name: /Welcome Lounge/ }).first().click();
      await expect.poll(async () => (await retention()).bytes).toBe(2 * MiB);
      const closeDetails = page.getByRole('button', { name: 'Close room details' });
      if (!await closeDetails.isVisible()) await page.getByRole('button', { name: 'Toggle room details' }).click();
      await expect(closeDetails).toBeVisible();
      await page.screenshot({ path: info.outputPath('media-room-details.png') });
      await page.keyboard.press('Escape');
      await page.setViewportSize(isMobile ? { width: 412, height: 480 } : { width: 1280, height: 500 });
      const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge' });
      await composer.focus();
      await expect(composer).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: info.outputPath('media-short-keyboard.png') });
      await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
      await page.setViewportSize(isMobile ? { width: 412, height: 915 } : { width: 1440, height: 1000 });
    }
    if (index < 39) await page.getByRole('button', { name: 'Load older messages' }).click();
  }
  await page.screenshot({ path: info.outputPath('media-final-room.png') });
  if (isMobile) await chats.click();
  await page.getByRole('button', { name: /Quiet room/ }).first().click();
  await expect.poll(async () => (await retention()).bytes).toBe(0);
  const result = await retention();
  expect(result.entries).toBe(0);
  expect(result.created).toBe(122);
  expect(result.revoked).toBe(result.created);
  expect(result.peakBytes).toBeLessThanOrEqual(3 * MiB);
  expect(authenticatedRequests).toBe(122);
  await info.attach('media-retention-budget', { body: JSON.stringify({ ...result, authenticatedRequests, pages: 40, byteBudget: 3 * MiB }), contentType: 'application/json' });
});
