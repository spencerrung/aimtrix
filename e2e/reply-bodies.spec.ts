import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string, css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    build: { write: false, lib: { entry: resolve('e2e/fixtures/replyBodies.tsx'), formats: ['es'], fileName: 'reply-bodies' },
      rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});

test('literal comparison and replacement quote lines survive rendering, copy and edit submission', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/reply-bodies-fixture', (route) => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reply body fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/reply-bodies-fixture');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const cases = [
    { id: '$literal', body: '>42 is the threshold\nKeep this room line', thread: false },
    { id: '$edited', body: '> authored quotation\nKeep this edited line', thread: false },
    { id: '$thread', body: '>>output\nKeep this thread line', thread: true },
  ];
  for (const item of cases) {
    if (item.thread) await page.locator('.conversation > .timeline [data-event-id="$root"]').getByRole('button', { name: /1 reply/ }).click();
    const scope = item.thread ? page.getByRole('complementary', { name: 'Thread', exact: true }) : page.locator('.conversation > .timeline');
    const row = scope.locator(`[data-event-id="${item.id}"]`);
    await expect(row.locator('.message-kind--text')).toHaveText(item.body);
    await row.getByRole('button', { name: 'More message actions' }).click();
    await page.getByRole('menuitem', { name: 'Copy text', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.replyBodyFixture.copied)).toBe(item.body);
    await row.getByRole('button', { name: 'More message actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit message', exact: true }).click();
    const composer = page.getByRole('textbox', { name: item.thread ? 'Message thread' : 'Message Welcome Lounge', exact: true });
    await expect.poll(() => composer.innerText()).toBe(item.body);
    await page.screenshot({ path: info.outputPath(`${item.thread ? 'thread' : item.id.slice(1)}-body-edit.png`) });
    await composer.press('Enter');
    await expect.poll(() => page.evaluate(() => window.replyBodyFixture.edits.at(-1))).toEqual({ eventId: item.id, body: item.body });
  }
});
