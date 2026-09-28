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
  await page.getByRole('button', { name: 'Soup0' }).click();
  await page.getByRole('button', { name: 'Salad0' }).click();
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
