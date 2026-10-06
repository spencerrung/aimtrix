import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateReleaseMetadata } from './validate-release-metadata.mjs';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'aimtrix-release-audit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const metadata = { version: '0.3.0-rc.7', platforms: { 'linux-x86_64': {
    signature: 'synthetic-signature', url: 'https://github.com/example/aimtrix/releases/download/v0.3.0-rc.7/Aimtrix.AppImage',
  } } };
  for (const name of ['Aimtrix.AppImage', 'Aimtrix.deb', 'Aimtrix.rpm']) {
    writeFileSync(path.join(directory, name), 'synthetic artifact');
    writeFileSync(path.join(directory, `${name}.sig`), 'synthetic-signature');
  }
  writeFileSync(path.join(directory, 'Aimtrix.AppImage.sig'), 'synthetic-signature\n');
  const file = path.join(directory, 'latest.json');
  const release = { tag_name: 'v0.3.0-rc.7', assets: [{ id: 123, name: 'Aimtrix.AppImage', url: 'https://api.github.com/repos/example/aimtrix/releases/assets/123', browser_download_url: metadata.platforms['linux-x86_64'].url }] };
  return { directory, metadata, release, validate(target = 'linux') {
    writeFileSync(file, JSON.stringify(metadata));
    writeFileSync(path.join(directory, 'release-index.json'), JSON.stringify(release));
    return validateReleaseMetadata(file, { target, tag: 'v0.3.0-rc.7', repository: 'example/aimtrix' });
  } };
}

test('accepts matching release metadata and complete downloaded Linux formats', (t) => {
  assert.equal(fixture(t).validate(), '0.3.0-rc.7');
});
test('rejects stale metadata version even when downloaded files exist', (t) => {
  const f = fixture(t); f.metadata.version = '0.3.0-rc.6'; assert.throws(f.validate, /version does not match/);
});
test('rejects an updater URL pointing to another release', (t) => {
  const f = fixture(t); f.metadata.platforms['linux-x86_64'].url = f.metadata.platforms['linux-x86_64'].url.replace('rc.7', 'rc.6');
  assert.throws(f.validate, /absent from release index/);
});
test('rejects a named updater asset missing from the downloaded release', (t) => {
  const f = fixture(t); rmSync(path.join(f.directory, 'Aimtrix.AppImage')); assert.throws(f.validate, /artifact missing/);
});
test('rejects metadata signature that differs from the downloaded sidecar', (t) => {
  const f = fixture(t); f.metadata.platforms['linux-x86_64'].signature = 'wrong-signature'; assert.throws(f.validate, /signature mismatch/);
});
test('rejects a missing parallel RPM result despite complete updater metadata', (t) => {
  const f = fixture(t); rmSync(path.join(f.directory, 'Aimtrix.rpm')); assert.throws(f.validate, /installer format .rpm/);
});

test('rejects a missing RPM signature even when its installer is downloaded', (t) => {
  const f = fixture(t); rmSync(path.join(f.directory, 'Aimtrix.rpm.sig')); assert.throws(f.validate, /Missing installer signature/);
});

function addPlatform(f, platform, name) {
  writeFileSync(path.join(f.directory, name), 'synthetic artifact');
  writeFileSync(path.join(f.directory, `${name}.sig`), 'synthetic-signature');
  f.metadata.platforms[platform] = { signature: 'synthetic-signature', url: `https://github.com/example/aimtrix/releases/download/v0.3.0-rc.7/${name}` };
  const id = f.release.assets.length + 123;
  f.release.assets.push({ id, name, url: `https://api.github.com/repos/example/aimtrix/releases/assets/${id}`, browser_download_url: f.metadata.platforms[platform].url });
}
test('accepts both macOS architectures and rejects a missing second disk image', (t) => {
  const f = fixture(t);
  addPlatform(f, 'darwin-aarch64', 'Aimtrix_aarch64.app.tar.gz');
  addPlatform(f, 'darwin-x86_64', 'Aimtrix_x64.app.tar.gz');
  for (const name of ['Aimtrix_aarch64.dmg', 'Aimtrix_x64.dmg']) writeFileSync(path.join(f.directory, name), 'synthetic image');
  assert.equal(f.validate('macos'), '0.3.0-rc.7');
  rmSync(path.join(f.directory, 'Aimtrix_x64.dmg'));
  assert.throws(() => f.validate('macos'), /installer format .dmg/);
});
test('accepts Windows updater with both signed installer formats', (t) => {
  const f = fixture(t);
  addPlatform(f, 'windows-x86_64', 'Aimtrix.msi');
  writeFileSync(path.join(f.directory, 'Aimtrix-setup.exe'), 'synthetic installer');
  writeFileSync(path.join(f.directory, 'Aimtrix-setup.exe.sig'), 'synthetic-signature');
  assert.equal(f.validate('windows'), '0.3.0-rc.7');
});

test('accepts authenticated draft API URLs matched against the fetched release index', (t) => {
  const f = fixture(t); f.metadata.platforms['linux-x86_64'].url = f.release.assets[0].url;
  assert.equal(f.validate(), '0.3.0-rc.7');
});
test('rejects a release index for a different tag', (t) => {
  const f = fixture(t); f.release.tag_name = 'v0.3.0-rc.6'; assert.throws(f.validate, /index tag mismatch/);
});
test('rejects an unrelated host even if it appears in the index', (t) => {
  const f = fixture(t); const url = f.release.assets[0].browser_download_url.replace('github.com', 'example.org');
  f.metadata.platforms['linux-x86_64'].url = url; f.release.assets[0].browser_download_url = url;
  assert.throws(f.validate, /repository mismatch/);
});

test('accepts indexed untagged draft download paths for the requested release', (t) => {
  const f = fixture(t); const url = f.release.assets[0].browser_download_url.replace('v0.3.0-rc.7', 'untagged-example');
  f.metadata.platforms['linux-x86_64'].url = url; f.release.assets[0].browser_download_url = url;
  assert.equal(f.validate(), '0.3.0-rc.7');
});
