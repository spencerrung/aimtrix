import { URL } from 'node:url';
import { invariant, matrixApi, register } from './stack.mjs';
import { login, openRoom } from './journeys.mjs';

// This deliberately keeps Synapse's normal successful /sync cache enabled.
// Report only counts and durations; neither credentials nor room events leave
// the process through the allowlisted diagnostics.
export async function runCacheReloadProfile({ browser, stack, check, metrics }) {
  const api = matrixApi(stack);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  try {
    const permitted = new Set(Object.values(stack.origins));
    await context.route('**/*', (route) => permitted.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    const account = await register(api, stack, 'reload-profile');
    await check('cache-reload-first-login', async () => {
      await login(page, stack.origins.app, 'reload-profile', stack.credentials.password);
    });

    const roomName = 'Synthetic reload profile';
    const messageCount = 350;
    await check('cache-reload-seed', async () => {
      const room = await api('/_matrix/client/v3/createRoom', {
        token: account.access_token, method: 'POST', body: { name: roomName, preset: 'private_chat' },
      });
      invariant(typeof room.room_id === 'string', 'cache-profile-room');
      await page.locator('.buddy-row').filter({ hasText: roomName }).waitFor({ timeout: 45000 });
      const started = Date.now();
      for (let start = 0; start < messageCount; start += 25) {
        await Promise.all(Array.from({ length: Math.min(25, messageCount - start) }, (_, offset) => {
          const index = start + offset;
          return api(`/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}/send/m.room.message/profile-${index}`, {
            token: account.access_token, method: 'PUT', body: { msgtype: 'm.text', body: `Synthetic reload event ${index}` },
          });
        }));
      }
      metrics.cacheReloadSeedMs = Date.now() - started;
      metrics.cacheReloadMessages = messageCount;
    });

    await check('cache-reload-readiness-profile', async () => {
      let syncResponses = 0;
      const reloadRequests = new WeakSet();
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/sync')) reloadRequests.add(request);
      });
      page.on('response', (response) => {
        if (reloadRequests.has(response.request())) syncResponses += 1;
      });
      const started = Date.now();
      const deadline = started + 90000;
      const remaining = () => Math.max(1, deadline - Date.now());
      try {
        await page.reload();
        await page.locator('.buddy-row').filter({ hasText: roomName }).waitFor({ timeout: remaining() });
        await openRoom(page, roomName);
        await page.locator('.timeline-message').filter({ hasText: `Synthetic reload event ${messageCount - 1}` }).waitFor({ timeout: remaining() });
        invariant(Date.now() <= deadline, 'cache-reload-timeout');
        metrics.cacheReloadReadyWithin90s = 1;
      } finally {
        metrics.cacheReloadReadyMs = Date.now() - started;
        metrics.cacheReloadSyncResponses = syncResponses;
        metrics.cacheReloadReadyWithin90s ??= 0;
      }
    });
  } finally {
    await context.close();
  }
}
