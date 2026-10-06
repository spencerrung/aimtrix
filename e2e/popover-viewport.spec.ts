import { expect, test } from '@playwright/test';

test('message actions and reaction search stay inside an offset keyboard viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: 'More message actions' }).last().click();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperties(viewport, { height: { configurable: true, get: () => 340 }, offsetTop: { configurable: true, get: () => 40 } });
    viewport.dispatchEvent(new Event('resize'));
  });
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await expect.poll(async () => menu.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 52 && bounds.bottom <= 368;
  })).toBe(true);
  await menu.getByRole('menuitem', { name: 'Add reaction' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a reaction' });
  await expect(picker).toBeVisible();
  await expect.poll(async () => picker.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 52 && bounds.bottom <= 368;
  })).toBe(true);
  await picker.getByRole('textbox', { name: 'Search reaction emoji' }).fill('heart');
  await expect.poll(async () => picker.evaluate((element) => element.getBoundingClientRect().bottom <= 368)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
});

test('zoomed menus and reaction grids fit a narrow visual viewport without changing the shell to keyboard mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: 'More message actions' }).last().click();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperties(viewport, {
      width: { configurable: true, get: () => 195 }, height: { configurable: true, get: () => 332 },
      offsetTop: { configurable: true, get: () => 40 }, offsetLeft: { configurable: true, get: () => 80 },
      scale: { configurable: true, get: () => 2 },
    });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-compact-viewport', 'false');
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await expect.poll(() => menu.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 92 && bounds.right <= 263 && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  await menu.getByRole('menuitem', { name: 'Add reaction' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a reaction' });
  await expect.poll(() => picker.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 92 && bounds.right <= 263 && element.scrollWidth <= element.clientWidth
      && [...element.querySelectorAll('.reaction-picker__grid')].every((grid) => grid.scrollWidth <= grid.clientWidth);
  })).toBe(true);
  await picker.getByRole('textbox', { name: 'Search reaction emoji' }).fill('heart');
  await picker.getByRole('button', { name: /React with/ }).first().click();
  await expect(picker).toBeHidden();
});
