/* global process, console */
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

const assets = join(process.cwd(), 'dist', 'assets');
const limits = new Map([
  ['.js', 800 * 1024],
  ['.css', 100 * 1024],
  ['.wasm', 6 * 1024 * 1024],
]);
const failures = [];
for (const name of await readdir(assets)) {
  const limit = limits.get(extname(name));
  if (!limit) continue;
  const { size } = await stat(join(assets, name));
  if (size > limit) failures.push(`${name}: ${size} bytes exceeds ${limit}`);
}
if (failures.length) {
  console.error(`Bundle budget failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Bundle budgets passed.');
}
