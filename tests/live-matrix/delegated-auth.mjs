/* global localStorage, fetch */
import { URL, URLSearchParams } from 'node:url';
import { invariant } from './stack.mjs';

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
    await check('delegated-auth-logout', async () => {
      await page.getByRole('button', { name: 'Open settings' }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('button', { name: 'Sign On', exact: true }).waitFor({ timeout: 30000 });
      const cleared = await page.evaluate(() => !localStorage.getItem('aimtrix.matrix-session.v1'));
      invariant(cleared, 'delegated-local-cleanup');
      const response = await fetch(tokenEndpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: credentials.oauth.clientId,
          refresh_token: credentials.oauth.refreshToken }) });
      invariant(response.status === 400 || response.status === 401, 'delegated-revocation');
      metrics.delegatedLogoutCompleted = 1;
    });
  } finally {
    await context.close();
  }
}
