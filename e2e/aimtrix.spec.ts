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

  await page.getByRole('button', { name: 'Direct Messages', exact: true }).click();
  await expect(page.getByRole('button', { name: /Mara Chen/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Welcome Lounge/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Friends' }).click();
  const gameSubspace = page.getByRole('button', { name: /Vidja Gamez/ });
  await expect(gameSubspace).toBeVisible();
  await expect(page.getByRole('button', { name: /GIF Club/ })).toBeVisible();
  await gameSubspace.click();
  await expect(page.getByRole('button', { name: /GIF Club/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Homelab' }).click();
  await expect(page.getByRole('button', { name: /Dev Shack/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mara Chen/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Personalize Aimtrix' })).toBeVisible();
  await page.getByRole('button', { name: /Appearance/ }).click();
  await page.getByRole('button', { name: 'Grape' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'grape');
});

test('desktop workspace panels resize, collapse, and restore', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Mobile uses the existing one-surface navigation flow.');
  const buddyDrawer = page.locator('.buddy-panel');
  const buddyResize = page.getByRole('separator', { name: 'Resize rooms and conversation' });
  const bounds = await buddyResize.boundingBox();
  if (!bounds) throw new Error('Buddy resize handle is not visible.');
  await page.mouse.move(bounds.x + 4, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 400, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await expect(buddyDrawer).toBeHidden();
  await page.getByRole('button', { name: 'Expand rooms' }).click();
  await expect(buddyDrawer).toBeVisible();
  const buddyBounds = await buddyDrawer.boundingBox();
  const conversationBounds = await page.getByRole('main', { name: /Welcome Lounge/ }).boundingBox();
  expect(Math.abs((buddyBounds?.y ?? 0) - (conversationBounds?.y ?? 0))).toBeLessThan(2);

  const detailsResize = page.getByRole('separator', { name: 'Resize conversation and details' });
  if (!await detailsResize.isVisible()) await page.getByRole('button', { name: 'Toggle room details' }).click();
  const chatBeforeDetailsResize = await page.getByRole('main', { name: /Welcome Lounge/ }).boundingBox();
  await detailsResize.press('ArrowRight');
  await expect.poll(async () => (await page.getByRole('main', { name: /Welcome Lounge/ }).boundingBox())?.width).toBeGreaterThan(chatBeforeDetailsResize?.width ?? 0);

  await page.getByRole('button', { name: 'Collapse conversation' }).click();
  await expect(page.getByRole('main', { name: /Welcome Lounge/ })).toBeHidden();
  await page.getByRole('button', { name: 'Expand conversation' }).click();
  await expect(page.getByRole('main', { name: /Welcome Lounge/ })).toBeVisible();

  await page.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread' });
  await thread.getByRole('button', { name: 'Collapse thread' }).click();
  await expect(thread).toBeHidden();
  await page.getByRole('button', { name: 'Expand thread' }).click();
  await expect(thread).toBeVisible();
});

test('space arrange mode supports drag reordering and moving into a subspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Native drag interaction is covered on desktop; mobile uses the same up/down and destination controls.');
  const spaces = page.getByRole('navigation', { name: 'Spaces' });
  await spaces.getByRole('button', { name: 'Homelab' }).dragTo(spaces.getByRole('button', { name: 'Friends' }));
  await expect(spaces.getByRole('button').nth(2)).toHaveAccessibleName('Homelab');
  await expect(spaces.getByRole('button').nth(3)).toHaveAccessibleName('Friends');
  await expect(spaces.locator('.space-button__drag')).toHaveCount(0);

  await page.getByRole('button', { name: 'Friends' }).click();
  await page.getByRole('button', { name: 'Arrange rooms and subspaces' }).click();

  const pixelHandle = page.getByRole('button', { name: 'Drag PixelGhost' });
  const maraRow = page.locator('.buddy-row--arranging').filter({ hasText: 'Mara Chen' });
  await pixelHandle.dragTo(maraRow);
  const arrangedNames = await page.locator('.buddy-row--arranging .buddy-row__copy strong').allTextContents();
  expect(arrangedNames.slice(0, 2)).toEqual(['PixelGhost', 'Mara Chen']);

  await page.getByLabel('Move Mara Chen to another subspace').selectOption('vidja-gamez');
  const gameBranch = page.locator('.space-branch').filter({ has: page.getByText('Vidja Gamez', { exact: true }) }).first();
  await expect(gameBranch.getByText('Mara Chen', { exact: true })).toBeVisible();
});

test('read indicators and safe room and DM backdrops are functional', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  }
  await expect(page.getByLabel('Read by Mara')).toBeVisible();
  await page.getByRole('button', { name: 'Decorate conversation background' }).click();
  let dialog = page.getByRole('dialog', { name: 'Decorate Welcome Lounge' });
  await dialog.getByRole('button', { name: 'Soft twilight' }).click();
  await dialog.getByRole('button', { name: 'Save backdrop' }).click();
  await expect(page.getByRole('main', { name: /Welcome Lounge/ })).toHaveClass(/room-backdrop--soft-twilight/);
  await expect(dialog.getByText('Artwork is always dimmed', { exact: false })).toBeVisible();
  await dialog.getByLabel('Who can change the room background').selectOption('members');

  if (testInfo.project.name === 'desktop') {
    const results = await new AxeBuilder({ page }).include('.room-background-dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  }
  await dialog.getByRole('button', { name: 'Close background decorator' }).click();

  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Friends' }).click();
    await page.getByRole('button', { name: /GIF Club/ }).click();
    await page.getByRole('button', { name: 'Decorate conversation background' }).click();
    dialog = page.getByRole('dialog', { name: 'Decorate GIF Club' });
    await dialog.getByRole('button', { name: 'Friends space' }).click();
    await expect(dialog.getByLabel('Decorator role for PixelGhost')).toBeChecked();
    await dialog.getByRole('button', { name: 'Graphite grid' }).click();
    await dialog.getByRole('button', { name: 'Save backdrop' }).click();
    await expect(page.getByRole('main', { name: /GIF Club/ })).toHaveClass(/room-backdrop--graphite-grid/);
    await dialog.getByRole('button', { name: 'Close background decorator' }).click();
  } else {
    await page.getByRole('button', { name: 'Back to buddy list' }).click();
  }
  await page.getByRole('button', { name: 'Direct Messages', exact: true }).click();
  await page.getByRole('button', { name: /Mara Chen/ }).click();
  await page.getByRole('button', { name: 'Decorate conversation background' }).click();
  dialog = page.getByRole('dialog', { name: 'Decorate Mara Chen' });
  await expect(dialog.getByText('Only you see this choice.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Citrus grove' }).click();
  await dialog.getByRole('button', { name: 'Save backdrop' }).click();
  await expect(page.getByRole('main', { name: /Mara Chen/ })).toHaveClass(/room-backdrop--citrus-grove/);
});

test('composer sends messages, emoji, and starter stickers', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  }
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: /Mara Chen/ }).click();
    await expect(page.getByLabel('Message Mara Chen')).toBeFocused();
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  }
  const composer = page.getByLabel('Message Welcome Lounge');
  await composer.fill('Browser test message');
  await composer.press('Enter');
  await expect(page.getByText('Browser test message')).toBeVisible();
  await expect(composer).toBeFocused();
  await composer.press('ArrowUp');
  await expect(composer).toHaveValue('Browser test message');
  await composer.fill('Edited browser test message');
  await composer.press('Enter');
  await expect(page.getByText('Edited browser test message')).toBeVisible();

  await page.getByRole('button', { name: 'Add emoji' }).click();
  await page.getByRole('button', { name: 'Insert 🌈' }).click();
  await expect(composer).toHaveValue('🌈');

  await page.getByRole('button', { name: 'Open sticker pack' }).click();
  await page.getByRole('button', { name: 'Send Aqua hello' }).click();
  await expect(page.getByRole('img', { name: 'Aqua hello' })).toBeVisible();

  await page.getByRole('button', { name: 'Open sticker pack' }).click();
  await page.getByLabel('Sticker pack', { exact: true }).selectOption({ label: 'Aero Days' });
  await page.getByRole('button', { name: 'Send Bubble Buddy' }).click();
  await expect(page.getByRole('img', { name: 'Bubble Buddy' })).toBeVisible();
});

test('sending from history returns to the latest local echo', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  }
  const composer = page.getByLabel('Message Welcome Lounge');
  await composer.fill('history\n'.repeat(32));
  await page.getByRole('button', { name: 'Send message' }).click();
  const timeline = page.getByRole('region', { name: 'Messages' });
  await expect.poll(() => timeline.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await timeline.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();

  await composer.fill('Back at the tail');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Back at the tail')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeHidden();
  await expect.poll(() => timeline.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(48);
});

test('thread summaries open a resizable conversation with its own composer', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  }
  await page.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread' });
  await expect(thread).toBeVisible();
  await expect(thread.getByText('That is exactly the energy.')).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    const mainComposerBounds = await page.getByLabel('Message Welcome Lounge').boundingBox();
    const threadBounds = await thread.boundingBox();
    expect((mainComposerBounds?.x ?? 0) + (mainComposerBounds?.width ?? 0)).toBeLessThanOrEqual((threadBounds?.x ?? 0) + 1);
  }
  const threadComposer = thread.getByLabel('Message thread');
  await threadComposer.fill('Thread browser test message');
  await expect(page.getByLabel('Message Welcome Lounge')).toHaveValue('');
  await threadComposer.press('Enter');
  await expect(thread.getByText('Thread browser test message')).toBeVisible();
  await expect(threadComposer).toBeFocused();
  await threadComposer.press('ArrowUp');
  await expect(threadComposer).toHaveValue('Thread browser test message');
  await threadComposer.fill('Edited thread browser test message');
  await threadComposer.press('Enter');
  await expect(thread.getByText('Edited thread browser test message')).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    const before = await thread.boundingBox();
    await thread.getByRole('separator', { name: 'Resize thread panel' }).press('End');
    await expect.poll(async () => (await thread.boundingBox())?.width).toBeGreaterThan(before?.width ?? 0);
  }
  await thread.getByRole('button', { name: 'Close thread' }).click();
  await expect(thread).toBeHidden();
});

test('profile page supports banners, frames, bios, and pinned stickers', async ({ page }, testInfo) => {
  await page.route('https://stickers.example.test/manifest.json', (route) => route.fulfill({
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ stickers: [{ id: 'tiny-sun', name: 'Tiny Sun', src: 'https://stickers.example.test/sun.svg' }] }),
  }));
  await page.locator('.self-card__profile').click();
  const dialog = page.getByRole('dialog', { name: 'My profile page' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Decorated in Aimtrix')).toBeVisible();

  await dialog.getByRole('button', { name: 'Decorate my page' }).click();
  await dialog.getByPlaceholder('A note for your own Aimtrix page — only you can read it…').fill('Welcome to my little corner of the web.');
  await dialog.getByRole('button', { name: 'Twilight' }).click();
  await dialog.getByRole('button', { name: 'Fresh leaf' }).click();
  await dialog.getByLabel('Profile sticker pack').selectOption({ label: 'Aero Days' });
  await dialog.getByRole('button', { name: 'Pin Good Morning' }).click();
  await dialog.getByLabel('Sticker pack name').fill('My Sunny Pack');
  await dialog.getByLabel('Sticker manifest URL').fill('https://stickers.example.test/manifest.json');
  await dialog.getByRole('button', { name: 'Check & install' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove My Sunny Pack' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove My Sunny Pack' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove My Sunny Pack' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save my page' }).click();

  await expect(dialog.getByText('Welcome to my little corner of the web.')).toBeVisible();
  await expect(dialog.locator('.profile-banner--twilight')).toBeVisible();
  await expect(dialog.locator('.profile-frame--leaf')).toBeVisible();
  await expect(dialog.locator('.profile-pinned-stickers')).toHaveCount(1);

  if (testInfo.project.name === 'desktop') {
    const results = await new AxeBuilder({ page }).include('.profile-dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  }

  await dialog.getByRole('button', { name: 'Close profile page' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Decorate profile page' }).click();
  await expect(page.getByRole('dialog', { name: 'My profile page' })).toBeVisible();
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
