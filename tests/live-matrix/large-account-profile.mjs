import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { invariant, matrixApi, register, until } from './stack.mjs';

const percentile = (values, percent) => {
  const ordered = [...values].sort((left, right) => left - right);
  return Math.round(ordered[Math.max(0, Math.ceil(ordered.length * percent) - 1)] ?? 0);
};

// Room creation is deliberately outside the client timing window. The
// disposable account contains only generated names and no copied room data.
export async function runLargeAccountProfile({ browser, stack, check, metrics }) {
  const roomCount = Number(process.env.AIMTRIX_LIVE_ROOM_COUNT ?? 1000);
  const sustained = process.env.AIMTRIX_LIVE_SUSTAINED === '1';
  invariant([100, 1000, 10000].includes(roomCount), 'large-account-room-count');
  const readinessLimitMs = roomCount === 10000 ? 600000 : 180000;
  const api = matrixApi(stack);
  const account = await register(api, stack, 'large-account-reader');
  const createdRoomIds = new Set();
  let lastRoomId;
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
        createdRoomIds.add(room.room_id);
        if (index === roomCount - 1) lastRoomId = room.room_id;
      }));
      metrics.largeAccountSeededRooms = Math.min(roomCount, start + 10);
    }
    metrics.largeAccountSeedMs = Date.now() - started;
  });
  await check('large-account-server-membership', async () => {
    const joined = await api('/_matrix/client/v3/joined_rooms', { token: account.access_token, timeoutMs: 60000 });
    invariant(Array.isArray(joined.joined_rooms), 'large-account-server-joined-rooms');
    const joinedRoomIds = new Set(joined.joined_rooms);
    metrics.largeAccountServerJoinedRooms = joinedRoomIds.size;
    invariant(joinedRoomIds.size === roomCount && createdRoomIds.size === roomCount
      && [...createdRoomIds].every((roomId) => joinedRoomIds.has(roomId)), 'large-account-server-joined-rooms');
  });
  if (sustained) await check('large-account-history-seed', async () => {
    invariant(typeof lastRoomId === 'string', 'large-account-room-created');
    for (let index = 0; index < 350; index += 1) {
      await api(`/_matrix/client/v3/rooms/${encodeURIComponent(lastRoomId)}/send/m.room.message/large-history-${index}`, {
        token: account.access_token, method: 'PUT', body: { msgtype: 'm.text', body: `Synthetic large-account history ${index}` },
      });
      metrics.largeAccountHistorySeededEvents = index + 1;
    }
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
    const rendererMetrics = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    };
    const heap = async () => (await rendererMetrics()).JSHeapUsedSize;
    const heapBefore = await heap();
    let syncResponses = 0;
    page.on('response', (response) => {
      if (!new URL(response.url()).pathname.endsWith('/sync') || !response.ok()) return;
      syncResponses += 1;
      metrics.largeAccountSyncResponses = syncResponses;
    });
    await check('large-account-initial-sync', async () => {
      await page.getByRole('textbox', { name: 'Matrix ID', exact: true }).fill('@large-account-reader:aimtrix.test');
      await page.getByLabel('Password', { exact: true }).fill(stack.credentials.password);
      const started = Date.now();
      await page.getByRole('button', { name: 'Sign On', exact: true }).click();
      await page.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: readinessLimitMs });
      metrics.largeAccountShellReadyMs = Date.now() - started;
      const search = page.getByRole('searchbox', { name: 'Search conversations' });
      await search.fill(roomName(roomCount - 1));
      const lastRoom = page.locator('.buddy-row').filter({ hasText: roomName(roomCount - 1) });
      await lastRoom.waitFor({ timeout: readinessLimitMs });
      metrics.largeAccountLastRoomVisibleMs = Date.now() - started;
      await search.fill('');
      const visibleTotal = async () => (await page.locator('.buddy-group__toggle span:last-child').allTextContents())
        .reduce((sum, value) => sum + Number(value), 0);
      await until(async () => {
        metrics.largeAccountUiRooms = await visibleTotal();
        return metrics.largeAccountUiRooms === roomCount;
      }, 'large-account-complete-sync', readinessLimitMs);
      invariant(syncResponses > 0, 'large-account-sync-response');
      metrics.largeAccountDeepRoomReadyMs = Date.now() - started;
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
      invariant(metrics.largeAccountDeepRoomReadyMs <= readinessLimitMs, 'large-account-ready-budget');
    });
    if (sustained) {
      const timeline = page.getByRole('region', { name: 'Messages', exact: true });
      const message = (body) => timeline.locator('.timeline-message').filter({ has: page.getByText(body, { exact: true }) });
      await check('large-account-history-navigation', async () => {
        await message('Synthetic large-account history 349').waitFor({ timeout: 45000 });
        for (let pageIndex = 0; pageIndex < 20 && await message('Synthetic large-account history 0').count() === 0; pageIndex += 1) {
          const older = page.getByRole('button', { name: 'Load older messages', exact: true });
          await until(() => older.isEnabled(), 'large-account-history-page', 45000);
          const firstEvent = await timeline.locator('[data-event-id]').first().getAttribute('data-event-id');
          await older.evaluate((button) => button.click());
          await until(async () => (await timeline.locator('[data-event-id]').first().getAttribute('data-event-id')) !== firstEvent,
            'large-account-history-page', 45000);
          metrics.largeAccountHistoryPages = pageIndex + 1;
          invariant(await timeline.locator('.timeline-message').count() <= 250, 'large-account-bounded-timeline');
        }
        invariant(await message('Synthetic large-account history 0').count() === 1, 'large-account-history-start');
        await page.getByRole('button', { name: 'Jump to latest messages', exact: true }).click();
        await page.getByRole('button', { name: 'Jump to latest messages', exact: true }).waitFor({ state: 'hidden', timeout: 45000 });
        await message('Synthetic large-account history 349').waitFor({ timeout: 45000 });
      });
      await check('large-account-sustained-delivery', async () => {
        const startingRenderer = await rendererMetrics();
        const heapStart = startingRenderer.JSHeapUsedSize;
        if (heapStart !== undefined) metrics.largeAccountIncrementalHeapAt0MiB = Math.round(heapStart / 2 ** 20);
        if (startingRenderer.Nodes !== undefined) metrics.largeAccountIncrementalNodesAt0 = startingRenderer.Nodes;
        if (startingRenderer.JSEventListeners !== undefined) metrics.largeAccountIncrementalListenersAt0 = startingRenderer.JSEventListeners;
        const latencies = [];
        const started = Date.now();
        for (let index = 0; index < 300; index += 1) {
          const cycleStarted = Date.now();
          const body = `Synthetic large-account incremental ${index}`;
          await api(`/_matrix/client/v3/rooms/${encodeURIComponent(lastRoomId)}/send/m.room.message/large-incremental-${index}`, {
            token: account.access_token, method: 'PUT', body: { msgtype: 'm.text', body },
          });
          await message(body).waitFor({ timeout: 45000 });
          latencies.push(Date.now() - cycleStarted);
          metrics.largeAccountIncrementalEvents = index + 1;
          if (index % 30 === 29) {
            invariant(await timeline.locator('.timeline-message').count() <= 250, 'large-account-bounded-timeline');
            invariant(await page.locator('.buddy-row').count() <= 101, 'large-account-bounded-rows');
          }
          await pause(Math.max(0, 2000 - (Date.now() - cycleStarted)));
          if (index === 99 || index === 199) {
            const sample = await rendererMetrics();
            if (sample.JSHeapUsedSize !== undefined) metrics[`largeAccountIncrementalHeapAt${index + 1}MiB`] = Math.round(sample.JSHeapUsedSize / 2 ** 20);
          }
        }
        await pause(Math.max(0, 600000 - (Date.now() - started)));
        metrics.largeAccountIncrementalDurationMs = Date.now() - started;
        metrics.largeAccountIncrementalP95Ms = percentile(latencies, 0.95);
        metrics.largeAccountIncrementalMaxMs = Math.round(Math.max(...latencies));
        metrics.largeAccountSyncResponses = syncResponses;
        const endingRenderer = await rendererMetrics();
        const heapAfter = endingRenderer.JSHeapUsedSize;
        if (heapAfter !== undefined) metrics.largeAccountIncrementalHeapAt300MiB = Math.round(heapAfter / 2 ** 20);
        if (endingRenderer.Nodes !== undefined) metrics.largeAccountIncrementalNodesAt300 = endingRenderer.Nodes;
        if (endingRenderer.JSEventListeners !== undefined) metrics.largeAccountIncrementalListenersAt300 = endingRenderer.JSEventListeners;
        if (heapStart !== undefined && heapAfter !== undefined) {
          metrics.largeAccountIncrementalHeapGrowthMiB = Math.max(0, Math.round((heapAfter - heapStart) / 2 ** 20));
        }
        invariant(metrics.largeAccountIncrementalDurationMs >= 600000, 'large-account-sustained-duration');
      });
    }
  } finally { await context.close(); }
}
