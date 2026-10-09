/* global matchMedia, navigator */
import console from 'node:console';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { createStack, invariant, matrixApi, register } from './stack.mjs';
import { login, openRoom } from './journeys.mjs';

// Disposable only. Never save browser state, messages, credentials, screenshots or exception bodies.
// Each stage has a fixed public name; failures discard Playwright's private diagnostics.
let stack, server, browser, profile, pwaSession, pwaManifest;
let stage = 'setup';
let passed = false;
try {
  stack = await createStack();
  await stack.start();
  stage = 'production-preview';
  const runtime = { defaultHomeserver: { serverName: 'aimtrix.test', baseUrl: stack.origins.synapse },
    features: { demoMode: false, calls: false, groupCalls: false, gifs: false, stickers: false }, emojiPacks: { enabled: false }, stickerPacks: [] };
  server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: Number(new URL(stack.origins.app).port), strictPort: true },
    plugins: [{ name: 'crypto-ownership-runtime', configurePreviewServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/config.json') return next();
        response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(runtime));
      });
    } }] });
  profile = await mkdtemp(join(tmpdir(), 'aimtrix-crypto-profile-'));
  const ownerContext = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: process.env.AIMTRIX_CRYPTO_HEADFUL !== '1',
    viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  browser = ownerContext.browser();
  const peerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const allowed = new Set(Object.values(stack.origins));
  for (const context of [ownerContext, peerContext]) await context.route('**/*', (route) => allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  const owner = await ownerContext.newPage(); const peer = await peerContext.newPage();
  owner.setDefaultTimeout(45000); peer.setDefaultTimeout(45000);
  const api = matrixApi(stack);
  stage = 'disposable-login';
  const account = await register(api, stack, 'crypto-owner'); const other = await register(api, stack, 'crypto-peer');
  await Promise.all([login(owner, stack.origins.app, 'crypto-owner', stack.credentials.password), login(peer, stack.origins.app, 'crypto-peer', stack.credentials.password)]);
  stage = 'encrypted-room';
  const roomName = 'Synthetic crypto ownership';
  const room = await api('/_matrix/client/v3/createRoom', { token: account.access_token, method: 'POST', body: {
    name: roomName, preset: 'private_chat', invite: [other.user_id], initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
  } });
  await api(`/_matrix/client/v3/join/${encodeURIComponent(room.room_id)}`, { token: other.access_token, method: 'POST', body: {} });
  await Promise.all([owner, peer].map((page) => page.locator('.buddy-row').filter({ hasText: roomName }).waitFor()));
  await Promise.all([openRoom(owner, roomName), openRoom(peer, roomName)]);
  async function encryptedExchange(sender, receiver) {
    const marker = `Synthetic ownership ${randomBytes(8).toString('hex')}`;
    const wire = sender.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname.includes('/send/m.room.encrypted/'));
    await sender.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(marker);
    await sender.getByRole('button', { name: 'Send message', exact: true }).click();
    const request = await wire;
    invariant(request.postDataJSON().algorithm === 'm.megolm.v1.aes-sha2' && !request.postData().includes(marker), 'wire-encryption');
    await receiver.locator('.timeline-message').filter({ hasText: marker }).first().waitFor();
    return marker;
  }
  stage = 'encrypted-before-takeover';
  const original = await encryptedExchange(owner, peer);
  stage = 'installed-pwa-install';
  const cdp = await browser.newBrowserCDPSession();
  pwaSession = cdp; pwaManifest = `${stack.origins.app}/`;
  await cdp.send('PWA.install', { manifestId: `${stack.origins.app}/`, installUrlOrBundleUrl: `${stack.origins.app}/` });
  await cdp.send('PWA.changeAppUserSettings', { manifestId: `${stack.origins.app}/`, displayMode: 'standalone' });
  stage = 'installed-pwa-launch';
  const pwaCreated = ownerContext.waitForEvent('page');
  await cdp.send('PWA.launch', { manifestId: `${stack.origins.app}/` });
  const pwa = await pwaCreated; pwa.setDefaultTimeout(45000);
  stage = 'installed-pwa-refusal';
  await expect(pwa.getByRole('heading', { name: 'This account is open in another window' })).toBeVisible();
  stage = 'installed-pwa-display-mode';
  invariant(await pwa.evaluate(() => matchMedia('(display-mode: standalone)').matches), 'pwa-display-mode');
  await pwa.close();
  console.log('Crypto ownership live: installed same-profile Chromium PWA refused concurrent storage');
  stage = 'same-profile-second-window';
  const contender = await ownerContext.newPage(); contender.setDefaultTimeout(45000);
  await contender.goto(stack.origins.app);
  await expect(contender.getByRole('heading', { name: 'This account is open in another window' })).toBeVisible();
  stage = 'cooperative-takeover';
  await contender.getByRole('button', { name: 'Use this window' }).click();
  await expect(owner.getByRole('heading', { name: 'This account is open in another window' })).toBeVisible();
  await contender.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 60000 });
  await openRoom(contender, roomName);
  await contender.locator('.timeline-message').filter({ hasText: original }).first().waitFor();
  stage = 'encrypted-after-takeover';
  const received = await encryptedExchange(peer, contender);
  await encryptedExchange(contender, peer);
  stage = 'same-device-reload';
  await contender.reload(); await contender.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 60000 });
  await openRoom(contender, roomName);
  await contender.locator('.timeline-message').filter({ hasText: original }).first().waitFor();
  await contender.locator('.timeline-message').filter({ hasText: received }).first().waitFor();
  stage = 'abrupt-owner-close';
  await contender.close();
  await expect.poll(() => owner.evaluate(async () => (await navigator.locks.query()).held?.length ?? 0)).toBe(0);
  stage = 'encrypted-after-abrupt-close';
  await owner.getByRole('button', { name: 'Retry here' }).click();
  await owner.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 60000 });
  await openRoom(owner, roomName);
  await encryptedExchange(owner, peer); await encryptedExchange(peer, owner);
  passed = true;
} catch { console.log(`Crypto ownership live: FAIL at ${stage}`); }
finally {
  if (pwaSession) await pwaSession.send('PWA.uninstall', { manifestId: pwaManifest }).catch(() => { passed = false; console.log('Crypto ownership live: FAIL at pwa-cleanup'); });
  const cleanup = await Promise.allSettled([browser?.close(), server?.close(), stack?.stop()]);
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => { passed = false; console.log('Crypto ownership live: FAIL at profile-cleanup'); });
  if (cleanup.some((result) => result.status === 'rejected')) { passed = false; console.log('Crypto ownership live: FAIL at cleanup'); }
}
console.log(`Crypto ownership live: ${passed ? 'PASS (takeover, encrypted bidirectional exchange, retained-key reload, abrupt close, cleanup)' : 'FAIL'}`);
if (!passed) process.exitCode = 1;
