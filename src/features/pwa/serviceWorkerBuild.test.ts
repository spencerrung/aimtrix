import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serviceWorkerBuild } from '../../../build/serviceWorker';
import type { Rolldown } from 'vite';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aimtrix-sw-hash-'));
  directories.push(root);
  const publicDir = join(root, 'public');
  mkdirSync(publicDir);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  writeFileSync(join(publicDir, 'sw.js'), "const CACHE = 'aimtrix-shell-v3';\nconst BUILD_SHELL = [];");
  writeFileSync(join(publicDir, 'notification-policy.js'), 'policy revision one');
  writeFileSync(join(publicDir, 'config.json'), '{}');
  const bundle = {
    'index.html': { type: 'asset', source: '<title>First</title>' },
    'assets/entry.js': { type: 'chunk', fileName: 'assets/entry.js', code: 'entry code', isEntry: true, moduleIds: [join(root, 'src/main.tsx')], imports: ['assets/shared.js'], dynamicImports: ['assets/workspace.js', 'assets/crypto.js'], viteMetadata: { importedCss: new Set(['assets/entry.css']) } },
    'assets/workspace.js': { type: 'chunk', fileName: 'assets/workspace.js', code: 'workspace code', isEntry: false, moduleIds: [join(root, 'src/features/workspace/Workspace.tsx')], imports: ['assets/shared.js'], dynamicImports: ['assets/emoji.js', 'assets/gifs.js'], viteMetadata: { importedCss: new Set(['assets/workspace.css']), importedAssets: new Set(['assets/font.woff2']) } },
    'assets/shared.js': { type: 'chunk', fileName: 'assets/shared.js', code: 'shared code', moduleIds: [], imports: ['assets/entry.js'] },
    'assets/entry.css': { type: 'asset', source: 'entry style' },
    'assets/workspace.css': { type: 'asset', source: 'workspace style' },
    'assets/font.woff2': { type: 'asset', source: 'font bytes' },
    'assets/crypto.js': { type: 'chunk', fileName: 'assets/crypto.js', code: 'crypto code', moduleIds: [], imports: [] },
    'assets/emoji.js': { type: 'chunk', fileName: 'assets/emoji.js', code: 'optional emoji catalog', moduleIds: [], imports: [] },
    'assets/gifs.js': { type: 'chunk', fileName: 'assets/gifs.js', code: 'optional GIF provider', moduleIds: [], imports: [] },
  } as unknown as Rolldown.OutputBundle;
  const generate = async (html = '<title>First</title>', reverse = false) => {
    const plugin = serviceWorkerBuild();
    if (typeof plugin.configResolved !== 'function' || !plugin.generateBundle || typeof plugin.generateBundle === 'function') throw new Error('Expected build hooks');
    plugin.configResolved.call({} as never, { root, publicDir } as never);
    let source: unknown;
    const outputs = Object.entries({ ...bundle, 'index.html': { type: 'asset', source: html } });
    await plugin.generateBundle.handler.call({ emitFile: (asset: { source: unknown }) => { source = asset.source; } } as never,
      {} as never, Object.fromEntries(reverse ? outputs.reverse() : outputs) as never, false);
    return source;
  };
  return { root, publicDir, bundle, generate };
}

it('hashes output, package and worker imports deterministically while excluding runtime config', async () => {
  const { root, publicDir, generate } = fixture();
  const original = await generate();
  expect(await generate(undefined, true)).toBe(original);
  writeFileSync(join(publicDir, 'config.json'), '{"brandName":"Instance override"}');
  expect(await generate()).toBe(original);
  expect(await generate('<title>Changed</title>')).not.toBe(original);
  writeFileSync(join(publicDir, 'notification-policy.js'), 'policy revision two');
  const importedChange = await generate();
  expect(importedChange).not.toBe(original);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.1' }));
  expect(await generate()).not.toBe(importedChange);
});

it('precaches the entry and deferred Workspace static graphs, CSS and assets without optional imports', async () => {
  const { generate } = fixture();
  const worker = String(await generate());
  const shell = JSON.parse(worker.match(/const BUILD_SHELL = (\[.*\]);/)![1]);
  expect(shell).toEqual([
    '/assets/entry.css', '/assets/entry.js', '/assets/font.woff2',
    '/assets/shared.js', '/assets/workspace.css', '/assets/workspace.js',
  ]);
});

it('gives manifest-only changes a new cache so a rejected candidate cannot delete the active cache', async () => {
  const { bundle, generate } = fixture();
  const first = String(await generate());
  const extraEntry = bundle['assets/emoji.js'] as Rolldown.OutputChunk;
  extraEntry.isEntry = true;
  const second = String(await generate());
  // Output bytes are unchanged; only the emitted graph's entry metadata differs.
  expect(first.match(/const CACHE = '([^']+)'/)![1]).not.toBe(second.match(/const CACHE = '([^']+)'/)![1]);
});

it('rejects a missing required output instead of emitting an incomplete shell', async () => {
  const { bundle, generate } = fixture();
  delete bundle['assets/workspace.css'];
  await expect(generate()).rejects.toThrow('Executable shell asset is missing from the build: assets/workspace.css');
});

it.each(['assets/entry.js', 'assets/workspace.js'])('requires both shell roots when %s is missing', async (name) => {
  const { bundle, generate } = fixture();
  delete bundle[name];
  await expect(generate()).rejects.toThrow('Executable shell entry or Workspace is missing');
});

it('requires the executable shell insertion marker', async () => {
  const { publicDir, generate } = fixture();
  writeFileSync(join(publicDir, 'sw.js'), "const CACHE = 'aimtrix-shell-v3';");
  await expect(generate()).rejects.toThrow('Service worker executable shell marker is missing');
});
