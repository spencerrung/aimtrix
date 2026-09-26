import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/attention.tsx'), formats: ['es'], fileName: 'attention' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/attention-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Attention fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/attention-fixture'); await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: script });
  await page.getByRole('button', { name: 'Home activity', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Home activity' })).toBeVisible();
});
test('Home unmounts conversation, retains filter and reading point, and opens exact context', async ({ page }, info) => {
  const home = page.getByRole('main', { name: 'Home activity' });
  await expect(page.locator('.conversation')).toHaveCount(0);
  const before = await page.evaluate(() => window.attentionFixture.reads.length);
  await home.getByRole('button', { name: 'Mentions', exact: true }).click();
  await expect(home.getByText('Synthetic activity item 1', { exact: true })).toHaveCount(0);
  const target = home.getByRole('button', { name: /Synthetic activity item 12 / });
  await target.scrollIntoViewIfNeeded();
  const scroll = await home.locator('.home-activity__list').evaluate((element) => element.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.attentionFixture.reads.length)).toBe(before);
  await page.screenshot({ path: info.outputPath('home-mentions.png') });
  await target.click();
  await expect(page.locator('[data-event-id="$activity-12"]')).toBeFocused();
  expect(await page.evaluate(() => window.attentionFixture.contexts)).toContain('$activity-12');
  await page.goBack();
  await expect(home.getByRole('button', { name: 'Mentions', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => home.locator('.home-activity__list').evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0);
  await expect(page.locator('.conversation')).toHaveCount(0);
  expect(await page.evaluate(() => window.attentionFixture.refreshes)).toBe(1);
});
test('Home controls support keyboard, paging, drafts, themes and mobile reachability', async ({ page }, info) => {
  const home = page.getByRole('main', { name: 'Home activity' });
  const threads = home.getByRole('button', { name: 'My threads', exact: true }); await threads.focus(); await page.keyboard.press('Enter');
  await expect(threads).toHaveAttribute('aria-pressed', 'true');
  await expect(home.getByText('Synthetic activity item 0', { exact: true })).toHaveCount(0);
  await home.getByRole('button', { name: 'Load older activity' }).click(); expect(await page.evaluate(() => window.attentionFixture.older)).toBe(1);
  await home.getByRole('button', { name: 'Check more threads' }).click(); expect(await page.evaluate(() => window.attentionFixture.threads)).toBe(1);
  await home.getByRole('button', { name: 'Drafts (0)' }).click(); await expect(page.getByRole('dialog', { name: 'Your drafts', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    expect((await new AxeBuilder({ page }).include('.home-activity').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`home-${theme}.png`) });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('Home keeps the activity list reachable in short mobile viewports', async ({ page }, info) => {
  const home = page.getByRole('main', { name: 'Home activity' });
  for (const size of [{ width: 412, height: 360 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(size);
    await home.getByRole('button', { name: 'Mentions', exact: true }).click();
    const item = home.getByRole('button', { name: /Synthetic activity item 12 / });
    await item.scrollIntoViewIfNeeded();
    const bounds = await home.locator('.home-activity__list').boundingBox();
    expect(bounds?.height).toBeGreaterThan(80);
    await expect(item).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: info.outputPath(`home-${size.width}x${size.height}.png`) });
  }
});

test('notification rules reconcile rejected writes and quiet hours remain reachable and accessible', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.getByRole('main', { name: 'Home activity' }).getByRole('button', { name: 'Notification settings', exact: true }).click();
  await page.getByRole('button', { name: 'Notification rules and delivery', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Notification rules and delivery', exact: true });
  const room = settings.getByRole('combobox', { name: 'Notifications for Welcome Lounge' });
  await expect(room).toHaveValue('all');
  await room.selectOption('mentions'); await expect(settings.getByRole('status')).toHaveText('Room notification rule saved.');
  await page.evaluate(() => { window.attentionFixture.rejectRoom = true; });
  await room.selectOption('nothing'); await expect(settings.getByRole('alert')).toContainText('could not be updated completely'); await expect(room).toHaveValue('mentions');
  await expect(settings.getByRole('combobox', { name: 'Notifications for Custom Room' })).toBeDisabled();
  const dnd = settings.getByRole('checkbox', { name: /Do not disturb across devices/ });
  await dnd.check(); await expect(dnd).toBeChecked(); await expect(settings.getByRole('status')).toHaveText('Account notification rule saved.');
  await settings.getByRole('textbox', { name: 'New keyword pattern' }).fill('release*');
  await settings.getByRole('button', { name: 'Add keyword' }).click(); await expect(settings.getByRole('button', { name: 'Remove keyword release*' })).toBeVisible();
  await settings.getByRole('button', { name: 'Remove keyword release*' }).click(); await expect(settings.getByRole('button', { name: 'Remove keyword release*' })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Pause for one hour' }).click(); await expect(settings.getByText(/^Paused until/)).toBeVisible();
  await settings.getByRole('button', { name: 'Clear local pause' }).click(); await expect(settings.getByText('Local alerts are not paused.')).toBeVisible();
  await settings.getByRole('checkbox', { name: /Daily quiet hours/ }).check();
  await settings.getByLabel('Quiet hours start', { exact: true }).fill('23:15'); await settings.getByLabel('Quiet hours end', { exact: true }).fill('06:30');
  await settings.getByRole('button', { name: 'Save quiet hours' }).click(); await expect(settings.getByRole('status')).toHaveText('Quiet hours saved on this device.');
  await settings.getByRole('button', { name: 'Refresh notification settings' }).click();
  await expect(settings.getByLabel('Quiet hours start', { exact: true })).toHaveValue('23:15'); await expect(settings.getByRole('checkbox', { name: /Daily quiet hours/ })).toBeChecked();
  await settings.getByRole('button', { name: 'Test local notification' }).click();
  await expect(settings.getByRole('status')).toContainText('does not verify background gateway delivery'); expect(await page.evaluate(() => window.attentionFixture.localTests)).toBe(1);
  for (const theme of ['aqua', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await settings.getByLabel('Quiet hours start', { exact: true }).scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({ page }).include('.attention-settings').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`notification-settings-${theme}.png`) });
  }
  for (const size of [{ width: 412, height: 360 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(size);
    const save = settings.getByRole('button', { name: 'Save quiet hours' }); await save.scrollIntoViewIfNeeded(); await expect(save).toBeInViewport({ ratio: 1 });
    const select = settings.getByRole('combobox', { name: 'Notifications for Welcome Lounge' }); await select.scrollIntoViewIfNeeded(); await expect(select).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: info.outputPath(`notification-settings-${size.width}x${size.height}.png`) });
  }
});
