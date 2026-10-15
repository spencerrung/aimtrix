// Build unmodified, pinned release sources outside the checkout. No deployment.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const destination = resolve(process.argv[2] ?? '/tmp/aimtrix-pwa-releases');
await mkdir(destination, { recursive: true });
const directory = await mkdtemp(resolve(destination, 'builds-'));
const releases = [
  { name: 'rc7', revision: '0d0852d50f3673c0101c3af2fe79d552d0371006' },
  { name: 'rc8', revision: 'eb7edb19ddde1387e260dcec2835dfcd59ee213d' },
];
const manifest = { node: process.version, releases: [] };
for (const release of releases) {
  const source = resolve(directory, release.name);
  await mkdir(source);
  const archive = execFileSync('git', ['archive', release.revision], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', source], { input: archive });
  try {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: source, stdio: 'inherit' });
    execFileSync('npm', ['run', 'build'], { cwd: source, stdio: 'inherit' });
    const worker = await readFile(resolve(source, 'dist/sw.js'), 'utf8');
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const cache = worker.match(/const CACHE = '(aimtrix-shell-[a-f0-9]{64})'/)?.[1];
    if (!cache) throw new Error('Missing release worker identity');
    manifest.releases.push({ ...release, directory: resolve(source, 'dist'), cache,
      workerSha256: hash(worker), lockSha256: hash(await readFile(resolve(source, 'package-lock.json'))),
      htmlSha256: hash(await readFile(resolve(source, 'dist/index.html'))) });
  } finally {
    await rm(resolve(source, 'node_modules'), { recursive: true, force: true });
  }
}
await writeFile(resolve(directory, 'releases.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`PWA_RELEASE_BUILDS=${resolve(directory, 'releases.json')}\n`);
