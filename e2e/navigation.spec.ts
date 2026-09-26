import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

async function modifier(page: Page) {
  return page.evaluate(() => /mac|iphone|ipad|ipod/i.test(navigator.platform) ? 'Meta' : 'Control');
}
async function switchTo(page: Page, name: string) {
  await page.keyboard.press(`${await modifier(page)}+k`);
  const query = page.getByRole('combobox', { name: 'Search rooms, people, and spaces' });
  await expect(query).toBeFocused();
  await query.fill(name);
  await expect(page.getByRole('dialog', { name: 'Quick switcher' }).getByRole('option')).toHaveCount(1);
  await query.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Quick switcher' })).toBeHidden();
}
async function openLink(page: Page, link: string) {
  await page.getByRole('button', { name: 'Quick switcher', exact: true }).click();
  await page.getByRole('button', { name: 'Open Matrix link', exact: true }).click();
  await page.getByRole('textbox', { name: 'Matrix link' }).fill(link);
  await page.getByRole('button', { name: 'Open link', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Open Matrix link' })).toBeHidden();
}

test('quick switching preserves drafts and real favorites filter independently of unread', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  await page.goto('/?demo=1');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('Keep my draft while finding another buddy');
  await switchTo(page, 'Mara Chen');
  await expect(page.getByRole('textbox', { name: 'Message Mara Chen', exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole('main', { name: 'Conversation with Mara Chen' }).evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await switchTo(page, 'Welcome Lounge');
  await expect(composer).toHaveText('Keep my draft while finding another buddy');
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Browse conversations', exact: true }).click();
  }
  const buddies = page.getByRole('complementary', { name: 'Buddy list' });
  const filter = page.getByRole('combobox', { name: 'Conversation filter' });
  await filter.selectOption('favorites');
  await expect(buddies.getByRole('button', { name: /Welcome Lounge/ })).toBeVisible();
  await expect(buddies.getByRole('button', { name: /Mara Chen/ })).toBeHidden();
  await page.screenshot({ path: info.outputPath('favorites-filter.png') });
  await buddies.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: 'Remove from favorites' }).click();
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Browse conversations', exact: true }).click();
  }
  await expect(buddies.getByRole('button', { name: /Welcome Lounge/ })).toBeHidden();
  await filter.selectOption('unread');
  await expect(buddies.getByRole('button', { name: /Mara Chen/ })).toBeVisible();
  await expect(buddies.getByRole('button', { name: /PixelGhost/ })).toBeHidden();
  await filter.selectOption('all');
  await expect(buddies.getByRole('button', { name: /PixelGhost/ })).toBeVisible();
  await switchTo(page, 'Friends');
  if (info.project.name === 'mobile') {
    await expect(buddies).toBeVisible();
    await expect.poll(() => buddies.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
});

test('touch controls reach the switcher, shortcut help and recoverable link errors across themes', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 320, height: 568 } : { width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?demo=1');
  const trigger = page.getByRole('button', { name: 'Quick switcher', exact: true });
  await expect(trigger).toBeInViewport({ ratio: 1 });
  await trigger.click();
  const switcher = page.getByRole('dialog', { name: 'Quick switcher' });
  await expect(switcher.getByRole('combobox')).toBeFocused();
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(switcher.getByRole('button', { name: 'Open Matrix link' })).toBeInViewport({ ratio: 1 });
    await expect(switcher.getByRole('button', { name: 'Keyboard shortcuts' })).toBeInViewport({ ratio: 1 });
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`quick-switcher-${theme}.png`) });
  }
  await switcher.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help.getByRole('button', { name: 'Done' })).toBeInViewport({ ratio: 1 });
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('keyboard-help.png') });
  await help.getByRole('button', { name: 'Done' }).click();
  await trigger.click();
  await page.getByRole('button', { name: 'Open Matrix link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open Matrix link' });
  const input = dialog.getByRole('textbox', { name: 'Matrix link' });
  await input.fill('https://matrix.to/#/!synthetic:test/not-an-event');
  await dialog.getByRole('button', { name: 'Open link' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Enter a complete/);
  await expect(input).toHaveValue('https://matrix.to/#/!synthetic:test/not-an-event');
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Open link' })).toBeInViewport({ ratio: 1 });
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('matrix-link-error.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('short landscape keeps quick-switcher results and touch actions reachable', async ({ page }, info) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Quick switcher', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick switcher' });
  await dialog.getByRole('combobox').fill('Welcome Lounge');
  const result = dialog.getByRole('option', { name: /Welcome Lounge/ });
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('short-landscape-switcher.png') });
  await expect(result).toBeInViewport({ ratio: 1 });
  for (const name of ['Next unread', 'Open Matrix link', 'Keyboard shortcuts']) {
    const button = dialog.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport({ ratio: 1 });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath('short-landscape-actions.png') });
  await dialog.getByRole('combobox').focus();
  await dialog.getByRole('combobox').press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true })).toBeVisible();
});

test.describe('event navigation history', () => {
  let script: string;
  let css: string;
  test.beforeAll(async () => {
    const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/navigation.tsx'), formats: ['es'], fileName: 'navigation' }, rolldownOptions: { output: { codeSplitting: false } } } });
    const output = (Array.isArray(result) ? result[0] : result).output;
    script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
    css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
  });
  test.beforeEach(async ({ page }, info) => {
    await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1280, height: 800 });
    await page.route('**/navigation-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Navigation fixture</title></head><body><div id="root"></div></body></html>' }));
    await page.goto('/navigation-fixture');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ type: 'module', content: script });
    if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  });
  test('same-room A/B links traverse browser history and restore the exact reading anchor', async ({ page }, info) => {
    test.setTimeout(60_000);
    const timeline = page.getByRole('region', { name: 'Messages', exact: true });
    const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
    await composer.fill('A draft that survives two message links');
    await timeline.hover();
    await page.mouse.wheel(0, -800);
    await expect(page.getByRole('button', { name: 'Jump to latest messages', exact: true })).toBeVisible();
    const anchor = timeline.locator('[data-event-id="$navigation-83"]');
    await anchor.evaluate((row) => {
      const container = row.closest('.timeline')!;
      container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.dispatchEvent(new Event('scroll'));
    });
    const offset = await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.timeline')!.getBoundingClientRect().top);
    const capture = () => timeline.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      const row = [...element.querySelectorAll<HTMLElement>('[data-event-id]')].find((candidate) => candidate.getBoundingClientRect().bottom > top)!;
      return { eventId: row.dataset.eventId!, offset: row.getBoundingClientRect().top - top };
    });
    const expectAnchor = async (saved: { eventId: string; offset: number }) => {
      const row = timeline.locator(`[data-event-id="${saved.eventId}"]`);
      await expect.poll(() => timeline.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await expect.poll(async () => Math.abs(await row.evaluate((element) => element.getBoundingClientRect().top - element.closest('.timeline')!.getBoundingClientRect().top) - saved.offset)).toBeLessThan(3);
    };
    await openLink(page, 'matrix:roomid/synthetic:test/e/navigation-10');
    const a = timeline.locator('[data-event-id="$navigation-10"]');
    await expect(a).toBeFocused();
    const aReading = await capture();
    await openLink(page, 'matrix:roomid/synthetic:test/e/navigation-30');
    const b = timeline.locator('[data-event-id="$navigation-30"]');
    await expect(b).toBeFocused();
    const bReading = await capture();
    await page.goBack();
    await expectAnchor(aReading);
    await page.goForward();
    await expectAnchor(bReading);
    await page.goBack();
    await expectAnchor(aReading);
    await page.goBack();
    await expect(anchor).toBeVisible();
    await expect.poll(async () => Math.abs(await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.timeline')!.getBoundingClientRect().top) - offset)).toBeLessThan(3);
    await expect(composer).toHaveText('A draft that survives two message links');
    expect(await page.evaluate(() => window.navigationFixture.contextRequests)).toEqual(['$navigation-10', '$navigation-30', aReading.eventId, bReading.eventId, aReading.eventId, '$navigation-83']);
    expect(page.url()).not.toContain('navigation-10');
    expect(page.url()).not.toContain('synthetic:test');
    await page.screenshot({ path: info.outputPath('history-restored-anchor.png') });
    await page.getByRole('button', { name: 'Jump to latest messages', exact: true }).click();
    await expect(timeline.locator('[data-event-id="$navigation-99"]')).toBeVisible();
    expect(await page.evaluate(() => window.navigationFixture.liveRequests)).toBeGreaterThan(0);
  });

  test('an inaccessible event shows truthful context feedback with retry and a return to live', async ({ page }, info) => {
    const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
    await composer.fill('Keep this draft if the target is inaccessible');
    await openLink(page, 'matrix:roomid/synthetic:test/e/missing');
    const context = page.getByLabel('Message context', { exact: true });
    await expect(context).toBeFocused();
    await expect(context).toHaveText(/This message is unavailable/);
    await expect(context.getByRole('button', { name: 'Try opening message again' })).toBeInViewport({ ratio: 1 });
    await context.getByRole('button', { name: 'Try opening message again' }).click();
    await expect.poll(() => page.evaluate(() => window.navigationFixture.contextRequests)).toEqual(['$missing', '$missing']);
    await expect(context).toHaveText(/This message is unavailable/);
    await expect(composer).toHaveText('Keep this draft if the target is inaccessible');
    expect((await new AxeBuilder({ page }).include('.history-context').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('unavailable-event.png') });
    await page.getByRole('button', { name: 'Jump to latest messages', exact: true }).click();
    await expect(page.locator('[data-event-id="$navigation-99"]')).toBeVisible();
    await expect(context).toBeHidden();
    await expect(composer).toHaveText('Keep this draft if the target is inaccessible');
  });

  test('Back restores a reading position beyond the originally linked context window', async ({ page }) => {
    const timeline = page.getByRole('region', { name: 'Messages', exact: true });
    await openLink(page, 'matrix:roomid/synthetic:test/e/navigation-10');
    await expect(timeline.locator('[data-event-id="$navigation-10"]')).toBeFocused();
    await page.getByRole('button', { name: 'Load newer messages', exact: true }).click();
    const anchor = timeline.locator('[data-event-id="$navigation-30"]');
    await expect(anchor).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Load newer messages', exact: true })).toBeEnabled();
    // Pagination restores its anchor over animation frames. Position the next
    // deliberate reading point after that layout work, with no queued wheel.
    await timeline.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await anchor.evaluate((row) => {
      const container = row.closest('.timeline')!;
      container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.dispatchEvent(new Event('scroll'));
    });
    const offset = await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.timeline')!.getBoundingClientRect().top);
    await openLink(page, 'matrix:roomid/synthetic:test/e/navigation-70');
    await expect(timeline.locator('[data-event-id="$navigation-70"]')).toBeFocused();
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.navigationFixture.contextRequests.at(-1))).toBe('$navigation-30');
    await expect(anchor).toBeVisible();
    await expect.poll(async () => Math.abs(await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.timeline')!.getBoundingClientRect().top) - offset)).toBeLessThan(3);
  });
});
