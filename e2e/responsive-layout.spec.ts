import { expect, test, type Locator } from '@playwright/test';

async function actionable(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect.poll(() => control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return element === hit || element.contains(hit);
  })).toBe(true);
}

// Geometry assertions are portable across engines/fonts; screenshots are retained
// beside each result for human review of the complete rendered composition.
for (const width of [320, 360, 390, 412, 768, 900, 1280, 1440]) {
  test(`navigation and room/thread composition fit ${width}px`, async ({ page, isMobile }, info) => {
    test.skip(isMobile !== (width < 768), 'Exercise each width with its corresponding pointer model.');
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?demo=1');
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
    const room = page.getByRole('main', { name: 'Conversation with Welcome Lounge' });
    const composer = room.getByRole('textbox', { name: 'Message Welcome Lounge' });
    if (isMobile) expect((await room.locator('.composer').boundingBox())!.height).toBeLessThanOrEqual(60);
    await composer.fill('Keep this while visiting a thread');
    await actionable(room.getByRole('button', { name: 'Send message', exact: true }));
    await actionable(room.getByRole('button', { name: 'Conversation actions', exact: true }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await room.locator('.conversation-header').evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(70);
    if (isMobile) {
      const navigation = page.getByRole('navigation', { name: 'Main navigation' });
      await actionable(navigation.getByRole('button', { name: 'Chats', exact: true }));
      const targets = room.locator('.reaction, .thread-summary');
      for (const target of await targets.all()) {
        const bounds = await target.boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(room.locator('.message-actions__quick').first()).not.toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`room-${width}.png`) });
    await room.getByRole('button', { name: /2 replies/ }).click();
    const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
    await thread.getByRole('textbox', { name: 'Message thread' }).fill('A separate thread draft');
    await actionable(thread.getByRole('button', { name: 'Send thread reply', exact: true }));
    await actionable(thread.getByRole('button', { name: 'Close thread' }));
    await page.screenshot({ path: info.outputPath(`thread-${width}.png`) });
    await thread.getByRole('button', { name: 'Close thread' }).click();
    await expect(composer).toHaveText('Keep this while visiting a thread');
  });
}
