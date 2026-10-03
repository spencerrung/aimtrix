import process from 'node:process';
import { URL } from 'node:url';
import { invariant, matrixApi, register, until } from './stack.mjs';

// Room creation is deliberately outside the client timing window. The
// disposable account contains only generated names and no copied room data.
export async function runLargeAccountProfile({ browser, stack, check, metrics }) {
  const roomCount = Number(process.env.AIMTRIX_LIVE_ROOM_COUNT ?? 1000);
  invariant([100, 1000, 10000].includes(roomCount), 'large-account-room-count');
  const api = matrixApi(stack);
  const account = await register(api, stack, 'large-account-reader');
  const roomName = (index) => `Synthetic live room ${String(index).padStart(5, '0')}`;
  metrics.largeAccountRoomCount = roomCount;
  metrics.largeAccountSeededRooms = 0;
  await check('large-account-seed', async () => {
    const started = Date.now();
    for (let start = 0; start < roomCount; start += 10) {
      await Promise.all(Array.from({ length: Math.min(10, roomCount - start) }, async (_, offset) => {
        const index = start + offset;
        const room = await api('/_matrix/client/v3/createRoom', {
          token: account.access_token, method: 'POST', body: { name: roomName(index), preset: 'private_chat' },
        });
        invariant(typeof room.room_id === 'string', 'large-account-room-created');
      }));
      metrics.largeAccountSeededRooms = Math.min(roomCount, start + 10);
    }
    metrics.largeAccountSeedMs = Date.now() - started;
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    const permitted = new Set(Object.values(stack.origins));
    await context.route('**/*', (route) => permitted.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    await page.goto(stack.origins.app);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      return (await cdp.send('Performance.getMetrics')).metrics.find((entry) => entry.name === 'JSHeapUsedSize')?.value;
    };
    const heapBefore = await heap();
    let syncResponses = 0, invalidSyncResponses = 0;
    const syncedRoomIds = new Set();
    page.on('response', (response) => {
      if (!new URL(response.url()).pathname.endsWith('/sync') || !response.ok()) return;
      syncResponses += 1;
      void response.json().then((body) => {
        for (const roomId of Object.keys(body.rooms?.join ?? {})) syncedRoomIds.add(roomId);
      }).catch(() => { invalidSyncResponses += 1; });
    });
    await check('large-account-initial-sync', async () => {
      await page.getByRole('textbox', { name: 'Matrix ID', exact: true }).fill('@large-account-reader:aimtrix.test');
      await page.getByLabel('Password', { exact: true }).fill(stack.credentials.password);
      const started = Date.now();
      await page.getByRole('button', { name: 'Sign On', exact: true }).click();
      await page.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 180000 });
      metrics.largeAccountShellReadyMs = Date.now() - started;
      const search = page.getByRole('searchbox', { name: 'Search conversations' });
      await search.fill(roomName(roomCount - 1));
      const lastRoom = page.locator('.buddy-row').filter({ hasText: roomName(roomCount - 1) });
      await lastRoom.waitFor({ timeout: 180000 });
      await search.fill('');
      const visibleTotal = async () => (await page.locator('.buddy-group__toggle span:last-child').allTextContents())
        .reduce((sum, value) => sum + Number(value), 0);
      await until(async () => syncedRoomIds.size === roomCount && await visibleTotal() === roomCount,
        'large-account-complete-sync', 180000);
      invariant(invalidSyncResponses === 0, 'large-account-sync-json');
      metrics.largeAccountDeepRoomReadyMs = Date.now() - started;
      metrics.largeAccountObservedRooms = syncedRoomIds.size;
      metrics.largeAccountUiRooms = await visibleTotal();
      metrics.largeAccountRenderedRows = await page.locator('.buddy-row').count();
      invariant(metrics.largeAccountRenderedRows > 0 && metrics.largeAccountRenderedRows <= 101, 'large-account-bounded-rows');
      metrics.largeAccountDomNodes = await page.locator('*').count();
      await search.fill(roomName(roomCount - 1));
      await lastRoom.waitFor();
      const navigationStarted = Date.now();
      await lastRoom.click();
      await page.getByRole('main', { name: roomName(roomCount - 1) }).waitFor({ timeout: 45000 });
      metrics.largeAccountDeepRoomOpenMs = Date.now() - navigationStarted;
      metrics.largeAccountSyncResponses = syncResponses;
      const heapAfter = await heap();
      if (heapBefore !== undefined && heapAfter !== undefined) {
        metrics.largeAccountHeapGrowthMiB = Math.max(0, Math.round((heapAfter - heapBefore) / 2 ** 20));
      }
      invariant(metrics.largeAccountDeepRoomReadyMs <= 180000, 'large-account-ready-budget');
    });
  } finally { await context.close(); }
}
