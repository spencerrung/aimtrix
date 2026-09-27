import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/largeAccount.tsx'), formats: ['es'], fileName: 'large-account' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

test('ten thousand rooms remain searchable with bounded, keyboard-accessible rows', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  await page.route('**/large-account-fixture*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Large account fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/large-account-fixture?rooms=10000');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });

  const panel = page.getByRole('complementary', { name: 'Buddy list' });
  const more = panel.getByRole('button', { name: 'Show 100 more rooms (9900 remaining)' });
  await expect(more).toBeVisible();
  await expect(panel.locator('.buddy-row')).toHaveCount(100);
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(panel.locator('.buddy-row')).toHaveCount(200);
  await expect(panel.getByRole('button', { name: /Synthetic room 00100/ })).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Show 100 more rooms (9800 remaining)' })).toBeVisible();

  const search = panel.getByRole('searchbox', { name: 'Search conversations' });
  await search.fill('Synthetic room 09999');
  const last = panel.getByRole('button', { name: /Synthetic room 09999/ });
  await expect(last).toBeVisible();
  await last.click();
  await expect(page.getByRole('main', { name: 'Conversation with Synthetic room 09999' })).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Back to previous view' }).click();
  await search.fill('');
  if (info.project.name === 'mobile') {
    await expect(panel.locator('.buddy-row')).toHaveCount(200);
  } else {
    await expect(last).toBeVisible();
    await expect(panel.locator('.buddy-row')).toHaveCount(201);
  }
  await page.screenshot({ path: info.outputPath('large-account-buddy-list.png') });
});

test('ten thousand children in one Matrix space keep paging, search and focus usable', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  await page.route('**/large-account-fixture*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Large account fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/large-account-fixture?rooms=10000&space=1');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  await page.getByRole('button', { name: /Friends/ }).first().click();
  const panel = page.getByRole('complementary', { name: 'Buddy list' });
  await expect(panel.locator('.buddy-row')).toHaveCount(100);
  const more = panel.getByRole('button', { name: 'Show 100 more items in Friends (9900 remaining)' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: /Synthetic room 00100/ })).toBeFocused();
  await expect(panel.locator('.buddy-row')).toHaveCount(200);
  const search = panel.getByRole('searchbox', { name: 'Search conversations' });
  await search.fill('Synthetic room 09999');
  await expect(panel.getByRole('button', { name: /Synthetic room 09999/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('large-matrix-space.png') });
});

test('search and selection reveal a nested room beyond the first space page', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  await page.route('**/large-account-fixture*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nested large space fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/large-account-fixture?rooms=10000&space=1&nested=1');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  await page.getByRole('button', { name: /Friends/ }).first().click();
  const panel = page.getByRole('complementary', { name: 'Buddy list' });
  await expect(panel.locator('.buddy-row')).toHaveCount(100);
  const search = panel.getByRole('searchbox', { name: 'Search conversations' });
  await search.fill('Synthetic room 09999');
  const last = panel.getByRole('button', { name: /Synthetic room 09999/ });
  await expect(last).toBeVisible();
  await last.click();
  await expect(page.getByRole('main', { name: 'Conversation with Synthetic room 09999' })).toBeVisible();
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Back to previous view' }).click();
    await expect(search).toBeVisible();
  } else {
    await search.fill('');
    await expect(panel.getByText('Vidja Gamez')).toBeVisible();
    await expect(last).toBeVisible();
    await expect(panel.locator('.buddy-row')).toHaveCount(101);
  }
  await page.screenshot({ path: info.outputPath('nested-large-matrix-space.png') });
});
