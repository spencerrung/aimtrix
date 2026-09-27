import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/privateSearch.tsx'), formats: ['es'], fileName: 'private-search' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/private-search-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private search</title></head><body><div id="root"></div></body></html>' }));
});

test('private search survives restart, labels coverage, and deletes on request', async ({ page }, info) => {
  const mount = async () => { await page.goto('/private-search-fixture'); await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script }); };
  await mount();
  const panel = page.getByRole('complementary', { name: 'Message search' });
  await panel.getByText('Encrypted history on this device').click();
  await panel.getByLabel('Local index passphrase').fill('a long local passphrase');
  await panel.getByRole('button', { name: 'Create or unlock index' }).click();
  await panel.getByRole('button', { name: 'Index up to 1,000 older messages' }).click();
  await expect(panel.getByText(/1 skipped without keys/)).toBeVisible();
  await panel.getByLabel('Search words').fill('nebula');
  await panel.getByRole('button', { name: 'Search history' }).click();
  await expect(panel.getByText('Synthetic nebula history')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.search-panel').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('private-search.png') });
  await mount();
  await panel.getByText('Encrypted history on this device').click();
  await panel.getByLabel('Local index passphrase').fill('a long local passphrase');
  await panel.getByRole('button', { name: 'Create or unlock index' }).click();
  await expect(panel.getByText(/1 indexed messages/)).toBeVisible();
  await panel.getByRole('button', { name: 'Delete local index' }).click();
  await page.getByRole('dialog', { name: 'Delete private search index?' }).getByRole('button', { name: 'Delete local index' }).click();
  await expect(panel.getByRole('button', { name: 'Create or unlock index' })).toBeVisible();
  expect(await page.evaluate(async () => (await indexedDB.databases()).filter((entry) => entry.name?.startsWith('aimtrix.private-search.')).length)).toBe(0);
});
