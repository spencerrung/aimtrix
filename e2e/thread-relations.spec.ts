import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    build: { write: false, lib: { entry: resolve('e2e/fixtures/threadRelations.tsx'), formats: ['es'], fileName: 'thread-relations' },
      rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

test('ordinary thread relations have no quoted preview while deliberate replies retain navigation', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/thread-relations-fixture', (route) => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Thread relation fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/thread-relations-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await expect(page.locator('[data-event-id="$room-reply"] .message-reply-context')).toHaveText(/Synthetic thread root/);
  await page.locator('[data-event-id="$root"]').getByRole('button', { name: /3 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread).toBeVisible();
  await expect(thread.locator('[data-event-id="$first"]')).toContainText('First ordinary contribution');
  await expect(thread.locator('[data-event-id="$second"]')).toContainText('Second ordinary contribution');
  await expect(thread.locator('[data-event-id="$first"] .message-reply-context')).toHaveCount(0);
  await expect(thread.locator('[data-event-id="$second"] .message-reply-context')).toHaveCount(0);
  const preview = thread.locator('[data-event-id="$explicit"] .message-reply-context');
  await expect(preview).toHaveText(/First ordinary contribution/);
  await page.screenshot({ path: info.outputPath('thread-relation-previews.png') });
  await preview.click();
  await expect(thread.locator('[data-event-id="$first"]')).toBeFocused();
});
