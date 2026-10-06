import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.getByText('Welcome Lounge', { exact: true }).first()).toBeVisible();
});

test('browser install event offers an explicit install action', async ({ page }) => {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: () => Promise.resolve() },
      userChoice: { value: Promise.resolve({ outcome: 'dismissed' }) },
    });
    window.dispatchEvent(event);
  });

  const prompt = page.getByRole('complementary', { name: 'Install Aimtrix' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Install' }).click();
  await expect(prompt).toBeHidden();
});

test('offline and reconnect states explain the Matrix boundary', async ({ page }) => {
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const status = page.locator('aside[role="status"]');
  await expect(status).toContainText('You’re offline');
  await expect(status).toContainText('Matrix history may be unavailable');

  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(status).toContainText('Connection restored');
  await expect(status).toContainText('reconnecting to Matrix');
});

test('service-worker update prompt protects drafts before reload', async ({ page }) => {
  await page.evaluate(() => {
    const waitingWorker = { postMessage: () => undefined } as unknown as ServiceWorker;
    window.dispatchEvent(new CustomEvent('aimtrix-update-ready', { detail: waitingWorker }));
  });

  const status = page.getByRole('status').filter({ hasText: 'Aimtrix update ready' });
  await expect(status).toContainText('Aimtrix update ready');
  await expect(status).toContainText('Reload when you are ready');
  await status.getByRole('button', { name: 'Later' }).click();
  await expect(status).toBeHidden();
});


test('update confirmation warns before discarding a demo draft', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('textbox', { name: /Message Welcome Lounge/ }).fill('Synthetic update draft');
  await page.evaluate(() => {
    const waitingWorker = { postMessage: () => { document.documentElement.dataset.updateApplied = 'yes'; } } as unknown as ServiceWorker;
    window.dispatchEvent(new CustomEvent('aimtrix-update-ready', { detail: waitingWorker }));
  });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reload Aimtrix?' });
  await expect(dialog).toContainText('Reloading will lose unsaved changes');
  await page.screenshot({ path: testInfo.outputPath('draft-update-confirmation.png') });
  await expect(page.locator('html')).not.toHaveAttribute('data-update-applied', 'yes');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('textbox', { name: /Message Welcome Lounge/ })).toHaveText('Synthetic update draft');
  await expect(page.locator('html')).not.toHaveAttribute('data-update-applied', 'yes');
});

test('stacked install and update notices reserve space and keep Send actionable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: () => Promise.resolve() },
      userChoice: { value: Promise.resolve({ outcome: 'dismissed' }) },
    });
    window.dispatchEvent(event);
    window.dispatchEvent(new CustomEvent('aimtrix-update-ready', { detail: { postMessage: () => undefined } }));
  });
  const composer = page.getByRole('textbox', { name: /Message Welcome Lounge/ });
  await composer.fill('Synthetic unobstructed composition');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expect(send).toBeVisible();
  await expect.poll(() => send.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.bottom <= window.innerHeight && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reserved-notices-composer.png') });
  await send.click();
  await expect(composer).toHaveText('');
});

test('expanded iOS install guidance leaves the composer reachable and stays dismissed after reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }));
  await page.reload();
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  const install = page.getByRole('complementary', { name: 'Install Aimtrix' });
  await install.getByRole('button', { name: 'How to install' }).click();
  await expect(install).toContainText('Add to Home Screen');
  const composer = page.getByRole('textbox', { name: /Message Welcome Lounge/ });
  await composer.fill('Synthetic iOS guidance draft');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expect.poll(() => send.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.bottom <= window.innerHeight && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ios-expanded-install-guidance.png') });
  await send.click();
  await expect(composer).toHaveText('');
  await install.getByRole('button', { name: 'Later' }).click();
  await page.reload();
  await expect(page.getByText('Welcome Lounge', { exact: true }).first()).toBeVisible();
  await expect(install).toBeHidden();
});

test('thread Send remains tappable with stacked notices and a visual-only keyboard', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Welcome Lounge/ }).click();
  await page.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  const composer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
  await composer.fill('Synthetic thread draft with notices and keyboard');
  await page.evaluate(() => {
    const install = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(install, {
      prompt: { value: () => Promise.resolve() },
      userChoice: { value: Promise.resolve({ outcome: 'dismissed' }) },
    });
    window.dispatchEvent(install);
    window.dispatchEvent(new CustomEvent('aimtrix-update-ready', { detail: { postMessage: () => undefined } }));
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 360 },
      offsetTop: { configurable: true, value: 40 },
      scale: { configurable: true, value: 1 },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.getByRole('complementary', { name: 'Install Aimtrix' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Aimtrix update ready' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-compact-viewport', 'true');
  const send = thread.getByRole('button', { name: 'Send thread reply', exact: true });
  for (const control of [composer, send]) {
    await expect.poll(() => control.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const viewport = window.visualViewport!;
      return bounds.top >= viewport.offsetTop && bounds.bottom <= viewport.offsetTop + viewport.height
        && element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    })).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('thread-notices-visual-keyboard.png') });
  if (testInfo.project.use.hasTouch) await send.tap();
  else await send.click();
  await expect(composer).toHaveText('');
  await expect(thread.getByText('Synthetic thread draft with notices and keyboard', { exact: true })).toBeVisible();
});
