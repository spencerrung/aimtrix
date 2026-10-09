import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

test('failed or unrelated navigations preserve the installed offline application', async ({ page, context, browserName }, info) => {
  test.skip(!process.env.PLAYWRIGHT_PREVIEW || browserName !== 'chromium', 'Requires a production Chromium service worker.');
  test.setTimeout(90000);
  const root = resolve('dist');
  let mode = 'normal';
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/' && mode !== 'normal') {
        if (mode === 'redirect') { response.writeHead(302, { Location: '/maintenance', 'Cache-Control': 'no-store' }).end(); return; }
        response.writeHead(mode === '503' ? 503 : mode === '404' ? 404 : 200, { 'Content-Type': mode === 'json' ? 'application/json' : 'text/html', 'Cache-Control': 'no-store' }).end('Synthetic non-application response');
        return;
      }
      if (path === '/maintenance') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end('<h1>Synthetic maintenance</h1>'); return; }
      const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
      if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
      try { response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(await readFile(file)); }
      catch { response.writeHead(404).end(); }
    })();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const origin = `http://127.0.0.1:${address.port}`;
  const cachedShell = () => page.evaluate(async () => {
    const key = (await caches.keys()).find((name) => name.startsWith('aimtrix-shell-'));
    const response = key && await (await caches.open(key)).match('/');
    return response ? { status: response.status, body: await response.text() } : undefined;
  });
  try {
    await page.goto(`${origin}/?demo=1`);
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    });
    // Warm assets explicitly: first-install precaching has its own regression.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    const installed = await cachedShell();
    expect(installed?.status).toBe(200);
    for (const failure of ['503', '404', 'json', 'maintenance-html', 'redirect', 'non-root']) {
      mode = failure === 'non-root' ? 'normal' : failure;
      await page.goto(`${origin}${failure === 'non-root' ? '/maintenance' : '/?demo=1'}`);
      await expect(page.locator('body')).toContainText('Synthetic');
      expect(await cachedShell()).toEqual(installed);
      await context.setOffline(true);
      await page.goto(`${origin}/?demo=1`);
      await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
      await expect(page.locator('aside[role="status"]')).toContainText('You’re offline');
      expect(await cachedShell()).toEqual(installed);
      if (failure === '503') await page.screenshot({ path: info.outputPath('offline-after-503.png') });
      await context.setOffline(false);
    }
    mode = 'normal';
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    await expect(page.locator('aside[role="status"]').filter({ hasText: 'You’re offline' })).toHaveCount(0);
    expect(await cachedShell()).toEqual(installed);
    expect(await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) => (await caches.open(key)).keys()))).flat().some((request) => new URL(request.url).pathname === '/config.json'))).toBe(false);
  } finally {
    await context.setOffline(false);
    if (!page.isClosed()) await page.goto('about:blank');
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }
});
