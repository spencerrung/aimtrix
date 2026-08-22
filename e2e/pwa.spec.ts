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
  const status = page.getByRole('status');
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

  const status = page.getByRole('status');
  await expect(status).toContainText('Aimtrix update ready');
  await expect(status).toContainText('Finish any draft');
  await status.getByRole('button', { name: 'Later' }).click();
  await expect(status).toBeHidden();
});
