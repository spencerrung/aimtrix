import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

declare global { interface Window { __previewStops?: number; groupCallFixture: { joins: number; leaves: number; microphone: boolean; video: boolean; screenshare: boolean } } }

let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/groupCall.tsx'), formats: ['es'], fileName: 'group-call' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

test('previews, joins, and controls an encrypted group call', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/group-call-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Group call</title></head><body><div id="root"></div></body></html>' }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic', label: 'Test microphone' }, { kind: 'videoinput', deviceId: 'camera', label: 'Test camera' }], getUserMedia: async () => {
      const stream = document.createElement('canvas').captureStream(1);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { window.__previewStops = (window.__previewStops ?? 0) + 1; stop(); };
      }
      return stream;
    } } });
  });
  await page.goto('/group-call-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  const dialog = page.getByRole('dialog', { name: 'Join group call' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Join with microphone on')).not.toBeChecked();
  await expect(dialog.getByLabel('Join with camera on')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Preview camera' }).click();
  await expect(dialog.getByLabel('Camera preview')).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop camera preview' }).click();
  await expect(dialog.getByLabel('Camera preview')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__previewStops)).toBe(1);
  await page.screenshot({ path: info.outputPath('group-call-prejoin.png') });
  await dialog.getByRole('button', { name: 'Join encrypted call' }).click();
  const call = page.getByRole('region', { name: 'Group call in Welcome Lounge' });
  await expect(call).toBeVisible();
  await expect(call.getByText('Media encrypted')).toBeVisible();
  await call.getByRole('button', { name: 'Unmute group microphone' }).click();
  await call.getByRole('button', { name: 'Turn group camera on' }).click();
  await call.getByRole('button', { name: 'Share group screen' }).click();
  expect(await page.evaluate(() => window.groupCallFixture)).toMatchObject({ joins: 1, microphone: true, video: true, screenshare: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('group-call-shelf.png') });
  await call.getByRole('button', { name: 'Leave group call' }).click();
  await expect(call).toHaveCount(0);
});
