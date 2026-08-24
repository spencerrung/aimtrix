import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile viewport checks run against the Pixel 7 project.');
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

  await timeline.evaluate((element) => {
    element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) / 2);
    element.dispatchEvent(new Event('scroll'));
  });
  const before = await timeline.evaluate((element) => element.scrollTop);

  await page.setViewportSize({ width: 568, height: 320 });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));

  await expect(composer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to buddy list' })).toBeVisible();
  expect(await composer.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
  expect(Math.abs(await timeline.evaluate((element) => element.scrollTop) - before)).toBeLessThan(48);
});
