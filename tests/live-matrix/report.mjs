import { images, invariant } from './stack.mjs';
export const checkNames = new Set([
  'setup', 'disposable-stack', 'application-server', 'isolated-accounts',
  'password-login-three-devices', 'encrypted-room-create-and-join',
  'encrypted-retry-reconnect-and-cancel', 'encrypted-thread-retry',
  'encrypted-send-receive-and-latency', 'authenticated-encrypted-media',
  'shared-backdrop-and-permissions', 'moderation-role-kick-ban-unban',
  'private-dm-backdrop-isolation', 'private-profile-save', 'standard-sso-token-callback',
  'diagnostic-failure-probe', 'cleanup',
]);
export const failureCategories = ['strict mode violation', 'Timeout', 'not a file input', 'matrix-http-status', 'media-requires-authentication', 'attachment-ciphertext', 'mxc-upload', 'other'];
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function makeReport({ revision, platform, run, probe, passed, failureStage, checks, metrics }) {
  invariant(checks.every((check) => checkNames.has(check.name)), 'report-check-name');
  invariant(failureStage === null || checkNames.has(failureStage), 'report-stage');
  return {
    schemaVersion: 1, revision: /^[a-f0-9]{40}$/.test(revision) ? revision : 'unknown', images,
    platform: ['linux/x64', 'linux/arm64', 'darwin/x64', 'darwin/arm64', 'win32/x64'].includes(platform) ? platform : 'other',
    browser: 'Chromium', run: Number.isInteger(run) && run > 0 && run <= 2 ? run : 1,
    probe: probe === true, passed: passed === true, failureStage,
    checks: checks.map(({ name, passed, durationMs, category }) => ({ name, passed: passed === true,
      ...(finite(durationMs) ? { durationMs: Math.round(durationMs) } : {}),
      ...(failureCategories.includes(category) ? { category } : {}),
    })),
    metrics: Object.fromEntries(['sendReceiveMs', 'sharedBackdropMs', 'attachmentInputCount'].filter((key) => finite(metrics[key])).map((key) => [key, Math.round(metrics[key])])),
  };
}
