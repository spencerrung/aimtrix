import { URL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { invariant, matrixApi, register } from './stack.mjs';
import { login, openRoom } from './journeys.mjs';

const percentile = (values, percent) => {
  const ordered = [...values].sort((left, right) => left - right);
  return Math.round(ordered[Math.max(0, Math.ceil(ordered.length * percent) - 1)] ?? 0);
};

// A bounded ten-minute real /sync workload. Every payload is synthetic, and
// only numeric measurements pass through the allowlisted report boundary.
export async function runSustainedSyncProfile({ browser, stack, check, metrics }) {
  const api = matrixApi(stack);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  try {
    const permitted = new Set(Object.values(stack.origins));
    await context.route('**/*', (route) => permitted.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    const [alice, bob] = await Promise.all([
      register(api, stack, 'sync-sender'),
      register(api, stack, 'sync-reader'),
    ]);
    const roomName = 'Synthetic sustained sync';
    let roomId;
    await check('sustained-sync-setup', async () => {
      const room = await api('/_matrix/client/v3/createRoom', {
        token: alice.access_token, method: 'POST', body: { name: roomName, preset: 'private_chat' },
      });
      invariant(typeof room.room_id === 'string', 'sustained-sync-room');
      roomId = room.room_id;
      await api(`/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}/invite`, {
        token: alice.access_token, method: 'POST', body: { user_id: bob.user_id },
      });
      await api(`/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}/join`, {
        token: bob.access_token, method: 'POST', body: {},
      });
      await login(page, stack.origins.app, 'sync-reader', stack.credentials.password);
      await openRoom(page, roomName);
      metrics.sustainedSyncRoomCount = 1;
      metrics.sustainedSyncEventCount = 0;
    });

    await check('sustained-sync-delivery', async () => {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        const values = (await cdp.send('Performance.getMetrics')).metrics;
        return values.find((entry) => entry.name === 'JSHeapUsedSize')?.value;
      };
      const heapBefore = await heap();
      const latencies = [];
      let syncResponses = 0;
      page.on('response', (response) => {
        if (new URL(response.url()).pathname.endsWith('/sync')) syncResponses += 1;
      });
      const started = Date.now();
      const total = 300;
      for (let index = 0; index < total; index += 1) {
        const cycleStarted = Date.now();
        const body = `Synthetic sustained event ${index}`;
        await api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/sustained-${index}`, {
          token: alice.access_token, method: 'PUT', body: { msgtype: 'm.text', body },
        });
        await page.locator('.timeline-message').filter({ has: page.getByText(body, { exact: true }) }).waitFor({ timeout: 30000 });
        latencies.push(Date.now() - cycleStarted);
        metrics.sustainedSyncEventCount = index + 1;
        if (index % 30 === 29) {
          invariant(await page.locator('.timeline-message').count() <= 250, 'sustained-sync-bounded-timeline');
          await page.getByRole('main', { name: roomName }).waitFor();
        }
        await pause(Math.max(0, 2000 - (Date.now() - cycleStarted)));
      }
      await pause(Math.max(0, 600000 - (Date.now() - started)));
      const heapAfter = await heap();
      metrics.sustainedSyncDurationMs = Date.now() - started;
      metrics.sustainedSyncP95Ms = percentile(latencies, 0.95);
      metrics.sustainedSyncMaxMs = Math.round(Math.max(...latencies));
      metrics.sustainedSyncResponses = syncResponses;
      if (heapBefore !== undefined && heapAfter !== undefined) {
        metrics.sustainedSyncHeapGrowthMiB = Math.max(0, Math.round((heapAfter - heapBefore) / 2 ** 20));
      }
      invariant(metrics.sustainedSyncDurationMs >= 600000, 'sustained-sync-duration');
    });
  } finally {
    await context.close();
  }
}
