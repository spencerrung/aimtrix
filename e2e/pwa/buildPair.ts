import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

export async function buildIdentity(directory: string) {
  const worker = await readFile(resolve(directory, 'sw.js'), 'utf8');
  const html = await readFile(resolve(directory, 'index.html'), 'utf8');
  const cache = worker.match(/const CACHE = '(aimtrix-shell-[a-f0-9]{64})'/)?.[1];
  const entry = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  if (!cache || !entry) throw new Error('Production worker identity or entry is missing');
  const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
  return { cache, entry, workerSha256: sha256(worker), htmlSha256: sha256(html) };
}

export type AssetRequest = { path: string; status: number; build: 'first' | 'second'; availability: 'complete' | 'missing' | 'unavailable' };

/** A real same-origin deployment transition, including an old replica lacking a new hashed asset. */
export async function serveBuildPair(first: string, second: string) {
  const identities = await Promise.all([buildIdentity(first), buildIdentity(second)]);
  if (identities[0].cache === identities[1].cache) throw new Error('The deployment must change worker bytes');
  const files = async (root: string) => (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => `/${resolve(entry.parentPath, entry.name).slice(root.length + 1)}`);
  const allowedPaths = new Set(['/', ...(await files(first)), ...(await files(second))]);
  const requests: AssetRequest[] = [];
  let selected: 'first' | 'second' = 'first';
  let availability: AssetRequest['availability'] = 'complete';
  let observe: (request: AssetRequest) => void = () => undefined;
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const build = selected, state = availability;
      const finish = (status: number, body = Buffer.alloc(0), type = 'text/plain') => {
        // Only known static paths, numeric status and controlled fixture enums.
        // Never headers, request queries, bodies, error strings or Matrix URLs.
        if (allowedPaths.has(path)) {
          const record = { path, status, build, availability: state };
          requests.push(record); observe(record);
        }
        response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
      };
      if (path === '/cache-seed') { finish(200, Buffer.from('<title>Cache setup</title>'), 'text/html'); return; }
      if (!allowedPaths.has(path)) { finish(404); return; }
      const failedEntry = build === 'second' && path === identities[1].entry;
      if (failedEntry && state === 'unavailable') { finish(503); return; }
      const root = build === 'first' || failedEntry && state === 'missing' ? first : second;
      const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
      try { finish(200, await readFile(file), types[extname(file)] ?? 'application/octet-stream'); }
      catch { finish(404); }
    })();
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing lifecycle server address');
  return {
    origin: `http://127.0.0.1:${address.port}`, identities, requests, allowedPaths,
    observe: (listener: typeof observe) => { observe = listener; },
    useSecond: (reject: boolean | AssetRequest['availability'] = false) => {
      selected = 'second'; availability = typeof reject === 'boolean' ? reject ? 'unavailable' : 'complete' : reject;
    },
    failedRequests: () => requests.filter((request) => request.status >= 400).length,
    close: () => new Promise<void>((done, reject) => { server.close((error) => error ? reject(error) : done()); server.closeAllConnections(); }),
  };
}
