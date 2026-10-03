import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/voiceMedia.tsx'), formats: ['es'], fileName: 'voice-media' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/voice-media-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voice and media</title></head><body><div id="root"></div></body></html>' }));
  if (info.title === 'records a playable clip with Chromium’s real MediaRecorder') await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      tone.frequency.value = 440;
      tone.connect(destination);
      tone.start();
      const track = destination.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { stop(); tone.stop(); void audio.close(); };
      return destination.stream;
    } });
  });
  else await page.addInitScript(() => {
    const track = { stop() {}, onended: null };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
    class Recorder {
      static isTypeSupported(type: string) { return type === 'audio/webm;codecs=opus'; }
      state = 'inactive'; mimeType = 'audio/webm;codecs=opus';
      ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['synthetic voice'], { type: this.mimeType }) }); this.onstop?.(); }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: Recorder });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
  });
  await page.goto('/voice-media-fixture'); await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  await page.locator('.buddy-row').filter({ hasText: 'Welcome Lounge' }).first().click();
});

test('records a playable clip with Chromium’s real MediaRecorder', async ({ page }) => {
  expect(await page.evaluate(() => Function.prototype.toString.call(MediaRecorder).includes('[native code]'))).toBe(true);
  await page.getByRole('button', { name: 'More message tools' }).click();
  await page.getByRole('button', { name: 'Record a voice message' }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  const preview = page.getByLabel('Voice message preview');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(async (audio: HTMLAudioElement) => {
    const file = await fetch(audio.src).then((response) => response.blob());
    if (file.type !== 'audio/webm' || file.size <= 1000) return false;
    const decoder = new AudioContext();
    try {
      const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
      return decoded.duration > 0 && decoded.getChannelData(0).some((sample) => Math.abs(sample) > 0.01);
    } finally { await decoder.close(); }
  })).toBe(true);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(preview).toHaveCount(0);
});

test('reviews voice before send and browses loaded images', async ({ page }, info) => {
  await page.getByRole('button', { name: 'More message tools' }).click();
  await page.getByRole('button', { name: 'Record a voice message' }).click();
  await expect(page.getByRole('dialog', { name: 'Record a voice message' })).toBeVisible();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByLabel('Voice message preview')).toBeVisible();
  await page.screenshot({ path: info.outputPath('voice-preview.png') });
  await page.getByRole('button', { name: 'Send voice message' }).click();
  await expect(page.getByRole('dialog', { name: 'Record a voice message' })).toHaveCount(0);
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Sent' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'View first.svg full size' }).click();
  await page.getByRole('button', { name: 'Next image' }).click();
  await expect(page.getByRole('dialog', { name: 'Viewing second.svg' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download image' })).toHaveAttribute('download', 'second.svg');
  await expect.poll(() => page.getByRole('dialog', { name: 'Viewing second.svg' }).locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('media-viewer.png') });
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Viewing first.svg' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
