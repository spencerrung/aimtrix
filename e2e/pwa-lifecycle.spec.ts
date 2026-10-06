import { expect, test } from '@playwright/test';

test('production worker controls a warmed shell and reloads it offline', async ({ page, context, browserName }) => {
  test.skip(!process.env.PLAYWRIGHT_PREVIEW, 'Real worker lifecycle requires the production build.');
  test.skip(browserName !== 'chromium', 'This gate exercises Chromium service-worker lifecycle.');
  await page.goto('/?demo=1');
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });
  // A controlled online reload warms the hashed entry and its imported chunks.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const keys = await caches.keys();
    const requests = (await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))).flat();
    return requests.some((request) => new URL(request.url).pathname.startsWith('/assets/'));
  })).toBe(true);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    await expect(page.locator('aside[role="status"]')).toContainText('You’re offline');
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});

test('a real replacement worker waits for draft confirmation before activation', async ({ page, browserName }) => {
  test.skip(!process.env.PLAYWRIGHT_PREVIEW, 'Real worker lifecycle requires the production build.');
  test.skip(browserName !== 'chromium', 'This gate exercises Chromium service-worker lifecycle.');
  // Serve the actual build with a changed worker revision; browser routing cannot
  // reliably intercept the browser process's service-worker update request.
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { resolve, extname } = await import('node:path');
  let revision = 1;
  const root = resolve('dist');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(pathname === '/sw.js' ? Buffer.concat([body, Buffer.from(`\n// lifecycle revision ${revision}\n`)]) : body);
      } catch { response.writeHead(404).end(); }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing lifecycle server address');
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://127.0.0.1:${address.port}/?demo=1`);
    const composer = page.getByRole('textbox', { name: /Message Welcome Lounge/ });
    await expect(composer).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    });
    await composer.fill('Synthetic draft survives deferred update');
    revision = 2;
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    const notice = page.getByRole('status').filter({ hasText: 'Aimtrix update ready' });
    await expect(notice).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed');
    await notice.getByRole('button', { name: 'Reload', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reload Aimtrix?' });
    await expect(dialog).toContainText('Reloading will lose unsaved changes');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(composer).toHaveText('Synthetic draft survives deferred update');
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(true);
    await notice.getByRole('button', { name: 'Reload', exact: true }).click();
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload now', exact: true }).click()]);
    await expect(composer).toBeVisible();
    await expect(composer).toHaveText('');
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(false);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
    await expect(notice).toBeHidden();
  } finally {
    try { if (!page.isClosed()) await page.goto('about:blank'); }
    finally {
      await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
    }
  }
});
