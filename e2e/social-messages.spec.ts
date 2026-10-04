import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/socialMessages.tsx'), formats: ['es'], fileName: 'social-messages' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/social-messages-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Social messages</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/social-messages-fixture'); await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
});

test('polls and static locations work at desktop and mobile sizes', async ({ page }, info) => {
  await expect(page.getByRole('region', { name: 'Poll: Lunch?' })).toBeVisible();
  await page.getByRole('button', { name: /Soup/ }).click();
  await page.getByRole('button', { name: /Salad/ }).click();
  await page.getByRole('button', { name: 'Save vote' }).click();
  await expect(page.getByText('Voted: soup, salad')).toBeVisible();
  await page.getByRole('button', { name: 'Create a poll' }).click();
  await expect(page.getByRole('dialog', { name: 'Create a poll' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Question' }).fill('Coffee?');
  await page.getByRole('textbox', { name: 'Answer 1' }).fill('Yes');
  await page.getByRole('textbox', { name: 'Answer 2' }).fill('No');
  await page.screenshot({ path: info.outputPath('poll-dialog.png') });
  await page.getByRole('button', { name: 'Create poll' }).click();
  await expect(page.getByText('Created: Coffee?')).toBeVisible();
  await page.getByRole('button', { name: 'Share a location' }).click();
  await page.getByRole('spinbutton', { name: 'Latitude' }).fill('40.7128');
  await page.getByRole('spinbutton', { name: 'Longitude' }).fill('-74.006');
  await expect(page.getByText('geo:40.7128,-74.006')).toBeVisible();
  await page.screenshot({ path: info.outputPath('location-dialog.png') });
  await page.getByRole('button', { name: 'Share this location' }).click();
  await expect(page.getByText('Shared: 40.7128,-74.006')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('browser geolocation fills a preview and still requires confirmation', async ({ page, context }) => {
  await context.setGeolocation({ latitude: 40.7128, longitude: -74.006 });
  await context.grantPermissions(['geolocation']);
  await page.getByRole('button', { name: 'Share a location' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share a location' });
  await dialog.getByRole('button', { name: 'Use my current location' }).click();
  await expect(dialog.getByText('geo:40.7128,-74.006', { exact: true })).toBeVisible();
  await expect(page.getByText('Shared: 40.7128,-74.006')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Share this location' }).click();
  await expect(page.getByText('Shared: 40.7128,-74.006')).toBeVisible();
});

test('denied browser geolocation retains manual sharing', async ({ page, context }) => {
  await context.grantPermissions([]);
  await page.getByRole('button', { name: 'Share a location' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share a location' });
  await dialog.getByRole('button', { name: 'Use my current location' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Location access was denied or unavailable. Enter coordinates manually.');
  await dialog.getByRole('spinbutton', { name: 'Latitude' }).fill('51.5072');
  await dialog.getByRole('spinbutton', { name: 'Longitude' }).fill('-0.1276');
  await dialog.getByRole('button', { name: 'Share this location' }).click();
  await expect(page.getByText('Shared: 51.5072,-0.1276')).toBeVisible();
});

test('manual location selection wins over a late device result', async ({ page }) => {
  await page.evaluate(() => {
    const browser = window as typeof window & { completeLocation?: () => void };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: (position: GeolocationPosition) => void) => {
        browser.completeLocation = () => success({ coords: { latitude: 40.7128, longitude: -74.006 } } as GeolocationPosition);
      },
    } });
  });
  await page.getByRole('button', { name: 'Share a location' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share a location' });
  await dialog.getByRole('button', { name: 'Use my current location' }).click();
  await dialog.getByRole('spinbutton', { name: 'Latitude' }).fill('51.5072');
  await dialog.getByRole('spinbutton', { name: 'Longitude' }).fill('-0.1276');
  await page.evaluate(() => (window as typeof window & { completeLocation?: () => void }).completeLocation?.());
  await expect(dialog.getByText('geo:51.5072,-0.1276')).toBeVisible();
  await dialog.getByRole('button', { name: 'Share this location' }).click();
  await expect(page.getByText('Shared: 51.5072,-0.1276')).toBeVisible();
});
