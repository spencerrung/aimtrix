import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/firstUse.tsx'), formats: ['es'], fileName: 'first-use' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

test('first-use health and conversation actions fit desktop and phone', async ({ page }, info) => {
  await page.route('**/first-use-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aimtrix first use</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/first-use-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  await expect(page.getByRole('heading', { name: 'Your buddy list starts here' })).toBeVisible();
  await expect(page.getByText(/Recovery needs attention/)).toBeVisible();
  for (const name of ['Start an encrypted chat', 'Create an encrypted room', 'Set up or restore recovery']) {
    const button = page.getByRole('button', { name });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('first-use.png') });
});
