// Disposable Element/Synapse proof. Only fixed stages/booleans leave memory.
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { createStack, invariant, until, matrixApi, register } from './stack.mjs';
import { login, session } from './journeys.mjs';

let stack, server, browser, releaseKeys;
let stage = 'setup';
const checks = [];
const check = async (name, action) => { stage = name; await action(); checks.push(name); console.log(`Verification recovery: ${name}`); };
const destination = process.env.AIMTRIX_VERIFICATION_OUTPUT || '/tmp/aimtrix-verification-recovery';
let passed = false;
try {
  stack = await createStack({ elementUi: true });
  await check('disposable-stack', () => stack.start());
  const runtime = { brandName: 'Aimtrix', defaultHomeserver: { serverName: 'aimtrix.test', baseUrl: stack.origins.synapse }, allowCustomHomeservers: false,
    features: { demoMode: false, calls: false, gifs: false, stickers: false }, stickerPacks: [] };
  server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: Number(new URL(stack.origins.app).port), strictPort: true },
    plugins: [{ name: 'verification-runtime', configurePreviewServer(vite) { vite.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== '/config.json') return next();
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(runtime));
    }); } }],
  });
  browser = await chromium.launch();
  const allowed = new Set(Object.values(stack.origins));
  const page = async (element = false) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: element ? 'allow' : 'block' });
    await context.route('**/*', (route) => allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const result = await context.newPage(); result.setDefaultTimeout(30000); return result;
  };
  const receiver = await page();
  const peer = await page(true);
  const account = await register(matrixApi(stack), stack, 'verification');
  let receiverSession;
  await check('aimtrix-trusted-receiver', async () => {
    await login(receiver, stack.origins.app, 'verification', stack.credentials.password);
    receiverSession = await session(receiver);
    await receiver.getByRole('button', { name: 'Open settings', exact: true }).click();
    const dialog = receiver.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
    await dialog.getByRole('button', { name: 'Matrix & security', exact: true }).click();
    await dialog.getByLabel('New recovery passphrase', { exact: true }).fill(`Synthetic ${randomBytes(24).toString('hex')}`);
    await dialog.getByLabel('Matrix password, if this account has one', { exact: true }).fill(stack.credentials.password);
    await dialog.getByRole('button', { name: 'Set up new recovery', exact: true }).click();
    await dialog.getByText('Encryption recovery and key backup are ready.', { exact: false }).waitFor({ timeout: 60000 });
    await dialog.getByRole('button', { name: 'I saved the recovery key', exact: true }).click();
    await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  });
  let holdKeys = true, held = 0, keysDelivered = false, senderDevice;
  const keyGate = new Promise((resolve) => { releaseKeys = resolve; });
  await receiver.route('**/_matrix/client/*/keys/query', async (route) => {
    if (holdKeys) { held++; await keyGate; }
    try {
      const response = await route.fetch();
      const data = await response.json();
      if (senderDevice && data.device_keys?.[account.user_id]?.[senderDevice]) keysDelivered = true;
      await route.fulfill({ response });
    } catch { await route.abort().catch(() => undefined); }
  });
  await check('element-fresh-login', async () => {
    await peer.goto(`${stack.origins.element}/#/login`);
    await peer.getByRole('textbox', { name: 'Username', exact: true }).fill(account.user_id);
    await peer.getByPlaceholder('Password', { exact: true }).fill(stack.credentials.password);
    const response = peer.waitForResponse((value) => value.request().method() === 'POST' && new URL(value.url()).pathname.endsWith('/login'));
    await peer.getByRole('button', { name: 'Sign in', exact: true }).click();
    const result = await response; invariant(result.ok(), 'login'); senderDevice = (await result.json()).device_id;
    invariant(typeof senderDevice === 'string', 'login-device');
    await peer.locator('.mx_AuthPage').getByRole('button', { name: 'Use another device', exact: true }).waitFor({ timeout: 60000 });
  });
  const requestFromElement = async () => {
    const sent = peer.waitForResponse((response) => response.request().method() === 'PUT' &&
      decodeURIComponent(new URL(response.url()).pathname).includes('/sendToDevice/m.key.verification.request/'));
    await peer.locator('.mx_AuthPage').getByRole('button', { name: 'Use another device', exact: true }).click();
    const response = await sent; invariant(response.ok(), 'request-accepted');
    const content = response.request().postDataJSON()?.messages?.[account.user_id]?.[receiverSession.deviceId];
    invariant(content?.from_device === senderDevice && typeof content.transaction_id === 'string', 'target-and-transaction');
    return content.transaction_id;
  };
  const incoming = receiver.getByRole('complementary', { name: 'Incoming device verification' });
  let original;
  await check('delayed-keys-original-request-visible-as-failed', async () => {
    original = await requestFromElement();
    await receiver.bringToFront();
    await incoming.getByText(/Verification could not start for a request naming device/).waitFor({ timeout: 45000 });
    invariant((await incoming.innerText()).includes(senderDevice), 'matching-sender');
    await incoming.getByRole('status').filter({ hasText: 'Device keys are not available yet' }).waitFor();
    invariant(held > 0 && !keysDelivered && await incoming.getByRole('button', { name: 'Compare emoji', exact: true }).count() === 0, 'unknown-device-not-verifiable');
  });
  await check('signed-keys-enable-explicit-retry-only', async () => {
    holdKeys = false; releaseKeys();
    await until(() => keysDelivered, 'signed-key-response');
    await incoming.getByRole('button', { name: 'Check device again', exact: true }).click();
    await incoming.getByRole('status').filter({ hasText: 'Cancel the pending attempt on the other device' }).waitFor();
    invariant(await incoming.getByRole('button', { name: 'Compare emoji', exact: true }).count() === 0, 'original-not-replayed');
  });
  await check('element-cancels-original-and-clears-recovery', async () => {
    await peer.locator('.mx_InfoDialog').getByRole('button', { name: 'Close dialog', exact: true }).click();
    await incoming.waitFor({ state: 'hidden' });
  });
  await check('explicit-known-device-retry-keeps-new-transaction', async () => {
    const retry = await requestFromElement(); invariant(retry !== original, 'explicit-new-transaction');
    await receiver.bringToFront();
    await incoming.getByRole('button', { name: 'Compare emoji', exact: true }).waitFor();
    invariant(await incoming.getByText(/Verification could not start/).count() === 0, 'new-sdk-request');
    await incoming.getByRole('button', { name: 'Compare emoji', exact: true }).click();
    const elementEmoji = peer.locator('.mx_VerificationShowSas_emojiSas > div > div:first-child');
    await until(async () => {
      for (const control of [peer.getByRole('button', { name: /^(Compare using unique emoji|Verify by emoji)$/ }),
        peer.locator('.mx_VerificationPanel_QRPhase_startOption').filter({ hasText: /Compare.*emoji/i }).getByRole('button', { name: 'Start', exact: true })]) {
        if (await control.isVisible()) { try { await control.click({ timeout: 5000 }); return true; } catch { return false; } }
      }
      return await elementEmoji.count() === 7;
    }, 'sas-method');
    await until(async () => await elementEmoji.count() === 7, 'sas-emoji');
    const challenge = receiver.getByRole('dialog', { name: 'Compare incoming verification emoji', exact: true });
    await challenge.waitFor();
    const own = (await challenge.locator('.incoming-verification__emoji b').allTextContents()).map((value) => value.trim());
    invariant(own.length === 7 && JSON.stringify(own) === JSON.stringify((await elementEmoji.allTextContents()).map((value) => value.trim())), 'sas-equality');
    await challenge.getByRole('button', { name: 'They match', exact: true }).click();
    await peer.locator('.mx_InfoDialog').getByRole('button', { name: 'They match', exact: true }).click();
    await challenge.waitFor({ state: 'hidden' });
    await peer.locator('.mx_InfoDialog').getByRole('button', { name: 'Got it', exact: true }).click();
    await incoming.waitFor({ state: 'hidden' });
  });
  passed = true;
} catch { console.log(`Verification recovery: failed at ${stage}`); }
finally {
  releaseKeys?.();
  const cleanup = await Promise.allSettled([browser?.close(), server?.close(), stack?.stop()]);
  const clean = cleanup.every((result) => result.status === 'fulfilled');
  if (!clean) passed = false;
  await mkdir(destination, { recursive: true });
  await writeFile(`${destination}/live-proof.json`, JSON.stringify({ passed, failureStage: passed ? null : stage, checks, cleanup: clean }, null, 2) + '\n', { mode: 0o600 });
  console.log(`Verification recovery: ${passed ? 'PASS' : 'FAIL'}; cleanup ${clean ? 'complete' : 'failed'}`);
  if (!passed) process.exitCode = 1;
}
