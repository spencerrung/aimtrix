import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(resolve('public/sw.js'), 'utf8');

function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const shell = new Response('<title>Installed application build</title>', { headers: { 'Content-Type': 'text/html' } });
  const cache = { match: vi.fn(async () => shell.clone()), put: vi.fn() };
  const fetch = vi.fn();
  runInNewContext(source, {
    self: { location: { origin: 'https://app.test' }, addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler) },
    caches: { open: vi.fn(async () => cache) }, fetch, URL, Response, importScripts() {},
  });
  const navigate = (path = '/') => {
    let response: Promise<Response> | undefined;
    handlers.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: `https://app.test${path}` }, respondWith: (value: Promise<Response>) => { response = value; } });
    return response!;
  };
  return { navigate, fetch, cache };
}

it.each([
  { status: 404, type: 'text/html', path: '/' },
  { status: 503, type: 'text/html', path: '/' },
  { status: 200, type: 'application/json', path: '/' },
  { status: 200, type: 'text/html', path: '/maintenance' },
  { status: 200, type: 'text/html', path: '/?demo=1' },
])('keeps the installed shell after $status $type navigation to $path', async ({ status, type, path }) => {
  const { navigate, fetch, cache } = worker();
  fetch.mockResolvedValueOnce(new Response('Network response from another document', { status, headers: { 'Content-Type': type } }));
  const network = await navigate(path);
  expect(network.status).toBe(status);
  expect(await network.text()).toBe('Network response from another document');
  fetch.mockRejectedValueOnce(new TypeError('Offline'));
  const offline = await navigate();
  expect(offline.status).toBe(200);
  expect(await offline.text()).toContain('Installed application build');
  expect(cache.put).not.toHaveBeenCalled();
});

it('resumes network navigation after an outage without promoting a new document into the installed build', async () => {
  const { navigate, fetch, cache } = worker();
  fetch.mockRejectedValueOnce(new TypeError('Offline'));
  expect(await (await navigate()).text()).toContain('Installed application build');
  fetch.mockResolvedValueOnce(new Response('<title>Recovered application build</title>', { headers: { 'Content-Type': 'text/html' } }));
  expect(await (await navigate()).text()).toContain('Recovered application build');
  expect(cache.put).not.toHaveBeenCalled();
});
