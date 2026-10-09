import { expect, test, type Locator } from '@playwright/test';

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

/** Geometry includes the visual viewport's layout offset, plus real pointer reachability. */
async function expectReachable(control: Locator) {
  await expect.poll(() => control.evaluate((node) => {
    const bounds = node.getBoundingClientRect(), viewport = window.visualViewport!;
    return bounds.width > 0 && bounds.height > 0
      && bounds.top >= viewport.offsetTop && bounds.bottom <= viewport.offsetTop + viewport.height
      && bounds.left >= viewport.offsetLeft && bounds.right <= viewport.offsetLeft + viewport.width
      && node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  })).toBe(true);
}

async function expectAboveComposer(picker: Locator, composer: Locator) {
  await expect.poll(async () => {
    const popup = await picker.boundingBox(), form = await composer.boundingBox();
    return popup !== null && form !== null && popup.y + popup.height <= form.y;
  }).toBe(true);
}

async function expectUnobstructedResults(picker: Locator) {
  await expect.poll(() => picker.locator(':scope > div').evaluate((grid) => {
    const bounds = grid.getBoundingClientRect();
    const visible = [...grid.querySelectorAll('button')].filter((button) => {
      const b = button.getBoundingClientRect();
      return b.top >= bounds.top && b.bottom <= bounds.bottom;
    });
    return visible.length > 0 && visible.every((button) => {
      const b = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
    });
  })).toBe(true);
}

for (const [width, height] of [[320, 320], [390, 340], [430, 360]]) {
  for (const resize of ['layout', 'visual'] as const) {
    for (const kind of ['room', 'thread'] as const) {
      test(`${kind} composer pickers search and send at ${width}x${height} with ${resize} keyboard geometry`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.route('**/config.json', async (route) => {
          const response = await route.fetch();
          const config = await response.json();
          await route.fulfill({ json: { ...config, stickerPacks: [{ name: 'Synthetic long configured pack', manifestUrl: '/synthetic-stickers.json' }] } });
        });
        await page.route('**/synthetic-stickers.json', (route) => route.fulfill({ json: {
          stickers: Array.from({ length: 48 }, (_, index) => ({ id: `synthetic-${index}`, name: `Synthetic sticker ${index}`, src: '/stickers/aqua/hey.svg' })),
        } }));
        await page.goto('/?demo=1');
        await page.getByRole('button', { name: /Welcome Lounge/ }).click();
        const dismiss = page.getByRole('button', { name: 'Dismiss installation notice' });
        if (await dismiss.count()) await dismiss.click();
        if (kind === 'thread') await page.getByRole('button', { name: /2 replies/ }).click();
        const surface = kind === 'thread' ? page.getByRole('complementary', { name: 'Thread', exact: true })
          : page.getByRole('main', { name: 'Conversation with Welcome Lounge', exact: true });
        const editor = surface.getByRole('textbox', { name: kind === 'thread' ? 'Message thread' : 'Message Welcome Lounge', exact: true });
        await surface.getByRole('button', { name: 'More message tools', exact: true }).click();
        await surface.getByRole('button', { name: 'Add emoji', exact: true }).click();
        const emoji = page.getByRole('dialog', { name: 'Emoji picker', exact: true });
        const search = emoji.getByRole('textbox', { name: 'Search emoji', exact: true });
        await expect(search).toBeFocused();
        // This item is absent from the immediate fallback: wait for the lazy catalog replacement.
        await expect(emoji.getByRole('button', { name: 'Insert 😃', exact: true })).toBeVisible();
        if (resize === 'layout') await page.setViewportSize({ width, height });
        else await page.evaluate(({ height, width }) => {
          Object.defineProperties(window.visualViewport!, {
            height: { configurable: true, value: height }, width: { configurable: true, value: width - 16 },
            offsetTop: { configurable: true, value: 40 }, offsetLeft: { configurable: true, value: 8 },
          });
          window.visualViewport!.dispatchEvent(new Event('resize'));
        }, { height, width });
        await expectReachable(emoji);
        await expectReachable(search);
        await expectReachable(emoji.locator('header'));
        await emoji.locator(':scope > div').evaluate((grid) => { grid.scrollTop = grid.scrollHeight; });
        await expectReachable(search);
        await expectReachable(emoji.getByRole('button').last());
        await expectUnobstructedResults(emoji);
        await page.screenshot({ path: info.outputPath(`${kind}-emoji-${width}-${resize}-keyboard.png`) });
        await search.fill('red heart');
        const heart = emoji.getByRole('button', { name: 'Insert ❤️', exact: true });
        await expectReachable(heart);
        if (info.project.use.hasTouch) await heart.tap(); else await heart.click();
        await expect(emoji).toHaveCount(0);
        await expect(editor).toHaveText('❤️');
        const send = surface.getByRole('button', { name: kind === 'thread' ? 'Send thread reply' : 'Send message', exact: true });
        await expectReachable(send);
        if (info.project.use.hasTouch) await send.tap(); else await send.click();
        await expect(editor).toHaveText('');
        await expect(surface.getByText('❤️', { exact: true })).toBeVisible();

        await surface.getByRole('button', { name: 'Open sticker pack', exact: true }).click();
        const sticker = page.getByRole('dialog', { name: 'Sticker picker', exact: true });
        const packs = sticker.getByRole('combobox', { name: 'Sticker pack', exact: true });
        await expectReachable(sticker);
        await expectReachable(packs);
        await expectReachable(sticker.locator('header'));
        await packs.selectOption({ label: 'Synthetic long configured pack' });
        await expect(sticker.getByRole('button')).toHaveCount(48);
        const last = sticker.getByRole('button', { name: 'Send Synthetic sticker 47', exact: true });
        await last.scrollIntoViewIfNeeded();
        await expectReachable(last);
        await expectReachable(packs);
        await expectUnobstructedResults(sticker);
        await page.screenshot({ path: info.outputPath(`${kind}-stickers-${width}-${resize}-keyboard.png`) });
        if (info.project.use.hasTouch) await last.tap(); else await last.click();
        await expect(sticker).toHaveCount(0);
        await expect(surface.getByRole('img', { name: 'Synthetic sticker 47', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (resize === 'visual') {
          // Scrolling/panning a still-open visual viewport must reposition the picker too.
          await surface.getByRole('button', { name: 'Open sticker pack', exact: true }).click();
          await page.evaluate(() => {
            Object.defineProperty(window.visualViewport!, 'offsetTop', { configurable: true, value: 80 });
            window.visualViewport!.dispatchEvent(new Event('scroll'));
          });
          await expectReachable(packs);
          await page.keyboard.press('Escape');
          await expect(surface.getByRole('button', { name: 'Open sticker pack', exact: true })).toBeFocused();
        }
      });
    }
  }
}

test('desktop room and thread pickers retain search, pack selection and focus return', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  for (const kind of ['room', 'thread'] as const) {
    if (kind === 'thread') await page.getByRole('button', { name: /2 replies/ }).click();
    const surface = kind === 'thread' ? page.getByRole('complementary', { name: 'Thread', exact: true })
      : page.getByRole('main', { name: 'Conversation with Welcome Lounge', exact: true });
    const form = surface.getByRole('form', { name: kind === 'thread' ? 'Thread message composer' : 'Message composer', exact: true });
    const more = surface.getByRole('button', { name: 'More message tools', exact: true });
    if (await more.isVisible()) await more.click();
    const opener = surface.getByRole('button', { name: 'Add emoji', exact: true });
    await opener.click();
    const emoji = page.getByRole('dialog', { name: 'Emoji picker', exact: true });
    await expectReachable(emoji.getByRole('textbox', { name: 'Search emoji' }));
    await expectUnobstructedResults(emoji);
    await expectAboveComposer(emoji, form);
    await page.screenshot({ path: info.outputPath(`${kind}-emoji-desktop.png`) });
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await surface.getByRole('button', { name: 'Open sticker pack', exact: true }).click();
    const stickers = page.getByRole('dialog', { name: 'Sticker picker', exact: true });
    await stickers.getByRole('combobox', { name: 'Sticker pack', exact: true }).selectOption({ label: 'Aero Days' });
    await expect(stickers.getByRole('button').first()).toBeVisible();
    await expectReachable(stickers.getByRole('combobox', { name: 'Sticker pack', exact: true }));
    await expectUnobstructedResults(stickers);
    await expectAboveComposer(stickers, form);
    await page.screenshot({ path: info.outputPath(`${kind}-stickers-desktop.png`) });
    await page.keyboard.press('Escape');
    await expect(surface.getByRole('button', { name: 'Open sticker pack', exact: true })).toBeFocused();
  }
});

test('composer picker portals dismiss on outside taps and room/thread navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const room = page.getByRole('main', { name: 'Conversation with Welcome Lounge', exact: true });
  const editor = room.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await room.getByRole('button', { name: 'More message tools', exact: true }).click();
  const emojiOpener = room.getByRole('button', { name: 'Add emoji', exact: true });
  await emojiOpener.click();
  await expect(page.getByRole('dialog', { name: 'Emoji picker', exact: true })).toBeVisible();
  if (info.project.use.hasTouch) await editor.tap(); else await editor.click();
  await expect(page.getByRole('dialog', { name: 'Emoji picker', exact: true })).toHaveCount(0);
  await expect(editor).toBeFocused();
  await emojiOpener.click();
  await page.keyboard.press('Escape');
  await expect(emojiOpener).toBeFocused();
  await room.getByRole('button', { name: 'Open sticker pack', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sticker picker', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sticker picker', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await thread.getByRole('button', { name: 'More message tools', exact: true }).click();
  await thread.getByRole('button', { name: 'Open sticker pack', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sticker picker', exact: true })).toBeVisible();
  await thread.getByRole('button', { name: 'Close thread', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sticker picker', exact: true })).toHaveCount(0);
  await expect(editor).toBeVisible();
  expect(await page.getByRole('dialog', { name: /Emoji picker|Sticker picker/ }).count()).toBe(0);
});
