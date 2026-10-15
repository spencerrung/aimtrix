import { expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test as lifecycleTest } from './pwa/diagnostics';
import { serveBuildPair } from './pwa/buildPair';

// Actual desktop Chromium PWA installation needs a non-incognito profile and
// the full browser, rather than chromium-headless-shell. All data is synthetic.
const test = lifecycleTest.extend({
  context: async ({ playwright, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent }, run) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'aimtrix-installed-pwa-'));
    const context = await playwright.chromium.launchPersistentContext(directory, {
      channel: 'chromium', headless: true, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    });
    try { await run(context); }
    finally { await context.close(); await rm(directory, { recursive: true, force: true }); }
  },
});

test.skip(!process.env.PWA_RELEASE_BUILDS, 'Pinned release proof requires scripts/prepare-pwa-release-builds.mjs.');
test.setTimeout(90_000);

async function releases() {
  const manifest = JSON.parse(await readFile(process.env.PWA_RELEASE_BUILDS!, 'utf8')) as {
    releases: { directory: string; revision: string; cache: string; workerSha256: string; htmlSha256: string }[];
  };
  expect(manifest.releases.map((release) => release.revision)).toEqual([
    '0d0852d50f3673c0101c3af2fe79d552d0371006', 'eb7edb19ddde1387e260dcec2835dfcd59ee213d',
  ]);
  const builds = await serveBuildPair(manifest.releases[0].directory, manifest.releases[1].directory);
  try {
    builds.identities.forEach((identity, i) => expect(identity).toMatchObject({
      cache: manifest.releases[i].cache, workerSha256: manifest.releases[i].workerSha256, htmlSha256: manifest.releases[i].htmlSha256,
    }));
    return { builds, revisions: manifest.releases.map((release) => release.revision) };
  } catch (error) { await builds.close(); throw error; }
}

for (const availability of ['complete', 'missing', 'unavailable'] as const) {
  test(`installed RC7 to RC8 upgrade with ${availability} assets protects deferred drafts`, async ({ page, context, isMobile, diagnostics }, testInfo) => {
    const { builds, revisions } = await releases();
    diagnostics.track(builds, revisions);
    const cdp = await context.newCDPSession(page);
    const manifestId = `${builds.origin}/`;
    let installed = false;
    try {
      await page.goto(`${builds.origin}/?demo=1`);
      await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
      await cdp.send('PWA.install', { manifestId }); installed = true;
      await cdp.send('PWA.openCurrentPageInApp', { manifestId });
      await expect.poll(() => page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
      await page.setViewportSize({ width: isMobile ? 393 : 1280, height: isMobile ? 851 : 800 });
      if (isMobile) await page.getByRole('button', { name: /Welcome Lounge/ }).click();
      const composer = page.getByRole('textbox', { name: /Message Welcome Lounge/ });
      const draft = 'Synthetic RC7 draft awaiting update consent';
      await composer.fill(draft);
      expect(await page.evaluate(() => caches.keys())).toContain(builds.identities[0].cache);
      builds.useSecond(availability);
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
      const notice = page.getByRole('status').filter({ hasText: 'Aimtrix update ready' });

      if (availability !== 'complete') {
        await expect.poll(() => builds.requests.filter((request) => request.path === builds.identities[1].entry && request.status === (availability === 'missing' ? 404 : 503)).length).toBeGreaterThan(0);
        await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.installing?.state ?? null)).toBeNull();
        expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null)).toBeNull();
        await expect(notice).toBeHidden();
        await expect(composer).toHaveText(draft);
        expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
        await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain(builds.identities[1].cache);
        expect(await page.evaluate(() => caches.keys())).toContain(builds.identities[0].cache);
        await diagnostics.checkpoint();
        // An explicitly requested negative run proves on-disk retention after
        // an actual Playwright assertion exit. Never enabled in normal gates.
        if (process.env.PWA_DIAGNOSTIC_FAILURE_PROBE === '1') {
          diagnostics.markAssertionExitProbe();
          expect(false, 'Intentional diagnostic-retention probe').toBe(true);
        }
        builds.useSecond('complete');
        await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
      }

      await expect(notice).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
      expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(builds.identities.map((identity) => identity.cache)));
      await expect(composer).toHaveText(draft);
      await page.screenshot({ path: testInfo.outputPath('installed-update-notice.png') });
      await notice.getByRole('button', { name: 'Reload', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Reload Aimtrix?' });
      await expect(dialog).toContainText('Reloading will lose unsaved changes');
      await expect(dialog).toContainText('Encrypted account storage is preserved');
      await page.screenshot({ path: testInfo.outputPath('installed-draft-confirmation.png') });
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(composer).toHaveText(draft);
      expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
      await diagnostics.checkpoint();
      await notice.getByRole('button', { name: 'Reload', exact: true }).click();
      await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload now', exact: true }).click()]);
      await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
      if (isMobile) await page.getByRole('button', { name: /Welcome Lounge/ }).click();
      // Demo drafts are explicitly volatile. Acceptance is consented discard,
      // not a claim of authenticated durable-draft or crypto recovery testing.
      await expect(composer).toHaveText('');
      expect(await page.locator('script[type="module"][src]').getAttribute('src')).toBe(builds.identities[1].entry);
      await expect(notice).toBeHidden();
      await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([builds.identities[1].cache]);
      expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null)).toBeNull();
      expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
      await expect(page.locator('aside[role="status"]')).toContainText('You’re offline');
      if (isMobile) await page.getByRole('button', { name: /Welcome Lounge/ }).click();
      await expect(composer).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('installed-rc8-offline.png') });
    } finally {
      await diagnostics.checkpoint();
      await context.setOffline(false);
      try { if (installed) await cdp.send('PWA.uninstall', { manifestId }); }
      finally { await builds.close(); }
    }
  });
}
