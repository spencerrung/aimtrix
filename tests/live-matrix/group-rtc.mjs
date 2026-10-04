/* global console, MediaStream, navigator, window */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { createStack, matrixApi, register, until } from './stack.mjs';
import { startRtcStack } from './rtc-stack.mjs';
import { login, openRoom } from './journeys.mjs';

const checks = [];
let stage = 'setup';
let stack, rtc, server, browser, roomId, aliceAccount, bobAccount, runtime;
const membershipWrites = { compatibility: { alice: { accepted: 0, rejected: 0 }, bob: { accepted: 0, rejected: 0 } }, matrix_2_0: { alice: { accepted: 0, rejected: 0 }, bob: { accepted: 0, rejected: 0 } } };
const stickyWire = { membership: 0, encrypted: 0, other: 0, rejected: 0 };
const run = async (name, action) => {
  stage = name;
  console.log(`MatrixRTC live: ${name}`);
  try { await action(); checks.push({ name, passed: true }); }
  catch { checks.push({ name, passed: false }); throw new Error('check-failed'); }
};

try {
  stack = await createStack({ federation: true, stickyEvents: true });
  await run('disposable-synapse', () => stack.start());
  const api = matrixApi(stack);
  await run('encrypted-room-and-accounts', async () => {
    aliceAccount = await register(api, stack, 'alice');
    bobAccount = await register(api, stack, 'bob');
    const created = await api('/_matrix/client/v3/createRoom', { token: aliceAccount.access_token, method: 'POST', body: {
      name: 'RTC Proof', preset: 'private_chat', initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
    } });
    roomId = created.room_id;
    const powerLevelsPath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`;
    const powerLevels = await api(powerLevelsPath, { token: aliceAccount.access_token });
    await api(powerLevelsPath, { token: aliceAccount.access_token, method: 'PUT', body: {
      ...powerLevels, events: { ...powerLevels.events, 'org.matrix.msc3401.call.member': 0 },
    } });
    await api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, { token: aliceAccount.access_token, method: 'POST', body: { user_id: bobAccount.user_id } });
    await api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, { token: bobAccount.access_token, method: 'POST', body: {} });
  });
  await run('disposable-livekit-and-openid-authorization', async () => { rtc = await startRtcStack(stack, roomId); });
  await run('application-server', async () => {
    await readFile('dist/index.html');
    runtime = { brandName: 'Aimtrix', defaultHomeserver: { serverName: 'aimtrix.test', baseUrl: stack.origins.synapse }, allowCustomHomeservers: false,
      features: { demoMode: false, calls: false, groupCalls: true, matrixRtcMode: 'compatibility', gifs: false, stickers: false }, emojiPacks: { enabled: false }, stickerPacks: [], media: { maxUploadBytes: 1048576 } };
    server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: Number(new URL(stack.origins.app).port), strictPort: true, open: false },
      plugins: [{ name: 'disposable-rtc-runtime', configurePreviewServer(vite) { vite.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] === '/config.json') { response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(runtime)); }
        else next();
      }); } }],
    });
    browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  });

  const contexts = [];
  const pageFor = async (label, mode = 'compatibility') => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone', 'camera'], serviceWorkers: 'block' });
    contexts.push(context);
    const permitted = new Set([...Object.values(stack.origins), rtc.authOrigin]);
    await context.route('**/*', (route) => permitted.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await context.route('**/_matrix/client/unstable/org.matrix.msc4143/rtc/transports', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rtc_transports: [{ type: 'livekit', livekit_service_url: rtc.authOrigin }] }) }));
    await context.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__rtcMediaTracks = [];
      window.__rtcDisplayTracks = [];
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        window.__rtcMediaTracks.push(...stream.getTracks());
        return stream;
      };
      // Chromium cannot select a real display in this unattended run. Feed a
      // separate fake video track through LiveKit's getDisplayMedia path.
      navigator.mediaDevices.getDisplayMedia = async () => {
        const stream = await original({ audio: false, video: true });
        window.__rtcDisplayTracks.push(...stream.getTracks());
        return stream;
      };
    });
    const page = await context.newPage();
    page.on('response', (response) => {
      const request = response.request();
      const url = new URL(response.url());
      const path = decodeURIComponent(url.pathname);
      if (mode === 'compatibility' && (request.method() !== 'PUT' || !path.includes('/state/org.matrix.msc3401.call.member/'))) return;
      if (mode === 'matrix_2_0') {
        if (request.method() !== 'PUT' || !path.includes('/send/') || !url.searchParams.has('org.matrix.msc4354.sticky_duration_ms')) return;
        if (!response.ok()) stickyWire.rejected++;
        const delayed = url.searchParams.has('org.matrix.msc4140.delay');
        if (path.includes('/send/org.matrix.msc4143.rtc.member/')) stickyWire.membership++;
        else if (path.includes('/send/m.room.encrypted/')) stickyWire.encrypted++;
        else stickyWire.other++;
        if (!path.includes('/send/org.matrix.msc4143.rtc.member/') || delayed) return;
      }
      membershipWrites[mode][label][response.ok() ? 'accepted' : 'rejected']++;
    });
    page.setDefaultTimeout(30000);
    return page;
  };
  const alice = await pageFor('alice'), bob = await pageFor('bob');
  await run('two-browser-login', async () => {
    await login(alice, stack.origins.app, 'alice', stack.credentials.password);
    await login(bob, stack.origins.app, 'bob', stack.credentials.password);
    await openRoom(alice, 'RTC Proof');
    await openRoom(bob, 'RTC Proof');
  });
  const join = async (page, label) => {
    stage = 'group-control';
    await page.getByRole('button', { name: label }).click();
    const prejoin = page.getByRole('dialog', { name: 'Join group call' });
    stage = 'group-prejoin';
    await prejoin.getByLabel('Join with microphone on').check();
    stage = 'group-join-request';
    await prejoin.getByRole('button', { name: 'Join encrypted call' }).click();
    const shelf = page.getByRole('region', { name: 'Group call in RTC Proof' });
    stage = 'group-encryption-ready';
    try { await shelf.getByText('Media encrypted').waitFor({ timeout: 60000 }); }
    catch (error) {
      const alert = prejoin.getByRole('alert');
      if (await alert.count()) {
        const message = await alert.textContent();
        const category = [
          ['authorization', 'token'], ['media key', 'key'], ['connect', 'sfu'],
          ['encryption worker', 'worker'], ['membership', 'membership'],
          ['microphone', 'microphone'],
          ['media encryption failed', 'encryption-worker-error'],
          ['could not enable media encryption', 'encryption-enable'],
        ].find(([needle]) => message?.includes(needle))?.[1];
        stage = category ? `group-${category}-unavailable` : 'group-join-rejected';
      }
      throw error;
    }
    return shelf;
  };
  const remoteVideoPlaying = async (shelf) => shelf.locator('video').evaluateAll((videos) => videos.some((video) =>
    video.srcObject instanceof MediaStream && video.srcObject.getVideoTracks().some((track) => track.readyState === 'live') && video.readyState >= 2 && video.videoWidth > 0));
  const exerciseVideoAndScreen = async (publisher, subscriberShelf, publisherShelf, prefix) => {
    await run(`${prefix}encrypted-camera-publish-and-subscribe`, async () => {
      await publisherShelf.getByRole('button', { name: 'Turn group camera on' }).click();
      await publisherShelf.getByRole('button', { name: 'Turn group camera off' }).waitFor();
      await until(() => remoteVideoPlaying(subscriberShelf), `${prefix}encrypted-camera-video`, 45000);
      await publisherShelf.getByRole('button', { name: 'Turn group camera off' }).click();
      await until(async () => (await subscriberShelf.locator('video').count()) === 0, `${prefix}camera-unpublished`, 45000);
    });
    await run(`${prefix}encrypted-synthetic-screen-publish-and-subscribe`, async () => {
      stage = `${prefix}screen-start`;
      await publisherShelf.getByRole('button', { name: 'Share group screen' }).click();
      await publisherShelf.getByRole('button', { name: 'Stop sharing group screen' }).waitFor();
      stage = `${prefix}screen-remote-video`;
      await until(() => remoteVideoPlaying(subscriberShelf), `${prefix}encrypted-screen-video`, 45000);
      stage = `${prefix}screen-capture-used`;
      if (!await publisher.evaluate(() => window.__rtcDisplayTracks.length > 0)) throw new Error('synthetic-screen-capture-unused');
      stage = `${prefix}screen-stop`;
      await publisherShelf.getByRole('button', { name: 'Stop sharing group screen' }).click();
      stage = `${prefix}screen-capture-cleanup`;
      await until(async () => (await subscriberShelf.locator('video').count()) === 0 &&
        (await publisher.evaluate(() => window.__rtcDisplayTracks.every((track) => track.readyState === 'ended'))), `${prefix}screen-capture-cleanup`, 45000);
    });
  };
  let aliceShelf, bobShelf;
  await run('first-encrypted-media-publisher', async () => {
    aliceShelf = await join(alice, 'Start group call');
    await aliceShelf.getByText('1 participant').waitFor();
  });
  await run('second-client-subscribes-to-encrypted-media', async () => {
    await bob.getByRole('button', { name: /Join group call/ }).waitFor({ timeout: 60000 });
    bobShelf = await join(bob, /Join group call/);
    await bobShelf.getByText('2 participants').waitFor({ timeout: 60000 });
    await aliceShelf.getByText('2 participants').waitFor({ timeout: 60000 });
    await until(async () => (await bobShelf.locator('audio').count()) > 0 && (await aliceShelf.locator('audio').count()) > 0, 'encrypted-remote-audio', 45000);
  });
  await exerciseVideoAndScreen(alice, bobShelf, aliceShelf, '');
  await run('membership-and-capture-cleanup', async () => {
    await bobShelf.getByRole('button', { name: 'Leave group call' }).click();
    await aliceShelf.getByText('1 participant').waitFor({ timeout: 60000 });
    await aliceShelf.getByRole('button', { name: 'Leave group call' }).click();
    await until(async () => (await alice.evaluate(() => window.__rtcMediaTracks.length > 0 && window.__rtcMediaTracks.every((track) => track.readyState === 'ended'))) && (await bob.evaluate(() => window.__rtcMediaTracks.length > 0 && window.__rtcMediaTracks.every((track) => track.readyState === 'ended'))), 'media-capture-cleanup', 30000);
  });
  await run('compatibility-membership-write-evidence', async () => {
    if (membershipWrites.compatibility.alice.accepted < 1 || membershipWrites.compatibility.bob.accepted < 1 || membershipWrites.compatibility.alice.rejected || membershipWrites.compatibility.bob.rejected) throw new Error('compatibility-membership');
  });
  await Promise.all(contexts.map((context) => context.close()));
  contexts.length = 0;
  runtime.features.matrixRtcMode = 'matrix_2_0';
  const modernAlice = await pageFor('alice', 'matrix_2_0'), modernBob = await pageFor('bob', 'matrix_2_0');
  await run('modern-two-browser-login', async () => {
    await login(modernAlice, stack.origins.app, 'alice', stack.credentials.password);
    await login(modernBob, stack.origins.app, 'bob', stack.credentials.password);
    await openRoom(modernAlice, 'RTC Proof');
    await openRoom(modernBob, 'RTC Proof');
  });
  let modernAliceShelf, modernBobShelf;
  await run('modern-first-encrypted-media-publisher', async () => {
    modernAliceShelf = await join(modernAlice, 'Start group call');
    await modernAliceShelf.getByText('1 participant').waitFor();
  });
  await run('modern-second-client-subscribes-to-encrypted-media', async () => {
    await modernBob.getByRole('button', { name: /Join group call/ }).waitFor({ timeout: 60000 });
    modernBobShelf = await join(modernBob, /Join group call/);
    await modernBobShelf.getByText('2 participants').waitFor({ timeout: 60000 });
    await modernAliceShelf.getByText('2 participants').waitFor({ timeout: 60000 });
    await until(async () => (await modernBobShelf.locator('audio').count()) > 0 && (await modernAliceShelf.locator('audio').count()) > 0, 'modern-encrypted-remote-audio', 45000);
  });
  await exerciseVideoAndScreen(modernAlice, modernBobShelf, modernAliceShelf, 'modern-');
  await run('modern-membership-and-capture-cleanup', async () => {
    await modernBobShelf.getByRole('button', { name: 'Leave group call' }).click();
    await modernAliceShelf.getByText('1 participant').waitFor({ timeout: 60000 });
    await modernAliceShelf.getByRole('button', { name: 'Leave group call' }).click();
    await until(async () => (await modernAlice.evaluate(() => window.__rtcMediaTracks.length > 0 && window.__rtcMediaTracks.every((track) => track.readyState === 'ended'))) && (await modernBob.evaluate(() => window.__rtcMediaTracks.length > 0 && window.__rtcMediaTracks.every((track) => track.readyState === 'ended'))), 'modern-media-capture-cleanup', 30000);
  });
  await run('modern-sticky-membership-and-token-evidence', async () => {
    if (membershipWrites.matrix_2_0.alice.accepted < 1 || membershipWrites.matrix_2_0.bob.accepted < 1 || membershipWrites.matrix_2_0.alice.rejected || membershipWrites.matrix_2_0.bob.rejected || stickyWire.encrypted || stickyWire.rejected || rtc.metrics.modernJwtIssued < 2) throw new Error('modern-membership-or-token');
  });
  await Promise.all(contexts.map((context) => context.close()));
} catch {
  process.exitCode = 1;
  console.log(`MatrixRTC live: stopped at ${stage}`);
} finally {
  let membershipState = null;
  if (stack && roomId && aliceAccount && bobAccount) {
    try {
      const events = await matrixApi(stack)(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`, { token: aliceAccount.access_token });
      const members = events.filter((event) => event.type === 'org.matrix.msc3401.call.member');
      membershipState = {
        alicePresent: members.some((event) => event.state_key.includes(aliceAccount.user_id) && Boolean(event.content?.device_id && event.content?.expires)),
        bobPresent: members.some((event) => event.state_key.includes(bobAccount.user_id) && Boolean(event.content?.device_id && event.content?.expires)),
      };
    } catch { membershipState = { queryFailed: true }; }
  }
  const results = await Promise.allSettled([browser?.close(), server?.close(), rtc?.stop(), stack?.stop()]);
  const cleaned = results.every((result) => result.status === 'fulfilled');
  checks.push({ name: 'cleanup', passed: cleaned });
  if (!cleaned) process.exitCode = 1;
  await mkdir(resolve('matrix-test-results'), { recursive: true });
  const report = { suite: 'matrixrtc-live', passed: !process.exitCode, failedStage: process.exitCode ? stage : null, checks, authorizer: rtc?.metrics ?? null, membershipWrites, stickyWire, membershipState, boundaries: ['synthetic authorizer validates real Matrix OpenID and signs a disposable LiveKit JWT', 'homeserver transport advertisement is injected because the pinned Synapse image lacks MSC4143 discovery', 'screen capture uses a synthetic video track in place of a physical display picker', 'TURN-required NAT, connection-loss recovery, deployed authorization-service compatibility, and homeserver-mediated MSC4195 authorization are not exercised'] };
  await writeFile(resolve('matrix-test-results/group-rtc.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`MatrixRTC live: ${report.passed ? 'PASS' : 'FAIL'} (${checks.filter((item) => item.passed).length}/${checks.length} checks)`);
}
