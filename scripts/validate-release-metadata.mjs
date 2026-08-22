/* global process, console */

import fs from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/validate-release-metadata.mjs <latest.json>');

const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
if (typeof metadata.version !== 'string' || !metadata.version) throw new Error('latest.json is missing version.');
if (!metadata.platforms || typeof metadata.platforms !== 'object') throw new Error('latest.json is missing platforms.');

const expected = ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64'];
for (const platform of expected) {
  const artifact = metadata.platforms[platform];
  if (!artifact || typeof artifact.signature !== 'string' || !artifact.signature) {
    throw new Error(`latest.json is missing a signature for ${platform}.`);
  }
  if (typeof artifact.url !== 'string' || !artifact.url.startsWith('https://')) {
    throw new Error(`latest.json has an invalid HTTPS URL for ${platform}.`);
  }
}

console.log(`Validated signed updater metadata for ${metadata.version}: ${expected.join(', ')}.`);
