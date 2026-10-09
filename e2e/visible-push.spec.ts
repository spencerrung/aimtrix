import { expect, test } from '@playwright/test';

// Persistent notifications require complete Chromium, not its headless shell.
test.use({ channel: 'chromium' });

test('production worker presents quiet, duplicate and unknown-owner pushes with no destination data', async ({ page, context, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Chromium CDP drives actual worker push events; physical Safari provider acceptance remains separate.');
  await context.grantPermissions(['notifications']);
  const cdp = await context.newCDPSession(page);
  let registrationId = '';
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    const current = registrations.find((item) => !item.isDeleted);
    if (current) registrationId = current.registrationId;
  });
  await cdp.send('ServiceWorker.enable');
  await page.goto('/?demo=1');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
  await expect.poll(() => registrationId).not.toBe('');
  const worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith('/sw.js'))!;
  await worker.evaluate(() => {
    const workerGlobal = globalThis as unknown as { registration: ServiceWorkerRegistration; visiblePushTestNotices: Array<{ title: string; options?: NotificationOptions }> };
    workerGlobal.visiblePushTestNotices = [];
    const show = workerGlobal.registration.showNotification.bind(workerGlobal.registration);
    workerGlobal.registration.showNotification = async (title, options) => {
      await show(title, options);
      workerGlobal.visiblePushTestNotices.push({ title, options });
    };
  });
  const payload = JSON.stringify({ room_id: '!synthetic:example.test', event_id: '$synthetic', body: 'Synthetic private payload' });
  for (const [index, mode] of ['paused', 'duplicate', 'signed-out', 'storage-denied'].entries()) {
    await page.evaluate(async (scenario) => {
      await globalThis.aimtrixNotificationPolicy.transaction(() => ({ state: scenario === 'signed-out' ? {} : {
        owner: 'synthetic-owner-001', policy: { pauseUntil: scenario === 'paused' ? Date.now() + 60_000 : 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } },
        seen: scenario === 'duplicate' ? [{ id: 'synthetic-owner-001:$synthetic', at: Date.now() }] : [],
      }, result: undefined }));
    }, mode);
    if (mode === 'storage-denied') await worker.evaluate(() => {
      globalThis.aimtrixNotificationPolicy = { ...globalThis.aimtrixNotificationPolicy, transaction: async () => { throw new Error('Synthetic denied metadata'); } };
    });
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(page.url()).origin, registrationId, data: payload });
    // Record only after Chromium accepts real persistent presentation. Native
    // display retention belongs to the OS and is not isolated between contexts.
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { visiblePushTestNotices: unknown[] }).visiblePushTestNotices.length)).toBe(index + 1);
    expect(await worker.evaluate(() => (globalThis as unknown as { visiblePushTestNotices: unknown[] }).visiblePushTestNotices.at(-1))).toEqual({
      title: 'Aimtrix', options: { body: 'Open Aimtrix to check for updates.', tag: 'aimtrix-background-update', renotify: false, silent: true,
        data: { generic: true, url: '/' }, actions: [{ action: 'open', title: 'Open Aimtrix' }] },
    });
  }
  await page.screenshot({ path: info.outputPath('visible-push-app.png') });
  await page.evaluate(async () => { for (const notice of await (await navigator.serviceWorker.ready).getNotifications()) notice.close(); });
  await cdp.detach();
});
