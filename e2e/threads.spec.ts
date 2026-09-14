import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

let script: string;
let css: string;
async function openThreadLink(page: Page, eventId: string) {
  await page.getByRole('button', { name: 'Quick switcher', exact: true }).click();
  await page.getByRole('button', { name: 'Open Matrix link', exact: true }).click();
  await page.getByRole('textbox', { name: 'Matrix link', exact: true }).fill(`https://matrix.to/#/!synthetic:test/${encodeURIComponent(eventId)}`);
  await page.getByRole('button', { name: 'Open link', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Open Matrix link' })).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Thread', exact: true })).toBeVisible();
}
const layoutSettled = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test.beforeAll(async () => {
  const result = await build({ configFile: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false, lib: { entry: resolve('e2e/fixtures/threads.tsx'), formats: ['es'], fileName: 'threads' }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = (Array.isArray(result) ? result[0] : result).output;
  script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
  css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
});
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/threads-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Threads fixture</title></head><body><div id="root"></div></body></html>' }));
  await page.goto('/threads-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ type: 'module', content: script });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
});

test('an old root outside the room window supports paging and keeps historical and hidden threads unread', async ({ page }, info) => {
  await openThreadLink(page, '$old-thread-root');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const timeline = thread.locator('.thread-panel__timeline');
  const composer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
  await expect(thread.getByText('An old synthetic root outside the loaded room timeline')).toBeVisible();
  await expect(page.locator('.conversation > .timeline [data-event-id="$old-thread-root"]')).toHaveCount(0);
  await composer.fill('Keep my draft while paging an old thread');
  await layoutSettled(page);
  const anchor = timeline.locator('[data-event-id="$reply-120"]');
  await anchor.evaluate((row) => {
    const element = row.closest('.thread-panel__timeline')!;
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top;
    element.dispatchEvent(new Event('scroll'));
  });
  const top = await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top);
  // Keep the chosen reading point stationary while exercising the pagination
  // operation; separately verify that its visible controls are touch reachable.
  await thread.getByRole('button', { name: 'Load older thread replies', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(timeline.locator('[data-event-id="$reply-60"]')).toHaveCount(1);
  await expect.poll(async () => Math.abs(await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top) - top)).toBeLessThan(3);
  await expect(composer).toHaveValue('Keep my draft while paging an old thread');
  const reads = await page.evaluate(() => window.threadFixture.reads.length);
  await composer.focus();
  await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await page.evaluate(() => window.dispatchEvent(new Event('thread-fixture-incoming')));
  await layoutSettled(page);
  expect(await page.evaluate(() => window.threadFixture.reads.length)).toBe(reads);
  await expect(timeline.locator('[data-event-id="$reply-160"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('historical-thread.png') });
  await thread.getByRole('button', { name: 'Close thread', exact: true }).click();
  await expect(thread).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('thread-fixture-incoming')));
  await layoutSettled(page);
  expect(await page.evaluate(() => window.threadFixture.reads.length)).toBe(reads);
  await page.goForward();
  await expect(thread).toBeVisible();
  await expect(composer).toHaveValue('Keep my draft while paging an old thread');
  await thread.getByRole('button', { name: 'Jump to latest replies', exact: true }).click();
  await expect(timeline.locator('[data-event-id="$reply-161"]')).toBeVisible();
  await composer.focus();
  await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.evaluate(() => window.threadFixture.reads.at(-1))).toEqual({ rootId: '$old-thread-root', eventId: '$reply-161' });
});

test('standard reply links own thread history and browser Back restores the room reading position', async ({ page }, info) => {
  const main = page.getByRole('main', { name: 'Conversation with Welcome Lounge' });
  const mainTimeline = page.getByRole('region', { name: 'Messages', exact: true });
  const mainComposer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await mainComposer.fill('Main draft behind the old thread');
  await mainTimeline.hover();
  await page.mouse.wheel(0, -800);
  await expect(page.getByRole('button', { name: 'Jump to latest messages', exact: true })).toBeVisible();
  const anchor = mainTimeline.locator('[data-event-id="$main-42"]');
  await layoutSettled(page);
  await anchor.evaluate((row) => {
    const element = row.closest('.timeline')!;
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top;
    element.dispatchEvent(new Event('scroll'));
  });
  const offset = await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.timeline')!.getBoundingClientRect().top);
  await openThreadLink(page, '$reply-5');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const reply = thread.locator('[data-event-id="$reply-5"]');
  await expect(reply).toBeFocused();
  const threadComposer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
  await threadComposer.fill('Thread draft behind a reply link');
  if (info.project.name === 'mobile') await expect(main).toBeHidden();
  const reads = await page.evaluate(() => window.threadFixture.reads.length);
  await thread.locator('.thread-panel__timeline').evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await layoutSettled(page);
  expect(await page.evaluate(() => window.threadFixture.reads.length)).toBe(reads);
  await page.goBack();
  await expect(main).toBeVisible();
  await expect(thread).toBeHidden();
  await expect(mainComposer).toHaveText('Main draft behind the old thread');
  await expect.poll(async () => Math.abs(await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.timeline')!.getBoundingClientRect().top) - offset)).toBeLessThan(3);
  await page.goForward();
  await expect(thread).toBeVisible();
  await expect(reply).toHaveCount(1);
  await expect(threadComposer).toHaveValue('Thread draft behind a reply link');
  expect(page.url()).not.toContain('reply-5');
  expect(page.url()).not.toContain('old-thread-root');
  await page.screenshot({ path: info.outputPath('thread-link-restored.png') });
});

test('different reply links in one thread retain separate Back and Forward reading positions', async ({ page }) => {
  await openThreadLink(page, '$reply-5');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const timeline = thread.locator('.thread-panel__timeline');
  const composer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
  await expect(timeline.locator('[data-event-id="$reply-5"]')).toBeFocused();
  await composer.fill('One draft shared by two reply destinations');
  const first = timeline.locator('[data-event-id="$reply-10"]');
  await layoutSettled(page);
  await first.evaluate((row) => {
    const viewport = row.closest('.thread-panel__timeline')!;
    viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 13;
    viewport.dispatchEvent(new Event('scroll'));
  });
  const offset = await first.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top);
  await openThreadLink(page, '$reply-125');
  const second = timeline.locator('[data-event-id="$reply-125"]');
  await expect(second).toBeFocused();
  await expect(first).toHaveCount(0);
  const secondOffset = await second.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top);
  await page.goBack();
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(0);
  await expect.poll(async () => Math.abs(await first.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top) - offset)).toBeLessThan(3);
  await expect(composer).toHaveValue('One draft shared by two reply destinations');
  await page.goForward();
  await expect(second).toHaveCount(1);
  await expect.poll(async () => Math.abs(await second.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top) - secondOffset)).toBeLessThan(3);
  expect(await page.evaluate(() => window.threadFixture.reads.length)).toBe(0);
});

test('reopening the same reply link revisits its target after paging and scrolling away', async ({ page }) => {
  await openThreadLink(page, '$reply-5');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const timeline = thread.locator('.thread-panel__timeline');
  const target = timeline.locator('[data-event-id="$reply-5"]');
  await expect(target).toBeFocused();
  const offset = await target.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top);
  const composer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
  await composer.fill('Draft survives reopening the same reply link');
  const newer = thread.getByRole('button', { name: 'Load newer thread replies', exact: true });
  for (const newestId of ['$reply-60', '$reply-110']) {
    await expect(newer).toBeEnabled();
    await newer.evaluate((button: HTMLButtonElement) => button.click());
    await expect(timeline.locator(`[data-event-id="${newestId}"]`)).toHaveCount(1);
  }
  await expect(target).toHaveCount(0);
  await layoutSettled(page);
  await timeline.locator('[data-event-id="$reply-100"]').evaluate((row) => {
    const viewport = row.closest('.thread-panel__timeline')!;
    viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 19;
    viewport.dispatchEvent(new Event('scroll'));
  });
  await openThreadLink(page, '$reply-5');
  await expect(target).toBeFocused();
  await expect.poll(async () => Math.abs(await target.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top) - offset)).toBeLessThan(3);
  await expect(composer).toHaveValue('Draft survives reopening the same reply link');
  expect(await page.evaluate(() => window.threadFixture.contexts.filter((request) => request.eventId === '$reply-5').length)).toBe(2);
  expect(await page.evaluate(() => window.threadFixture.reads.length)).toBe(0);
});

test('newer thread paging keeps a stable anchor and unique bounded replies', async ({ page }) => {
  await openThreadLink(page, '$reply-75');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const timeline = thread.locator('.thread-panel__timeline');
  const anchor = timeline.locator('[data-event-id="$reply-75"]');
  await expect(anchor).toBeFocused();
  const composer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
  await composer.fill('Draft while paging toward newer replies');
  await layoutSettled(page);
  const offset = await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top);
  const newer = thread.getByRole('button', { name: 'Load newer thread replies', exact: true });
  await expect(newer).toBeEnabled();
  await newer.evaluate((button: HTMLButtonElement) => button.click());
  await expect(timeline.locator('[data-event-id="$reply-130"]')).toHaveCount(1);
  await expect.poll(async () => Math.abs(await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.thread-panel__timeline')!.getBoundingClientRect().top) - offset)).toBeLessThan(3);
  await expect(composer).toHaveValue('Draft while paging toward newer replies');
  const ids = await timeline.locator('[data-event-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id')));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeLessThanOrEqual(100);
  expect(await page.evaluate(() => window.threadFixture.pages)).toEqual(['forward']);
  expect(await page.evaluate(() => window.threadFixture.reads.length)).toBe(0);
});

test('sending from historical replies returns the thread to latest and preserves the main reading point', async ({ page }) => {
  const mainTimeline = page.getByRole('region', { name: 'Messages', exact: true });
  const mainComposer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await mainComposer.fill('Main draft remains behind a thread send');
  await mainTimeline.hover();
  await page.mouse.wheel(0, -800);
  await expect(page.getByRole('button', { name: 'Jump to latest messages', exact: true })).toBeVisible();
  await layoutSettled(page);
  const anchor = mainTimeline.locator('[data-event-id="$main-42"]');
  await anchor.evaluate((row) => {
    const viewport = row.closest('.timeline')!;
    viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    viewport.dispatchEvent(new Event('scroll'));
  });
  const offset = await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.timeline')!.getBoundingClientRect().top);
  await openThreadLink(page, '$reply-5');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread.getByRole('button', { name: 'Jump to latest replies', exact: true })).toBeVisible();
  const composer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
  await composer.fill('A new reply from historical thread context');
  await thread.getByRole('button', { name: 'Send thread reply', exact: true }).click();
  await expect(thread.locator('[data-event-id="$sent-reply"]')).toBeInViewport();
  await expect(composer).toHaveValue('');
  await expect(thread.getByRole('button', { name: 'Jump to latest replies', exact: true })).toBeHidden();
  await thread.getByRole('button', { name: 'Close thread', exact: true }).click();
  await expect(mainTimeline).toBeVisible();
  await expect(mainComposer).toHaveText('Main draft remains behind a thread send');
  await expect.poll(async () => Math.abs(await anchor.evaluate((row) => row.getBoundingClientRect().top - row.closest('.timeline')!.getBoundingClientRect().top) - offset)).toBeLessThan(3);
});

test('thread paging failures retain the draft and the chosen reading point for retry', async ({ page }) => {
  await openThreadLink(page, '$old-thread-root');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const composer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
  await composer.fill('A draft survives thread history failure');
  await page.evaluate(() => window.dispatchEvent(new Event('thread-fixture-fail-next')));
  await thread.getByRole('button', { name: 'Load older thread replies', exact: true }).click();
  await expect(thread.getByRole('status').filter({ hasText: /could not|unable|failed/i })).toBeVisible();
  await expect(composer).toHaveValue('A draft survives thread history failure');
  await thread.getByRole('button', { name: /Retry loading thread replies|Try loading again|Retry/i }).click();
  await expect(thread.locator('[data-event-id="$reply-60"]')).toHaveCount(1);
  await expect(composer).toHaveValue('A draft survives thread history failure');
});

test('removed roots and unavailable linked replies remain truthful and navigable', async ({ page }, info) => {
  await openThreadLink(page, '$removed-thread-root');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread.getByRole('status').filter({ hasText: /original message was removed/i })).toBeVisible();
  await expect(thread.getByText('Reply survives a removed synthetic root')).toBeVisible();
  await expect(thread.getByRole('textbox', { name: 'Message thread', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('removed-thread-root.png') });
  await openThreadLink(page, '$missing-reply');
  await expect(thread.getByText(/unavailable|not available/i)).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Close thread', exact: true })).toBeVisible();
  await expect(thread.getByRole('textbox', { name: 'Message thread', exact: true })).toBeVisible();
});

test('thread history controls and composer remain reachable across themes and short viewports', async ({ page }, info) => {
  test.setTimeout(60_000);
  await openThreadLink(page, '$old-thread-root');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await thread.getByRole('textbox', { name: 'Message thread', exact: true }).fill('A reachable reply');
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    expect((await new AxeBuilder({ page }).include('.thread-panel').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`thread-history-${theme}.png`) });
  }
  for (const size of [{ width: 412, height: 360 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(size);
    for (const label of ['Close thread', 'More thread tools', 'Send thread reply']) {
      await expect(thread.getByRole('button', { name: label, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await expect(thread.getByRole('textbox', { name: 'Message thread', exact: true })).toBeInViewport({ ratio: 1 });
    const older = thread.getByRole('button', { name: 'Load older thread replies', exact: true });
    await older.scrollIntoViewIfNeeded();
    await expect(older).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: info.outputPath(`thread-history-${size.width}x${size.height}.png`) });
  }
});
