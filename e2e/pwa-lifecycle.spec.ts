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

test('a changed production build waits for draft confirmation before activation', async ({ page, context, browserName, isMobile }) => {
  test.skip(isMobile, 'One actual two-build lifecycle gate; mobile notice layout is covered separately.');
  test.setTimeout(120000);
  test.skip(!process.env.PLAYWRIGHT_PREVIEW, 'Real worker lifecycle requires the production build.');
  test.skip(browserName !== 'chromium', 'This gate exercises Chromium service-worker lifecycle.');
  // Build two real outputs. A changed document title is an actual HTML input
  // change, not a hand-edited worker revision or fake worker.
  const { createServer } = await import('node:http');
  const { readFile, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { build } = await import('vite');
  const { resolve, extname } = await import('node:path');
  const directory = await mkdtemp(resolve(tmpdir(), 'aimtrix-pwa-builds-'));
  const first = resolve(directory, 'first'), second = resolve(directory, 'second');
  try {
    await build({ logLevel: 'silent', build: { outDir: first, emptyOutDir: true } });
    await build({ logLevel: 'silent', build: { outDir: second, emptyOutDir: true }, plugins: [{
      name: 'lifecycle-document-change',
      transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<title>Aimtrix</title>', '<title>Aimtrix updated build</title>') },
    }] });
    expect(await readFile(resolve(first, 'sw.js'), 'utf8')).not.toBe(await readFile(resolve(second, 'sw.js'), 'utf8'));
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  let root = first;
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/cache-seed') { response.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Cache setup</title>'); return; }
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(body);
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
    const origin = `http://127.0.0.1:${address.port}`;
    // Create a conflicting older cache before the app has registered its worker.
    await page.goto(`${origin}/cache-seed`);
    await page.evaluate(async () => {
      const unrelated = await caches.open('unrelated-origin-cache');
      await unrelated.put('/', new Response('<title>Unrelated cached shell</title>', { headers: { 'Content-Type': 'text/html' } }));
    });
    await page.goto(`${origin}/?demo=1`);
    const composer = page.getByRole('textbox', { name: /Message Welcome Lounge/ });
    await expect(composer).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    });
    await composer.fill('Synthetic draft survives deferred update');
    root = second;
    // The running old page must discover an update when brought back to focus.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
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
    await expect(page).toHaveTitle('Aimtrix updated build');
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(false);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
    await expect(notice).toBeHidden();
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith('aimtrix-shell-')).length)).toBe(1);
    expect(await page.evaluate(() => caches.has('unrelated-origin-cache'))).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(composer).toBeVisible();
    await expect(page).toHaveTitle('Aimtrix updated build');
  } finally {
    try { await context.setOffline(false); if (!page.isClosed()) await page.goto('about:blank'); }
    finally {
      await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
      await rm(directory, { recursive: true, force: true });
    }
  }
});
