import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Requires a mobile browser context.');
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
});

test('composer stays usable through a keyboard-sized viewport', async ({ page }) => {
  const composer = page.getByLabel('Message Welcome Lounge');
  await composer.focus();
  await page.setViewportSize({ width: 412, height: 360 });

  await expect(composer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  expect(await composer.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await composer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom <= (window.visualViewport?.height ?? window.innerHeight);
  })).toBe(true);

  await composer.fill('Still here');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Still here')).toBeVisible();
});

test('timeline and composer survive a narrow landscape resize', async ({ page }) => {
  const timeline = page.getByRole('region', { name: 'Messages' });
  const composer = page.getByLabel('Message Welcome Lounge');
  await composer.fill('line\n'.repeat(36));
  await composer.press('Enter');
  await expect.poll(() => timeline.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  // Wait until the client accepts detachment, after the send-to-latest frame.
  await expect(async () => {
    await timeline.evaluate((element) => {
      element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) / 2);
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();
  }).toPass();
  const before = await timeline.evaluate((element) => element.scrollTop);

  await page.setViewportSize({ width: 568, height: 320 });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));

  await expect(composer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to previous view' })).toBeVisible();
  expect(await composer.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
  expect(Math.abs(await timeline.evaluate((element) => element.scrollTop) - before)).toBeLessThan(48);
});

for (const width of [320, 390, 430]) {
  test(`phone chrome preserves reading space at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const later = page.getByRole('button', { name: 'Later', exact: true });
    if (await later.isVisible()) await later.click();
    const header = page.locator('.conversation-header');
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(52);
    expect((await page.locator('.app-titlebar').boundingBox())!.height).toBeLessThanOrEqual(46);
    expect((await page.getByRole('region', { name: 'Messages', exact: true }).boundingBox())!.height).toBeGreaterThan(600);
    await page.getByRole('button', { name: 'Back to previous view', exact: true }).click();
    const groups = page.locator('.buddy-groups');
    expect((await groups.boundingBox())!.y).toBeLessThanOrEqual(155);
    const search = page.getByRole('searchbox', { name: 'Search conversations', exact: true });
    const filter = page.getByRole('combobox', { name: 'Conversation filter', exact: true });
    await expect(search).toBeVisible();
    const searchBox = (await page.locator('.buddy-search').boundingBox())!;
    const filterBox = (await filter.boundingBox())!;
    expect(Math.abs(searchBox.y - filterBox.y)).toBeLessThan(3);
    expect(filterBox.height).toBeGreaterThanOrEqual(44);
    await filter.selectOption('unread');
    await expect(page.getByRole('button', { name: /Welcome Lounge/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`phone-list-${width}.png`) });
  });
}

test('phone safe area stays outside fixed app content without document scrolling', async ({ page }) => {
  // Browser automation cannot create the iOS system status bar. Model its inset
  // and assert the page boundary beneath it independently of platform blur.
  await page.addStyleTag({ content: '.app-frame { padding-top: 47px; }' });
  const header = page.locator('.conversation-header');
  await expect.poll(async () => (await header.boundingBox())!.y).toBeGreaterThanOrEqual(47);
  await page.evaluate(() => window.scrollTo(0, 100));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await header.evaluate((element) => getComputedStyle(element).filter)).toBe('none');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  const sendBounds = (await send.boundingBox())!;
  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(844);
});
