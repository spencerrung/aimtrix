import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function expectReachable(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeInViewport({ ratio: 1 });
}

async function openRoom(page: Page) {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
}

test('ordinary desktop keeps one contextual panel and retains each surface’s state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop docking is covered at the accepted 1280px reference width.');
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?demo=1');
  const main = page.getByRole('main', { name: 'Conversation with Welcome Lounge' });
  const composer = page.getByLabel('Message Welcome Lounge');
  const details = page.getByRole('complementary', { name: 'Buddy and room drawer' });
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const search = page.getByRole('complementary', { name: 'Message search', exact: true });
  await details.getByRole('tab', { name: 'Collections', exact: true }).click();
  await composer.fill('Keep my conversation draft');
  await page.getByRole('button', { name: /2 replies/ }).click();
  await expect(details).toBeHidden();
  await expect(thread).toBeVisible();
  await expectReachable(composer);
  await expectReachable(main.getByRole('button', { name: 'Attach a file' }));
  expect((await main.boundingBox())!.width).toBeGreaterThanOrEqual(420);
  const mainBounds = (await main.boundingBox())!;
  const threadBounds = (await thread.boundingBox())!;
  expect(mainBounds.x + mainBounds.width).toBeLessThanOrEqual(threadBounds.x + 1);
  await thread.getByLabel('Message thread').fill('Keep my thread draft');
  await page.getByRole('button', { name: 'Search message history', exact: true }).click();
  await expect(thread).toBeHidden();
  await search.getByRole('searchbox', { name: 'Search words' }).fill('goal');
  await page.getByRole('button', { name: 'Toggle room details' }).click();
  await expect(search).toBeHidden();
  await expect(details.getByRole('tab', { name: 'Collections', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Search message history', exact: true }).click();
  await expect(search.getByRole('searchbox', { name: 'Search words' })).toHaveValue('goal');
  await page.getByRole('button', { name: /2 replies/ }).click();
  await expect(thread.getByLabel('Message thread')).toHaveText('Keep my thread draft');
  await expect(composer).toHaveText('Keep my conversation draft');
  await thread.getByRole('separator', { name: 'Resize thread panel' }).press('End');
  expect((await main.boundingBox())!.width).toBeGreaterThanOrEqual(420);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await thread.getByRole('separator', { name: 'Resize thread panel' }).press('Home');
  for (const theme of ['Aqua', 'Graphite', 'Midnight']) {
    await page.getByRole('button', { name: 'You settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Personalize Aimtrix' });
    await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
    await settings.getByRole('button', { name: new RegExp(`^${theme}`) }).click();
    await page.keyboard.press('Escape');
    await expect(thread).toBeVisible();
    await expectReachable(composer);
    expect((await new AxeBuilder({ page }).include('.context-panel').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`desktop-one-context-${theme.toLowerCase()}.png`) });
  }
  await thread.getByRole('button', { name: 'Close thread' }).click();
  await expect(thread).toBeHidden();
  await expect(details).toBeHidden();
  await expect(search).toBeHidden();
  await expect(page.getByRole('button', { name: /2 replies/ })).toBeFocused();
});

test('phone and tablet route Back preserves the room, draft and exact reading anchor', async ({ page }, testInfo) => {
  const size = testInfo.project.name.includes('mobile') ? { width: 412, height: 915 } : { width: 900, height: 800 };
  await page.setViewportSize(size);
  await openRoom(page);
  const composer = page.getByLabel('Message Welcome Lounge');
  const main = page.getByRole('main', { name: 'Conversation with Welcome Lounge' });
  const timeline = page.getByRole('region', { name: 'Messages', exact: true });
  await composer.fill('Reading anchor filler\n'.repeat(36));
  await composer.press('Enter');
  await composer.fill('A draft while reading');
  const root = timeline.locator('[data-event-id="m2"]');
  await expect(async () => {
    const settledOffset = await root.evaluate(async (element) => {
      const timelineElement = element.closest('.timeline')!;
      timelineElement.scrollTop += element.getBoundingClientRect().top - timelineElement.getBoundingClientRect().top;
      timelineElement.dispatchEvent(new Event('scroll'));
      // Sending and draft notices can still resize the timeline. Establish the
      // reading position after its observers/programmatic-scroll guard settle.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return Math.abs(element.getBoundingClientRect().top - timelineElement.getBoundingClientRect().top);
    });
    expect(settledOffset).toBeLessThan(3);
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();
  }).toPass();
  expect(await timeline.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    return [...element.querySelectorAll('[data-event-id]')].find((row) => row.getBoundingClientRect().bottom > top)?.getAttribute('data-event-id');
  })).toBe('m2');
  const anchorOffset = await root.evaluate((element) => element.getBoundingClientRect().top - element.closest('.timeline')!.getBoundingClientRect().top);
  await root.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread).toBeVisible();
  await expect(main).toBeHidden();
  expect(await page.locator('.conversation').getAttribute('inert')).not.toBeNull();
  await expect(thread.locator('[data-panel-heading]')).toBeFocused();
  await thread.getByLabel('Message thread').fill('A retained thread draft');
  await page.goBack();
  await expect(main).toBeVisible();
  await expect(composer).toHaveText('A draft while reading');
  await expect.poll(async () => Math.abs(await root.evaluate((element) => element.getBoundingClientRect().top - element.closest('.timeline')!.getBoundingClientRect().top) - anchorOffset)).toBeLessThan(3);
  await page.goForward();
  await expect(thread).toBeVisible();
  await expect(thread.getByLabel('Message thread')).toHaveText('A retained thread draft');
  const historyLength = await page.evaluate(() => history.length);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(main).toBeVisible();
  await expect(thread).toBeVisible();
  await page.setViewportSize(size);
  await expect(main).toBeHidden();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('context-route.png') });
  await thread.getByRole('button', { name: 'Close thread' }).click();
  await expect(main).toBeVisible();
  await expect.poll(async () => Math.abs(await root.evaluate((element) => element.getBoundingClientRect().top - element.closest('.timeline')!.getBoundingClientRect().top) - anchorOffset)).toBeLessThan(3);
  if (size.width < 768) await page.getByRole('button', { name: 'Back to previous view' }).click();
  else await page.goBack();
  await expect(page.getByRole('button', { name: /Welcome Lounge/ })).toBeVisible();
  if (size.width < 768) await expect(main).toBeHidden();
  await page.goForward();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveText('A draft while reading');
});

for (const size of [{ width: 412, height: 360 }, { width: 568, height: 320 }, { width: 1024, height: 360 }]) {
  test(`composition and context controls remain reachable at ${size.width}x${size.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await openRoom(page);
    await page.setViewportSize(size);
    const composer = page.getByLabel('Message Welcome Lounge');
    await composer.fill('Still composing');
    await expectReachable(composer);
    await expectReachable(page.getByRole('button', { name: 'Send message', exact: true }));
    await expectReachable(page.getByRole('button', { name: 'Back to previous view' }));
    const more = page.getByRole('button', { name: 'More message tools' });
    if (size.width < 768) { await expectReachable(more); await more.click(); }
    else await expect(more).toBeHidden();
    await expectReachable(page.getByRole('button', { name: 'Attach a file', exact: true }));
    if (size.width < 768) { await page.keyboard.press('Escape'); await expect(more).toBeFocused(); }
    await page.screenshot({ path: testInfo.outputPath(`conversation-${size.width}x${size.height}.png`) });
    await page.getByRole('button', { name: /2 replies/ }).click();
    const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
    const threadComposer = thread.getByLabel('Message thread');
    await threadComposer.fill('Still replying');
    await expectReachable(threadComposer);
    await expectReachable(thread.getByRole('button', { name: 'Send thread reply' }));
    await expectReachable(thread.getByRole('button', { name: 'Close thread' }));
    await expectReachable(thread.getByRole('button', { name: size.width < 768 ? 'More message tools' : 'Attach a file' }));
    expect(await threadComposer.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: testInfo.outputPath(`thread-${size.width}x${size.height}.png`) });
    await thread.getByRole('button', { name: 'Send thread reply' }).click();
    await expect(thread.getByText('Still replying', { exact: true })).toBeVisible();
    await thread.getByRole('button', { name: 'Close thread' }).click();
    await expect(composer).toHaveText('Still composing');
  });
}

test('minimum phone preserves named header actions and contextual Back navigation', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 568 });
  await openRoom(page);
  await expectReachable(page.getByRole('button', { name: 'Back to previous view' }));
  await expectReachable(page.getByRole('button', { name: 'More message tools' }));
  const searchButton = page.getByRole('button', { name: 'Search message history', exact: true });
  await expectReachable(searchButton);
  await searchButton.click();
  const search = page.getByRole('complementary', { name: 'Message search', exact: true });
  await search.getByRole('searchbox', { name: 'Search words' }).fill('goal');
  await expectReachable(search.getByRole('button', { name: 'Close message search' }));
  await search.getByRole('button', { name: 'Close message search' }).click();
  await expect(searchButton).toBeFocused();
  const detailsButton = page.getByRole('button', { name: 'Toggle room details' });
  await expectReachable(detailsButton);
  await detailsButton.click();
  await expectReachable(page.getByRole('button', { name: 'Close room details' }));
  await page.screenshot({ path: testInfo.outputPath('minimum-phone-details-reduced-motion.png') });
  await page.getByRole('button', { name: 'Close room details' }).click();
  await expect(detailsButton).toBeFocused();
  await searchButton.click();
  await expect(search.getByRole('searchbox', { name: 'Search words' })).toHaveValue('goal');
  await page.goBack();
  await expectReachable(page.getByLabel('Message Welcome Lounge'));
});
