import { expect, test } from '@playwright/test';

test('a saved message returns to its original conversation and can be removed', async ({ page }, testInfo) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const message = page.locator('.timeline [data-event-id="m2"]');
  await message.getByRole('button', { name: 'More message actions' }).click();
  await page.getByRole('menuitem', { name: 'Save message' }).click();
  await expect(message.getByRole('status')).toContainText('Message saved');
  await page.getByRole('button', { name: 'Saved messages', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Saved messages' });
  await expect(dialog.getByRole('button', { name: /^Welcome Lounge Saved/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('saved-messages.png') });
  await dialog.getByRole('button', { name: /^Welcome Lounge Saved/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('main', { name: 'Conversation with Welcome Lounge' })).toBeVisible();
  await page.getByRole('button', { name: 'Saved messages', exact: true }).click();
  await dialog.getByRole('button', { name: /Remove saved message/ }).click();
  await expect(dialog.getByText('No saved messages yet')).toBeVisible();
});

test('collections distinguish shared pins from loaded media and links', async ({ page }, testInfo) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const details = page.getByRole('complementary', { name: 'Buddy and room drawer' });
  if (!await details.isVisible()) await page.getByRole('button', { name: 'Toggle room details' }).click();
  await details.getByRole('tab', { name: 'Collections' }).click();
  await expect(details.getByRole('button', { name: 'Files & media' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('room-collections.png') });
  await details.getByRole('button', { name: 'Pins' }).click();
  await expect(details.getByText('Shared pins reflect current Matrix room state')).toBeVisible();
  await details.getByRole('button', { name: 'Links' }).click();
  await expect(details.getByText('Showing links in the loaded conversation window')).toBeVisible();
});
