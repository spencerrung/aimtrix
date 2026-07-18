import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.getByText('Welcome Lounge', { exact: true }).first()).toBeVisible();
});

test('workspace navigation, drawer, and personalization are functional', async ({ page }, testInfo) => {
  await expect(page.locator('.aimtrix-window')).toHaveCSS('width', `${await page.evaluate(() => window.innerWidth)}px`);
  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('complementary', { name: 'Buddy and room drawer' })).toBeVisible();
  } else {
    await expect(page.getByRole('complementary', { name: 'Buddy and room drawer' })).toBeHidden();
  }

  await page.getByRole('button', { name: 'Homelab' }).click();
  await expect(page.getByRole('button', { name: /Dev Shack/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mara Chen/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Personalize Aimtrix' })).toBeVisible();
  await page.getByRole('button', { name: /Appearance/ }).click();
  await page.getByRole('button', { name: 'Grape' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'grape');
});

test('composer sends messages, emoji, and starter stickers', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  }
  const composer = page.getByLabel('Message Welcome Lounge');
  await composer.fill('Browser test message');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Browser test message')).toBeVisible();

  await page.getByRole('button', { name: 'Add emoji' }).click();
  await page.getByRole('button', { name: 'Insert 🌈' }).click();
  await expect(composer).toHaveValue('🌈');

  await page.getByRole('button', { name: 'Open sticker pack' }).click();
  await page.getByRole('button', { name: 'Send Aqua hello' }).click();
  await expect(page.getByRole('img', { name: 'Aqua hello' })).toBeVisible();
});

test('loaded message search filters the timeline', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  }
  await page.getByRole('button', { name: 'Search loaded messages' }).click();
  await page.getByPlaceholder('Search loaded messages').fill('2006');
  await expect(page.getByText('The goal: 2006 in spirit, 2026 where it matters.')).toBeVisible();
  await expect(page.getByText("Okay, this already feels like the chat app we should've had all along.")).toBeHidden();
});

test('critical settings expose a truthful demo state', async ({ page }) => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: /Matrix & security/ }).click();
  await expect(page.getByText('Matrix account settings require a real signed-in session.')).toBeVisible();
});

test('has no automatically detectable WCAG A/AA violations on the main workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'The same semantic workspace is covered on desktop.');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
