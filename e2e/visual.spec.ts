import { expect, test } from '@playwright/test';

// Baselines use Chromium on Linux, Arial/Liberation Sans, fixed UTC time, DPR 1,
// reduced motion and synthetic demo content. Other engines keep geometry gates.
test.use({ timezoneId: 'UTC', deviceScaleFactor: 1 });
for (const width of [320, 390, 1280]) {
  test(`reviewed conversation appearance at ${width}px`, async ({ page, browserName, isMobile }, info) => {
    test.skip(browserName !== 'chromium' || process.platform !== 'linux', 'Visual baselines use Linux Chromium; cross-engine geometry is tested separately.');
    test.skip(isMobile !== (width < 768), 'Match touch and desktop presentation.');
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?demo=1');
    await page.getByRole('button', { name: /Welcome Lounge/ }).click();
    await page.addStyleTag({ content: '* { font-family: Arial, sans-serif !important; }' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('textbox', { name: 'Message Welcome Lounge', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot(`conversation-${width}.png`, {
      animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.003,
    });
    await page.screenshot({ path: info.outputPath(`reviewed-conversation-${width}.png`), animations: 'disabled', caret: 'hide' });
  });
}
