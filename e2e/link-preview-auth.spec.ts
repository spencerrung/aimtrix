import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    build: { write: false, lib: { entry: resolve('e2e/fixtures/linkPreview.tsx'), formats: ['es'], fileName: 'link-preview' },
      rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

for (const denied of [false, true]) test(`protected preview uses authenticated media and survives denied=${denied}`, async ({ page }, info) => {
  let requests = 0;
  const authorizationPresent: boolean[] = [];
  await page.route('**/synthetic-protected-preview/*', (route) => {
    requests++;
    const account = new URL(route.request().url()).pathname.split('/').at(-1);
    const authenticated = route.request().headers().authorization === `Bearer synthetic-${account}`;
    authorizationPresent.push(authenticated);
    return denied || !authenticated ? route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
      : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#3579b1"/></svg>' });
  });
  await page.route('**/link-preview-fixture', (route) => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protected preview</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/link-preview-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  await expect(page.getByRole('link', { name: 'Synthetic article' })).toBeVisible();
  const load = page.getByRole('button', { name: 'Load preview image' });
  await expect(load).toBeVisible();
  expect(requests).toBe(0);
  await load.click();
  await expect.poll(() => requests).toBe(1);
  expect(authorizationPresent).toEqual([true]);
  const image = page.locator('.link-preview img');
  if (denied) {
    await expect(image).toHaveCount(0);
    await expect(page.getByText('A protected Matrix preview image.')).toBeVisible();
  } else {
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(320);
    const first = await image.getAttribute('src');
    expect(first).toMatch(/^blob:/);
    await page.screenshot({ path: info.outputPath('authenticated-preview.png') });
    await page.getByRole('button', { name: 'Simulate account switch' }).click();
    await expect(load).toBeVisible();
    expect(await page.evaluate(async (url) => { try { await fetch(url!); return true; } catch { return false; } }, first)).toBe(false);
    await load.click();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(320);
    const second = await image.getAttribute('src');
    expect(second).not.toBe(first);
    expect(authorizationPresent).toEqual([true, true]);
    await page.getByRole('button', { name: 'Simulate sign-out' }).click();
    await expect(page.getByRole('status')).toHaveText('Signed out');
    await expect(image).toHaveCount(0);
    expect(await page.evaluate(async (url) => { try { await fetch(url!); return true; } catch { return false; } }, second)).toBe(false);
  }
  expect(await page.locator('body').innerHTML()).not.toContain('synthetic-first');
  expect(await page.locator('body').innerHTML()).not.toContain('synthetic-second');
});
