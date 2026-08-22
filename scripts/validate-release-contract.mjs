/* global console */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  'docs/release-operations.md',
  'docs/privacy-and-store-disclosures.md',
  'docs/desktop-release.md',
  'docs/mobile-release.md',
  '.github/workflows/quality.yml',
];
const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`Release contract is missing: ${missing.join(', ')}`);

const runtimeConfig = JSON.parse(fs.readFileSync(path.join(root, 'public/config.json'), 'utf8'));
const forbiddenKeys = /accessToken|recoveryKey|privateKey|password|secret/i;
const sensitiveKeys = [];
const inspect = (value, location) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) sensitiveKeys.push(`${location}.${key}`);
    inspect(child, `${location}.${key}`);
  }
};
inspect(runtimeConfig, 'config');
if (sensitiveKeys.length) throw new Error(`Runtime config contains sensitive keys: ${sensitiveKeys.join(', ')}`);

const operations = fs.readFileSync(path.join(root, 'docs/release-operations.md'), 'utf8');
for (const heading of [
  '## Release channels',
  '## Shared automated gate',
  '## Live Matrix interoperability gate',
  '## Physical client gate',
  '## Support and incident response',
]) {
  if (!operations.includes(heading)) throw new Error(`Release runbook is missing section: ${heading}`);
}
if (!operations.includes('Rollback') && !operations.includes('rollback')) {
  throw new Error('Release runbook is missing rollback guidance.');
}

const quality = fs.readFileSync(path.join(root, '.github/workflows/quality.yml'), 'utf8');
if (!quality.includes('npm run release:validate')) throw new Error('Quality workflow does not run the release contract validator.');
if (!quality.includes('actions/upload-artifact@v4')) throw new Error('Quality workflow does not preserve browser evidence artifacts.');

console.log('Release contract passed: runtime config is public-only, runbook sections exist, and CI wiring is present.');
