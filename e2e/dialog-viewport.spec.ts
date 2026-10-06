import { expect, test, type Locator } from '@playwright/test';

async function visuallyReachable(control: Locator) {
  await expect.poll(() => control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const viewport = window.visualViewport!;
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.top >= viewport.offsetTop && box.bottom <= viewport.offsetTop + viewport.height + 1 && (hit === element || element.contains(hit));
  })).toBe(true);
}

test('dialogs remain usable after a visual-only keyboard resize', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Search conversations (quick switcher)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick switcher' });
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 360 },
      offsetTop: { configurable: true, value: 40 },
      scale: { configurable: true, value: 1 },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 40 && bounds.bottom <= 401;
  })).toBe(true);
  const query = dialog.getByRole('combobox');
  await query.fill('Welcome');
  await visuallyReachable(query);
  await page.screenshot({ path: info.outputPath('keyboard-quick-switcher.png') });
  await query.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, { height: { configurable: true, value: 844 }, offsetTop: { configurable: true, value: 0 } });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await page.getByRole('button', { name: 'You settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Personalize Aimtrix' });
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, { height: { configurable: true, value: 360 }, offsetTop: { configurable: true, value: 40 } });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const theme = settings.getByRole('button', { name: /^Graphite / });
  await theme.scrollIntoViewIfNeeded();
  await visuallyReachable(theme);
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
  const close = settings.getByRole('button', { name: 'Close settings', exact: true });
  await visuallyReachable(close);
  await page.screenshot({ path: info.outputPath('keyboard-settings.png') });
  await close.click();
  await expect(settings).toBeHidden();
});
