import { expect, test } from '@playwright/test';

for (const httpCache of ['retained', 'cleared'] as const) test(`fresh production shell starts on its first offline reload with HTTP cache ${httpCache}`, async ({ page, context, browserName, isMobile }, testInfo) => {
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
  const installed = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter((key) => key.startsWith('aimtrix-shell-'));
    const cache = await caches.open(keys[0]);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  const documentAssets = await page.locator('script[src], link[rel="stylesheet"], link[rel="modulepreload"]').evaluateAll((elements) => elements.map((element) => new URL(element.getAttribute('src') ?? element.getAttribute('href')!, location.href).pathname));
  expect(installed).toEqual(expect.arrayContaining(documentAssets));
  expect(installed).not.toContain('/config.json');
  // No controlled online reload: installation must fetch everything needed to start.
  if (httpCache === 'cleared') {
    const session = await context.newCDPSession(page);
    await session.send('Network.clearBrowserCache');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    await expect(page.locator('aside[role="status"]')).toContainText('You’re offline');
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    if (isMobile) await page.getByRole('button', { name: /Welcome Lounge/ }).click();
    const composer = page.getByRole('textbox', { name: /Message Welcome Lounge/ });
    await expect(composer).toBeVisible();
    if (httpCache === 'cleared') {
      await page.screenshot({ path: testInfo.outputPath('first-offline-reload.png') });
      await page.setViewportSize({ width: isMobile ? 393 : 1280, height: 360 });
      await composer.focus();
      await expect(composer).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('first-offline-short-viewport.png') });
    }
  } finally {
    await context.setOffline(false);
  }
});

for (const install of ['fresh', 'update'] as const) test(`a failed required asset rejects ${install} shell installation and preserves working caches`, async ({ page, context, browserName, isMobile }) => {
  test.skip(isMobile, 'One actual asset-failure gate per installation state.');
  test.setTimeout(120000);
  test.skip(!process.env.PLAYWRIGHT_PREVIEW, 'Real worker lifecycle requires the production build.');
  test.skip(browserName !== 'chromium', 'This gate exercises Chromium service-worker lifecycle.');
  const builds = await productionBuildPair();
  try {
    await page.goto(`${builds.origin}/cache-seed`);
    await page.evaluate(async () => {
      const unrelated = await caches.open('unrelated-origin-cache');
      await unrelated.put('/', new Response('Unrelated cache'));
    });
    if (install === 'update') {
      await page.goto(`${builds.origin}/?demo=1`);
      await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      });
    }
    const workingCaches = await page.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith('aimtrix-shell-')));
    expect(workingCaches).toHaveLength(install === 'update' ? 1 : 0);
    builds.useSecond(true);
    const result = await page.evaluate(async (update) => {
      const settled = (worker: ServiceWorker) => new Promise<string>((resolve) => {
        const check = () => {
          if (['redundant', 'installed', 'activated'].includes(worker.state)) resolve(worker.state);
        };
        worker.addEventListener('statechange', check);
        check();
      });
      if (!update) {
        const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        return { state: worker ? await settled(worker) : 'redundant', active: Boolean(registration.active), waiting: Boolean(registration.waiting) };
      }
      const registration = await navigator.serviceWorker.ready;
      const active = registration.active;
      const attempt = new Promise<string>((resolve) => {
        registration.addEventListener('updatefound', () => {
          if (registration.installing) void settled(registration.installing).then(resolve);
        }, { once: true });
      });
      await registration.update();
      return { state: await attempt, active: registration.active === active, waiting: Boolean(registration.waiting) };
    }, install === 'update');
    expect(result).toEqual({ state: 'redundant', active: install === 'update', waiting: false });
    expect(builds.failedRequests()).toBeGreaterThan(0);
    expect(await page.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith('aimtrix-shell-')))).toEqual(workingCaches);
    expect(await page.evaluate(() => caches.has('unrelated-origin-cache'))).toBe(true);
    if (install === 'update') {
      const session = await context.newCDPSession(page);
      await session.send('Network.clearBrowserCache');
      await session.send('Network.setCacheDisabled', { cacheDisabled: true });
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
      await expect(page).toHaveTitle('Aimtrix');
      await expect(page.locator('aside[role="status"]')).toContainText('You’re offline');
    }
  } finally {
    try { await context.setOffline(false); if (!page.isClosed()) await page.goto('about:blank'); }
    finally { await builds.close(); }
  }
});

async function productionBuildPair() {
  // Build two real outputs. A changed document title is an actual HTML input
  // change, not a hand-edited worker revision or fake worker.
  const { createServer } = await import('node:http');
  const { readFile, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { build } = await import('vite');
  const { resolve, extname } = await import('node:path');
  const directory = await mkdtemp(resolve(tmpdir(), 'aimtrix-pwa-builds-'));
  const first = resolve(directory, 'first'), second = resolve(directory, 'second');
  let requiredEntry: string;
  try {
    await build({ logLevel: 'silent', build: { outDir: first, emptyOutDir: true } });
    await build({ logLevel: 'silent', build: { outDir: second, emptyOutDir: true }, plugins: [{
      name: 'lifecycle-document-change',
      transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<title>Aimtrix</title>', '<title>Aimtrix updated build</title>') },
    }] });
    expect(await readFile(resolve(first, 'sw.js'), 'utf8')).not.toBe(await readFile(resolve(second, 'sw.js'), 'utf8'));
    const html = await readFile(resolve(second, 'index.html'), 'utf8');
    const entry = html.match(/<script[^>]+src="([^"]+)"/);
    if (!entry) throw new Error('Production entry script is missing');
    requiredEntry = entry[1];
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  let root = first;
  let rejectEntry = false;
  let failedRequests = 0;
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/cache-seed') { response.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Cache setup</title>'); return; }
      if (rejectEntry && pathname === requiredEntry) { failedRequests++; response.writeHead(503).end(); return; }
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
  return {
    origin: `http://127.0.0.1:${address.port}`,
    useSecond: (reject = false) => { root = second; rejectEntry = reject; },
    failedRequests: () => failedRequests,
    close: async () => {
      await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('a changed production build waits for draft confirmation before activation', async ({ page, context, browserName, isMobile }) => {
  test.skip(isMobile, 'One actual two-build lifecycle gate; mobile notice layout is covered separately.');
  test.setTimeout(120000);
  test.skip(!process.env.PLAYWRIGHT_PREVIEW, 'Real worker lifecycle requires the production build.');
  test.skip(browserName !== 'chromium', 'This gate exercises Chromium service-worker lifecycle.');
  const builds = await productionBuildPair();
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { origin } = builds;
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
    builds.useSecond();
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
      await builds.close();
    }
  }
});
