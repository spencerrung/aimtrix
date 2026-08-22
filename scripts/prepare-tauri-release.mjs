/* global process, console */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseTag = process.env.RELEASE_TAG ?? '';
const version = releaseTag.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`RELEASE_TAG must be a vMAJOR.MINOR.PATCH tag, received: ${releaseTag || '(empty)'}`);
}

const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
if (!publicKey) throw new Error('TAURI_UPDATER_PUBLIC_KEY is required for a signed desktop release.');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cargoTomlPath = path.join(root, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(root, 'src-tauri', 'Cargo.lock');
const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8').replace(
  /(?<=^version = ")[^"]+(?="$)/m,
  version,
);
fs.writeFileSync(cargoTomlPath, cargoToml);

const cargoLock = fs.readFileSync(cargoLockPath, 'utf8').replace(
  /(name = "aimtrix"\nversion = ")[^"]+("\n)/,
  `$1${version}$2`,
);
fs.writeFileSync(cargoLockPath, cargoLock);

const config = {
  version,
  bundle: {
    createUpdaterArtifacts: true,
    macOS: process.env.APPLE_SIGNING_IDENTITY ? {
      signingIdentity: process.env.APPLE_SIGNING_IDENTITY,
    } : undefined,
    windows: process.env.WINDOWS_CERTIFICATE_THUMBPRINT ? {
      certificateThumbprint: process.env.WINDOWS_CERTIFICATE_THUMBPRINT,
      digestAlgorithm: 'sha256',
      timestampUrl: 'http://timestamp.digicert.com',
    } : undefined,
  },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: ['https://github.com/spencerrung/aimtrix/releases/latest/download/latest.json'],
    },
  },
};

const generatedPath = path.join(root, 'src-tauri', 'tauri.release.generated.json');
fs.writeFileSync(generatedPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Prepared signed Tauri release config for ${version}.`);
