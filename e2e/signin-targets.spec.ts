import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`sign-in controls support touch and keyboard at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.route('**/config.json', (route) => route.fulfill({ json: { defaultHomeserver: { serverName: 'example.test', baseUrl: 'https://example.test' } } }));
    await page.route('https://example.test/**', (route) => route.fulfill({
      status: route.request().url().endsWith('/login') ? 200 : 404,
      json: { flows: [{ type: 'm.login.password' }, { type: 'm.login.sso' }] },
    }));
    await page.goto('/');
    const matrixId = page.getByLabel('Matrix ID');
    const password = page.getByLabel('Password', { exact: true });
    const homeserver = page.getByLabel('Homeserver', { exact: true });
    const signOn = page.getByRole('button', { name: 'Sign On', exact: true });
    const sso = page.getByRole('button', { name: 'Sign in with homeserver SSO', exact: true });
    const demo = page.getByRole('button', { name: 'Explore the demo buddy list' });
    await expect(sso).toBeVisible();
    for (const control of [matrixId, password, homeserver, signOn, sso, demo]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await matrixId.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: info.outputPath('sign-in-touch-targets.png') });
    // Empty submission exercises native validation without sending credentials.
    await signOn.click();
    await expect(matrixId).toBeFocused();
    for (const control of [password, homeserver, signOn, sso, demo]) {
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
      await expect.poll(() => control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 3 && box.bottom <= innerHeight - 3
          && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
    }
    expect(await demo.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.screenshot({ path: info.outputPath('sign-in-keyboard-focus.png') });
    if (info.project.use.hasTouch) await demo.tap();
    else await demo.click();
    await expect(page.getByRole('button', { name: /Welcome Lounge/ })).toBeVisible();
  });
}
