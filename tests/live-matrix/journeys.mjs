/* global localStorage, indexedDB, fetch, AbortSignal, window, Event, navigator, Blob, atob */
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
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
  const voiceBytes = await readFile(new URL('./fixtures/synthetic-tone.webm', import.meta.url));
  await alice.addInitScript((voiceBase64) => {
    const track = { stop() {}, onended: null };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }),
      enumerateDevices: async () => [],
    } });
    class SyntheticRecorder {
      static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
      state = 'inactive'; mimeType = 'audio/webm;codecs=opus';
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([Uint8Array.from(atob(voiceBase64), (character) => character.charCodeAt(0))], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: SyntheticRecorder });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
  }, voiceBytes.toString('base64'));
  let aliceSession, bobSession, secondSession, roomId;
  let navigationHistory, threadHistory, attachmentThreadRootId, formattedPeer, elementPeer;
  const roomName = 'Disposable encrypted lounge';
  const wire = [];
  const bobWire = [];
  const uploads = [];
  alice.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'PUT' && url.pathname.includes('/send/')) wire.push({ path: url.pathname, content: request.postDataJSON() });
  });
  bob.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'PUT' && url.pathname.includes('/send/')) bobWire.push({ path: url.pathname, content: request.postDataJSON() });
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
    if (stack.origins.element) await check('element-ui-encrypted-room', async () => {
      let stage = 'element-encrypted-login';
      try {
        elementPeer = await newPage();
        await elementPeer.goto(`${stack.origins.element}/#/login`);
        await elementPeer.getByRole('textbox', { name: 'Username', exact: true }).fill(accounts.bob.user_id);
        await elementPeer.getByPlaceholder('Password', { exact: true }).fill(stack.credentials.password);
        await elementPeer.getByRole('button', { name: 'Sign in', exact: true }).click();
        await until(async () => !(new URL(elementPeer.url()).hash.startsWith('#/login')), 'element-login');
        stage = 'element-encrypted-room';
        await elementPeer.goto(`${stack.origins.element}/#/room/${encode(roomId)}`);
        stage = 'element-encrypted-composer';
        const skip = elementPeer.getByRole('button', { name: /^(Skip|Skip for now)$/ }).first();
        const composer = elementPeer.locator('.mx_BasicMessageComposer_input');
        try {
          await until(async () => {
            // Startup prompts can disappear between visibility and click. Keep
            // waiting for the encrypted composer rather than failing the journey.
            if (await skip.isVisible()) await skip.click({ timeout: 1500 }).catch(() => {});
            return (await composer.isVisible()) && await composer.isEnabled();
          }, 'element-encrypted-composer', 30000);
        } catch {
          // Fixed categories preserve the privacy boundary: no URL, room data,
          // dialog text, or DOM snapshot is written to the report.
          const route = new URL(elementPeer.url()).hash;
          stage = route.startsWith('#/login') ? 'element-back-at-login'
            : !route.startsWith('#/room/') ? 'element-left-room-route'
              : !await elementPeer.locator('.mx_RoomView').count() ? 'element-room-not-rendered'
                : await composer.count() ? 'element-composer-hidden'
                  : await elementPeer.getByRole('dialog').count() ? 'element-room-dialog'
                    : 'element-room-no-composer';
          throw new Error(stage);
        }
        const hello = `Synthetic Element encrypted hello ${randomBytes(6).toString('hex')}`;
        stage = 'element-encrypted-fill';
        await composer.fill(hello);
        stage = 'element-encrypted-send';
        const [response] = await Promise.all([
          elementPeer.waitForResponse((result) => result.request().method() === 'PUT' && new URL(result.url()).pathname.includes('/send/m.room.encrypted/'), { timeout: 45000 }),
          composer.press('Enter'),
        ]);
        invariant(response.ok(), 'element-encrypted-send');
        stage = 'element-encrypted-receive';
        await alice.locator('.timeline-message').filter({ hasText: hello }).waitFor({ timeout: 45000 });
      } catch { throw new Error(stage); }
    });
    const marker = `Encrypted round trip ${randomBytes(12).toString('hex')}`;
    await check('encrypted-send-receive-and-latency', async () => {
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
    await check('password-two-device-recovery-setup-and-restore', async () => {
      let stage = 'recovery-open-first-settings';
      let recoveryDevice;
      try {
      await alice.bringToFront();
      await alice.getByRole('button', { name: 'Open settings', exact: true }).click();
      const first = alice.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
      await first.getByRole('button', { name: 'Matrix & security', exact: true }).click();
      stage = 'recovery-setup-control';
      await first.getByRole('button', { name: 'Set up new recovery', exact: true }).waitFor();
      await first.getByLabel('New recovery passphrase', { exact: true }).fill(`Synthetic recovery ${randomBytes(12).toString('hex')}`);
      await first.getByLabel('Matrix password, if this account has one', { exact: true }).fill(stack.credentials.password);
      await first.getByRole('button', { name: 'Set up new recovery', exact: true }).click();
      stage = 'recovery-setup-result';
      await first.getByText('Encryption recovery and key backup are ready.', { exact: false }).waitFor({ timeout: 60000 });
      stage = 'recovery-server-backup';
      await until(async () => {
        try {
          const info = await api('/_matrix/client/v3/room_keys/version', { token: aliceSession.accessToken });
          return Boolean(info.version && info.count > 0);
        } catch { return false; }
      }, 'recovery-server-backup', 60000);
      stage = 'recovery-server-secret-storage';
      await until(async () => {
        try {
          const data = await api(`/_matrix/client/v3/user/${encode(aliceSession.userId)}/account_data/m.secret_storage.default_key`, { token: aliceSession.accessToken });
          return typeof data.key === 'string' && data.key.length > 0;
        } catch { return false; }
      }, 'recovery-server-secret-storage', 60000);
      const key = await first.locator('.recovery-key-output code').textContent();
      invariant(Boolean(key), 'recovery-key-generated');
      await first.getByRole('button', { name: 'I saved the recovery key', exact: true }).click();
      invariant(await first.locator('.recovery-key-output code').count() === 0, 'recovery-key-dismissed');
      await first.getByRole('button', { name: 'Close settings', exact: true }).click();

      stage = 'recovery-new-device-history';
      recoveryDevice = await newPage();
      await login(recoveryDevice, stack.origins.app, 'alice', stack.credentials.password);
      await openRoom(recoveryDevice, roomName);
      await recoveryDevice.locator('.timeline-message').first().waitFor({ timeout: 45000 });
      invariant(await recoveryDevice.locator('.timeline-message').filter({ hasText: marker }).count() === 0, 'recovery-old-event-unavailable');
      stage = 'recovery-open-second-settings';
      await recoveryDevice.getByRole('button', { name: 'Open settings', exact: true }).click();
      const second = recoveryDevice.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
      await second.getByRole('button', { name: 'Matrix & security', exact: true }).click();
      await second.getByLabel('Existing recovery key', { exact: true }).fill(key);
      await second.getByRole('button', { name: 'Restore existing room keys', exact: true }).click();
      stage = 'recovery-restore-result';
      const result = second.locator('.settings-success').filter({ hasText: 'Recovery complete.' });
      await result.waitFor({ timeout: 60000 });
      stage = 'recovery-imported-keys';
      const imported = Number((await result.textContent())?.match(/Imported (\d+) room keys/)?.[1] ?? 0);
      invariant(imported > 0, 'recovery-imported-keys');
      invariant(await second.getByLabel('Existing recovery key', { exact: true }).inputValue() === '', 'recovery-key-cleared');
      await second.getByRole('button', { name: 'Close settings', exact: true }).click();
      stage = 'recovery-old-event-restored';
      await recoveryDevice.getByText(marker, { exact: true }).waitFor({ timeout: 45000 });
      } catch {
        if (stage === 'recovery-setup-result') {
          if (await alice.getByRole('alert').filter({ hasText: 'trusted Matrix client' }).count()) stage = 'recovery-setup-unsupported';
          else if (await alice.getByRole('alert').filter({ hasText: 'Recovery setup failed' }).count()) stage = 'recovery-setup-failed';
          else if (await alice.getByRole('status').filter({ hasText: 'Working with your homeserver' }).count()) stage = 'recovery-setup-pending';
        }
        if (stage === 'recovery-restore-result') {
          const alert = recoveryDevice.getByRole('alert');
          if (await alert.filter({ hasText: 'could not restore its encryption identity' }).count()) stage = 'recovery-restore-cross-signing';
          else if (await alert.filter({ hasText: 'room-key backup could not be enabled' }).count()) stage = 'recovery-restore-backup';
          else if (await alert.filter({ hasText: 'room keys could not be imported' }).count()) stage = 'recovery-restore-room-keys';
          else if (await alert.filter({ hasText: 'does not match this account' }).count()) stage = 'recovery-restore-key-mismatch';
          else if (await alert.filter({ hasText: 'no compatible recovery backup' }).count()) stage = 'recovery-restore-no-backup';
          else if (await alert.count()) stage = 'recovery-restore-failed';
          else if (await recoveryDevice.getByText('Recovery complete. Imported 0 room keys.', { exact: true }).count()) stage = 'recovery-restore-zero-import';
          else if (await recoveryDevice.locator('.matrix-settings-panel fieldset:disabled').count()) {
            const notice = recoveryDevice.locator('.settings-success');
            if (await notice.filter({ hasText: 'Restoring the encryption identity' }).count()) stage = 'recovery-restore-pending-identity';
            else if (await notice.filter({ hasText: 'Unlocking the room-key backup' }).count()) stage = 'recovery-restore-pending-backup-key';
            else if (await notice.filter({ hasText: 'Checking backup trust' }).count()) stage = 'recovery-restore-pending-backup-trust';
            else if (await notice.filter({ hasText: 'Importing encrypted room keys' }).count()) stage = 'recovery-restore-pending-import';
            else stage = 'recovery-restore-pending';
          }
          else if (await recoveryDevice.locator('.settings-success').filter({ hasText: 'Recovery complete.' }).count()) stage = 'recovery-restore-unmatched-count';
          else if (await recoveryDevice.locator('.settings-success').count()) stage = 'recovery-restore-unmatched-success';
          else if (await recoveryDevice.locator('.settings-error').count()) stage = 'recovery-restore-unmatched-error';
          else if (await recoveryDevice.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true }).count() === 0) stage = 'recovery-restore-dialog-gone';
          else stage = 'recovery-restore-idle';
        }
        throw new Error(stage);
      }
    });
    await check('incoming-two-device-sas-verification', async () => {
      let stage = 'verification-new-device';
      try {
        const verifyPeer = await newPage();
        await login(verifyPeer, stack.origins.app, 'alice', stack.credentials.password);
        const verifySession = await session(verifyPeer);
        invariant(verifySession?.deviceId && verifySession.deviceId !== aliceSession.deviceId, 'verification-distinct-device');
        stage = 'verification-open-initiator';
        await alice.bringToFront();
        await alice.getByRole('button', { name: 'Open settings', exact: true }).click();
        const settings = alice.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
        await settings.getByRole('button', { name: 'Matrix & security', exact: true }).click();
        stage = 'verification-device-row';
        const deviceInput = settings.getByRole('textbox', { name: `Name for ${verifySession.deviceId}` });
        for (let attempt = 0; attempt < 5 && !await deviceInput.count(); attempt++) {
          const refresh = settings.getByRole('button', { name: 'Refresh', exact: true });
          await refresh.click();
          await until(() => refresh.isEnabled(), 'verification-device-refresh', 10000);
        }
        await deviceInput.waitFor();
        const device = deviceInput.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " device-card ")]');
        stage = 'verification-button';
        await device.getByRole('button', { name: 'Verify', exact: true }).click();
        stage = 'verification-incoming-request';
        await verifyPeer.bringToFront();
        const incoming = verifyPeer.getByRole('complementary', { name: 'Incoming device verification' });
        await incoming.getByRole('button', { name: 'Compare emoji', exact: true }).click();
        stage = 'verification-emoji';
        const initiatedChallenge = alice.getByRole('dialog', { name: 'Compare verification emoji', exact: true });
        const incomingChallenge = verifyPeer.getByRole('dialog', { name: 'Compare incoming verification emoji', exact: true });
        await initiatedChallenge.waitFor({ timeout: 45000 });
        await incomingChallenge.waitFor({ timeout: 45000 });
        const firstEmoji = await initiatedChallenge.locator('small').allTextContents();
        const secondEmoji = await incomingChallenge.locator('small').allTextContents();
        invariant(firstEmoji.length === 7 && JSON.stringify(firstEmoji) === JSON.stringify(secondEmoji), 'verification-matching-emoji');
        await initiatedChallenge.getByRole('button', { name: 'They match', exact: true }).click();
        await incomingChallenge.getByRole('button', { name: 'They match', exact: true }).click();
        stage = 'verification-completion';
        await initiatedChallenge.waitFor({ state: 'hidden', timeout: 45000 });
        await incomingChallenge.waitFor({ state: 'hidden', timeout: 45000 });
        await settings.getByText('Device verified.', { exact: true }).waitFor({ timeout: 45000 });
        await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      } catch { throw new Error(stage); }
    });
    if (elementPeer) await check('element-ui-encrypted-message', async () => {
      const skip = elementPeer.getByRole('button', { name: /^(Skip|Skip for now)$/ }).first();
      await until(async () => {
        if (await skip.isVisible()) await skip.click();
        return elementPeer.locator('.mx_EventTile').filter({ hasText: marker }).last().isVisible();
      }, 'element-encrypted-message', 60000);
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
      // HTTP acceptance and peer delivery can precede the sender's remote-echo
      // reconciliation. Require stable convergence, not a single intermediate
      // render; persistent duplicates or a missing accepted row still fail.
      let settledReplyId, settledSamples = 0;
      await until(async () => {
        const [peerIds, senderIds] = await Promise.all([
          received.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id'))),
          failed.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id'))),
        ]);
        const replyId = peerIds[0];
        if (peerIds.length !== 1 || senderIds.length !== 1 || !replyId?.startsWith('$') || senderIds[0] !== replyId) {
          settledSamples = 0; settledReplyId = undefined; return false;
        }
        settledSamples = settledReplyId === replyId ? settledSamples + 1 : 1;
        settledReplyId = replyId;
        return settledSamples >= 3;
      }, 'single-thread-reply');
      threadHistory = { rootId: await root.getAttribute('data-event-id'), replyId: settledReplyId };
      const attempts = wire.slice(start);
      invariant(attempts.length === 2 && attempts[0].path === attempts[1].path && JSON.stringify(attempts[0].content) === JSON.stringify(attempts[1].content), 'thread-retry-same-ciphertext-transaction');
      invariant(attempts[0].content['m.relates_to']?.rel_type === 'm.thread', 'standard-thread-relation');
      const relations = await api(`/_matrix/client/v1/rooms/${encode(roomId)}/relations/${encode(threadHistory.rootId)}/m.thread?limit=100`, { token: aliceSession.accessToken });
      const acceptedCopies = relations.chunk.filter((event) => event.type === 'm.room.encrypted' && event.content?.ciphertext === attempts[0].content.ciphertext);
      invariant(acceptedCopies.length === 1 && acceptedCopies[0].event_id === settledReplyId, 'single-thread-reply');
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
    await check('private-encrypted-search-key-availability', async () => {
      let stage = 'private-search-keyed-device';
      const passphrase = () => randomBytes(24).toString('hex');
      const historyPrefix = navigationHistory.firstText.slice(0, navigationHistory.firstText.lastIndexOf(' '));
      const openIndex = async (page, localPassphrase) => {
        await openRoom(page, roomName);
        await page.getByRole('button', { name: 'Search message history', exact: true }).click();
        const panel = page.getByRole('complementary', { name: 'Message search' });
        await panel.getByLabel('Search conversation').selectOption(roomId);
        await panel.locator('summary').filter({ hasText: 'Encrypted history on this device' }).click();
        await panel.getByLabel('Local index passphrase').fill(localPassphrase);
        await panel.getByRole('button', { name: 'Create or unlock index' }).click();
        await panel.getByRole('button', { name: 'Index up to 1,000 older messages' }).waitFor();
        return panel;
      };
      try {
        const capture = (page) => {
          const bodies = [];
          const searches = [];
          const observe = (request) => {
            const body = request.postData();
            if (body) bodies.push(body);
            if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/search')) searches.push(true);
          };
          page.on('request', observe);
          return { bodies, searches, stop: () => page.off('request', observe) };
        };
        const keyedPassphrase = passphrase();
        const keyedTraffic = capture(aliceSecond);
        try {
          const panel = await openIndex(aliceSecond, keyedPassphrase);
          await panel.getByRole('button', { name: 'Index up to 1,000 older messages' }).click();
          await panel.getByRole('button', { name: 'Available history indexed' }).waitFor({ timeout: 120000 });
          invariant(/oldest indexed .+, newest /.test(await panel.locator('.private-search-controls [role="status"]').textContent() ?? ''), 'private-search-keyed-device');
          stage = 'private-search-keyed-result';
          await panel.getByLabel('Search words').fill(navigationHistory.secondText);
          await panel.getByRole('button', { name: 'Search history', exact: true }).click();
          const result = panel.locator('.search-results button').filter({ hasText: navigationHistory.secondText });
          await result.waitFor({ timeout: 60000 });
          invariant(await result.count() === 1, 'private-search-keyed-result');
          invariant(keyedTraffic.searches.length === 0 && keyedTraffic.bodies.every((body) => !body.includes(historyPrefix) && !body.includes(keyedPassphrase)), 'private-search-no-plaintext-upload');
          stage = 'private-search-exact-context';
          await result.click();
          await aliceSecond.locator(`[data-event-id=${JSON.stringify(navigationHistory.secondId)}]`).waitFor({ timeout: 45000 });
        } finally { keyedTraffic.stop(); }
        stage = 'private-search-new-device';
        // Charlie joined before the history was sent but had no browser session
        // receiving its room keys. A first signed-in device exposes that gap.
        const charlieFresh = await newPage();
        await login(charlieFresh, stack.origins.app, 'charlie', stack.credentials.password);
        const freshSession = await session(charlieFresh);
        invariant(freshSession.userId === accounts.charlie.user_id, 'private-search-new-device');
        const freshPassphrase = passphrase();
        const freshTraffic = capture(charlieFresh);
        const freshPanel = await openIndex(charlieFresh, freshPassphrase);
        await freshPanel.getByRole('button', { name: 'Index up to 1,000 older messages' }).click();
        await freshPanel.getByRole('button', { name: 'Available history indexed' }).waitFor({ timeout: 120000 });
        stage = 'private-search-missing-keys';
        await until(async () => /[1-9]\d* skipped without keys/.test(await freshPanel.locator('.private-search-controls [role="status"]').textContent() ?? ''), 'private-search-missing-keys');
        await freshPanel.getByLabel('Search words').fill(navigationHistory.secondText);
        await freshPanel.getByRole('button', { name: 'Search history', exact: true }).click();
        await freshPanel.getByText('No matches in the searched coverage.', { exact: true }).waitFor();
        invariant(freshTraffic.searches.length === 0 && freshTraffic.bodies.every((body) => !body.includes(historyPrefix) && !body.includes(freshPassphrase)), 'private-search-no-plaintext-upload');
        freshTraffic.stop();
        stage = 'private-search-sending-still-available';
        await freshPanel.getByRole('button', { name: 'Close message search' }).click();
        const marker = `Synthetic private search send ${randomBytes(8).toString('hex')}`;
        await charlieFresh.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(marker);
        const sent = charlieFresh.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname.includes('/send/m.room.encrypted/'));
        await charlieFresh.getByRole('button', { name: 'Send message', exact: true }).click();
        await sent;
        await charlieFresh.locator('.timeline-message').filter({ hasText: marker }).getByText('Accepted by server', { exact: true }).waitFor();
        stage = 'private-search-delete';
        await charlieFresh.getByRole('button', { name: 'Search message history', exact: true }).click();
        await freshPanel.getByRole('button', { name: 'Delete local index' }).click();
        await charlieFresh.getByRole('dialog', { name: 'Delete private search index?' }).getByRole('button', { name: 'Delete local index' }).click();
        await freshPanel.getByRole('button', { name: 'Create or unlock index' }).waitFor();
        invariant(await charlieFresh.evaluate(async () => (await indexedDB.databases()).every((database) => !database.name?.startsWith('aimtrix.private-search.'))), 'private-search-delete');
      } catch { throw new Error(stage); }
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
    const openTool = async (name) => {
      const more = alice.getByRole('button', { name: 'More message tools' });
      if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
      await alice.getByRole('button', { name, exact: true }).click();
    };
    const safeAction = async (category, action) => {
      try { return await action(); }
      catch { throw new Error(category); }
    };
    const question = `Synthetic poll ${randomBytes(6).toString('hex')}`;
    const first = 'Synthetic option A', second = 'Synthetic option B';
    const alicePoll = alice.getByRole('region', { name: `Poll: ${question}` });
    const bobPoll = bob.getByRole('region', { name: `Poll: ${question}` });
    await check('encrypted-poll-create', async () => {
      const socialWireStart = wire.length;
      await safeAction('poll-open-control', () => openTool('Create a poll'));
      const pollDialog = alice.getByRole('dialog', { name: 'Create a poll' });
      await safeAction('poll-dialog-input', async () => {
        await pollDialog.getByLabel('Question').fill(question);
        await pollDialog.getByLabel('Answer 1').fill(first);
        await pollDialog.getByLabel('Answer 2').fill(second);
      });
      await safeAction('poll-submit', () => pollDialog.getByRole('button', { name: 'Create poll', exact: true }).click());
      await safeAction('poll-render', async () => {
        await alicePoll.waitFor({ timeout: 45000 });
        await bobPoll.waitFor({ timeout: 45000 });
      });
      const pollStartWire = wire.slice(socialWireStart);
      invariant(pollStartWire.length > 0 && pollStartWire.every((event) => event.path.includes('/m.room.encrypted/') && !JSON.stringify(event.content).includes(question)), 'poll-create-decrypted');
    });
    if (elementPeer) await check('element-ui-encrypted-poll', async () => {
      await until(() => elementPeer.locator('.mx_EventTile').filter({ hasText: question }).last().isVisible(), 'element-poll-render', 60000);
    });
    await check('encrypted-poll-vote', async () => {
      const bobVoteStart = bobWire.length;
      await safeAction('poll-vote-control', async () => {
        const choice = bobPoll.getByRole('button', { name: second });
        await until(async () => {
          if (await choice.isEnabled()) return true;
          const refresh = bobPoll.getByRole('button', { name: 'Refresh results' });
          if (await refresh.isEnabled()) await refresh.click();
          return false;
        }, 'poll-vote-control');
        await choice.click();
      });
      await safeAction('poll-vote-confirm', () => bobPoll.getByText('Vote saved.', { exact: true }).waitFor({ timeout: 45000 }));
      const voteWire = bobWire.slice(bobVoteStart);
      invariant(voteWire.length > 0 && voteWire.every((event) => event.path.includes('/m.room.encrypted/')), 'poll-vote-reconciled');
      await until(async () => {
        await alicePoll.getByRole('button', { name: 'Refresh results' }).click();
        return (await alicePoll.textContent()).includes('1 vote');
      }, 'poll-vote-reconciled');
    });
    await check('encrypted-poll-end', async () => {
      const pollEndWireStart = wire.length;
      await alicePoll.getByRole('button', { name: 'End poll' }).click();
      await alice.getByRole('dialog', { name: 'End this poll?' }).getByRole('button', { name: 'End poll' }).click();
      await alicePoll.getByText('Poll ended', { exact: true }).first().waitFor({ timeout: 45000 });
      const endWire = wire.slice(pollEndWireStart);
      invariant(endWire.length > 0 && endWire.every((event) => event.path.includes('/m.room.encrypted/')), 'poll-end-reconciled');
      await until(async () => {
        await bobPoll.getByRole('button', { name: 'Refresh results' }).click();
        return (await bobPoll.textContent()).includes('Poll ended');
      }, 'poll-end-reconciled');
    });
    const location = `Synthetic meeting point ${randomBytes(6).toString('hex')}`;
    await check('encrypted-location-interop', async () => {
      const locationWireStart = wire.length;
      await safeAction('location-open-control', () => openTool('Share a location'));
      const locationDialog = alice.getByRole('dialog', { name: 'Share a location' });
      await safeAction('location-dialog-input', async () => {
        await locationDialog.getByRole('spinbutton', { name: 'Latitude' }).fill('40.7128');
        await locationDialog.getByRole('spinbutton', { name: 'Longitude' }).fill('-74.006');
        await locationDialog.getByLabel('Description (optional)').fill(location);
      });
      await safeAction('location-submit', () => locationDialog.getByRole('button', { name: 'Share this location' }).click());
      const receivedLocation = bob.locator('.message-location').filter({ hasText: location });
      await safeAction('location-render', () => receivedLocation.waitFor({ timeout: 45000 }));
      const locationWire = wire.slice(locationWireStart);
      invariant((await receivedLocation.textContent()).includes('40.7128, -74.006') &&
        (await receivedLocation.getByRole('link', { name: `Open ${location} in your map application` }).getAttribute('href')) === 'geo:40.7128,-74.006' &&
        locationWire.length > 0 && locationWire.every((event) => event.path.includes('/m.room.encrypted/') && !JSON.stringify(event.content).includes(location)), 'location-decrypted');
    });
    if (elementPeer) await check('element-ui-encrypted-location', async () => {
      await until(() => elementPeer.locator('.mx_EventTile').filter({ hasText: location }).last().isVisible(), 'element-location-render', 60000);
    });
    await check('encrypted-voice-interop', async () => {
      const bytes = voiceBytes;
      const uploadStart = uploads.length;
      const voiceWireStart = wire.length;
      await openTool('Record a voice message');
      const voiceDialog = alice.getByRole('dialog', { name: 'Record a voice message' });
      invariant(uploads.length === uploadStart && wire.length === voiceWireStart, 'voice-no-premature-upload');
      await voiceDialog.getByRole('button', { name: 'Start recording' }).click();
      await voiceDialog.getByRole('button', { name: 'Stop recording' }).waitFor();
      await alice.waitForTimeout(350);
      await voiceDialog.getByRole('button', { name: 'Stop recording' }).click();
      await voiceDialog.getByLabel('Voice message preview').waitFor();
      invariant(uploads.length === uploadStart && wire.length === voiceWireStart, 'voice-no-premature-upload');
      await voiceDialog.getByRole('button', { name: 'Send voice message' }).click();
      await until(() => uploads.length > uploadStart, 'voice-encrypted-upload');
      const audio = bob.locator('.message-audio-card').filter({ hasText: 'Voice message' }).last();
      await audio.waitFor({ timeout: 45000 });
      const link = audio.getByRole('link', { name: 'Download audio' });
      await until(async () => (await link.getAttribute('href'))?.startsWith('blob:'), 'voice-decrypted-download');
      const decrypted = await link.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch(element.href)).arrayBuffer())));
      invariant(Buffer.from(decrypted).equals(bytes), 'voice-decrypted-download');
      const source = uploads.at(-1).content_uri;
      const encrypted = await api(`/_matrix/client/v1/media/download/${source.slice(6)}`, { token: bobSession.accessToken, binary: true });
      const voiceWire = wire.slice(voiceWireStart);
      invariant(!Buffer.from(encrypted).equals(bytes) && voiceWire.length > 0 && voiceWire.every((event) => event.path.includes('/m.room.encrypted/')), 'voice-encrypted-upload');
    });
    if (elementPeer) await check('element-ui-encrypted-voice', async () => {
      await until(() => elementPeer.locator('.mx_EventTile').filter({ hasText: 'Voice message' }).last().isVisible(), 'element-voice-render', 60000);
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
          await until(async () => await alice.locator('.timeline-message').filter({ has: alice.locator('.message-file').filter({ hasText: files[index].name }) }).count() === 1, 'single-accepted-attachment');
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
    await check('saved-reference-own-device-and-context', async () => {
      let stage = 'saved-open-source';
      try {
        const formattedName = 'Disposable formatted API peer';
        await openRoom(alice, formattedName);
        const source = alice.locator(`[data-event-id=${JSON.stringify(formattedPeer.outboundId)}]`);
        await source.getByRole('button', { name: 'More message actions' }).click();
        stage = 'saved-write';
        await alice.getByRole('menuitem', { name: 'Save message', exact: true }).click();
        await source.getByText('Message saved.', { exact: true }).waitFor();
        const savedPath = `/_matrix/client/v3/user/${encode(aliceSession.userId)}/account_data/im.aimtrix.saved_events.v1`;
        await until(async () => {
          try { return (await api(savedPath, { token: aliceSession.accessToken })).items?.some((item) => item.roomId === formattedPeer.roomId && item.eventId === formattedPeer.outboundId); }
          catch { return false; }
        }, 'saved-account-data');
        const accountData = await api(savedPath, { token: secondSession.accessToken });
        invariant(Object.keys(accountData).join() === 'items' && accountData.items?.length === 1 &&
          Object.keys(accountData.items[0]).sort().join() === 'eventId,roomId,savedAt' &&
          accountData.items[0].roomId === formattedPeer.roomId && accountData.items[0].eventId === formattedPeer.outboundId &&
          Number.isSafeInteger(accountData.items[0].savedAt), 'saved-opaque-reference');
        stage = 'saved-own-device';
        await aliceSecond.getByRole('button', { name: 'Saved messages', exact: true }).click();
        const secondList = aliceSecond.getByRole('dialog', { name: 'Saved messages' });
        await secondList.getByRole('button', { name: /^Disposable formatted API peer Saved/ }).waitFor({ timeout: 45000 });
        stage = 'saved-exact-context';
        await secondList.getByRole('button', { name: /^Disposable formatted API peer Saved/ }).click();
        await aliceSecond.locator(`[data-event-id=${JSON.stringify(formattedPeer.outboundId)}]`).waitFor({ timeout: 45000 });
        stage = 'saved-remove-own-device';
        await aliceSecond.getByRole('button', { name: 'Saved messages', exact: true }).click();
        await aliceSecond.getByRole('dialog', { name: 'Saved messages' }).getByRole('button', { name: `Remove saved message from ${formattedName}` }).click();
        await until(async () => (await api(savedPath, { token: aliceSession.accessToken })).items?.length === 0, 'saved-removed-account-data');
        stage = 'saved-removal-sync';
        await alice.getByRole('button', { name: 'Saved messages', exact: true }).click();
        const firstList = alice.getByRole('dialog', { name: 'Saved messages' });
        await firstList.getByText('No saved messages yet.', { exact: false }).waitFor({ timeout: 45000 });
        await firstList.getByRole('button', { name: 'Close saved messages' }).click();
        await aliceSecond.getByRole('dialog', { name: 'Saved messages' }).getByRole('button', { name: 'Close saved messages' }).click();
        stage = 'saved-access-loss';
        const departedName = 'Disposable saved departure';
        const departed = await api('/_matrix/client/v3/createRoom', { token: aliceSession.accessToken, method: 'POST', body: { name: departedName, preset: 'private_chat' } });
        const departedEvent = await api(`/_matrix/client/v3/rooms/${encode(departed.room_id)}/send/m.room.message/${randomBytes(12).toString('hex')}`,
          { token: aliceSession.accessToken, method: 'PUT', body: { msgtype: 'm.text', body: 'Synthetic saved departure marker' } });
        await openRoom(alice, departedName);
        const departedRow = alice.locator(`[data-event-id=${JSON.stringify(departedEvent.event_id)}]`);
        await departedRow.getByRole('button', { name: 'More message actions' }).click();
        await alice.getByRole('menuitem', { name: 'Save message', exact: true }).click();
        await until(async () => (await api(savedPath, { token: aliceSession.accessToken })).items?.some((item) => item.eventId === departedEvent.event_id), 'saved-departure-account-data');
        await api(`/_matrix/client/v3/rooms/${encode(departed.room_id)}/leave`, { token: aliceSession.accessToken, method: 'POST', body: {} });
        await alice.getByRole('button', { name: 'Saved messages', exact: true }).click();
        const departedList = alice.getByRole('dialog', { name: 'Saved messages' });
        const unavailable = departedList.getByRole('button', { name: /^Conversation no longer available Saved/ });
        await unavailable.waitFor({ timeout: 45000 });
        invariant(await unavailable.isDisabled(), 'saved-inaccessible-disabled');
        stage = 'saved-remove-after-leave';
        await departedList.getByRole('button', { name: 'Remove saved message from unavailable conversation' }).click();
        await until(async () => (await api(savedPath, { token: aliceSession.accessToken })).items?.length === 0, 'saved-removed-after-leave');
        await departedList.getByRole('button', { name: 'Close saved messages' }).click();
        await openRoom(alice, formattedName);
      } catch { throw new Error(stage); }
    });
    await check('shared-pins-and-member-permission', async () => {
      let stage = 'pin-source';
      try {
        const formattedName = 'Disposable formatted API peer';
        const source = alice.locator(`[data-event-id=${JSON.stringify(formattedPeer.outboundId)}]`);
        await source.getByRole('button', { name: 'Pin message', exact: true }).click();
        const pinsPath = `/_matrix/client/v3/rooms/${encode(formattedPeer.roomId)}/state/m.room.pinned_events`;
        stage = 'pin-server-state';
        await until(async () => (await api(pinsPath, { token: bobSession.accessToken }).catch(() => ({}))).pinned?.includes(formattedPeer.outboundId), 'pin-server-state');
        stage = 'pin-peer-collection';
        await openRoom(bob, formattedName);
        const drawer = bob.getByRole('complementary', { name: 'Buddy and room drawer' });
        if (!await drawer.isVisible()) await bob.getByRole('button', { name: 'Toggle room details', exact: true }).click();
        await drawer.getByRole('tab', { name: 'Collections' }).click();
        await drawer.getByRole('button', { name: 'Pins', exact: true }).click();
        await drawer.locator('.drawer-collection-item').filter({ hasText: 'Synthetic outbound room formatting' }).waitFor({ timeout: 45000 });
        stage = 'pin-member-denied';
        const peerSource = bob.locator(`[data-event-id=${JSON.stringify(formattedPeer.outboundId)}]`);
        invariant(await peerSource.getByRole('button', { name: 'Pin message', exact: true }).count() === 0, 'pin-member-control-hidden');
        await api(pinsPath, { token: bobSession.accessToken, method: 'PUT', body: { pinned: [] }, status: 403 });
        stage = 'pin-remove-sync';
        await source.getByRole('button', { name: 'Unpin message', exact: true }).click();
        await until(async () => (await api(pinsPath, { token: bobSession.accessToken })).pinned?.length === 0, 'pin-removed-server-state');
        await drawer.getByText('No shared pins in this room.', { exact: true }).waitFor({ timeout: 45000 });
        for (const page of [alice, bob]) await openRoom(page, roomName);
      } catch { throw new Error(stage); }
    });
    await check('old-cross-room-server-search-and-context', async () => {
      let stage = 'search-create-peer';
      try {
        const created = await api('/_matrix/client/v3/createRoom', { token: aliceSession.accessToken, method: 'POST', body: { name: 'Disposable search peer', preset: 'private_chat', invite: [accounts.bob.user_id] } });
        const searchRoomId = created.room_id;
        await api(`/_matrix/client/v3/rooms/${encode(searchRoomId)}/join`, { token: bobSession.accessToken, method: 'POST', body: {} });
        const send = (target, body) => api(`/_matrix/client/v3/rooms/${encode(target)}/send/m.room.message/${randomBytes(12).toString('hex')}`, { token: bobSession.accessToken, method: 'PUT', body: { msgtype: 'm.text', body } });
        const needle = `Synthetic retrieval needle ${randomBytes(6).toString('hex')}`;
        stage = 'search-old-history';
        const first = await send(formattedPeer.roomId, `${needle} in formatted room`);
        const second = await send(searchRoomId, `${needle} in search room`);
        for (let index = 0; index < 45; index += 1) {
          await send(formattedPeer.roomId, `Synthetic formatted history padding ${index}`);
          await send(searchRoomId, `Synthetic search history padding ${index}`);
        }
        await aliceSecond.reload();
        await openRoom(aliceSecond, 'Disposable formatted API peer');
        invariant(await aliceSecond.locator(`[data-event-id=${JSON.stringify(first.event_id)}]`).count() === 0, 'search-old-not-loaded');
        await openRoom(aliceSecond, roomName);
        stage = 'search-query';
        const searchRequests = [];
        const receiptTargets = [];
        const observe = (request) => {
          const path = new URL(request.url()).pathname;
          if (request.method() === 'POST' && path.endsWith('/search')) searchRequests.push(request.postDataJSON());
          if (path.includes('/receipt/')) receiptTargets.push(path);
        };
        aliceSecond.on('request', observe);
        try {
          await aliceSecond.getByRole('button', { name: 'Search message history', exact: true }).click();
          const panel = aliceSecond.getByRole('complementary', { name: 'Message search' });
          await panel.getByLabel('Search conversation').selectOption('');
          await panel.getByLabel('Search sender Matrix ID').fill(accounts.bob.user_id);
          await panel.getByLabel('Search words').fill(needle);
          await panel.getByRole('button', { name: 'Search history', exact: true }).click();
          const results = panel.locator('.search-results button').filter({ hasText: needle });
          await until(async () => await results.count() === 2, 'search-cross-room-results', 60000);
          const filter = searchRequests.at(-1)?.search_categories?.room_events?.filter;
          invariant(filter?.rooms?.includes(formattedPeer.roomId) && filter.rooms.includes(searchRoomId) && !filter.rooms.includes(roomId) &&
            filter.senders?.length === 1 && filter.senders[0] === accounts.bob.user_id, 'search-joined-unencrypted-filter');
          invariant(!receiptTargets.some((path) => [first.event_id, second.event_id].some((id) => path.includes(encode(id)))), 'search-no-passive-read');
          stage = 'search-exact-context';
          await results.filter({ hasText: 'in search room' }).click();
          await aliceSecond.locator(`[data-event-id=${JSON.stringify(second.event_id)}]`).waitFor({ timeout: 45000 });
          await aliceSecond.getByRole('status').filter({ hasText: 'Showing the selected message and its surrounding conversation.' }).waitFor();
        } finally { aliceSecond.off('request', observe); }
        await openRoom(aliceSecond, roomName);
      } catch { throw new Error(stage); }
    });
    await check('notification-rules-and-own-device-sync', async () => {
      let stage = 'notification-open-controls';
      try {
      const open = async (page) => {
        await page.bringToFront();
        await page.getByRole('button', { name: 'Open settings', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
        await dialog.getByRole('button', { name: 'Matrix & security', exact: true }).click();
        await dialog.getByRole('button', { name: 'Notification rules and delivery', exact: true }).click();
        await dialog.getByLabel(`Notifications for ${roomName}`, { exact: true }).waitFor();
        return dialog;
      };
      const rules = () => api('/_matrix/client/v3/pushrules/', { token: aliceSession.accessToken });
      const settings = await open(alice);
      const mode = settings.getByLabel(`Notifications for ${roomName}`, { exact: true });
      for (const value of ['all', 'mentions', 'nothing', 'default']) {
        stage = `notification-mode-${value}`;
        await mode.selectOption(value);
        await settings.getByText('Room notification rule saved.', { exact: true }).waitFor();
        const current = (await rules()).global;
        const roomRule = current.room.find((rule) => rule.rule_id === roomId);
        const silence = current.override.find((rule) => rule.rule_id === `dev.alucard.aimtrix.silence.${encode(roomId)}`);
        invariant(value === 'all' ? roomRule?.actions.includes('notify') : value === 'mentions' ? roomRule && !roomRule.actions.includes('notify') : value === 'nothing' ? silence && !silence.actions.includes('notify') && !roomRule : !silence && !roomRule, 'notification-room-rule-readback');
      }
      stage = 'notification-account-dnd';
      await settings.getByRole('checkbox', { name: /^Do not disturb across devices/ }).click();
      await settings.getByText('Account notification rule saved.', { exact: true }).waitFor();
      invariant((await rules()).global.override.some((rule) => rule.rule_id === '.m.rule.master' && rule.enabled), 'notification-account-rule-readback');
      stage = 'notification-second-device';
      const secondSettings = await open(aliceSecond);
      invariant(await secondSettings.getByRole('checkbox', { name: /^Do not disturb across devices/ }).isChecked(), 'notification-own-device-sync');
      await secondSettings.getByRole('button', { name: 'Close settings', exact: true }).click();
      await alice.bringToFront();
      await settings.getByRole('checkbox', { name: /^Do not disturb across devices/ }).click();
      await settings.getByText('Account notification rule saved.', { exact: true }).waitFor();
      invariant(!(await rules()).global.override.some((rule) => rule.rule_id === '.m.rule.master' && rule.enabled), 'notification-account-rule-readback');
      stage = 'notification-keyword-add-remove';
      await settings.getByLabel('New keyword pattern', { exact: true }).fill('synthetic-attention-*');
      await settings.getByRole('button', { name: 'Add keyword', exact: true }).click();
      await settings.getByText('Keyword saved.', { exact: true }).waitFor();
      invariant((await rules()).global.content.some((rule) => rule.pattern === 'synthetic-attention-*' && rule.actions.includes('notify')), 'notification-keyword-readback');
      await settings.getByRole('button', { name: 'Remove keyword synthetic-attention-*', exact: true }).click();
      await settings.getByText('Keyword removed.', { exact: true }).waitFor();
      invariant(!(await rules()).global.content.some((rule) => rule.pattern === 'synthetic-attention-*'), 'notification-keyword-readback');
      stage = 'notification-health';
      await settings.getByText('Device subscription', { exact: true }).waitFor();
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      } catch { throw new Error(stage); }
    });
    await check('home-activity-and-follow-own-device-sync', async () => {
      let stage = 'home-open-thread';
      try {
      const name = 'Disposable formatted API peer';
      const followType = 'dev.alucard.aimtrix.followed_threads.v1';
      const followPath = `/_matrix/client/v3/user/${encode(aliceSession.userId)}/rooms/${encode(formattedPeer.roomId)}/account_data/${followType}`;
      await alice.bringToFront();
      await openMatrixEvent(alice, formattedPeer.roomId, formattedPeer.rootId);
      const attentionThread = alice.getByRole('complementary', { name: 'Thread', exact: true });
      stage = 'home-mute-thread';
      await attentionThread.getByRole('button', { name: 'Mute thread alerts', exact: true }).click();
      stage = 'home-thread-mute-saved';
      await attentionThread.getByRole('button', { name: 'Use room alerts', exact: true }).waitFor();
      const threadRuleId = `dev.alucard.aimtrix.thread_silence.${encode(formattedPeer.roomId)}:${encode(formattedPeer.rootId)}`;
      const mutedRules = (await api('/_matrix/client/v3/pushrules/', { token: secondSession.accessToken })).global.override;
      invariant(mutedRules.some((rule) => rule.rule_id === threadRuleId && !rule.actions.includes('notify') && rule.conditions.some((condition) => condition.value === formattedPeer.rootId)), 'notification-thread-rule-readback');
      await attentionThread.getByRole('button', { name: 'Use room alerts', exact: true }).click();
      await attentionThread.getByRole('button', { name: 'Mute thread alerts', exact: true }).waitFor();
      invariant(!(await api('/_matrix/client/v3/pushrules/', { token: secondSession.accessToken })).global.override.some((rule) => rule.rule_id === threadRuleId), 'notification-thread-rule-readback');
      stage = 'home-follow-thread';
      await attentionThread.getByRole('button', { name: /^(Hide from Home|Follow in Home)$/ }).waitFor();
      if (await attentionThread.getByRole('button', { name: 'Hide from Home', exact: true }).isVisible()) {
        stage = 'home-hide-before-follow';
        await attentionThread.getByRole('button', { name: 'Hide from Home', exact: true }).click();
      }
      stage = 'home-follow-click';
      await attentionThread.getByRole('button', { name: 'Follow in Home', exact: true }).click();
      stage = 'home-follow-saved';
      await attentionThread.getByRole('button', { name: 'Hide from Home', exact: true }).waitFor();
      invariant((await api(followPath, { token: secondSession.accessToken })).threads?.[formattedPeer.rootId] === true, 'home-follow-account-data');
      await alice.getByRole('button', { name: 'Close thread', exact: true }).click();
      const send = (content) => api(`/_matrix/client/v3/rooms/${encode(formattedPeer.roomId)}/send/m.room.message/${randomBytes(12).toString('hex')}`, { token: bobSession.accessToken, method: 'PUT', body: content });
      stage = 'home-open-home';
      for (const page of [alice, aliceSecond]) {
        await page.getByRole('button', { name: 'Home activity', exact: true }).click();
        await page.getByRole('main', { name: 'Home activity', exact: true }).waitFor();
      }
      const receiptTargets = [];
      const observe = (request) => {
        if (request.method() !== 'POST') return;
        const parts = new URL(request.url()).pathname.split('/').map(decodeURIComponent);
        const receipt = parts.indexOf('receipt');
        if (receipt >= 0) receiptTargets.push(parts[receipt + 2]);
        if (parts.at(-1) === 'read_markers') {
          const data = request.postDataJSON();
          receiptTargets.push(data?.['m.read'], data?.['m.read.private']);
        }
      };
      alice.on('request', observe); aliceSecond.on('request', observe);
      let mention, reply;
      try {
        stage = 'home-send-activity';
        mention = await send({ msgtype: 'm.text', body: 'Synthetic Home highlighted message', 'm.mentions': { user_ids: [aliceSession.userId] } });
        reply = await send({ msgtype: 'm.text', body: 'Synthetic Home followed reply', 'm.relates_to': { rel_type: 'm.thread', event_id: formattedPeer.rootId, is_falling_back: true, 'm.in_reply_to': { event_id: formattedPeer.rootId } } });
        stage = 'home-show-mention';
        const home = alice.getByRole('main', { name: 'Home activity', exact: true });
        await alice.bringToFront();
        await home.getByRole('button', { name: 'Refresh activity', exact: true }).click();
        await home.getByRole('button', { name: 'Mentions', exact: true }).click();
        await home.getByRole('region', { name: 'Recent activity', exact: true }).getByText('Synthetic Home highlighted message', { exact: true }).waitFor({ timeout: 45000 });
        await home.getByRole('complementary', { name: 'Activity coverage', exact: true }).waitFor();
        stage = 'home-show-thread';
        await home.getByRole('button', { name: 'My threads', exact: true }).click();
        const threadCard = home.locator('article').filter({ hasText: 'Synthetic Home followed reply' });
        await threadCard.getByRole('button', { name: 'Hide from Home', exact: true }).waitFor();
        invariant((await api(followPath, { token: secondSession.accessToken })).threads?.[formattedPeer.rootId] === true, 'home-follow-account-data');
        await aliceSecond.bringToFront();
        stage = 'home-second-follow';
        const secondHome = aliceSecond.getByRole('main', { name: 'Home activity', exact: true });
        await secondHome.getByRole('button', { name: 'Refresh activity', exact: true }).click();
        await secondHome.getByRole('button', { name: 'My threads', exact: true }).click();
        const secondCard = secondHome.locator('article').filter({ hasText: 'Synthetic Home followed reply' });
        await secondCard.getByRole('button', { name: 'Hide from Home', exact: true }).click();
        await secondCard.waitFor({ state: 'hidden' });
        invariant((await api(followPath, { token: aliceSession.accessToken })).threads?.[formattedPeer.rootId] === false, 'home-follow-account-data');
        await alice.bringToFront();
        await home.getByRole('button', { name: 'Refresh activity', exact: true }).click();
        stage = 'home-hide-shared';
        await threadCard.waitFor({ state: 'hidden' });
        invariant(!receiptTargets.includes(mention.event_id) && !receiptTargets.includes(reply.event_id), 'home-no-passive-receipts');
        await home.getByRole('button', { name: 'Mentions', exact: true }).click();
        stage = 'home-open-exact';
        await home.getByRole('region', { name: 'Recent activity', exact: true }).getByRole('button').filter({ hasText: 'Synthetic Home highlighted message' }).click();
        stage = 'home-exact-render';
        try { await alice.getByRole('main', { name: `Conversation with ${name}`, exact: true }).locator(`[data-event-id=${JSON.stringify(mention.event_id)}]`).waitFor(); }
        catch {
          stage = await home.isVisible() ? 'home-exact-still-home' : !await alice.getByRole('main', { name: `Conversation with ${name}`, exact: true }).count() ? 'home-exact-wrong-room' : !await alice.locator(`[data-event-id=${JSON.stringify(mention.event_id)}]`).count() ? 'home-exact-event-missing' : 'home-exact-event-hidden';
          throw new Error(stage);
        }
        stage = 'home-return';
        await alice.evaluate(() => window.history.back());
        await home.waitFor();
        invariant(await home.getByRole('button', { name: 'Mentions', exact: true }).getAttribute('aria-pressed') === 'true', 'home-return-filter');
      } finally { alice.off('request', observe); aliceSecond.off('request', observe); }
      stage = 'home-cleanup-rooms';
      for (const page of [alice, aliceSecond]) await openRoom(page, roomName);
      } catch { throw new Error(stage); }
    });
    if (stack.origins.element) await check('element-ui-formatted-interoperability', async () => {
      let stage = 'element-login-ui';
      try {
        // An actual separately distributed Element UI reads the server's events.
        // Only this disposable browser context holds its login/session data.
        const peer = elementPeer;
        stage = 'element-room-timeline';
        await peer.goto(`${stack.origins.element}/#/room/${encode(formattedPeer.roomId)}`);
        // Startup prompts can arrive after navigation; wait for the actual tile
        // while dismissing only the optional verification deferral control.
        const skip = peer.getByRole('button', { name: /^(Skip|Skip for now)$/ }).first();
        const outbound = peer.locator('.mx_EventTile').filter({ hasText: 'Synthetic outbound room formatting' }).last();
        await until(async () => {
          if (await skip.isVisible()) await skip.click({ timeout: 1500 }).catch(() => {});
          return outbound.locator('strong').filter({ hasText: /^Synthetic outbound room formatting$/ }).isVisible();
        }, 'element-timeline', 60000);
        stage = 'element-outbound-emphasis';
        await outbound.locator('em').filter({ hasText: /^emphasis$/ }).waitFor();
        await outbound.locator('code').filter({ hasText: /^inline code$/ }).waitFor();
        stage = 'element-root-format';
        const root = peer.locator('.mx_EventTile').filter({ has: peer.locator('strong').filter({ hasText: /^API peer root$/ }) }).last();
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
        stage = 'element-return-composer';
        const composer = peer.locator('.mx_BasicMessageComposer_input');
        await composer.fill('**Synthetic Element return** with _peer emphasis_ and `peer code`.');
        const [response] = await Promise.all([
          peer.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.includes(`/rooms/${encode(formattedPeer.roomId)}/send/m.room.message/`)),
          composer.press('Enter'),
        ]);
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
      let stage = 'moderation-open-drawer';
      try {
        const drawer = alice.getByRole('complementary', { name: 'Buddy and room drawer' });
        if (!(await drawer.isVisible())) await alice.getByRole('button', { name: 'Toggle room details', exact: true }).click();
        stage = 'moderation-people-tab';
        await drawer.getByRole('tab', { name: 'People', exact: true }).click();
        stage = 'moderation-set-role';
        await drawer.getByRole('button', { name: 'Actions for charlie', exact: true }).click();
        await drawer.getByRole('menuitemradio', { name: 'Decorator', exact: true }).click();
        const memberPath = `/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.member/${encode(accounts.charlie.user_id)}`;
        await until(async () => (await api(`/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.power_levels`, { token: aliceSession.accessToken })).users?.[accounts.charlie.user_id] === 25, 'moderation-power');
        stage = 'moderation-kick';
        await drawer.getByRole('button', { name: 'Actions for charlie', exact: true }).click();
        await drawer.getByRole('menuitem', { name: 'Remove member', exact: true }).click();
        await alice.getByRole('dialog').getByRole('button', { name: 'Remove member', exact: true }).click();
        await until(async () => (await api(memberPath, { token: aliceSession.accessToken })).membership === 'leave', 'moderation-kick');
        stage = 'moderation-invite';
        await api(`/_matrix/client/v3/rooms/${encode(roomId)}/invite`, { token: aliceSession.accessToken, method: 'POST', body: { user_id: accounts.charlie.user_id } });
        stage = 'moderation-ban';
        await drawer.getByRole('button', { name: 'Actions for charlie', exact: true }).click();
        await drawer.getByRole('menuitem', { name: 'Ban member', exact: true }).click();
        await alice.getByRole('dialog').getByRole('button', { name: 'Ban member', exact: true }).click();
        await until(async () => (await api(memberPath, { token: aliceSession.accessToken })).membership === 'ban', 'moderation-ban');
        stage = 'moderation-unban';
        await drawer.getByRole('button', { name: 'Actions for charlie', exact: true }).click();
        await drawer.getByRole('menuitem', { name: 'Unban member', exact: true }).click();
        await until(async () => (await api(memberPath, { token: aliceSession.accessToken })).membership === 'leave', 'moderation-unban');
      } catch { throw new Error(stage); }
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
    let sso;
    await check('standard-sso-token-callback', async () => {
      sso = await newPage();
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
    await check('standard-sso-recovery-guidance', async () => {
      await sso.getByRole('button', { name: 'Open settings', exact: true }).click();
      const settings = sso.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
      await settings.getByRole('button', { name: 'Matrix & security', exact: true }).click();
      await settings.getByLabel('New recovery passphrase', { exact: true }).fill(`Synthetic SSO recovery ${randomBytes(12).toString('hex')}`);
      await settings.getByRole('button', { name: 'Set up new recovery', exact: true }).click();
      await settings.getByRole('alert').filter({ hasText: 'trusted Matrix client' }).waitFor({ timeout: 60000 });
      invariant(await settings.getByLabel('New recovery passphrase', { exact: true }).inputValue() !== '', 'sso-recovery-passphrase-retained');
      invariant(await settings.locator('.recovery-key-output').count() === 0, 'sso-recovery-no-key-export');
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
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
