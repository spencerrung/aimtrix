import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function contained(page: Page, dialog: Locator) {
  const controls = dialog.locator('button:visible:enabled, input:visible:enabled, select:visible:enabled, textarea:visible:enabled, [tabindex="0"]:visible');
  await controls.last().focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await controls.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([]);
}

test('dialogs contain focus, restore triggers and retain Aqua character across themes', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.goto('/?demo=1');
  const settingsTrigger = page.getByRole('button', { name: 'Open settings' });
  await expect(settingsTrigger).toBeVisible();
  for (const theme of ['Aqua', 'Graphite', 'Midnight']) {
    await settingsTrigger.click();
    const settings = page.getByRole('dialog', { name: 'Personalize Aimtrix' });
    await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
    await settings.getByRole('button', { name: new RegExp(`^${theme}`) }).click();
    await contained(page, settings);
    await page.screenshot({ path: `/tmp/aimtrix-04-${info.project.name}-${theme.toLowerCase()}-settings.png` });
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(settingsTrigger).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const roomTrigger = page.getByRole('button', { name: 'Join or create room' });
  await roomTrigger.click();
  const room = page.getByRole('dialog', { name: 'Add a conversation' });
  await contained(page, room);
  await page.keyboard.press('Escape');
  await expect(roomTrigger).toBeFocused();
  const profileTrigger = page.locator('.self-card__profile');
  await profileTrigger.click();
  const profile = page.getByRole('dialog', { name: 'My profile page' });
  await profile.getByRole('button', { name: 'Decorate my page' }).click();
  await contained(page, profile);
  await profile.getByRole('button', { name: 'Save my page' }).focus();
  const saveBounds = await profile.getByRole('button', { name: 'Save my page' }).boundingBox();
  expect(saveBounds!.y + saveBounds!.height + 3).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  await page.screenshot({ path: `/tmp/aimtrix-04-${info.project.name}-profile.png` });
  await page.keyboard.press('Escape');
  await expect(profileTrigger).toBeFocused();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const backdropTrigger = page.getByRole('button', { name: 'Decorate conversation background' });
  await backdropTrigger.click();
  const backdrop = page.getByRole('dialog', { name: 'Decorate Welcome Lounge' });
  await contained(page, backdrop);
  await page.screenshot({ path: `/tmp/aimtrix-04-${info.project.name}-backdrop.png` });
  await page.keyboard.press('Escape');
  await expect(backdropTrigger).toBeFocused();
});

test('pickers accept touch and keyboard with Escape restoring their trigger', async ({ page }, info) => {
  await page.goto('/?demo=1');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: 'More message tools' }).click();
  const trigger = page.getByRole('button', { name: 'Add emoji', exact: true });
  await trigger.click();
  await expect(page.getByRole('textbox', { name: 'Search emoji', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: 'Insert 🎉', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true })).toContainText('🎉');
  await expect(page.getByRole('dialog', { name: 'Emoji picker' })).toBeHidden();
});
