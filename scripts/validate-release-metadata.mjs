import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { URL, pathToFileURL } from 'node:url';

const expectedByTarget = {
  all: ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64'],
  linux: ['linux-x86_64'],
  macos: ['darwin-aarch64', 'darwin-x86_64'],
  windows: ['windows-x86_64'],
};

export function validateReleaseMetadata(file, { target = 'all', tag, repository, indexFile = path.join(path.dirname(file), 'release-index.json'), directory = path.dirname(file) } = {}) {
  const expected = expectedByTarget[target];
  if (!expected) throw new Error('Unknown release target.');
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('RELEASE_TAG is required.');
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is required.');
  const release = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  if (release.tag_name !== tag || !Array.isArray(release.assets)) throw new Error('Release index tag mismatch.');
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (metadata.version !== tag.slice(1)) throw new Error('latest.json version does not match RELEASE_TAG.');
  if (!metadata.platforms || typeof metadata.platforms !== 'object') throw new Error('latest.json is missing platforms.');
  const names = fs.readdirSync(directory).filter((name) => fs.statSync(path.join(directory, name)).isFile());
  const updaterNames = new Set();
  for (const platform of expected) {
    const artifact = metadata.platforms[platform];
    if (!artifact || typeof artifact.signature !== 'string' || !artifact.signature.trim()) throw new Error(`Missing signature for ${platform}.`);
    let url;
    try { url = new URL(artifact.url); } catch { throw new Error(`Invalid updater URL for ${platform}.`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`Invalid updater URL for ${platform}.`);
    const asset = release.assets.find((entry) => entry.url === artifact.url || entry.browser_download_url === artifact.url);
    if (!asset || typeof asset.name !== 'string') throw new Error(`Updater URL absent from release index for ${platform}.`);
    const name = asset.name;
    const apiPrefix = `/repos/${repository}/releases/assets/`;
    const isApi = url.origin === 'https://api.github.com' && url.pathname.startsWith(apiPrefix) && /^\d+$/.test(url.pathname.slice(apiPrefix.length));
    const downloadPrefix = `/${repository}/releases/download/`;
    const decodedPath = decodeURIComponent(url.pathname);
    // Draft asset URLs can use GitHub's untagged-* path. The authenticated
    // release index, not that temporary path segment, establishes tag identity.
    const isDownload = url.origin === 'https://github.com' && decodedPath.startsWith(downloadPrefix) && decodedPath.split('/').at(-1) === name;
    if (!isApi && !isDownload) throw new Error(`Updater URL repository mismatch for ${platform}.`);
    if (!name || path.basename(name) !== name || !names.includes(name)) throw new Error(`Updater artifact missing for ${platform}.`);
    if (updaterNames.has(name)) throw new Error(`Duplicate updater artifact for ${platform}.`);
    updaterNames.add(name);
    const signature = `${name}.sig`;
    if (!names.includes(signature) || fs.readFileSync(path.join(directory, signature), 'utf8').trim() !== artifact.signature.trim()) throw new Error(`Updater signature mismatch for ${platform}.`);
  }
  const formats = target === 'all' ? ['.AppImage', '.deb', '.rpm', '.dmg', '.app.tar.gz', '.exe', '.msi']
    : target === 'linux' ? ['.AppImage', '.deb', '.rpm']
      : target === 'macos' ? ['.dmg', '.app.tar.gz'] : ['.exe', '.msi'];
  for (const format of formats) {
    const matching = names.filter((name) => name.endsWith(format));
    const required = ['.dmg', '.app.tar.gz'].includes(format) ? 2 : 1;
    if (matching.length < required) throw new Error(`Missing requested installer format ${format}.`);
    if (format !== '.dmg' && matching.some((name) => !names.includes(`${name}.sig`) || !fs.readFileSync(path.join(directory, `${name}.sig`), 'utf8').trim())) throw new Error(`Missing installer signature for ${format}.`);
  }
  return metadata.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/validate-release-metadata.mjs <latest.json>');
  const version = validateReleaseMetadata(file, { target: process.env.RELEASE_TARGET, tag: process.env.RELEASE_TAG, repository: process.env.GITHUB_REPOSITORY, indexFile: process.env.RELEASE_INDEX_FILE });
  console.log(`Validated signed updater metadata and requested installer formats for ${version}.`);
}
