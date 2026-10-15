import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/verificationRecovery.tsx'), formats: ['es'], fileName: 'verification-recovery' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

for (const compact of [false, true]) test(`lost verification has accessible peer retry guidance${compact ? ' at 320px and short height' : ''}`, async ({ page }, info) => {
  if (compact) await page.setViewportSize({ width: 320, height: 360 });
  await page.route('**/verification-recovery-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aimtrix verification recovery</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/verification-recovery-fixture');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  const notice = page.getByRole('complementary', { name: 'Incoming device verification' });
  await expect(notice.getByRole('status')).toContainText('Device keys are not available yet');
  await expect(notice.getByRole('button', { name: 'Compare emoji' })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(notice.getByRole('button', { name: 'Check device again' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(notice.getByRole('status')).toContainText('Cancel the pending attempt on the other device');
  for (const control of await notice.getByRole('button').all()) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('verification-recovery.png') });
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect(notice).toHaveCount(0);
});
