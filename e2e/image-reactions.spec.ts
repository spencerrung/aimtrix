import { expect, test } from '@playwright/test';

// Mock catalog assets at the network boundary; service-worker lifecycle has its own production gate.
test.use({ serviceWorkers: 'block' });

test('configured custom image emoji remain searchable and selectable as reactions', async ({ page, isMobile }) => {
  await page.route('**/emoji/packs/*/manifest.json', (route) => route.fulfill({ json: { entries: [{ id: 'synthetic-wave', name: 'Synthetic wave', aliases: ['synthetic cheer'], src: '/synthetic-emoji.svg' }] } }));
  await page.route('**/synthetic-emoji.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="purple"/></svg>' }));
  await page.goto('/?demo=1');
  if (isMobile) await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const row = page.locator('.conversation .timeline-message').first();
  await row.getByRole('button', { name: 'More message actions' }).click();
  await page.getByRole('menuitem', { name: 'Add reaction', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a reaction' });
  await picker.getByRole('textbox', { name: 'Search reaction emoji' }).fill('synthetic cheer');
  const choice = picker.getByRole('button', { name: 'React with :synthetic-wave:' });
  await expect(choice).toBeVisible();
  await expect.poll(() => choice.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await choice.click();
  await expect(picker).toBeHidden();
  await expect(row.getByRole('button', { name: ':synthetic-wave:, 1 reactions' })).toBeVisible();
});
