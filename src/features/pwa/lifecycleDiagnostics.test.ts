import { expect, it } from 'vitest';
import { allowlistedAssetPath, allowlistedSnapshot } from '../../../e2e/pwa/diagnosticSchema';

it('retains worker states and build caches without arbitrary page or account data', () => {
  const cache = `aimtrix-shell-${'a'.repeat(64)}`;
  const result = allowlistedSnapshot({ phase: 'statechange', visibility: 'visible',
    active: { script: '/sw.js', state: 'activated', token: 'private-token' },
    waiting: { script: '/sw.js', state: 'installed' }, installing: null,
    changedWorker: { script: '/sw.js', state: 'redundant', error: 'private-error' },
    controller: { script: '/sw.js?token=private-token', state: 'activated' },
    caches: [cache, 'private-room-cache', 'aimtrix-shell-private-token'],
    draft: 'private-draft', headers: { Authorization: 'private-token' },
  });
  expect(result).toEqual({ phase: 'statechange', visibility: 'visible', standalone: false, active: { script: '/sw.js', state: 'activated' },
    waiting: { script: '/sw.js', state: 'installed' }, installing: null, controller: null,
    changedWorker: { script: '/sw.js', state: 'redundant' }, caches: [cache] });
  expect(JSON.stringify(result)).not.toContain('private');
});

it('rejects unknown worker states and untrusted diagnostic labels', () => {
  expect(allowlistedSnapshot({ phase: 'private-draft', visibility: 'private-room', active: { script: '/sw.js', state: 'private-error' } }))
    .toEqual({ phase: 'checkpoint', visibility: 'unknown', standalone: false, active: null, waiting: null, installing: null, controller: null, changedWorker: null, caches: [] });
});

it('records only known same-origin asset paths and strips queries and fragments', () => {
  const origin = 'http://127.0.0.1:4581';
  const paths = new Set(['/assets/index-AbCd.js', '/sw.js']);
  expect(allowlistedAssetPath(`${origin}/assets/index-AbCd.js?token=private#private`, origin, paths)).toBe('/assets/index-AbCd.js');
  expect(allowlistedAssetPath('https://private.test/sw.js', origin, paths)).toBeUndefined();
  expect(allowlistedAssetPath(`${origin}/assets/private-room.js`, origin, paths)).toBeUndefined();
  expect(allowlistedAssetPath(`${origin}/_matrix/client/v3/sync`, origin, paths)).toBeUndefined();
});
