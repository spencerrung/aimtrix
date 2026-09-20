import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, resolve: { alias: [{ find: /^(?:\.\/matrix\/MatrixController|\.\.\/\.\.\/matrix\/MatrixController)$/, replacement: resolve('e2e/fixtures/recoveryController.ts') }] }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/recovery.tsx'), formats: ['es'], fileName: 'recovery' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.route('**/config.json', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/recovery-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recovery fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/recovery-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
});

test('expiry hides conversations and restores volatile drafts after same-account sign in', async ({ page }, info) => {
  test.setTimeout(60000);
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('Synthetic unsent main draft');
  await page.getByRole('button', { name: '2 replies' }).click();
  await page.getByRole('textbox', { name: 'Message thread', exact: true }).fill('Synthetic unsent thread draft');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('session-fixture', { detail: 'expired' })));
  await expect(page.getByRole('heading', { name: 'Your Matrix session expired' })).toBeVisible();
  await expect(page.locator('.workspace-grid')).toHaveCount(0);
  await expect(page.getByText('Synthetic unsent main draft')).toHaveCount(0);
  await expect(page.getByText('Spencer', { exact: true })).toHaveCount(0);
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const signIn = page.getByRole('button', { name: 'Sign in again' });
    await signIn.focus(); await expect(signIn).toBeFocused();
    expect((await new AxeBuilder({ page }).include('.session-recovery').analyze()).violations).toEqual([]);
    await page.screenshot({ path: `/tmp/aimtrix-07-${info.project.name}-${theme}-recovery.png` });
  }
  await page.getByRole('button', { name: 'Sign in again' }).click();
  await expect(page.getByLabel('Matrix ID')).toHaveValue('@you:example.com');
  await expect(page.getByLabel('Matrix ID')).toHaveAttribute('readonly');
  await page.getByLabel('Password').fill('synthetic fixture password');
  await page.getByRole('button', { name: 'Sign On', exact: true }).click();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await expect(composer).toHaveText('Synthetic unsent main draft');
  await page.getByRole('button', { name: '2 replies' }).click();
  await expect(page.getByRole('textbox', { name: 'Message thread', exact: true })).toHaveText('Synthetic unsent thread draft');
  const saved = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(saved).not.toContain('Synthetic unsent');
});

test('transient issues keep the workspace mounted and forgetting requires confirmation', async ({ page }, info) => {
  test.setTimeout(60000);
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('Synthetic draft through outage');
  await composer.evaluate((element) => { element.setAttribute('data-original-composer', 'true'); });
  for (const issue of ['offline', 'consent', 'storage']) {
    await page.evaluate((detail) => window.dispatchEvent(new CustomEvent('session-fixture', { detail })), issue);
    await expect(composer).toHaveAttribute('data-original-composer', 'true');
    await expect(composer).toHaveText('Synthetic draft through outage');
    const box = (await composer.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(page.locator('.connection-pill')).toHaveText('Offline');
    for (const theme of ['aqua', 'graphite', 'midnight']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      expect((await new AxeBuilder({ page }).include('.session-connection-banner').analyze()).violations).toEqual([]);
      await page.screenshot({ path: `/tmp/aimtrix-07-${info.project.name}-${theme}-${issue}-banner.png` });
    }
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect(page.getByRole('complementary', { name: 'Connection status' })).toHaveCount(0);
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('session-fixture', { detail: 'hard' })));
  await expect(page.getByText(/another verified device/)).toBeVisible();
  await page.getByRole('button', { name: 'Forget this session' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Messages that are not backed up may become unreadable');
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Your Matrix session expired' })).toBeVisible();
  await page.getByRole('button', { name: 'Forget this session' }).click();
  await page.getByRole('button', { name: 'Forget session and keys' }).click();
  await expect(page.getByLabel('Matrix ID')).toHaveValue('');
  await page.getByLabel('Matrix ID').fill('@you:example.com');
  await page.getByLabel('Password').fill('synthetic fixture password');
  await page.getByRole('button', { name: 'Sign On', exact: true }).click();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await expect(composer).toHaveText('');
});
