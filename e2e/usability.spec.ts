import { expect, test, type Locator } from '@playwright/test';

async function expectUncovered(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect.poll(() => control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
}

test('visual viewport keyboard geometry preserves usable composition', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'Requires mobile layout. Geometry simulation does not emulate an OS keyboard.');
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('Keyboard geometry regression');
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 360 },
      offsetTop: { configurable: true, value: 40 },
      scale: { configurable: true, value: 1 },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-compact-viewport', 'true');
  await expect.poll(() => composer.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.top >= 40 && box.bottom <= 401;
  })).toBe(true);
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expectUncovered(send);
  await page.screenshot({ path: info.outputPath('visual-viewport-keyboard.png') });
  await send.tap();
  await expect(page.getByText('Keyboard geometry regression', { exact: true })).toBeVisible();
});

test('install help reserves space and leaves Send tappable', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'Requires a touch context. iPhone user agent exercises guidance, not Safari installation.');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
    sessionStorage.removeItem('aimtrix-install-dismissed');
  });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: 'How to install' }).tap();
  const composer = page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true });
  await composer.fill('Install guidance leaves composition reachable');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expectUncovered(send);
  await page.screenshot({ path: info.outputPath('install-help-composition.png') });
  await send.tap();
  await expect(page.getByText('Install guidance leaves composition reachable', { exact: true })).toBeVisible();
});
