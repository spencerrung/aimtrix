import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
let script: string;
let css: string;
// Chromium headless shell reports Notification.permission=denied even after
// granting notifications; the complete Chromium binary exercises this API.
test.use({ channel: 'chromium' });
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false,
    lib: { entry: resolve('e2e/fixtures/localNotifications.tsx'), formats: ['es'], fileName: 'local-notifications' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n');
  css = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css')).map((item) => item.source).join('\n');
});
test('Android constructor restriction uses persistent delivery and settings exposes failure before retry', async ({ page, context, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Real headless persistent-notification acceptance is exercised in Chromium; adapter contracts also have unit coverage.');
  await context.grantPermissions(['notifications']);
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 480 } : { width: 1280, height: 640 });
  await page.route('**/local-notification-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local notification fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/local-notification-fixture');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  const button = page.getByRole('button', { name: 'Test local notification', exact: true });
  await button.click();
  await expect(page.getByRole('alert')).toContainText('local notification could not be shown');
  expect(await page.evaluate(() => window.localNoticeFixture.presented)).toBe(0);
  await page.getByRole('alert').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('local-notification-error.png') });
  await button.click();
  await expect(page.getByRole('status')).toContainText('Local test requested');
  await expect.poll(() => page.evaluate(() => window.localNoticeFixture.notifications())).toEqual([{ title: 'Aimtrix notification test', data: { owner: 'synthetic-owner-001', local: true } }]);
  expect(await page.evaluate(() => window.localNoticeFixture.constructorCalls)).toBe(0);
  expect(await page.evaluate(() => window.localNoticeFixture.presented)).toBe(1);
  await page.getByRole('status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('local-notification-success.png') });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.evaluate(() => window.localNoticeFixture.close());
});
