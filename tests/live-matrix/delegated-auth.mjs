/* global localStorage, fetch */
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
    let tokenEndpoint;
    await check('delegated-auth-login', async () => {
      await signInWithProvider(page, stack, username);
      credentials = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
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
    let recoveryMarker;
    let recoveryEventId;
    await check('delegated-auth-recovery-setup', async () => {
      recoveryRoomName = `Delegated recovery ${randomBytes(5).toString('hex')}`;
      recoveryMarker = `Synthetic delegated history ${randomBytes(8).toString('hex')}`;
      await page.getByRole('button', { name: 'Join or create room' }).click();
      const createDialog = page.getByRole('dialog', { name: 'Add a conversation' });
      await createDialog.getByRole('button', { name: 'Create room', exact: true }).first().click();
      await createDialog.getByLabel('Room name', { exact: true }).fill(recoveryRoomName);
      await createDialog.getByLabel('Encrypt this room').check();
      const creation = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/createRoom') &&
        response.request().method() === 'POST');
      await createDialog.locator('form').getByRole('button', { name: 'Create room', exact: true }).click();
      const created = await creation;
      invariant(created.ok(), 'delegated-recovery-room-created');
      const roomId = (await created.json()).room_id;
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
      const encryption = await fetch(`${stored.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption`,
        { headers: { Authorization: `Bearer ${stored.accessToken}` } });
      invariant(encryption.ok() && (await encryption.json()).algorithm === 'm.megolm.v1.aes-sha2',
        'delegated-recovery-room-encrypted');
      await createDialog.waitFor({ state: 'hidden' });
      await page.locator('.buddy-row').filter({ hasText: recoveryRoomName }).first().click();
      await page.getByRole('main', { name: recoveryRoomName }).waitFor();
      await page.getByRole('textbox', { name: `Message ${recoveryRoomName}`, exact: true }).fill(recoveryMarker);
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      const sent = page.locator('.timeline-message').filter({ hasText: recoveryMarker });
      await until(async () => (await sent.getAttribute('data-event-id'))?.startsWith('$'), 'delegated-recovery-event-accepted');
      recoveryEventId = await sent.getAttribute('data-event-id');
      await page.getByRole('button', { name: 'Open settings' }).click();
      const settings = page.getByRole('dialog', { name: 'Personalize Aimtrix', exact: true });
      await settings.getByRole('button', { name: 'Matrix & security', exact: true }).click();
      await settings.getByLabel('New recovery passphrase', { exact: true }).fill(`Synthetic delegated recovery ${randomBytes(12).toString('hex')}`);
      await settings.getByRole('button', { name: 'Set up new recovery', exact: true }).click();
      const guidance = settings.getByRole('alert').filter({ hasText: 'trusted Matrix client' });
      const output = settings.locator('.recovery-key-output code');
      await until(async () => Boolean(await guidance.count() || await output.count()), 'delegated-recovery-outcome', 60000);
      if (await guidance.count()) {
        invariant(await settings.getByLabel('New recovery passphrase', { exact: true }).inputValue() !== '',
          'delegated-recovery-passphrase-retained');
        invariant(await output.count() === 0, 'delegated-recovery-no-key-export');
        metrics.delegatedRecoverySupported = 0;
      } else {
        recoveryKey = await output.textContent();
        invariant(Boolean(recoveryKey), 'delegated-recovery-key-generated');
        await until(async () => {
          const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aimtrix.matrix-session.v1')));
          const response = await fetch(`${stored.baseUrl}/_matrix/client/v3/room_keys/version`,
            { headers: { Authorization: `Bearer ${stored.accessToken}` } });
          if (!response.ok) return false;
          const backup = await response.json();
          return Boolean(backup.version && backup.count > 0);
        }, 'delegated-recovery-server-backup', 60000);
        metrics.delegatedRecoverySupported = 1;
        await settings.getByRole('button', { name: 'I saved the recovery key', exact: true }).click();
      }
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
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
