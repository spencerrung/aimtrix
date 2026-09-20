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
async function openMatrixEvent(page, roomId, eventId) {
  await page.getByRole('button', { name: 'Quick switcher', exact: true }).click();
  await page.getByRole('dialog', { name: 'Quick switcher', exact: true }).getByRole('button', { name: 'Open Matrix link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Open Matrix link', exact: true });
  await dialog.getByLabel('Matrix link', { exact: true }).fill(`https://matrix.to/#/${encode(roomId)}/${encode(eventId)}`);
  await dialog.getByRole('button', { name: 'Open link', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
async function verifyAttachment(scope, file, caption) {
  const link = scope.locator('.message-file').filter({ hasText: file.name });
  await link.waitFor({ timeout: 45000 });
  invariant(await link.count() === 1, 'single-accepted-attachment');
  invariant(await link.getAttribute('download') === file.name, 'attachment-filename-caption');
  const row = scope.locator('.timeline-message').filter({ hasText: caption });
  await row.getByText(caption, { exact: true }).waitFor();
  await until(async () => (await link.getAttribute('href'))?.startsWith('blob:'), 'attachment-decrypted-source');
  const received = await link.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch(element.href)).arrayBuffer())));
  invariant(Buffer.from(received).equals(file.buffer), 'attachment-decryption');
}

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
  let navigationHistory, threadHistory, attachmentThreadRootId, formattedPeer;
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
      const thread = alice.getByRole('complementary', { name: 'Thread', exact: true });
      await thread.getByRole('textbox', { name: 'Message thread', exact: true }).fill(marker);
      await thread.getByRole('button', { name: 'Send thread reply', exact: true }).click();
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
      threadHistory = { rootId: await root.getAttribute('data-event-id'), replyId: await failed.getAttribute('data-event-id') };
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
      await root.locator('.thread-summary').getByText(/^1(?: reply|\+ replies)$/).waitFor();
      await alice.unroute(pattern, reject);

      await alice.getByRole('button', { name: 'Close thread', exact: true }).click();
      await bob.getByRole('button', { name: 'Close thread', exact: true }).click();
    });
    await check('private-read-tracking-and-reminders', async () => {
      const preferencesPath = `/_matrix/client/v3/user/${encode(aliceSession.userId)}/account_data/dev.alucard.aimtrix.preferences.v1`;
      const setPublicReads = async (page, enabled) => {
        await page.bringToFront();
        await page.getByRole('button', { name: 'Open settings', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
        await settings.getByRole('button', { name: 'Matrix & security', exact: true }).click();
        await settings.getByRole('checkbox', { name: /^Send read receipts/ }).setChecked(enabled);
        await until(async () => {
          try { return (await api(preferencesPath, { token: aliceSession.accessToken })).sendReadReceipts === enabled; }
          catch { return false; }
        }, 'receipt-preference-persisted');
        await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      };
      const readAction = async (page, unread) => {
        await page.bringToFront();
        await page.getByRole('button', { name: 'Read status', exact: true }).click();
        const popover = page.getByRole('dialog', { name: 'Conversation read status', exact: true });
        await popover.getByRole('button', { name: unread ? 'Mark unread' : 'Mark conversation read', exact: true }).click();
        await popover.getByText(unread ? /^Marked unread\. Your reminder/ : /^Conversation marked read\./).waitFor();
        // Saving must retain keyboard focus: exercise Escape without refocusing.
        await page.keyboard.press('Escape');
        await popover.waitFor({ state: 'hidden' });
      };
      const followLatest = async (page) => {
        await page.bringToFront();
        const latest = page.getByRole('button', { name: 'Jump to latest messages', exact: true });
        if (await latest.isVisible()) {
          await latest.click();
          await latest.waitFor({ state: 'hidden' });
        }
      };
      const sendMain = async (marker) => {
        await bob.bringToFront();
        const accepted = bob.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.includes('/send/'));
        await bob.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(marker);
        await bob.getByRole('button', { name: 'Send message', exact: true }).click();
        const response = await accepted;
        invariant(response.ok(), 'receipt-message-accepted');
        return (await response.json()).event_id;
      };
      // Keep identifiers and sync payloads in memory. Neither observer is an SDK
      // client, and neither sends receipts or changes the account it observes.
      // Select the room from each response below. Synapse's room-ID filter also
      // filters room account-data objects, which lack their own room_id field.
      const filter = encode(JSON.stringify({ presence: { types: [] }, account_data: { types: [] }, room: {
        state: { types: [] }, timeline: { types: [], limit: 0 },
        ephemeral: { types: ['m.receipt'] }, account_data: { types: ['m.fully_read', 'm.marked_unread'] },
      } }));
      const observeSync = async (token) => {
        const first = await api(`/_matrix/client/v3/sync?timeout=0&filter=${filter}`, { token });
        let since = first.next_batch;
        const receipts = [];
        const accountData = new Map();
        return { receipts, accountData, poll: async () => {
          const response = await api(`/_matrix/client/v3/sync?timeout=0&filter=${filter}&since=${encode(since)}`, { token });
          since = response.next_batch;
          const room = response.rooms?.join?.[roomId];
          for (const event of room?.ephemeral?.events ?? []) {
            if (event.type !== 'm.receipt') continue;
            for (const [eventId, types] of Object.entries(event.content)) {
              for (const [type, users] of Object.entries(types)) {
                const receipt = users[aliceSession.userId];
                if (receipt) receipts.push({ eventId, type, threadId: receipt.thread_id });
              }
            }
          }
          for (const event of room?.account_data?.events ?? []) accountData.set(event.type, event.content);
        } };
      };
      const sentReceipts = [];
      const recordReceipt = (request) => {
        if (request.method() !== 'POST') return;
        const path = new URL(request.url()).pathname.split('/').map(decodeURIComponent);
        const receipt = path.indexOf('receipt');
        if (receipt < 0 || path[receipt - 1] !== roomId) return;
        sentReceipts.push({ type: path[receipt + 1], eventId: path[receipt + 2], threadId: request.postDataJSON()?.thread_id });
      };
      for (const page of [alice, bob, aliceSecond]) await openRoom(page, roomName);
      await setPublicReads(alice, false);
      await setPublicReads(aliceSecond, false);
      await followLatest(alice);
      alice.on('request', recordReceipt); aliceSecond.on('request', recordReceipt);
      try {
        const own = await observeSync(secondSession.accessToken);
        const other = await observeSync(bobSession.accessToken);
        const privateMarker = `Synthetic private reading ${randomBytes(8).toString('hex')}`;
        const privateEvent = await sendMain(privateMarker);
        await alice.locator('.timeline-message').filter({ hasText: privateMarker }).waitFor({ timeout: 45000 });
        await readAction(alice, false);
        await until(async () => {
          await own.poll(); await other.poll();
          return own.receipts.some((receipt) => receipt.eventId === privateEvent && receipt.type === 'm.read.private' && receipt.threadId === 'main')
            && own.accountData.get('m.fully_read')?.event_id === privateEvent;
        }, 'private-main-read-own-device-sync');
        invariant(sentReceipts.some((receipt) => receipt.eventId === privateEvent && receipt.type === 'm.read.private' && receipt.threadId === 'main'), 'private-main-receipt-scope');

        // A fresh reply exercises the old privacy regression: opening a thread
        // with public receipts off must never silently send an m.read receipt.
        await bob.bringToFront();
        const bobRoot = bob.locator('.timeline .timeline-message:has(.thread-summary)').first();
        const rootId = await bobRoot.getAttribute('data-event-id');
        invariant(Boolean(rootId), 'receipt-thread-root');
        await bobRoot.locator('.thread-summary').click();
        const threadMarker = `Synthetic private thread reading ${randomBytes(8).toString('hex')}`;
        const accepted = bob.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.includes('/send/'));
        const bobThread = bob.getByRole('complementary', { name: 'Thread', exact: true });
        await bobThread.getByRole('textbox', { name: 'Message thread', exact: true }).fill(threadMarker);
        await bobThread.getByRole('button', { name: 'Send thread reply', exact: true }).click();
        const response = await accepted;
        invariant(response.ok(), 'receipt-thread-message-accepted');
        const threadEvent = (await response.json()).event_id;
        await alice.bringToFront();
        await alice.locator(`.timeline [data-event-id=${JSON.stringify(rootId)}] .thread-summary`).click();
        const aliceThread = alice.getByRole('complementary', { name: 'Thread', exact: true });
        await aliceThread.locator('.timeline-message').filter({ hasText: threadMarker }).waitFor({ timeout: 45000 });
        await aliceThread.locator('.thread-panel__timeline').evaluate((element) => {
          element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll'));
        });
        await until(async () => {
          await own.poll(); await other.poll();
          return own.receipts.some((receipt) => receipt.eventId === threadEvent && receipt.type === 'm.read.private' && receipt.threadId === rootId);
        }, 'private-thread-read-own-device-sync');
        invariant(sentReceipts.some((receipt) => receipt.eventId === threadEvent && receipt.type === 'm.read.private' && receipt.threadId === rootId), 'private-thread-receipt-scope');
        invariant(own.accountData.get('m.fully_read')?.event_id === privateEvent, 'thread-read-preserves-main-position');
        await alice.getByRole('button', { name: 'Close thread', exact: true }).click();
        await bob.getByRole('button', { name: 'Close thread', exact: true }).click();

        await readAction(alice, true);
        await until(async () => {
          await own.poll(); await other.poll();
          return own.accountData.get('m.marked_unread')?.unread === true;
        }, 'marked-unread-own-device-sync');
        const returnPoint = own.accountData.get('m.marked_unread')?.['dev.alucard.aimtrix.return_point']?.event_id;
        invariant(typeof returnPoint === 'string' && returnPoint.startsWith('$'), 'marked-unread-return-point');
        await aliceSecond.bringToFront();
        await aliceSecond.reload(); await openRoom(aliceSecond, roomName);
        const reminder = aliceSecond.locator('.conversation-history-controls .history-context').filter({ hasText: 'Marked unread for later.' });
        await reminder.waitFor({ timeout: 45000 });
        await reminder.getByRole('button', { name: 'Return to saved message', exact: true }).click();
        await until(async () => aliceSecond.locator('[data-event-id]').evaluateAll((elements, target) =>
          elements.some((element) => element.getAttribute('data-event-id') === target && element === element.ownerDocument.activeElement), returnPoint), 'marked-unread-return-context');
        const markerPath = `/_matrix/client/v3/user/${encode(aliceSession.userId)}/rooms/${encode(roomId)}/account_data/m.marked_unread`;
        invariant((await api(markerPath, { token: secondSession.accessToken })).unread === true, 'reminder-persists-after-return');
        await readAction(alice, false);
        await until(async () => { await own.poll(); return own.accountData.get('m.marked_unread')?.unread === false; }, 'marked-unread-explicit-clear');
        await aliceSecond.bringToFront();
        await reminder.waitFor({ state: 'hidden' });
        await other.poll();
        invariant(!other.receipts.some((receipt) => receipt.type === 'm.read.private' || receipt.eventId === privateEvent || receipt.eventId === threadEvent), 'private-receipts-absent-to-other-user');
        invariant(!sentReceipts.some((receipt) => receipt.type === 'm.read' && [privateEvent, threadEvent].includes(receipt.eventId)), 'no-public-read-with-privacy-off');
        invariant(!other.accountData.has('m.marked_unread'), 'reminder-private-to-account');

        await setPublicReads(alice, true);
        await followLatest(alice);
        const publicMarker = `Synthetic public reading ${randomBytes(8).toString('hex')}`;
        const publicEvent = await sendMain(publicMarker);
        await alice.locator('.timeline-message').filter({ hasText: publicMarker }).waitFor({ timeout: 45000 });
        await readAction(alice, false);
        await until(async () => {
          await other.poll();
          return other.receipts.some((receipt) => receipt.eventId === publicEvent && receipt.type === 'm.read' && receipt.threadId === 'main');
        }, 'public-main-read-other-user-sync');
        invariant(sentReceipts.some((receipt) => receipt.eventId === publicEvent && receipt.type === 'm.read' && receipt.threadId === 'main'), 'public-main-receipt-scope');
        await setPublicReads(aliceSecond, true);
      } finally {
        alice.off('request', recordReceipt); aliceSecond.off('request', recordReceipt);
      }
    });
    await check('encrypted-history-and-context', async () => {
      await openRoom(alice, roomName);
      // Buddy rows prefer a room topic to message previews. Clear this test
      // topic so the receiving device's live preview is observable in context.
      await api(`/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.topic`, { token: aliceSession.accessToken, method: 'PUT', body: { topic: '' } });
      const prefix = `Synthetic history ${randomBytes(8).toString('hex')}`;
      const historyWireStart = wire.length;
      const composer = alice.getByRole('textbox', { name: `Message ${roomName}`, exact: true });
      const sentIds = [];
      for (let index = 0; index < 350; index++) {
        await composer.fill(`${prefix} ${String(index).padStart(3, '0')}`);
        const sent = alice.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.includes('/send/m.room.encrypted/') && response.ok());
        await alice.getByRole('button', { name: 'Send message', exact: true }).click();
        sentIds.push((await (await sent).json()).event_id);
        await composer.filter({ hasText: /^$/ }).waitFor();
      }
      invariant(wire.slice(historyWireStart).every((event) => event.content['m.relates_to']?.rel_type !== 'm.thread'), 'history-main-conversation-events');
      invariant(new Set(sentIds).size === 350 && wire.every((event) => event.path.includes('/m.room.encrypted/') && !JSON.stringify(event.content).includes(prefix)), 'history-encrypted-wire');
      navigationHistory = { firstId: sentIds[40], secondId: sentIds[240], firstText: `${prefix} 040`, secondText: `${prefix} 240` };
      // Reload removes the in-memory SDK timeline; existing keys remain on this
      // device and online peers can still share keys, as in the reload journey.
      await aliceSecond.reload(); await openRoom(aliceSecond, roomName);
      const timeline = aliceSecond.getByRole('region', { name: 'Messages', exact: true });
      const entry = (index) => timeline.locator('.timeline-message').filter({ hasText: `${prefix} ${String(index).padStart(3, '0')}` });
      await until(async () => await entry(349).count() > 0 || await aliceSecond.getByRole('button', { name: 'Jump to latest messages', exact: true }).count() > 0, 'history-initial-view-ready');
      if (await aliceSecond.getByRole('button', { name: 'Jump to latest messages', exact: true }).count()) await aliceSecond.getByRole('button', { name: 'Jump to latest messages', exact: true }).click();
      await entry(349).waitFor({ timeout: 45000 });
      invariant(await entry(0).count() === 0, 'old-history-outside-live-window');
      for (let attempt = 0; attempt < 12 && await entry(0).count() === 0; attempt++) {
        const older = aliceSecond.getByRole('button', { name: 'Load older messages', exact: true });
        const firstBefore = await timeline.locator('.timeline-message').first().getAttribute('data-event-id');
        await older.and(aliceSecond.locator(':enabled')).evaluate((button) => button.click());
        await until(async () => await timeline.locator('.timeline-message').first().getAttribute('data-event-id') !== firstBefore, 'history-older-window-advanced');
        await aliceSecond.getByText('Loading older messages…', { exact: true }).waitFor({ state: 'hidden' });
        invariant(await timeline.locator('.timeline-message').count() <= 250, 'bounded-history-render');
      }
      await entry(0).waitFor({ state: 'attached' });
      await entry(0).scrollIntoViewIfNeeded();
      invariant(await entry(349).count() === 0, 'history-window-moved');
      const previousLast = await timeline.locator('.timeline-message').last().getAttribute('data-event-id');
      await aliceSecond.getByRole('button', { name: 'Load newer messages', exact: true }).and(aliceSecond.locator(':enabled')).evaluate((button) => button.click());
      await until(async () => await timeline.locator('.timeline-message').last().getAttribute('data-event-id') !== previousLast, 'history-forward-navigation');
      await aliceSecond.getByRole('button', { name: 'Jump to latest messages', exact: true }).click();
      await entry(349).waitFor();
      // A fresh app navigation must use the real /context endpoint and load both
      // sides: SDK getEventTimeline itself requests context with limit=0.
      await aliceSecond.goto(`${stack.origins.app}/?room=${encode(roomId)}&event=${encode(sentIds[20])}`);
      await entry(20).waitFor({ timeout: 45000 });
      await entry(19).waitFor(); await entry(21).waitFor();
      invariant(await entry(349).count() === 0 && await timeline.locator('.timeline-message').count() <= 250, 'bounded-event-context');
      const top = (await entry(20).boundingBox()).y;
      await composer.fill(`${prefix} incoming`);
      await alice.getByRole('button', { name: 'Send message', exact: true }).click();
      await aliceSecond.locator('.buddy-row').filter({ hasText: roomName }).filter({ hasText: `${prefix} incoming` }).waitFor({ timeout: 45000 });
      invariant(Math.abs((await entry(20).boundingBox()).y - top) < 2, 'history-incoming-anchor');
      await aliceSecond.getByRole('button', { name: 'Jump to latest messages', exact: true }).click();
      await timeline.locator('.timeline-message').filter({ hasText: `${prefix} incoming` }).waitFor();
      await api(`/_matrix/client/v3/rooms/${encode(roomId)}/redact/${encode(sentIds[20])}/history-redaction`, { token: aliceSession.accessToken, method: 'PUT', body: {} });
      await aliceSecond.goto(`${stack.origins.app}/?room=${encode(roomId)}&event=${encode(sentIds[20])}`);
      await aliceSecond.getByText('That message was removed.', { exact: true }).waitFor({ timeout: 45000 });
      invariant(await entry(20).count() === 0, 'redacted-context-hidden');
    });
    await check('standard-favorites-and-own-device-sync', async () => {
      const tagPath = `/_matrix/client/v3/user/${encode(aliceSession.userId)}/rooms/${encode(roomId)}/tags`;
      const customTag = 'org.example.synthetic-navigation';
      await api(`${tagPath}/${encode(customTag)}`, { token: aliceSession.accessToken, method: 'PUT', body: { order: 0.25 } });
      for (const page of [alice, aliceSecond, bob]) await openRoom(page, roomName);
      await alice.bringToFront();
      await alice.getByRole('button', { name: 'Add to favorites', exact: true }).click();
      await alice.getByRole('button', { name: 'Remove from favorites', exact: true }).waitFor();
      await aliceSecond.bringToFront();
      await aliceSecond.getByRole('button', { name: 'Remove from favorites', exact: true }).waitFor();
      await until(async () => Object.hasOwn((await api(tagPath, { token: aliceSession.accessToken })).tags ?? {}, 'm.favourite'), 'favorite-server-tag');
      await aliceSecond.reload(); await openRoom(aliceSecond, roomName);
      await aliceSecond.getByRole('button', { name: 'Remove from favorites', exact: true }).waitFor();
      invariant(await bob.getByRole('button', { name: 'Add to favorites', exact: true }).isVisible(), 'favorite-other-user-isolation');
      const otherTags = await api(`/_matrix/client/v3/user/${encode(bobSession.userId)}/rooms/${encode(roomId)}/tags`, { token: bobSession.accessToken });
      invariant(!Object.hasOwn(otherTags.tags ?? {}, 'm.favourite'), 'favorite-other-account-tag-absent');
      await aliceSecond.bringToFront();
      await aliceSecond.getByRole('button', { name: 'Remove from favorites', exact: true }).click();
      await aliceSecond.getByRole('button', { name: 'Add to favorites', exact: true }).waitFor();
      await alice.bringToFront();
      await alice.getByRole('button', { name: 'Add to favorites', exact: true }).waitFor();
      const tags = (await api(tagPath, { token: aliceSession.accessToken })).tags ?? {};
      invariant(!Object.hasOwn(tags, 'm.favourite') && tags[customTag]?.order === 0.25, 'favorite-removal-preserves-other-tags');
    });
    await check('matrix-links-and-navigation-history', async () => {
      invariant(Boolean(navigationHistory), 'navigation-history-available');
      const { firstId, secondId, firstText, secondText } = navigationHistory;
      const alias = `#navigation-${randomBytes(8).toString('hex')}:aimtrix.test`;
      await api(`/_matrix/client/v3/directory/room/${encode(alias)}`, { token: aliceSession.accessToken, method: 'PUT', body: { room_id: roomId } });
      await api(`/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.canonical_alias`, { token: aliceSession.accessToken, method: 'PUT', body: { alias } });
      await aliceSecond.bringToFront();
      // Start without the earlier redacted-context launch URL or SDK history.
      await aliceSecond.goto(stack.origins.app); await openRoom(aliceSecond, roomName);
      const timeline = aliceSecond.getByRole('region', { name: 'Messages', exact: true });
      const first = timeline.locator('.timeline-message').filter({ hasText: firstText });
      const second = timeline.locator('.timeline-message').filter({ hasText: secondText });
      await timeline.locator('.timeline-message').first().waitFor({ timeout: 45000 });
      invariant(await first.count() === 0 && await second.count() === 0, 'navigation-targets-outside-initial-window');
      const draft = 'Synthetic draft retained through Matrix navigation';
      const composer = aliceSecond.getByRole('textbox', { name: `Message ${roomName}`, exact: true });
      await composer.fill(draft);
      let resolvedAlias = false, joinedRoom = false;
      const requestedContexts = new Set();
      const observeNavigation = (request) => {
        const path = new URL(request.url()).pathname.split('/').map(decodeURIComponent);
        if (request.method() === 'GET' && path.at(-1) === alias && path.includes('directory')) resolvedAlias = true;
        if (request.method() === 'GET' && path.includes('context')) requestedContexts.add(path.at(-1));
        if (request.method() === 'POST' && (path.includes('join') || path.at(-1) === 'createRoom')) joinedRoom = true;
      };
      const openLink = async (value) => {
        await aliceSecond.getByRole('button', { name: 'Quick switcher', exact: true }).click();
        await aliceSecond.getByRole('dialog', { name: 'Quick switcher', exact: true }).getByRole('button', { name: 'Open Matrix link', exact: true }).click();
        const dialog = aliceSecond.getByRole('dialog', { name: 'Open Matrix link', exact: true });
        await dialog.getByLabel('Matrix link', { exact: true }).fill(value);
        await dialog.getByRole('button', { name: 'Open link', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
      };
      const appTraverse = async (direction) => {
        await aliceSecond.getByRole('button', { name: 'Quick switcher', exact: true }).click();
        const dialog = aliceSecond.getByRole('dialog', { name: 'Quick switcher', exact: true });
        await dialog.getByRole('button', { name: direction, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
      };
      const restoredAt = async (entry, top) => {
        await entry.waitFor({ timeout: 45000 });
        await until(async () => {
          const bounds = await entry.boundingBox();
          return bounds !== null && Math.abs(bounds.y - top) < 3;
        }, 'navigation-reading-anchor-restored');
        invariant(await composer.textContent() === draft, 'navigation-draft-preserved');
      };
      aliceSecond.on('request', observeNavigation);
      try {
        await openLink(`https://matrix.to/#/${encode(alias)}/${encode(firstId)}`);
        await first.waitFor({ timeout: 45000 });
        // Let the context's intentional positioning finish before the observed
        // reading scroll; no timing sleep or production controller hook needed.
        await aliceSecond.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        await timeline.evaluate((element) => { element.scrollTop += 53; element.dispatchEvent(new Event('scroll')); });
        const firstTop = (await first.boundingBox()).y;
        await openLink(`matrix:roomid/${encode(roomId.slice(1))}/e/${encode(secondId.slice(1))}`);
        await second.waitFor({ timeout: 45000 });
        invariant(await first.count() === 0 && await timeline.locator('.timeline-message').count() <= 250, 'navigation-distinct-bounded-contexts');
        await aliceSecond.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        const secondTop = (await second.boundingBox()).y;
        invariant(resolvedAlias && requestedContexts.has(firstId) && requestedContexts.has(secondId), 'navigation-real-alias-and-context-endpoints');
        await aliceSecond.evaluate(() => window.history.back());
        await restoredAt(first, firstTop);
        await appTraverse('Forward');
        await restoredAt(second, secondTop);
        await appTraverse('Back');
        await restoredAt(first, firstTop);
        await aliceSecond.evaluate(() => window.history.forward());
        await restoredAt(second, secondTop);
        invariant(!joinedRoom, 'matrix-navigation-never-joins-or-creates');
        invariant(await aliceSecond.evaluate(({ room, firstEvent, secondEvent, aliasValue }) => {
          const state = JSON.stringify(window.history.state);
          return ![room, firstEvent, secondEvent, aliasValue].some((value) => state.includes(value));
        }, { room: roomId, firstEvent: firstId, secondEvent: secondId, aliasValue: alias }), 'navigation-history-state-opaque');
      } finally { aliceSecond.off('request', observeNavigation); }
      await composer.fill('');
    });
    await check('encrypted-thread-history-and-links', async () => {
      invariant(Boolean(threadHistory?.rootId && threadHistory?.replyId), 'old-thread-identifiers');
      const { rootId, replyId } = threadHistory;
      const openLink = async (page, eventId) => {
        await page.bringToFront();
        await page.getByRole('button', { name: 'Quick switcher', exact: true }).click();
        await page.getByRole('button', { name: 'Open Matrix link', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Open Matrix link', exact: true });
        await dialog.getByRole('textbox', { name: 'Matrix link', exact: true }).fill(`https://matrix.to/#/${encode(roomId)}/${encode(eventId)}`);
        await dialog.getByRole('button', { name: 'Open link', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('complementary', { name: 'Thread', exact: true }).waitFor();
      };
      await openLink(alice, rootId);
      const senderThread = alice.getByRole('complementary', { name: 'Thread', exact: true });
      const sendReply = async () => {
        await alice.bringToFront();
        const accepted = alice.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.includes('/send/'));
        await senderThread.getByRole('textbox', { name: 'Message thread', exact: true }).fill(`Synthetic old thread reply ${randomBytes(8).toString('hex')}`);
        await senderThread.getByRole('button', { name: 'Send thread reply', exact: true }).click();
        const response = await accepted;
        invariant(response.ok(), 'old-thread-reply-accepted');
        return (await response.json()).event_id;
      };
      const start = wire.length;
      // Exceed a relations page using real encrypted UI sends, without another
      // large main-room history seed. All identifiers and wire content stay in memory.
      for (let index = 0; index < 60; index += 1) await sendReply();
      invariant(wire.slice(start).every((request) => request.path.includes('/send/m.room.encrypted/')
        && request.content['m.relates_to']?.rel_type === 'm.thread'
        && request.content['m.relates_to']?.event_id === rootId), 'old-thread-standard-encrypted-relations');
      const countBeforeIncoming = Number((await senderThread.locator('.thread-panel__header').textContent()).match(/(\d+)\+? replies/)?.[1]);
      invariant(Number.isFinite(countBeforeIncoming), 'old-thread-count-available');
      await aliceSecond.bringToFront();
      await aliceSecond.goto(stack.origins.app); await openRoom(aliceSecond, roomName);
      invariant(await aliceSecond.locator(`.timeline [data-event-id=${JSON.stringify(rootId)}]`).count() === 0, 'old-root-outside-main-window');
      await aliceSecond.getByRole('button', { name: 'Open settings', exact: true }).click();
      const settings = aliceSecond.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
      await settings.getByRole('button', { name: 'Matrix & security', exact: true }).click();
      await settings.getByRole('checkbox', { name: /^Send read receipts/ }).uncheck();
      await until(async () => (await api(`/_matrix/client/v3/user/${encode(aliceSession.userId)}/account_data/dev.alucard.aimtrix.preferences.v1`, { token: secondSession.accessToken })).sendReadReceipts === false, 'old-thread-private-preference');
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      const receipts = [];
      const recordReceipt = (request) => {
        if (request.method() !== 'POST') return;
        const path = new URL(request.url()).pathname.split('/').map(decodeURIComponent);
        const receipt = path.indexOf('receipt');
        if (receipt >= 0 && path[receipt - 1] === roomId && request.postDataJSON()?.thread_id === rootId)
          receipts.push({ type: path[receipt + 1], eventId: path[receipt + 2] });
      };
      const acceptedPrivate = new Set();
      const recordAcceptedReceipt = (response) => {
        const request = response.request();
        if (!response.ok() || request.method() !== 'POST') return;
        const path = new URL(request.url()).pathname.split('/').map(decodeURIComponent);
        const receipt = path.indexOf('receipt');
        if (receipt >= 0 && path[receipt - 1] === roomId && path[receipt + 1] === 'm.read.private'
          && request.postDataJSON()?.thread_id === rootId) acceptedPrivate.add(path[receipt + 2]);
      };
      aliceSecond.on('request', recordReceipt);
      aliceSecond.on('response', recordAcceptedReceipt);
      try {
        await openLink(aliceSecond, rootId);
        const thread = aliceSecond.getByRole('complementary', { name: 'Thread', exact: true });
        const timeline = thread.locator('.thread-panel__timeline');
        const reply = timeline.locator(`[data-event-id=${JSON.stringify(replyId)}]`);
        const composer = thread.getByRole('textbox', { name: 'Message thread', exact: true });
        const draft = 'Synthetic draft while reading old thread replies';
        await composer.fill(draft);
        await thread.getByRole('button', { name: 'Load older thread replies', exact: true }).click();
        await reply.waitFor({ timeout: 45000 });
        invariant(await composer.innerText() === draft && await timeline.locator('.timeline-message').count() <= 250, 'old-thread-bounded-paging-retains-draft');
        await openLink(aliceSecond, replyId);
        await until(() => reply.evaluate((element) => element === element.ownerDocument.activeElement), 'old-thread-link-focus');
        invariant((await thread.locator('.thread-panel__root').textContent()).includes('Retry round trip'), 'old-thread-root-decrypted');
        const historicalReceipts = receipts.length;
        await composer.focus();
        await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
        const incoming = await sendReply();
        await aliceSecond.bringToFront();
        await composer.focus();
        // The independently accepted live-tail marker proves a sync snapshot was
        // published while history stayed detached. Partial counts may use '+'.
        await until(async () => await thread.getAttribute('data-latest-reply-id') === incoming, 'old-thread-live-tail-published');
        const currentCount = Number((await thread.locator('.thread-panel__header').textContent()).match(/(\d+)\+? replies/)?.[1]);
        invariant(currentCount >= countBeforeIncoming, 'old-thread-count-nondecreasing');
        invariant(receipts.length === historicalReceipts, 'historical-thread-never-acknowledged');
        invariant(await timeline.locator(`[data-event-id=${JSON.stringify(incoming)}]`).count() === 0, 'historical-thread-not-replaced-by-live');
        await thread.getByRole('button', { name: 'Jump to latest replies', exact: true }).click();
        await timeline.locator(`[data-event-id=${JSON.stringify(incoming)}]`).waitFor({ timeout: 45000 });
        await composer.focus();
        await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
        await until(() => acceptedPrivate.has(incoming), 'old-thread-private-latest-receipt');
        invariant(receipts.every((receipt) => receipt.type === 'm.read.private'), 'old-thread-no-public-receipts');
        await composer.fill('');
        await thread.getByRole('button', { name: 'Close thread', exact: true }).click();
      } finally { aliceSecond.off('request', recordReceipt); aliceSecond.off('response', recordAcceptedReceipt); }
      await senderThread.getByRole('button', { name: 'Close thread', exact: true }).click();
    });
    await check('authenticated-encrypted-media', async () => {
      const latest = bob.getByRole('button', { name: 'Jump to latest messages', exact: true });
      if (await latest.count()) await latest.click();
      metrics.attachmentInputCount = await alice.getByLabel('Choose attachment', { exact: true }).count();
      const bytes = Buffer.from(`Disposable attachment ${randomBytes(24).toString('hex')}`);
      await alice.getByLabel('Choose attachment', { exact: true }).setInputFiles({ name: 'synthetic.bin', mimeType: 'application/octet-stream', buffer: bytes });
      await alice.getByRole('button', { name: 'Send attachments', exact: true }).click();
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
    await check('encrypted-staged-attachments-and-retry', async () => {
      const files = ['staged-alpha.bin', 'staged-beta.bin'].map((name) => ({ name, mimeType: 'application/octet-stream', buffer: randomBytes(64) }));
      const captions = ['Synthetic first attachment caption', 'Synthetic second attachment caption'];
      const start = wire.length;
      await alice.getByLabel('Choose attachment', { exact: true }).setInputFiles(files);
      for (let index = 0; index < files.length; index++) await alice.getByLabel(`Caption for ${files[index].name}`, { exact: true }).fill(captions[index]);
      invariant(wire.length === start, 'attachment-staging-no-send');
      const pattern = '**/rooms/*/send/m.room.encrypted/*';
      let requests = 0;
      const rejectSecond = (route) => ++requests === 2
        ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'Synthetic attachment rejection' }) })
        : route.continue();
      await alice.route(pattern, rejectSecond);
      try {
        await alice.getByRole('button', { name: 'Send attachments', exact: true }).click();
        const retry = alice.getByRole('button', { name: `Retry ${files[1].name}`, exact: true });
        await retry.waitFor();
        await verifyAttachment(bob, files[0], captions[0]);
        await alice.unroute(pattern, rejectSecond);
        await retry.click();
        await alice.getByRole('region', { name: 'Attachments', exact: true }).locator('li').filter({ hasText: files[1].name }).getByText('Sent', { exact: true }).waitFor();
        for (let index = 0; index < files.length; index++) {
          await verifyAttachment(bob, files[index], captions[index]);
          invariant(await alice.locator('.timeline-message').filter({ has: alice.locator('.message-file').filter({ hasText: files[index].name }) }).count() === 1, 'single-accepted-attachment');
        }
        const attempts = wire.slice(start);
        invariant(attempts.length === 3 && attempts.every((event) => event.path.includes('/m.room.encrypted/')), 'attachment-retry-transaction');
        invariant(attempts[0].path !== attempts[1].path && attempts[1].path === attempts[2].path && JSON.stringify(attempts[1].content) === JSON.stringify(attempts[2].content), 'attachment-retry-transaction');
      } finally { await alice.unroute(pattern, rejectSecond); }
    });
    await check('encrypted-thread-attachment', async () => {
      const marker = `Synthetic attachment thread ${randomBytes(10).toString('hex')}`;
      await alice.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(marker);
      await alice.getByRole('button', { name: 'Send message', exact: true }).click();
      const root = alice.locator('.timeline-message').filter({ hasText: marker });
      await root.getByText('Accepted by server', { exact: true }).waitFor();
      attachmentThreadRootId = await root.getAttribute('data-event-id');
      await root.getByRole('button', { name: 'Reply in thread', exact: true }).click();
      const thread = alice.getByRole('complementary', { name: 'Thread', exact: true });
      const file = { name: 'thread-attachment.bin', mimeType: 'application/octet-stream', buffer: randomBytes(96) };
      const caption = 'Synthetic threaded attachment caption';
      const start = wire.length;
      await thread.getByLabel('Choose thread attachment', { exact: true }).setInputFiles(file);
      await thread.getByLabel(`Caption for ${file.name}`, { exact: true }).fill(caption);
      await thread.getByRole('button', { name: 'Send thread attachments', exact: true }).click();
      await thread.getByRole('region', { name: 'Thread attachments', exact: true }).getByText('Sent', { exact: true }).waitFor();
      await bob.locator('.timeline-message').filter({ hasText: marker }).locator('.thread-summary').click();
      const peerThread = bob.getByRole('complementary', { name: 'Thread', exact: true });
      await verifyAttachment(peerThread, file, caption);
      const attempts = wire.slice(start);
      invariant(attempts.length === 1 && attempts[0].path.includes('/m.room.encrypted/') && attempts[0].content['m.relates_to']?.rel_type === 'm.thread' && attempts[0].content['m.relates_to']?.event_id === attachmentThreadRootId, 'standard-thread-attachment');
      await thread.getByRole('button', { name: 'Close thread', exact: true }).click();
      await peerThread.getByRole('button', { name: 'Close thread', exact: true }).click();
    });
    await check('durable-room-thread-drafts-and-reattach', async () => {
      let stage = 'draft-stage-room';
      try {
        const roomDraft = 'Synthetic durable room draft';
        const threadDraft = 'Synthetic durable thread draft';
        const roomFile = { name: 'room-draft.bin', mimeType: 'application/octet-stream', buffer: randomBytes(40) };
        const threadFile = { name: 'thread-draft.bin', mimeType: 'application/octet-stream', buffer: randomBytes(48) };
        const roomCaption = 'Synthetic durable room caption', threadCaption = 'Synthetic durable thread caption';
        const start = wire.length;
        await alice.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(roomDraft);
        await alice.getByLabel('Choose attachment', { exact: true }).setInputFiles(roomFile);
        await alice.getByLabel(`Caption for ${roomFile.name}`, { exact: true }).fill(roomCaption);
        stage = 'draft-stage-thread';
        await openMatrixEvent(alice, roomId, attachmentThreadRootId);
        stage = 'draft-thread-composer';
        const thread = alice.getByRole('complementary', { name: 'Thread', exact: true });
        await thread.getByRole('textbox', { name: 'Message thread', exact: true }).fill(threadDraft);
        stage = 'draft-thread-file';
        await thread.getByLabel('Choose thread attachment', { exact: true }).setInputFiles(threadFile);
        stage = 'draft-thread-caption';
        await thread.getByLabel(`Caption for ${threadFile.name}`, { exact: true }).fill(threadCaption);
        stage = 'draft-thread-persistence';
        // Observe only synthetic draft strings in memory; do not persist a storage snapshot.
        await until(() => alice.evaluate(({ roomDraft, threadDraft, roomCaption, threadCaption }) => {
          const drafts = Object.keys(localStorage).filter((key) => key.startsWith('aimtrix.private-drafts.v1:')).map((key) => localStorage.getItem(key)).join('');
          return [roomDraft, threadDraft, roomCaption, threadCaption].every((value) => drafts.includes(value));
        }, { roomDraft, threadDraft, roomCaption, threadCaption }), 'drafts-persisted');
        stage = 'draft-reload-room';
        await alice.reload();
        await openRoom(alice, roomName);
        const roomComposer = alice.getByRole('textbox', { name: `Message ${roomName}`, exact: true });
        await until(async () => await roomComposer.innerText() === roomDraft, 'room-draft-restored');
        await alice.getByLabel(`Reattach ${roomFile.name}`, { exact: true }).waitFor();
        invariant(await alice.getByLabel(`Caption for ${roomFile.name}`, { exact: true }).inputValue() === roomCaption && await alice.getByRole('button', { name: 'Send attachments', exact: true }).isDisabled(), 'draft-reattach-required');
        stage = 'draft-reload-thread';
        await openMatrixEvent(alice, roomId, attachmentThreadRootId);
        await until(async () => await thread.getByRole('textbox', { name: 'Message thread', exact: true }).innerText() === threadDraft, 'thread-draft-restored');
        stage = 'draft-reattach-thread';
        await thread.getByLabel(`Reattach ${threadFile.name}`, { exact: true }).waitFor();
        invariant(await thread.getByLabel(`Caption for ${threadFile.name}`, { exact: true }).inputValue() === threadCaption && await thread.getByRole('button', { name: 'Send thread attachments', exact: true }).isDisabled(), 'draft-reattach-required');
        invariant(wire.length === start, 'draft-reload-no-send');
        stage = 'draft-send-reattached';
        await thread.getByLabel(`Reattach ${threadFile.name}`, { exact: true }).setInputFiles(threadFile);
        await thread.getByRole('button', { name: 'Send thread attachments', exact: true }).click();
        await thread.getByRole('region', { name: 'Thread attachments', exact: true }).getByText('Sent', { exact: true }).waitFor();
        stage = 'draft-receive-reattached';
        await openMatrixEvent(bob, roomId, attachmentThreadRootId);
        await verifyAttachment(bob.getByRole('complementary', { name: 'Thread', exact: true }), threadFile, threadCaption);
        invariant(await thread.getByRole('textbox', { name: 'Message thread', exact: true }).innerText() === threadDraft && await roomComposer.innerText() === roomDraft, 'independent-draft-contexts');
        stage = 'draft-cleanup-contexts';
        await thread.getByRole('textbox', { name: 'Message thread', exact: true }).fill('');
        await thread.getByRole('button', { name: 'Close thread', exact: true }).click();
        await bob.getByRole('button', { name: 'Close thread', exact: true }).click();
        await alice.getByLabel(`Reattach ${roomFile.name}`, { exact: true }).setInputFiles(roomFile);
        await alice.getByRole('region', { name: 'Attachments', exact: true }).getByText('Ready to send', { exact: true }).waitFor();
        await alice.getByRole('button', { name: `Remove ${roomFile.name}`, exact: true }).click();
        await roomComposer.fill('');
      } catch { throw new Error(stage); }
    });
    await check('formatted-api-peer-interoperability', async () => {
      // This is a standard Matrix API peer, not a third-party client UI claim.
      const name = 'Disposable formatted API peer';
      const created = await api('/_matrix/client/v3/createRoom', { token: aliceSession.accessToken, method: 'POST', body: { name, preset: 'private_chat', invite: [accounts.bob.user_id] } });
      const formattedRoomId = created.room_id;
      await api(`/_matrix/client/v3/rooms/${encode(formattedRoomId)}/join`, { token: bobSession.accessToken, method: 'POST', body: {} });
      const send = (content) => api(`/_matrix/client/v3/rooms/${encode(formattedRoomId)}/send/m.room.message/${randomBytes(12).toString('hex')}`, { token: bobSession.accessToken, method: 'PUT', body: content });
      const root = await send({ msgtype: 'm.text', body: 'Synthetic formatted root fallback', format: 'org.matrix.custom.html', formatted_body: '<mx-reply><blockquote>Discard synthetic quoted fallback</blockquote></mx-reply><p>Synthetic <strong>API peer root</strong> with <em>emphasis</em>.</p><blockquote>Preserved quotation</blockquote><ul><li>List item</li></ul><pre><code class="language-javascript">const safe = true;</code></pre><p><a href="https://example.invalid/">Safe link</a> <span data-mx-spoiler="synthetic reason">Hidden synthetic detail</span></p>' });
      const reply = await send({ msgtype: 'm.notice', body: 'Synthetic formatted thread fallback', format: 'org.matrix.custom.html', formatted_body: '<p>Synthetic <strong>API peer thread</strong> and <code>inline code</code>.</p>', 'm.relates_to': { rel_type: 'm.thread', event_id: root.event_id, is_falling_back: true, 'm.in_reply_to': { event_id: root.event_id } } });
      for (const page of [alice, bob]) await openRoom(page, name);
      const rootRow = alice.locator(`[data-event-id=${JSON.stringify(root.event_id)}]`);
      await rootRow.locator('strong').filter({ hasText: /^API peer root$/ }).waitFor();
      await rootRow.locator('blockquote').filter({ hasText: /^Preserved quotation$/ }).waitFor();
      await rootRow.locator('li').filter({ hasText: /^List item$/ }).waitFor();
      invariant(!(await rootRow.textContent()).includes('Discard synthetic quoted fallback'), 'formatted-api-peer-subset');
      await rootRow.getByRole('button', { name: 'Reveal spoiler: synthetic reason', exact: true }).click();
      await rootRow.getByText('Hidden synthetic detail', { exact: true }).waitFor();
      await rootRow.getByRole('link', { name: 'Safe link', exact: true }).waitFor();
      await rootRow.locator('.thread-summary').click();
      const thread = alice.getByRole('complementary', { name: 'Thread', exact: true });
      await thread.locator('.thread-panel__root strong').filter({ hasText: /^API peer root$/ }).waitFor();
      await thread.locator(`[data-event-id=${JSON.stringify(reply.event_id)}] strong`).filter({ hasText: /^API peer thread$/ }).waitFor();
      const start = wire.length;
      const outbound = '**Synthetic outbound formatting**';
      await thread.getByRole('textbox', { name: 'Message thread', exact: true }).fill(outbound);
      await thread.getByRole('button', { name: 'Send thread reply', exact: true }).click();
      const accepted = thread.locator('.timeline-message').filter({ hasText: 'Synthetic outbound formatting' });
      await accepted.getByText('Accepted by server', { exact: true }).waitFor();
      const eventId = await accepted.getAttribute('data-event-id');
      const stored = await api(`/_matrix/client/v3/rooms/${encode(formattedRoomId)}/event/${encode(eventId)}`, { token: bobSession.accessToken });
      invariant(stored.type === 'm.room.message' && stored.content.format === 'org.matrix.custom.html' && stored.content.formatted_body.includes('<strong>Synthetic outbound formatting</strong>') && stored.content['m.relates_to']?.event_id === root.event_id && wire.length === start + 1, 'formatted-outbound-roundtrip');
      await openMatrixEvent(bob, formattedRoomId, root.event_id);
      await bob.getByRole('complementary', { name: 'Thread', exact: true }).locator(`[data-event-id=${JSON.stringify(eventId)}] strong`).filter({ hasText: /^Synthetic outbound formatting$/ }).waitFor();
      for (const page of [alice, bob]) await page.getByRole('button', { name: 'Close thread', exact: true }).click();
      await alice.getByRole('textbox', { name: `Message ${name}`, exact: true }).fill('**Synthetic outbound room formatting** with _emphasis_ and `inline code`.');
      await alice.getByRole('button', { name: 'Send message', exact: true }).click();
      const roomOutbound = alice.locator('.timeline-message').filter({ hasText: 'Synthetic outbound room formatting' });
      await roomOutbound.getByText('Accepted by server', { exact: true }).waitFor();
      formattedPeer = { roomId: formattedRoomId, rootId: root.event_id, replyId: reply.event_id, outboundId: await roomOutbound.getAttribute('data-event-id') };
      for (const page of [alice, bob]) await openRoom(page, roomName);
    });
    if (stack.origins.element) await check('element-ui-formatted-interoperability', async () => {
      let stage = 'element-login-ui';
      try {
        // An actual separately distributed Element UI reads the server's events.
        // Only this disposable browser context holds its login/session data.
        const peer = await newPage();
        await peer.goto(`${stack.origins.element}/#/login`);
        await peer.getByRole('textbox', { name: 'Username', exact: true }).fill(accounts.bob.user_id);
        await peer.getByPlaceholder('Password', { exact: true }).fill(stack.credentials.password);
        await peer.getByRole('button', { name: 'Sign in', exact: true }).click();
        await until(async () => !(new URL(peer.url()).hash.startsWith('#/login')), 'element-login');
        stage = 'element-room-timeline';
        await peer.goto(`${stack.origins.element}/#/room/${encode(formattedPeer.roomId)}`);
        // Startup prompts can arrive after navigation; wait for the actual tile
        // while dismissing only the optional verification deferral control.
        const skip = peer.getByRole('button', { name: /^(Skip|Skip for now)$/ }).first();
        const outbound = peer.locator('.mx_EventTile').filter({ hasText: 'Synthetic outbound room formatting' });
        await until(async () => {
          if (await skip.isVisible()) await skip.click();
          return outbound.locator('strong').filter({ hasText: /^Synthetic outbound room formatting$/ }).isVisible();
        }, 'element-timeline', 60000);
        stage = 'element-outbound-emphasis';
        await outbound.locator('em').filter({ hasText: /^emphasis$/ }).waitFor();
        await outbound.locator('code').filter({ hasText: /^inline code$/ }).waitFor();
        stage = 'element-root-format';
        const root = peer.locator('.mx_EventTile').filter({ has: peer.locator('strong').filter({ hasText: /^API peer root$/ }) });
        await root.locator('strong').filter({ hasText: /^API peer root$/ }).waitFor();
        stage = 'element-root-quote';
        await root.locator('blockquote').filter({ hasText: /^Preserved quotation$/ }).waitFor();
        stage = 'element-root-list';
        await root.locator('li').filter({ hasText: /^List item$/ }).waitFor();
        stage = 'element-return-room';
        await openRoom(alice, 'Disposable formatted API peer');
        // Returning to a room preserves its reading position. Opt into live here
        // before asserting that a newly arriving peer message is visible.
        const latest = alice.getByRole('button', { name: 'Jump to latest messages', exact: true });
        if (await latest.isVisible()) { await latest.click(); await latest.waitFor({ state: 'hidden' }); }
        const accepted = peer.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.includes('/send/m.room.message/'));
        stage = 'element-return-composer';
        const composer = peer.getByRole('textbox', { name: 'Send an unencrypted message…', exact: true });
        await composer.fill('**Synthetic Element return** with _peer emphasis_ and `peer code`.');
        await composer.press('Enter');
        const response = await accepted;
        invariant(response.ok(), 'element-formatted-send');
        const content = response.request().postDataJSON();
        invariant(content.format === 'org.matrix.custom.html' && content.formatted_body?.includes('<strong>Synthetic Element return</strong>'), 'element-formatted-send');
        stage = 'element-return-receive';
        const eventId = (await response.json()).event_id;
        const stored = await api(`/_matrix/client/v3/rooms/${encode(formattedPeer.roomId)}/event/${encode(eventId)}`, { token: aliceSession.accessToken });
        invariant(stored.type === 'm.room.message' && stored.content.msgtype === 'm.text' && stored.content['m.relates_to']?.rel_type !== 'm.thread', 'element-return-main-event');
        await alice.bringToFront();
        const received = alice.locator(`[data-event-id=${JSON.stringify(eventId)}]`);
        try { await received.waitFor(); } catch {
          const latest = alice.getByRole('button', { name: 'Jump to latest messages', exact: true });
          if (await latest.isVisible()) stage = 'element-return-detached';
          else if (await alice.locator('.timeline-message').filter({ hasText: 'Synthetic Element return' }).count()) stage = 'element-return-id-mismatch';
          throw new Error(stage);
        }
        stage = 'element-return-strong';
        await received.locator('strong').filter({ hasText: /^Synthetic Element return$/ }).waitFor();
        stage = 'element-return-emphasis';
        await received.locator('em').filter({ hasText: /^peer emphasis$/ }).waitFor();
        stage = 'element-return-code';
        await received.locator('code').filter({ hasText: /^peer code$/ }).waitFor();
        await openRoom(alice, roomName);
        await peer.close();
      } catch { throw new Error(stage); }
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
      if (!(await drawer.isVisible())) await alice.getByRole('button', { name: 'Toggle room details', exact: true }).click();
      await drawer.getByRole('button', { name: 'Actions for charlie', exact: true }).click();
      await drawer.getByRole('menuitemradio', { name: 'Decorator', exact: true }).click();
      const memberPath = `/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.member/${encode(accounts.charlie.user_id)}`;
      await until(async () => (await api(`/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.power_levels`, { token: aliceSession.accessToken })).users?.[accounts.charlie.user_id] === 25, 'moderation-power');
      await drawer.getByRole('button', { name: 'Actions for charlie', exact: true }).click();
      await drawer.getByRole('menuitem', { name: 'Remove member', exact: true }).click();
      await alice.getByRole('dialog').getByRole('button', { name: 'Remove member', exact: true }).click();
      await until(async () => (await api(memberPath, { token: aliceSession.accessToken })).membership === 'leave', 'moderation-kick');
      await api(`/_matrix/client/v3/rooms/${encode(roomId)}/invite`, { token: aliceSession.accessToken, method: 'POST', body: { user_id: accounts.charlie.user_id } });
      await drawer.getByRole('button', { name: 'Actions for charlie', exact: true }).click();
      await drawer.getByRole('menuitem', { name: 'Ban member', exact: true }).click();
      await alice.getByRole('dialog').getByRole('button', { name: 'Ban member', exact: true }).click();
      await until(async () => (await api(memberPath, { token: aliceSession.accessToken })).membership === 'ban', 'moderation-ban');
      await drawer.getByRole('button', { name: 'Actions for charlie', exact: true }).click();
      await drawer.getByRole('menuitem', { name: 'Unban member', exact: true }).click();
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
    const assertExpired = async (page) => {
      await page.getByRole('heading', { name: 'Your Matrix session expired', exact: true }).waitFor({ timeout: 60000 });
      invariant(await page.locator('.timeline-message, .buddy-row').count() === 0, 'expired-room-dom-cleared');
      invariant(await page.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).count() === 0, 'expired-composer-removed');
      // Return only a boolean, never serialized credential/recovery metadata.
      await until(() => page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1'));
        return !saved?.accessToken;
      }), 'expired-token-removed');
    };
    const openRecovery = async (page, previous) => {
      await page.getByRole('button', { name: 'Sign in again', exact: true }).click();
      const identity = page.getByRole('textbox', { name: 'Matrix ID', exact: true });
      await identity.waitFor();
      invariant(await identity.inputValue() === previous.userId && await identity.evaluate((input) => input.readOnly), 'recovery-account-locked');
      const homeserver = page.getByRole('textbox', { name: 'Homeserver', exact: true });
      if (await homeserver.count()) invariant(await homeserver.evaluate((input) => input.readOnly), 'recovery-homeserver-locked');
    };
    await check('revoked-active-session-and-encrypted-reauthentication', async () => {
      // Standard logout invalidates only this disposable device. Its browser
      // remains open, so the real SDK sync loop must detect M_UNKNOWN_TOKEN.
      await api('/_matrix/client/v3/logout', { token: secondSession.accessToken, method: 'POST', body: {} });
      await assertExpired(aliceSecond);
      // A reload retains the token-free recovery choice, not the rejected token.
      await aliceSecond.reload();
      await assertExpired(aliceSecond);
      await openRecovery(aliceSecond, secondSession);
      await aliceSecond.getByLabel('Password', { exact: true }).fill(stack.credentials.password);
      await aliceSecond.getByRole('button', { name: 'Sign On', exact: true }).click();
      await aliceSecond.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 60000 });
      const restored = await session(aliceSecond);
      invariant(restored.userId === secondSession.userId && restored.deviceId !== secondSession.deviceId && restored.accessToken !== secondSession.accessToken, 'reauthenticated-new-device-same-account');
      for (const page of [aliceSecond, bob]) {
        await openRoom(page, roomName);
        const latest = page.getByRole('button', { name: 'Jump to latest messages', exact: true });
        if (await latest.count()) await latest.click();
      }
      const marker = `Synthetic recovered session ${randomBytes(12).toString('hex')}`;
      const sent = aliceSecond.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname.includes('/send/'));
      await aliceSecond.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(marker);
      await aliceSecond.getByRole('button', { name: 'Send message', exact: true }).click();
      const request = await sent;
      const content = request.postDataJSON();
      invariant(new URL(request.url()).pathname.includes('/send/m.room.encrypted/') && content.algorithm === 'm.megolm.v1.aes-sha2' && !JSON.stringify(content).includes(marker), 'reauthenticated-encrypted-wire');
      await bob.locator('.timeline-message').filter({ hasText: marker }).waitFor({ timeout: 45000 });
      await bob.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(`Reply ${marker}`);
      await bob.getByRole('button', { name: 'Send message', exact: true }).click();
      await aliceSecond.locator('.timeline-message').filter({ hasText: `Reply ${marker}` }).waitFor({ timeout: 45000 });
      // Peers stay online: this proves new-device encryption and reception,
      // not isolated restoration of old keys or backup/verification coverage.
    });
    await check('revoked-stored-session-recovery', async () => {
      // Unload the SDK before revocation, preserving the browser's stored
      // credential. The next initial restore must reject that real old token.
      await bob.goto('about:blank');
      await api('/_matrix/client/v3/logout', { token: bobSession.accessToken, method: 'POST', body: {} });
      await bob.goto(stack.origins.app);
      await assertExpired(bob);
      await openRecovery(bob, bobSession);
    });
  } finally {
    for (const context of contexts) await context.close();
  }
}
