import { expect } from '@playwright/test';
import { test } from './pwa/diagnostics';
import { serveBuildPair } from './pwa/buildPair';

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

for (const install of ['fresh', 'update'] as const) test(`a failed required asset rejects ${install} shell installation and preserves working caches`, async ({ page, context, browserName, isMobile, diagnostics }) => {
  test.skip(isMobile, 'One actual asset-failure gate per installation state.');
  test.setTimeout(120000);
  test.skip(!process.env.PLAYWRIGHT_PREVIEW, 'Real worker lifecycle requires the production build.');
  test.skip(browserName !== 'chromium', 'This gate exercises Chromium service-worker lifecycle.');
  const builds = await productionBuildPair();
  diagnostics.track(builds);
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
    await diagnostics.checkpoint();
    try { await context.setOffline(false); if (!page.isClosed()) await page.goto('about:blank'); }
    finally { await builds.close(); }
  }
});

async function productionBuildPair() {
  // Build two real outputs. A changed document title is an actual HTML input
  // change, not a hand-edited worker revision or fake worker.
  const { readFile, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { build } = await import('vite');
  const { resolve } = await import('node:path');
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
  const server = await serveBuildPair(first, second);
  return {
    ...server,
    close: async () => {
      try { await server.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

test('a changed production build waits for draft confirmation before activation', async ({ page, context, browserName, isMobile, diagnostics }) => {
  test.skip(isMobile, 'One actual two-build lifecycle gate; mobile notice layout is covered separately.');
  test.setTimeout(120000);
  test.skip(!process.env.PLAYWRIGHT_PREVIEW, 'Real worker lifecycle requires the production build.');
  test.skip(browserName !== 'chromium', 'This gate exercises Chromium service-worker lifecycle.');
  const builds = await productionBuildPair();
  diagnostics.track(builds);
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
    await diagnostics.checkpoint();
    try { await context.setOffline(false); if (!page.isClosed()) await page.goto('about:blank'); }
    finally {
      await builds.close();
    }
  }
});


test('a newly opened controlled page announces an already waiting production worker', async ({ page, context, browserName, isMobile, diagnostics }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_PREVIEW, 'Real worker lifecycle requires the production build.');
  test.skip(browserName !== 'chromium', 'This gate exercises Chromium service-worker lifecycle.');
  test.setTimeout(120_000);
  const builds = await productionBuildPair();
  diagnostics.track(builds);
  try {
    await page.goto(`${builds.origin}/?demo=1`);
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
    builds.useSecond();
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect(page.getByRole('status').filter({ hasText: 'Aimtrix update ready' })).toBeVisible();
    const newcomer = await context.newPage();
    try {
      // This tab must recover the browser's retained waiting state even when
      // register() announces it before the new React tree subscribes.
      await newcomer.goto(`${builds.origin}/?demo=1`);
      await expect(newcomer.getByRole('button', { name: 'Open settings' })).toBeVisible();
      await expect(newcomer.getByRole('status').filter({ hasText: 'Aimtrix update ready' })).toBeVisible();
      expect(await newcomer.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
      if (isMobile) await newcomer.getByRole('button', { name: /Welcome Lounge/ }).click();
      await expect(newcomer.getByRole('textbox', { name: /Message Welcome Lounge/ })).toBeVisible();
      await newcomer.screenshot({ path: testInfo.outputPath('waiting-worker-new-page.png') });
      await diagnostics.checkpoint();
    } finally { await newcomer.close(); }
  } finally { await diagnostics.checkpoint(); await builds.close(); }
});
