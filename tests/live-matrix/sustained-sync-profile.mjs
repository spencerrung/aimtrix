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

// Two independent Aimtrix devices exercise the actual encrypted composer,
// Megolm wire event, incremental sync, and receiver decryption for ten minutes.
export async function runEncryptedSustainedSyncProfile({ browser, stack, check, metrics }) {
  const api = matrixApi(stack);
  const senderContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  let readerContext;
  try {
    readerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const permitted = new Set(Object.values(stack.origins));
    for (const context of [senderContext, readerContext]) {
      await context.route('**/*', (route) => permitted.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    }
    const [senderPage, readerPage] = await Promise.all([senderContext.newPage(), readerContext.newPage()]);
    for (const page of [senderPage, readerPage]) {
      page.setDefaultTimeout(20000);
      page.setDefaultNavigationTimeout(30000);
    }
    const [sender, reader] = await Promise.all([
      register(api, stack, 'encrypted-sync-sender'),
      register(api, stack, 'encrypted-sync-reader'),
    ]);
    const roomName = 'Synthetic encrypted sustained sync';
    let roomId;
    let plaintextSends = 0;
    senderPage.on('request', (request) => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname.includes('/send/m.room.message/')) plaintextSends += 1;
    });
    const visibleMessage = (body) => readerPage.locator('.timeline-message').filter({ has: readerPage.getByText(body, { exact: true }) });
    const sendEncrypted = async (body) => {
      const composer = senderPage.getByRole('textbox', { name: `Message ${roomName}`, exact: true });
      await composer.fill(body);
      const sent = senderPage.waitForResponse((response) => response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.includes(`/rooms/${encodeURIComponent(roomId)}/send/m.room.encrypted/`), { timeout: 45000 });
      await senderPage.getByRole('button', { name: 'Send message', exact: true }).click();
      const response = await sent;
      const content = response.request().postDataJSON();
      invariant(response.ok() && content?.algorithm === 'm.megolm.v1.aes-sha2' &&
        !JSON.stringify(content).includes(body) && plaintextSends === 0, 'encrypted-sync-wire');
      await visibleMessage(body).waitFor({ timeout: 45000 });
    };
    await check('encrypted-sustained-sync-setup', async () => {
      const room = await api('/_matrix/client/v3/createRoom', {
        token: sender.access_token, method: 'POST', body: {
          name: roomName, preset: 'private_chat',
          initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
        },
      });
      invariant(typeof room.room_id === 'string', 'encrypted-sync-room');
      roomId = room.room_id;
      await api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
        token: sender.access_token, method: 'POST', body: { user_id: reader.user_id },
      });
      await api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, {
        token: reader.access_token, method: 'POST', body: {},
      });
      await Promise.all([
        login(senderPage, stack.origins.app, 'encrypted-sync-sender', stack.credentials.password),
        login(readerPage, stack.origins.app, 'encrypted-sync-reader', stack.credentials.password),
      ]);
      await Promise.all([openRoom(senderPage, roomName), openRoom(readerPage, roomName)]);
      await sendEncrypted('Synthetic encrypted sync warmup');
      metrics.encryptedSyncRoomCount = 1;
      metrics.encryptedSyncEventCount = 0;
      metrics.encryptedSyncWireCount = 0;
    });

    await check('encrypted-sustained-sync-delivery', async () => {
      const cdp = await readerContext.newCDPSession(readerPage);
      await cdp.send('Performance.enable');
      const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Performance.getMetrics')).metrics.find((entry) => entry.name === 'JSHeapUsedSize')?.value;
      };
      const heapBefore = await heap();
      const latencies = [];
      let syncResponses = 0;
      readerPage.on('response', (response) => {
        if (new URL(response.url()).pathname.endsWith('/sync')) syncResponses += 1;
      });
      const started = Date.now();
      for (let index = 0; index < 300; index += 1) {
        const cycleStarted = Date.now();
        await sendEncrypted(`Synthetic encrypted sustained event ${index}`);
        latencies.push(Date.now() - cycleStarted);
        metrics.encryptedSyncEventCount = index + 1;
        metrics.encryptedSyncWireCount = index + 1;
        if (index % 30 === 29) {
          invariant(await readerPage.locator('.timeline-message').count() <= 250, 'encrypted-sync-bounded-timeline');
          await readerPage.getByRole('main', { name: roomName }).waitFor();
        }
        await pause(Math.max(0, 2000 - (Date.now() - cycleStarted)));
      }
      await pause(Math.max(0, 600000 - (Date.now() - started)));
      const heapAfter = await heap();
      metrics.encryptedSyncDurationMs = Date.now() - started;
      metrics.encryptedSyncP95Ms = percentile(latencies, 0.95);
      metrics.encryptedSyncMaxMs = Math.round(Math.max(...latencies));
      metrics.encryptedSyncResponses = syncResponses;
      if (heapBefore !== undefined && heapAfter !== undefined) {
        metrics.encryptedSyncHeapGrowthMiB = Math.max(0, Math.round((heapAfter - heapBefore) / 2 ** 20));
      }
      invariant(metrics.encryptedSyncDurationMs >= 600000, 'encrypted-sync-duration');
    });
  } finally {
    await Promise.all([senderContext.close(), readerContext?.close()]);
  }
}
