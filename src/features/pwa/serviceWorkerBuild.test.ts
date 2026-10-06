import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serviceWorkerBuild } from '../../../build/serviceWorker';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it('hashes output, package and worker imports deterministically while excluding runtime config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aimtrix-sw-hash-'));
  directories.push(root);
  const publicDir = join(root, 'public');
  mkdirSync(publicDir);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  writeFileSync(join(publicDir, 'sw.js'), "const CACHE = 'aimtrix-shell-v3';");
  writeFileSync(join(publicDir, 'notification-policy.js'), 'policy revision one');
  writeFileSync(join(publicDir, 'config.json'), '{}');
  const generate = async (html = '<title>First</title>', reverse = false) => {
    const plugin = serviceWorkerBuild();
    if (typeof plugin.configResolved !== 'function' || !plugin.generateBundle || typeof plugin.generateBundle === 'function') throw new Error('Expected build hooks');
    plugin.configResolved.call({} as never, { root, publicDir } as never);
    let source: unknown;
    const outputs = [
      ['index.html', { type: 'asset', source: html }],
      ['assets/entry.js', { type: 'chunk', code: 'entry code' }],
    ];
    await plugin.generateBundle.handler.call({ emitFile: (asset: { source: unknown }) => { source = asset.source; } } as never,
      {} as never, Object.fromEntries(reverse ? outputs.reverse() : outputs) as never, false);
    return source;
  };
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
