/* global localStorage, indexedDB, fetch, AbortSignal, window, Event */
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { invariant, until, register, matrixApi } from './stack.mjs';

export const session = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
export async function login(page, origin, user, password) {
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Matrix ID', exact: true }).fill(`@${user}:aimtrix.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign On', exact: true }).click();
  await page.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 60000 });
}
export async function openRoom(page, name) {
  await page.locator('.buddy-row').filter({ hasText: name }).first().click();
  await page.getByRole('main', { name }).waitFor();
}
const encode = encodeURIComponent;
export async function runJourneys({ browser, stack, check, forceFailure, metrics }) {
  const api = matrixApi(stack);
  const accounts = {};
  await check('isolated-accounts', async () => {
    for (const name of ['alice', 'bob', 'charlie']) accounts[name] = await register(api, stack, name);
  });
  const contexts = [];
  const newPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    contexts.push(context);
    // A bad default/discovery target must fail locally, never contact a real account service.
    const permitted = new Set(Object.values(stack.origins));
    await context.route('**/*', (route) => permitted.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
    return page;
  };
  const alice = await newPage(), bob = await newPage(), aliceSecond = await newPage();
  let aliceSession, bobSession, secondSession, roomId;
  const roomName = 'Disposable encrypted lounge';
  const wire = [];
  const uploads = [];
  alice.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'PUT' && url.pathname.includes('/send/')) wire.push({ path: url.pathname, content: request.postDataJSON() });
  });
  alice.on('response', async (response) => {
    if (response.request().method() === 'POST' && new URL(response.url()).pathname.includes('/media/') && new URL(response.url()).pathname.endsWith('/upload') && response.ok()) {
      try { uploads.push(await response.json()); } catch { /* Awaited below through a bounded readiness check. */ }
    }
  });
  try {
    await check('password-login-three-devices', async () => {
      await login(alice, stack.origins.app, 'alice', stack.credentials.password);
      await login(bob, stack.origins.app, 'bob', stack.credentials.password);
      await login(aliceSecond, stack.origins.app, 'alice', stack.credentials.password);
      [aliceSession, bobSession, secondSession] = await Promise.all([session(alice), session(bob), session(aliceSecond)]);
      invariant(aliceSession.deviceId !== secondSession.deviceId, 'distinct-device');
      for (const page of [alice, bob, aliceSecond]) {
        const databases = await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
        invariant(databases.some((name) => name.startsWith('aimtrix-crypto-')), 'persistent-crypto');
      }
    });
    if (forceFailure) {
      // This deliberately sensitive exception must never be printed or serialized.
      throw new Error(`diagnostic-canary ${aliceSession.accessToken} ${stack.credentials.password} private-room-canary`);
    }
    await check('encrypted-room-create-and-join', async () => {
      await alice.getByRole('button', { name: 'Join or create room' }).click();
      const dialog = alice.getByRole('dialog', { name: 'Add a conversation' });
      await dialog.getByRole('button', { name: 'Create room', exact: true }).first().click();
      await dialog.getByLabel('Room name', { exact: true }).fill(roomName);
      await dialog.getByLabel('Topic', { exact: true }).fill('Ephemeral integration test');
      await dialog.getByLabel('Encrypt this room').check();
      const creation = alice.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/createRoom') && response.request().method() === 'POST');
      await dialog.locator('form').getByRole('button', { name: 'Create room', exact: true }).click();
      const response = await creation; invariant(response.ok(), 'room-creation'); roomId = (await response.json()).room_id;
      for (const name of ['bob', 'charlie']) {
        await api(`/_matrix/client/v3/rooms/${encode(roomId)}/invite`, { token: aliceSession.accessToken, method: 'POST', body: { user_id: accounts[name].user_id } });
        await api(`/_matrix/client/v3/rooms/${encode(roomId)}/join`, { token: accounts[name].access_token, method: 'POST', body: {} });
      }
      const state = await api(`/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.encryption`, { token: aliceSession.accessToken });
      invariant(state.algorithm === 'm.megolm.v1.aes-sha2', 'room-encryption-state');
      for (const page of [alice, bob, aliceSecond]) await openRoom(page, roomName);
    });
    await check('encrypted-send-receive-and-latency', async () => {
      const marker = `Encrypted round trip ${randomBytes(12).toString('hex')}`;
      const start = Date.now();
      await alice.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(marker);
      await alice.getByRole('button', { name: 'Send message', exact: true }).click();
      for (const page of [bob, aliceSecond]) await page.locator('.timeline-message').filter({ hasText: marker }).waitFor({ timeout: 45000 });
      metrics.sendReceiveMs = Date.now() - start;
      invariant(wire.length > 0 && wire.every((event) => event.path.includes('/m.room.encrypted/') && event.content.algorithm === 'm.megolm.v1.aes-sha2' && !JSON.stringify(event.content).includes(marker)), 'encrypted-wire');
      const events = await api(`/_matrix/client/v3/rooms/${encode(roomId)}/messages?dir=b&limit=20`, { token: bobSession.accessToken });
      invariant(events.chunk.some((event) => event.type === 'm.room.encrypted'), 'server-encrypted-event');
      invariant(!JSON.stringify(events).includes(marker), 'no-server-plaintext');
      await bob.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(`Reply ${marker}`);
      await bob.getByRole('button', { name: 'Send message', exact: true }).click();
      await alice.locator('.timeline-message').filter({ hasText: `Reply ${marker}` }).waitFor({ timeout: 45000 });
      // Reload the same device and verify decryption; peers remain online, so this
      // does not isolate persisted keys from possible peer key sharing.
      await aliceSecond.reload(); await openRoom(aliceSecond, roomName);
      await aliceSecond.locator('.timeline-message').filter({ hasText: marker }).first().waitFor({ timeout: 45000 });
    });
    await check('encrypted-retry-reconnect-and-cancel', async () => {
      const marker = `Retry round trip ${randomBytes(12).toString('hex')}`;
      const newer = 'Newer synthetic draft';
      const composer = alice.getByRole('textbox', { name: `Message ${roomName}`, exact: true });
      const sendPattern = '**/rooms/*/send/m.room.encrypted/*';
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      let intercepted = false;
      const reject = async (route) => {
        intercepted = true;
        await gate;
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'Synthetic rejection' }) });
      };
      await alice.route(sendPattern, reject);
      const wireStart = wire.length;
      await composer.fill(marker);
      await alice.getByRole('button', { name: 'Send message', exact: true }).click();
      await until(() => intercepted, 'send-intercepted');
      await composer.fill(newer);
      release();
      const failed = alice.locator('.timeline-message').filter({ hasText: marker });
      await failed.getByRole('button', { name: 'Retry message', exact: true }).waitFor();
      invariant(await composer.innerText() === newer, 'new-draft-preserved');
      invariant(await failed.getByText('Sending…', { exact: true }).count() === 0, 'failed-not-sending');
      await alice.unroute(sendPattern, reject);
      await alice.context().setOffline(true);
      await alice.evaluate(() => window.dispatchEvent(new Event('offline')));
      await alice.context().setOffline(false);
      await alice.evaluate(() => window.dispatchEvent(new Event('online')));
      // Accept on Synapse, then lose the HTTP acknowledgement after the sync echo.
      // The original transaction must still reconcile as one accepted message.
      let acknowledgementLost = false;
      const loseAcknowledgement = async (route) => {
        const response = await route.fetch();
        invariant(response.ok(), 'retry-server-acceptance');
        await failed.getByText('Accepted by server', { exact: true }).waitFor();
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'Synthetic lost acknowledgement' }) });
        acknowledgementLost = true;
      };
      await alice.route(sendPattern, loseAcknowledgement);
      await failed.getByRole('button', { name: 'Retry message', exact: true }).click();
      await bob.locator('.timeline-message').filter({ hasText: marker }).waitFor({ timeout: 45000 });
      await until(() => acknowledgementLost, 'acknowledgement-lost');
      await failed.getByText('Accepted by server', { exact: true }).waitFor();
      invariant(await failed.count() === 1 && await bob.locator('.timeline-message').filter({ hasText: marker }).count() === 1, 'retry-single-echo');
      const attempts = wire.slice(wireStart);
      invariant(attempts.length === 2 && attempts[0].path === attempts[1].path && JSON.stringify(attempts[0].content) === JSON.stringify(attempts[1].content), 'retry-original-encrypted-transaction');
      const serverEvents = await api(`/_matrix/client/v3/rooms/${encode(roomId)}/messages?dir=b&limit=30`, { token: aliceSession.accessToken });
      invariant(serverEvents.chunk.filter((event) => event.content?.ciphertext === attempts[0].content.ciphertext).length === 1, 'retry-single-server-event');
      invariant(await composer.innerText() === newer, 'retry-preserves-new-draft');
      await alice.unroute(sendPattern, loseAcknowledgement);
      const cancelled = `Cancelled synthetic message ${randomBytes(8).toString('hex')}`;
      await alice.route(sendPattern, reject);
      await composer.fill(cancelled);
      await alice.getByRole('button', { name: 'Send message', exact: true }).click();
      const cancelledRow = alice.locator('.timeline-message').filter({ hasText: cancelled });
      await cancelledRow.getByRole('button', { name: 'Cancel message', exact: true }).click();
      await cancelledRow.waitFor({ state: 'hidden' });
      await alice.unroute(sendPattern, reject);
      invariant(await bob.locator('.timeline-message').filter({ hasText: cancelled }).count() === 0, 'cancel-stays-local');
    });
    await check('encrypted-thread-retry', async () => {
      const root = alice.locator('.timeline-message').filter({ hasText: 'Retry round trip' }).first();
      await root.getByRole('button', { name: 'Reply in thread', exact: true }).click();
      const marker = `Synthetic thread retry ${randomBytes(10).toString('hex')}`;
      const pattern = '**/rooms/*/send/m.room.encrypted/*';
      const reject = (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'Synthetic thread rejection' }) });
      await alice.route(pattern, reject);
      const start = wire.length;
      await alice.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(marker);
      await alice.getByRole('button', { name: 'Send message', exact: true }).click();
      await root.locator('.thread-summary').click();
      const thread = alice.getByRole('complementary', { name: 'Thread', exact: true });
      const failed = thread.locator('.timeline-message').filter({ hasText: marker });
      await failed.getByRole('button', { name: 'Retry message', exact: true }).waitFor();
      await alice.unroute(pattern, reject);
      await failed.getByRole('button', { name: 'Retry message', exact: true }).click();
      await failed.getByText('Accepted by server', { exact: true }).waitFor();
      const bobRoot = bob.locator('.timeline-message').filter({ hasText: 'Retry round trip' }).first();
      await bobRoot.locator('.thread-summary').click();
      const received = bob.getByRole('complementary', { name: 'Thread', exact: true }).locator('.timeline-message').filter({ hasText: marker });
      await received.waitFor({ timeout: 45000 });
      invariant(await received.count() === 1 && await failed.count() === 1, 'single-thread-reply');
      const attempts = wire.slice(start);
      invariant(attempts.length === 2 && attempts[0].path === attempts[1].path && JSON.stringify(attempts[0].content) === JSON.stringify(attempts[1].content), 'thread-retry-same-ciphertext-transaction');
      invariant(attempts[0].content['m.relates_to']?.rel_type === 'm.thread', 'standard-thread-relation');
      const cancelled = 'Synthetic cancelled thread reply';
      await alice.route(pattern, reject);
      await thread.getByRole('textbox', { name: 'Message thread', exact: true }).fill(cancelled);
      await thread.getByRole('button', { name: 'Send thread reply', exact: true }).click();
      const cancelledRow = thread.locator('.timeline-message').filter({ hasText: cancelled });
      await cancelledRow.getByRole('button', { name: 'Cancel message', exact: true }).click();
      await cancelledRow.waitFor({ state: 'hidden' });
      await root.locator('.thread-summary').getByText('1 reply', { exact: true }).waitFor();
      await alice.unroute(pattern, reject);

      await alice.getByRole('button', { name: 'Close thread', exact: true }).click();
      await bob.getByRole('button', { name: 'Close thread', exact: true }).click();
    });
    await check('authenticated-encrypted-media', async () => {
      metrics.attachmentInputCount = await alice.getByLabel('Choose attachment', { exact: true }).count();
      const bytes = Buffer.from(`Disposable attachment ${randomBytes(24).toString('hex')}`);
      await alice.getByLabel('Choose attachment', { exact: true }).setInputFiles({ name: 'synthetic.bin', mimeType: 'application/octet-stream', buffer: bytes });
      await until(() => uploads.length > 0, 'upload-response');
      const source = uploads.at(-1).content_uri;
      invariant(source?.startsWith('mxc://aimtrix.test/'), 'mxc-upload');
      const mediaPath = `/_matrix/client/v1/media/download/${source.slice(6)}`;
      const anonymous = await fetch(`${stack.origins.synapse}${mediaPath}`, { signal: AbortSignal.timeout(10000) });
      invariant(anonymous.status === 401, 'media-requires-authentication');
      const encrypted = await api(mediaPath, { token: bobSession.accessToken, binary: true });
      invariant(!Buffer.from(encrypted).equals(bytes) && !Buffer.from(encrypted).includes(bytes), 'attachment-ciphertext');
      const link = bob.locator('.message-file').filter({ hasText: 'synthetic.bin' });
      await link.waitFor({ timeout: 45000 });
      await until(async () => (await link.getAttribute('href'))?.startsWith('blob:'), 'decrypted-media-source');
      const received = await link.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch(element.href)).arrayBuffer())));
      invariant(Buffer.from(received).equals(bytes), 'attachment-decryption');
      invariant(wire.every((event) => event.path.includes('/m.room.encrypted/')), 'encrypted-media-event');
    });
    await check('shared-backdrop-and-permissions', async () => {
      const start = Date.now();
      await alice.getByRole('button', { name: 'Decorate conversation background' }).click();
      const dialog = alice.getByRole('dialog', { name: `Decorate ${roomName}` });
      await dialog.getByRole('button', { name: 'Soft twilight', exact: true }).click();
      await dialog.getByRole('button', { name: 'Save backdrop', exact: true }).click();
      await until(async () => (await bob.getByRole('main', { name: roomName }).getAttribute('class')).includes('room-backdrop--soft-twilight'), 'shared-backdrop-render');
      metrics.sharedBackdropMs = Date.now() - start;
      const path = `/_matrix/client/v3/rooms/${encode(roomId)}/state/dev.alucard.aimtrix.room_background.v1`;
      invariant((await api(path, { token: bobSession.accessToken })).preset === 'soft-twilight', 'shared-backdrop-state');
      await api(path, { token: bobSession.accessToken, method: 'PUT', body: { preset: 'citrus-grove' }, status: 403 });
      await dialog.getByLabel('Who can change the room background').selectOption('members');
      await until(async () => (await api(`/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.power_levels`, { token: bobSession.accessToken })).events?.['dev.alucard.aimtrix.room_background.v1'] === 0, 'backdrop-power-level');
      await dialog.getByRole('button', { name: 'Close background decorator' }).click();
    });
    await check('moderation-role-kick-ban-unban', async () => {
      const drawer = alice.getByRole('complementary', { name: 'Buddy and room drawer' });
      await drawer.getByLabel('Role for charlie', { exact: true }).selectOption('25');
      const memberPath = `/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.member/${encode(accounts.charlie.user_id)}`;
      await until(async () => (await api(`/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.power_levels`, { token: aliceSession.accessToken })).users?.[accounts.charlie.user_id] === 25, 'moderation-power');
      await drawer.getByRole('button', { name: 'Remove charlie', exact: true }).click();
      await alice.getByRole('dialog').getByRole('button', { name: 'Remove member', exact: true }).click();
      await until(async () => (await api(memberPath, { token: aliceSession.accessToken })).membership === 'leave', 'moderation-kick');
      await api(`/_matrix/client/v3/rooms/${encode(roomId)}/invite`, { token: aliceSession.accessToken, method: 'POST', body: { user_id: accounts.charlie.user_id } });
      await drawer.getByRole('button', { name: 'Ban charlie', exact: true }).click();
      await alice.getByRole('dialog').getByRole('button', { name: 'Ban member', exact: true }).click();
      await until(async () => (await api(memberPath, { token: aliceSession.accessToken })).membership === 'ban', 'moderation-ban');
      await drawer.getByRole('button', { name: 'Unban charlie', exact: true }).click();
      await until(async () => (await api(memberPath, { token: aliceSession.accessToken })).membership === 'leave', 'moderation-unban');
    });
    await check('private-dm-backdrop-isolation', async () => {
      await alice.getByRole('button', { name: 'Join or create room' }).click();
      const dialog = alice.getByRole('dialog', { name: 'Add a conversation' });
      await dialog.getByRole('button', { name: 'Direct chat', exact: true }).click();
      await dialog.getByLabel('Matrix ID', { exact: true }).fill(accounts.bob.user_id);
      const created = alice.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/createRoom') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Start direct chat', exact: true }).click();
      const dm = (await (await created).json()).room_id;
      await api(`/_matrix/client/v3/rooms/${encode(dm)}/join`, { token: bobSession.accessToken, method: 'POST', body: {} });
      await dialog.waitFor({ state: 'hidden' });
      await alice.getByRole('button', { name: 'Direct Messages', exact: true }).click();
      await openRoom(alice, 'bob');
      await alice.getByRole('button', { name: 'Decorate conversation background' }).click();
      const backdrop = alice.getByRole('dialog', { name: /Decorate/ });
      await backdrop.getByText('Only you see this choice.', { exact: false }).waitFor();
      await backdrop.getByRole('button', { name: 'Citrus grove', exact: true }).click();
      await backdrop.getByRole('button', { name: 'Save backdrop', exact: true }).click();
      const accountPath = (id) => `/_matrix/client/v3/user/${encode(id)}/account_data/dev.alucard.aimtrix.direct_backgrounds.v1`;
      await until(async () => {
        try { return (await api(accountPath(aliceSession.userId), { token: aliceSession.accessToken })).rooms?.[dm]?.preset === 'citrus-grove'; } catch { return false; }
      }, 'private-account-data');
      await api(accountPath(bobSession.userId), { token: bobSession.accessToken, status: 404 });
      await api(accountPath(aliceSession.userId), { token: bobSession.accessToken, status: 403 });
      await api(`/_matrix/client/v3/rooms/${encode(dm)}/state/dev.alucard.aimtrix.room_background.v1`, { token: bobSession.accessToken, status: 404 });
      await backdrop.getByRole('button', { name: 'Close background decorator' }).click();
    });
    await check('private-profile-save', async () => {
      await alice.locator('.self-card__profile').click();
      const profile = alice.getByRole('dialog', { name: 'My profile page' });
      await profile.getByRole('button', { name: 'Decorate my page', exact: true }).click();
      await profile.getByRole('button', { name: 'Twilight', exact: true }).click();
      await profile.getByRole('button', { name: 'Save my page', exact: true }).click();
      await profile.getByRole('status').filter({ hasText: 'Profile decorations saved.' }).waitFor();
      const path = `/_matrix/client/v3/user/${encode(aliceSession.userId)}/account_data/dev.alucard.aimtrix.profile.v1`;
      invariant((await api(path, { token: aliceSession.accessToken })).bannerPreset === 'twilight', 'private-profile-state');
      await api(path, { token: bobSession.accessToken, status: 403 });
      await profile.getByRole('button', { name: 'Close profile page' }).click();
    });
    await check('standard-sso-token-callback', async () => {
      const sso = await newPage();
      await sso.goto(stack.origins.app);
      await sso.getByRole('button', { name: 'Sign in with homeserver SSO', exact: true }).click();
      // Dex is a real OIDC provider; no callback route or login response is mocked.
      await sso.getByLabel(/^Email address$/i).fill('sso@aimtrix.test');
      await sso.getByLabel('Password', { exact: true }).fill(stack.credentials.password);
      await sso.getByRole('button', { name: 'Login', exact: true }).click();
      await sso.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 60000 });
      const saved = await session(sso);
      invariant(saved?.userId === '@sso:aimtrix.test', 'sso-identity');
      invariant(!new URL(sso.url()).searchParams.has('loginToken'), 'sso-token-cleanup');
      invariant((await api('/_matrix/client/v3/account/whoami', { token: saved.accessToken })).user_id === saved.userId, 'sso-valid-session');
    });
  } finally {
    for (const context of contexts) await context.close();
  }
}
