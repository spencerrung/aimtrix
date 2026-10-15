const states = new Set(['parsed', 'installing', 'installed', 'activating', 'activated', 'redundant']);
const phases = new Set(['poll', 'statechange', 'updatefound', 'controllerchange', 'visibilitychange', 'announcement', 'checkpoint']);
const cacheName = /^aimtrix-shell-(?:[a-f0-9]{64}|v[0-9]+)$/;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const worker = (value: unknown) => {
  const entry = object(value);
  return entry.script === '/sw.js' && states.has(String(entry.state)) ? { script: '/sw.js', state: String(entry.state) } : null;
};

export function allowlistedAssetPath(url: string, origin: string, paths: ReadonlySet<string>) {
  const parsed = new URL(url);
  return parsed.origin === origin && paths.has(parsed.pathname) ? parsed.pathname : undefined;
}

/** Allowlist at the Node boundary too: a page binding is untrusted input. */
export function allowlistedSnapshot(value: unknown) {
  const entry = object(value);
  return {
    phase: phases.has(String(entry.phase)) ? String(entry.phase) : 'checkpoint',
    visibility: entry.visibility === 'visible' || entry.visibility === 'hidden' ? entry.visibility : 'unknown',
    standalone: entry.standalone === true,
    controller: worker(entry.controller), active: worker(entry.active), waiting: worker(entry.waiting), installing: worker(entry.installing),
    changedWorker: worker(entry.changedWorker),
    caches: Array.isArray(entry.caches) ? entry.caches.filter((key): key is string => typeof key === 'string' && cacheName.test(key)).slice(0, 20).sort() : [],
  };
}

