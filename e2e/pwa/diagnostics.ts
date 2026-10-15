import { test as base, type Page } from '@playwright/test';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { serveBuildPair } from './buildPair';

import { allowlistedAssetPath, allowlistedSnapshot } from './diagnosticSchema';

export type LifecycleDiagnostics = {
  track(builds: Awaited<ReturnType<typeof serveBuildPair>>, revisions?: string[]): void;
  checkpoint(): Promise<void>;
  markAssertionExitProbe(): void;
};

export const test = base.extend<{ diagnostics: LifecycleDiagnostics }>({
  diagnostics: [async ({ context, baseURL }, run, testInfo) => {
    const path = testInfo.outputPath('pwa-diagnostics.json');
    mkdirSync(dirname(path), { recursive: true });
    let origin = new URL(baseURL!).origin;
    let allowedPaths = new Set(['/sw.js', '/notification-policy.js']);
    const pageIds = new Map<Page, number>();
    const previousSnapshots = new Map<Page, string>();
    const started = Date.now();
    const report = {
      schema: 1, status: 'running', browser: testInfo.project.name,
      builds: [] as { cache: string; entry: string; workerSha256: string; htmlSha256: string; revision?: string }[],
      snapshots: [] as (ReturnType<typeof allowlistedSnapshot> & { page: number; elapsedMs: number })[],
      assetResponses: [] as { path: string; status: number; build: string; availability: string; elapsedMs: number }[],
      assetTransportFailures: [] as string[], pageErrorCount: 0, captureFailureCount: 0, intentionalAssertionExit: false,
    };
    // Atomic synchronous writes retain the last completed observation even if
    // an assertion, page crash or process interruption prevents final teardown.
    const persist = () => { writeFileSync(`${path}.tmp`, `${JSON.stringify(report, null, 2)}\n`); renameSync(`${path}.tmp`, path); };
    const record = (value: unknown, source: Page) => {
      if (!pageIds.has(source)) pageIds.set(source, pageIds.size + 1);
      const snapshot = { ...allowlistedSnapshot(value), page: pageIds.get(source)! };
      const serialized = JSON.stringify(snapshot);
      if (snapshot.phase !== 'poll' || serialized !== previousSnapshots.get(source)) {
        previousSnapshots.set(source, serialized);
        report.snapshots.push({ ...snapshot, elapsedMs: Date.now() - started }); persist();
      }
    };
    context.on('requestfailed', (request) => {
      const asset = allowlistedAssetPath(request.url(), origin, allowedPaths);
      if (asset) { report.assetTransportFailures.push(asset); persist(); }
    });
    const observePage = (target: Page) => target.on('pageerror', () => { report.pageErrorCount++; persist(); });
    context.pages().forEach(observePage);
    context.on('page', observePage);
    await context.exposeBinding('__retainPwaState', ({ frame, page: source }, value: unknown) => {
      if (frame === source.mainFrame() && new URL(frame.url()).origin === origin) record(value, source);
    });
    await context.addInitScript(() => {
      if (!('serviceWorker' in navigator)) return;
      const sink = (window as Window & { __retainPwaState?: (value: unknown) => Promise<void> }).__retainPwaState;
      const seen = new WeakSet<ServiceWorker | ServiceWorkerRegistration>();
      const describe = (worker?: ServiceWorker | null) => worker ? { script: new URL(worker.scriptURL).pathname, state: worker.state } : null;
      const snapshot = async (phase: string, changedWorker?: ReturnType<typeof describe>) => {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration && !seen.has(registration)) {
            seen.add(registration);
            registration.addEventListener('updatefound', () => { void snapshot('updatefound'); });
          }
          for (const worker of [registration?.active, registration?.waiting, registration?.installing]) {
            if (worker && !seen.has(worker)) {
              seen.add(worker);
              worker.addEventListener('statechange', () => { void snapshot('statechange', describe(worker)); });
            }
          }
          await sink?.({ phase, visibility: document.visibilityState, standalone: matchMedia('(display-mode: standalone)').matches, controller: describe(navigator.serviceWorker.controller),
            active: describe(registration?.active), waiting: describe(registration?.waiting), installing: describe(registration?.installing),
            changedWorker, caches: await caches.keys() });
        } catch { /* Navigation can destroy a context; retained Node observations survive. */ }
      };
      (window as Window & { __snapshotPwa?: () => Promise<void> }).__snapshotPwa = () => snapshot('checkpoint');
      navigator.serviceWorker.addEventListener('controllerchange', () => { void snapshot('controllerchange'); });
      document.addEventListener('visibilitychange', () => { void snapshot('visibilitychange'); });
      window.addEventListener('aimtrix-update-ready', () => { void snapshot('announcement'); });
      window.setInterval(() => { void snapshot('poll'); }, 100);
      void snapshot('poll');
    });
    const diagnostics: LifecycleDiagnostics = {
      markAssertionExitProbe() { report.intentionalAssertionExit = true; persist(); },
      track(builds, revisions) {
        origin = builds.origin;
        allowedPaths = builds.allowedPaths;
        report.builds = builds.identities.map((identity, i) => ({ ...identity, revision: revisions?.[i] }));
        builds.observe((request) => { report.assetResponses.push({ ...request, elapsedMs: Date.now() - started }); persist(); });
        persist();
      },
      async checkpoint() {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.all(context.pages().filter((target) => !target.isClosed() && new URL(target.url()).origin === origin).map((target) =>
              target.evaluate(async () => { await (window as Window & { __snapshotPwa?: () => Promise<void> }).__snapshotPwa?.(); }))),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic checkpoint timeout')), 2000); }),
          ]);
        } catch { report.captureFailureCount++; }
        finally { clearTimeout(timer); }
        persist();
      },
    };
    persist();
    try { await run(diagnostics); }
    finally {
      report.status = testInfo.status ?? 'unknown';
      persist();
      // Do not wait for navigator.serviceWorker.ready: failed fresh installs
      // never resolve it. Teardown retains the last observation even if closed.
      await diagnostics.checkpoint();
      await testInfo.attach('pwa-diagnostics', { path, contentType: 'application/json' });
    }
  }, { auto: true, timeout: 10_000 }],
});
