import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).first().click();
});

test('message navigation uses one Tab entry and returns to the composer', async ({ page }) => {
  const timeline = page.locator('.conversation .timeline');
  const rows = timeline.locator('[data-keyboard-message]');
  await expect(rows.first()).toBeVisible();
  await expect(timeline.locator('[data-keyboard-message][tabindex="0"]')).toHaveCount(1);
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => rows.nth(1).evaluate((row) => row.contains(document.activeElement) && row !== document.activeElement)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Message Welcome Lounge' })).toBeFocused();
  await rows.first().focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => timeline.evaluate((node) => !node.contains(document.activeElement))).toBe(true);
  await page.getByRole('textbox', { name: 'Message Welcome Lounge' }).focus();
  await page.keyboard.press('Shift+F6');
  await expect(rows.first()).toBeFocused();
});

test('touch messages expose one action entry and retain reply and reaction menus', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'Touch-specific action layout');
  const row = page.locator('.conversation [data-keyboard-message]').first();
  await expect(row.locator('.message-actions button:visible')).toHaveCount(1);
  for (const message of await page.locator('.conversation [data-keyboard-message]').all()) {
    const geometry = await message.evaluate((element) => {
      const box = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
      const button = box('.message-actions__more'), bubble = box('.timeline-message__content'), avatar = box(':scope > .avatar');
      return { contained: button.left >= bubble.left && button.right <= bubble.right && button.top >= bubble.top && button.bottom <= bubble.bottom,
        overlapsAvatar: button.left < avatar.right && button.right > avatar.left && button.top < avatar.bottom && button.bottom > avatar.top,
        width: button.width, height: button.height };
    });
    expect(geometry.contained).toBe(true);
    expect(geometry.overlapsAvatar).toBe(false);
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
  }
  const more = row.getByRole('button', { name: 'More message actions' });
  await more.click();
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click();
  await expect(page.locator('.conversation .composer-context')).toContainText('Replying to');
  await page.getByRole('button', { name: 'Cancel reply or edit' }).click();
  await more.click();
  await page.getByRole('menuitem', { name: 'Add reaction', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a reaction' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await page.screenshot({ path: info.outputPath('touch-message-actions.png') });
});

test('composer typing avoids timeline measurements while sent messages retain one Tab entry', async ({ page }) => {
  const timeline = page.locator('.conversation .timeline');
  const rows = timeline.locator('[data-keyboard-message]');
  await expect(rows.first()).toBeVisible();
  const initialCount = await rows.count();
  await page.evaluate(() => {
    document.documentElement.dataset.keyboardRowMeasurements = '0';
    for (const row of document.querySelectorAll<HTMLElement>('.conversation [data-keyboard-message]')) {
      const measure = row.getClientRects.bind(row);
      row.getClientRects = () => {
        document.documentElement.dataset.keyboardRowMeasurements = String(Number(document.documentElement.dataset.keyboardRowMeasurements) + 1);
        return measure();
      };
    }
  });
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge' });
  await composer.pressSequentially('Synthetic keyboard performance reply');
  expect(await page.locator('html').getAttribute('data-keyboard-row-measurements')).toBe('0');
  await composer.press('Enter');
  await expect(rows).toHaveCount(initialCount + 1);
  await expect.poll(async () => Number(await page.locator('html').getAttribute('data-keyboard-row-measurements'))).toBeGreaterThan(0);
  await expect(timeline.locator('[data-keyboard-message][tabindex="0"]')).toHaveCount(1);
  await expect(rows.last().locator('button[tabindex="-1"]').first()).toBeAttached();
  await rows.last().focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => rows.last().evaluate((row) => row !== document.activeElement && row.contains(document.activeElement))).toBe(true);
});
