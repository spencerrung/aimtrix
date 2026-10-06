/* global localStorage, fetch, AbortSignal */
import { randomBytes } from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';
import { invariant, until } from './stack.mjs';

async function signInWithProvider(page, stack, username) {
  await page.goto(stack.origins.app);
  await page.getByRole('button', { name: 'Sign in with homeserver OAuth', exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Sign in with homeserver OAuth', exact: true }).click();
  await page.waitForURL((url) => url.origin === stack.origins.mas, { timeout: 30000 });
  const name = page.locator('input[name="username"], input[autocomplete="username"]').first();
  await name.waitFor({ timeout: 30000 });
  await name.fill(username);
  const password = page.locator('input[type="password"]').first();
  if (!(await password.isVisible())) {
    await page.getByRole('button', { name: /continue|next|sign in|log in/i }).first().click();
    await password.waitFor({ timeout: 30000 });
  }
  await password.fill(stack.credentials.password);
  await page.getByRole('button', { name: /continue|sign in|log in/i }).first().click();
  const consent = page.getByRole('heading', { name: /continue to/i });
  await Promise.any([
    consent.waitFor({ timeout: 30000 }),
    page.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 30000 }),
  ]);
  if (await consent.isVisible()) await page.getByRole('button', { name: /continue/i }).first().click();
  await page.getByRole('button', { name: 'Join or create room' }).waitFor({ timeout: 60000 });
}

async function rejectNextDeviceRead(page, trigger) {
  let rejected = 0;
  let claimed = false;
  const pattern = '**/_matrix/client/*/devices';
  const reject = async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (claimed) return route.continue();
    claimed = true;
    rejected += 1;
    await route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ errcode: 'M_UNKNOWN_TOKEN', error: 'Expired access token' }) });
    await page.unroute(pattern, reject);
  };
  await page.route(pattern, reject);
  await trigger();
  await until(() => rejected === 1, 'delegated-refresh-device-request', 30000);
}

export async function runDelegatedAuthJourney({ browser, stack, check, metrics }) {
  const username = 'delegated';
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await check('delegated-auth-account', async () => {
      await stack.compose('exec', '-T', 'mas', 'mas-cli', 'manage', 'register-user', '--yes', username,
        '--password', stack.credentials.password, '--ignore-password-complexity');
    });
    await check('delegated-auth-discovery', async () => {
      await page.goto(stack.origins.app);
      await page.getByRole('button', { name: 'Sign in with homeserver OAuth', exact: true }).waitFor({ timeout: 30000 });
    });
    let credentials;
    let originalSessionReadAt;
    let tokenEndpoint;
    await check('delegated-auth-login', async () => {
      await signInWithProvider(page, stack, username);
      credentials = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
      originalSessionReadAt = Date.now();
      invariant(credentials?.userId === '@delegated:aimtrix.test' && credentials.oauth?.refreshToken &&
        credentials.oauth?.clientId && credentials.oauth?.issuer === `${stack.origins.mas}/`, 'delegated-session');
      invariant(!new URL(page.url()).searchParams.has('code') && !new URL(page.url()).hash.includes('code='), 'delegated-callback-cleanup');
      const identity = await page.evaluate(async () => {
        const stored = JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1'));
        const response = await fetch(`${stored.baseUrl}/_matrix/client/v3/account/whoami`,
          { headers: { Authorization: `Bearer ${stored.accessToken}` } });
        return response.ok ? (await response.json()).user_id : undefined;
      });
      invariant(identity === credentials.userId, 'delegated-whoami');
      const metadata = await (await fetch(`${stack.origins.synapse}/_matrix/client/v1/auth_metadata`)).json();
      invariant(metadata.issuer === credentials.oauth.issuer && new URL(metadata.token_endpoint).origin === stack.origins.mas,
        'delegated-metadata');
      tokenEndpoint = metadata.token_endpoint;
      metrics.delegatedLoginCompleted = 1;
    });
    await check('delegated-auth-account-settings', async () => {
      await page.getByRole('button', { name: 'Open settings' }).click();
      const settings = page.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
      await settings.getByRole('button', { name: 'Matrix & security', exact: true }).click();
      await settings.getByText(/This account signs in through homeserver OAuth/).waitFor();
      invariant(await settings.getByRole('button', { name: 'Change password' }).count() === 0,
        'delegated-password-control-hidden');
      invariant(await settings.getByText('Deactivate Matrix account').count() === 0,
        'delegated-deactivation-control-hidden');
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    });
    let recoveryKey;
    let recoveryRoomName;
    let recoveryRoomId;
    let recoveryMarker;
    let recoveryEventId;
    await check('delegated-auth-recovery-setup', async () => {
      let stage = 'delegated-recovery-open-create';
      try {
        recoveryRoomName = `Delegated recovery ${randomBytes(5).toString('hex')}`;
        recoveryMarker = `Synthetic delegated history ${randomBytes(8).toString('hex')}`;
        await page.getByRole('button', { name: 'Join or create room' }).click();
        stage = 'delegated-recovery-create-form';
        const createDialog = page.getByRole('dialog', { name: 'Add a conversation' });
        await createDialog.getByRole('button', { name: 'Create room', exact: true }).first().click();
        await createDialog.getByLabel('Room name', { exact: true }).fill(recoveryRoomName);
        await createDialog.getByLabel('Encrypt this room').check();
        stage = 'delegated-recovery-room-submit';
        const creation = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/createRoom') &&
          response.request().method() === 'POST');
        await createDialog.locator('form').getByRole('button', { name: 'Create room', exact: true }).click();
        const created = await creation;
        invariant(created.ok(), 'delegated-recovery-room-created');
        stage = 'delegated-recovery-room-response';
        const roomId = (await created.json()).room_id;
        recoveryRoomId = roomId;
        invariant(typeof roomId === 'string' && roomId.startsWith('!'), stage);
        stage = 'delegated-recovery-session-read';
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
        invariant(stored?.accessToken, stage);
        stage = 'delegated-recovery-state-request';
        const encryption = await fetch(`${stack.origins.synapse}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption`,
          { headers: { Authorization: `Bearer ${stored.accessToken}` } });
        metrics.delegatedRecoveryStateHttpStatus = encryption.status;
        stage = encryption.status === 401 ? 'delegated-recovery-state-unauthorized'
          : encryption.status === 404 ? 'delegated-recovery-state-missing' : 'delegated-recovery-state-http';
        invariant(encryption.ok, stage);
        stage = 'delegated-recovery-room-encryption';
        invariant((await encryption.json()).algorithm === 'm.megolm.v1.aes-sha2', stage);
        stage = 'delegated-recovery-room-open';
        await createDialog.waitFor({ state: 'hidden' });
        await page.locator('.buddy-row').filter({ hasText: recoveryRoomName }).first().click();
        await page.getByRole('main', { name: recoveryRoomName }).waitFor();
        stage = 'delegated-recovery-send';
        await page.getByRole('textbox', { name: `Message ${recoveryRoomName}`, exact: true }).fill(recoveryMarker);
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        const sent = page.locator('.timeline-message').filter({ hasText: recoveryMarker });
        await until(async () => (await sent.getAttribute('data-event-id'))?.startsWith('$'), 'delegated-recovery-event-accepted');
        recoveryEventId = await sent.getAttribute('data-event-id');
        stage = 'delegated-recovery-settings';
        await page.getByRole('button', { name: 'Open settings' }).click();
        const settings = page.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
        await settings.getByRole('button', { name: 'Matrix & security', exact: true }).click();
        await settings.getByLabel('New recovery passphrase', { exact: true }).fill(`Synthetic delegated recovery ${randomBytes(12).toString('hex')}`);
        stage = 'delegated-recovery-setup-action';
        await settings.getByRole('button', { name: 'Set up new recovery', exact: true }).click();
        const guidance = settings.getByRole('alert').filter({ hasText: 'This homeserver requires an authorization step Aimtrix cannot complete here.' });
        const output = settings.locator('.recovery-key-output code');
        stage = 'delegated-recovery-outcome';
        await until(async () => Boolean(await guidance.count() || await output.count()), 'delegated-recovery-outcome', 60000);
        if (await guidance.count()) {
          invariant(await settings.getByLabel('New recovery passphrase', { exact: true }).inputValue() !== '',
            'delegated-recovery-passphrase-retained');
          invariant(await output.count() === 0, 'delegated-recovery-no-key-export');
          metrics.delegatedRecoverySupported = 0;
        } else {
          recoveryKey = await output.textContent();
          invariant(Boolean(recoveryKey), 'delegated-recovery-key-generated');
          stage = 'delegated-recovery-backup';
          await until(async () => {
            const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
            const response = await fetch(`${stored.baseUrl}/_matrix/client/v3/room_keys/version`,
              { headers: { Authorization: `Bearer ${stored.accessToken}` } });
            if (!response.ok) return false;
            const backup = await response.json();
            return Boolean(backup.version && backup.count > 0);
          }, 'delegated-recovery-server-backup', 60000);
          metrics.delegatedRecoverySupported = 1;
          stage = 'delegated-recovery-dismiss-key';
          await settings.getByRole('button', { name: 'I saved the recovery key', exact: true }).click();
        }
        stage = 'delegated-recovery-close-settings';
        await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      } catch { throw new Error(stage); }
    });
    await check('delegated-auth-natural-expiry', async () => {
      // This page has no request routes: both expiry and refresh use the real servers.
      // Recovery setup overlaps the 60-second provider TTL instead of adding an idle minute.
      const deadline = Date.now() + 90000;
      await until(async () => {
        if (Date.now() - originalSessionReadAt < 60000) return false;
        const expired = await fetch(`${stack.origins.synapse}/_matrix/client/v3/account/whoami`, {
          headers: { Authorization: `Bearer ${credentials.accessToken}` }, signal: AbortSignal.timeout(5000),
        });
        if (expired.status !== 401) return false;
        invariant((await expired.json()).errcode === 'M_UNKNOWN_TOKEN', 'delegated-natural-expiry-code');
        return true;
      }, 'delegated-natural-expiry-old-token', Math.max(1, deadline - Date.now()));
      metrics.delegatedNaturalExpiryObservedMs = Date.now() - originalSessionReadAt;
      let rotated;
      await until(async () => {
        rotated = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
        return rotated?.accessToken && rotated.accessToken !== credentials.accessToken
          && rotated.oauth?.refreshToken && rotated.oauth.refreshToken !== credentials.oauth.refreshToken;
      }, 'delegated-natural-expiry-rotation', Math.max(1, deadline - Date.now()));
      const identity = await fetch(`${stack.origins.synapse}/_matrix/client/v3/account/whoami`, {
        headers: { Authorization: `Bearer ${rotated.accessToken}` }, signal: AbortSignal.timeout(5000),
      });
      invariant(identity.ok && (await identity.json()).user_id === credentials.userId,
        'delegated-natural-expiry-identity');
      metrics.delegatedNaturalExpiryRotated = 1;
      const marker = `Synthetic post-expiry message ${randomBytes(8).toString('hex')}`;
      await page.getByRole('textbox', { name: `Message ${recoveryRoomName}`, exact: true }).fill(marker);
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      const sent = page.locator('.timeline-message').filter({ hasText: marker });
      await until(async () => (await sent.getAttribute('data-event-id'))?.startsWith('$'),
        'delegated-natural-expiry-send');
      const eventId = await sent.getAttribute('data-event-id');
      // Always read the latest credential for fresh API work, since sync may rotate it again.
      const current = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
      const response = await fetch(`${stack.origins.synapse}/_matrix/client/v3/rooms/${encodeURIComponent(recoveryRoomId)}/event/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${current.accessToken}` }, signal: AbortSignal.timeout(5000),
      });
      invariant(response.ok, 'delegated-natural-expiry-event');
      const event = await response.json();
      invariant(event.type === 'm.room.encrypted' && event.content?.algorithm === 'm.megolm.v1.aes-sha2'
        && typeof event.content.ciphertext === 'string' && !JSON.stringify(event.content).includes(marker),
      'delegated-natural-expiry-ciphertext');
      await page.reload();
      await page.locator('.buddy-row').filter({ hasText: recoveryRoomName }).first().click();
      await page.locator(`.timeline-message[data-event-id="${eventId}"]`).getByText(marker, { exact: true }).waitFor({ timeout: 45000 });
      metrics.delegatedNaturalExpiryEncryptedRoundtrip = 1;
    });
    if (recoveryKey) await check('delegated-auth-recovery-restore', async () => {
      const secondContext = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const second = await secondContext.newPage();
        await signInWithProvider(second, stack, username);
        const secondSession = await second.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
        invariant(secondSession?.deviceId && secondSession.deviceId !== credentials.deviceId,
          'delegated-recovery-distinct-device');
        await second.locator('.buddy-row').filter({ hasText: recoveryRoomName }).first().click();
        await second.getByRole('main', { name: recoveryRoomName }).waitFor();
        const oldEvent = second.locator(`.timeline-message[data-event-id="${recoveryEventId}"]`);
        await oldEvent.waitFor({ timeout: 45000 });
        invariant(!await oldEvent.getByText(recoveryMarker, { exact: true }).count(),
          'delegated-recovery-old-event-unavailable');
        await second.getByRole('button', { name: 'Open settings' }).click();
        const settings = second.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
        await settings.getByRole('button', { name: 'Matrix & security', exact: true }).click();
        await settings.getByLabel('Existing recovery key', { exact: true }).fill(recoveryKey);
        await settings.getByRole('button', { name: 'Restore existing room keys', exact: true }).click();
        const restored = settings.locator('.settings-success').filter({ hasText: 'Recovery complete.' });
        await restored.waitFor({ timeout: 60000 });
        invariant(Number((await restored.textContent())?.match(/Imported (\d+) room keys/)?.[1] ?? 0) > 0,
          'delegated-recovery-imported-keys');
        invariant(await settings.getByLabel('Existing recovery key', { exact: true }).inputValue() === '',
          'delegated-recovery-key-cleared');
        await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
        await oldEvent.getByText(recoveryMarker, { exact: true }).waitFor({ timeout: 45000 });
        metrics.delegatedRecoveryRestored = 1;
      } finally {
        await secondContext.close();
      }
    });
    await check('delegated-auth-refresh-and-rejection', async () => {
      const refreshContext = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const refreshPage = await refreshContext.newPage();
        await signInWithProvider(refreshPage, stack, username);
        const initial = await refreshPage.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
        invariant(initial?.accessToken && initial?.oauth?.refreshToken && initial?.oauth?.clientId,
          'delegated-refresh-initial-session');
        await rejectNextDeviceRead(refreshPage, async () => {
          await refreshPage.getByRole('button', { name: 'Open settings' }).click();
          await refreshPage.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true })
            .getByRole('button', { name: 'Matrix & security', exact: true }).click();
        });
        let rotated;
        await until(async () => {
          rotated = await refreshPage.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
          return rotated?.accessToken && rotated.accessToken !== initial.accessToken &&
            rotated.oauth?.refreshToken && rotated.oauth.refreshToken !== initial.oauth.refreshToken;
        }, 'delegated-refresh-rotation', 45000);
        const settings = refreshPage.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
        await settings.getByText('Account and homeserver', { exact: true }).waitFor({ timeout: 30000 });
        const identity = await fetch(`${stack.origins.synapse}/_matrix/client/v3/account/whoami`,
          { headers: { Authorization: `Bearer ${rotated.accessToken}` } });
        invariant(identity.ok && (await identity.json()).user_id === initial.userId,
          'delegated-refresh-new-token-accepted');
        metrics.delegatedRefreshRotated = 1;

        const metadata = await (await fetch(`${stack.origins.synapse}/_matrix/client/v1/auth_metadata`)).json();
        invariant(new URL(metadata.revocation_endpoint).origin === stack.origins.mas,
          'delegated-refresh-revocation-endpoint');
        invariant(new URL(metadata.token_endpoint).origin === stack.origins.mas,
          'delegated-refresh-token-endpoint');
        const revoked = await fetch(metadata.revocation_endpoint, { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: rotated.oauth.clientId,
            token: rotated.oauth.refreshToken, token_type_hint: 'refresh_token' }) });
        invariant(revoked.ok, 'delegated-refresh-revoked');
        // Prove MAS rejected the revoked refresh token separately before
        // exercising browser reauthentication (which may need an injected 401).
        const rejectedRefresh = await fetch(metadata.token_endpoint, { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: rotated.oauth.clientId,
            refresh_token: rotated.oauth.refreshToken }) });
        invariant([400, 401].includes(rejectedRefresh.status), 'delegated-refresh-provider-rejected');
        metrics.delegatedRefreshRejected = 1;
        const expired = refreshPage.getByRole('heading', { name: 'Your Matrix session expired' });
        const alreadyExpired = await expired.waitFor({ timeout: 5000 }).then(() => true, () => false);
        metrics.delegatedRevocationAutoReauth = Number(alreadyExpired);
        if (!alreadyExpired) await rejectNextDeviceRead(refreshPage,
          () => settings.getByRole('button', { name: 'Refresh', exact: true }).click());
        await expired.waitFor({ timeout: 45000 });
        const recovery = await refreshPage.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
        invariant(recovery?.userId === initial.userId && !recovery.accessToken && !recovery.oauth?.refreshToken,
          'delegated-refresh-token-free-recovery');
      } finally {
        await refreshContext.close();
      }
    });
    await check('delegated-auth-logout', async () => {
      const latestCredentials = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
      invariant(latestCredentials?.oauth?.refreshToken, 'delegated-session');
      await page.getByRole('button', { name: 'Open settings' }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('button', { name: 'Sign in with homeserver OAuth', exact: true }).waitFor({ timeout: 30000 });
      const cleared = await page.evaluate(() => !localStorage.getItem('aimtrix.matrix-session.v1'));
      invariant(cleared, 'delegated-local-cleanup');
      const response = await fetch(tokenEndpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: latestCredentials.oauth.clientId,
          refresh_token: latestCredentials.oauth.refreshToken }) });
      invariant(response.status === 400 || response.status === 401, 'delegated-revocation');
      metrics.delegatedLogoutCompleted = 1;
    });
  } finally {
    await context.close();
  }
}
