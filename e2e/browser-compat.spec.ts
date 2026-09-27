import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('sign-in remains labelled during capability discovery', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.route('**/config.json', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Aimtrix' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Matrix ID')).toBeVisible();
  await expect(page.getByLabel('Homeserver')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('sign-in.png') });
});

test('modal keyboard focus returns and reduced motion applies', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?demo=1');
  const trigger = page.getByRole('button', { name: 'Open settings' });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Personalize Aimtrix' });
  await expect(dialog).toBeVisible();
  const controls = dialog.locator('button:visible:enabled, input:visible:enabled, select:visible:enabled');
  await controls.last().focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  const motion = await page.locator('.aimtrix-window').evaluate((element) => getComputedStyle(element).animationDuration);
  expect(motion.split(',').every((duration) => parseFloat(duration) <= 0.001)).toBe(true);
  await page.screenshot({ path: info.outputPath('settings-reduced-motion.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('primary phone controls remain reachable by touch', async ({ page }, info) => {
  test.skip(!info.project.name.includes('mobile'), 'Phone touch checks run only in the WebKit phone project.');
  await page.goto('/?demo=1');
  const room = page.getByRole('button', { name: /Welcome Lounge/ });
  await expect(room).toBeVisible({ timeout: 15_000 });
  await room.tap();
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await expect(composer).toBeVisible();
  const box = (await composer.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: info.outputPath('phone-composer.png') });
});

test('long thread composition stays reachable across themes', async ({ page }, info) => {
  await page.goto('/?demo=1');
  const room = page.getByRole('button', { name: /Welcome Lounge/ });
  await expect(room).toBeVisible({ timeout: 15_000 });
  if (info.project.name.includes('mobile')) await room.tap();
  await page.getByRole('button', { name: /2 replies/ }).click();
  const composer = page.getByRole('textbox', { name: 'Message thread', exact: true });
  await composer.fill('A long synthetic reply for layout review. '.repeat(20));
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(composer).toBeVisible();
    const box = (await composer.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.screenshot({ path: info.outputPath(`thread-${theme}.png`) });
  }
});

test('error feedback and shared media viewer remain accessible across themes', async ({ page }, info) => {
  await page.goto('/?demo=1');
  const settings = page.getByRole('button', { name: 'Open settings' });
  await expect(settings).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Quick switcher', exact: true }).click();
  await page.getByRole('button', { name: 'Open Matrix link' }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Open Matrix link' });
  await linkDialog.getByRole('textbox', { name: 'Matrix link' }).fill('https://matrix.to/#/!synthetic:test/not-an-event');
  await linkDialog.getByRole('button', { name: 'Open link' }).click();
  await expect(linkDialog.getByRole('alert')).toHaveText(/Enter a complete/);
  expect((await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('link-error.png') });
  await page.keyboard.press('Escape');

  if (info.project.name.includes('mobile')) {
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
    await page.getByRole('button', { name: 'Back to previous view' }).click();
    await page.getByRole('button', { name: 'Direct Messages', exact: true }).click();
  }
  await page.getByRole('button', { name: /Mara Chen/ }).click();
  await page.getByRole('button', { name: 'View aimtrix-mark.svg full size' }).click();
  const viewer = page.getByRole('dialog', { name: 'Viewing aimtrix-mark.svg' });
  await expect(viewer).toBeVisible();
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(viewer).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`media-${theme}.png`) });
  }
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
});
