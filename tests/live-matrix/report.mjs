import { images, invariant } from './stack.mjs';
export const checkNames = new Set([
  'setup', 'disposable-stack', 'application-server', 'isolated-accounts',
  'password-login-three-devices', 'encrypted-room-create-and-join',
  'encrypted-retry-reconnect-and-cancel', 'encrypted-thread-retry',
  'private-read-tracking-and-reminders', 'encrypted-thread-history-and-links',
  'standard-favorites-and-own-device-sync', 'matrix-links-and-navigation-history',
  'encrypted-send-receive-and-latency', 'encrypted-history-and-context', 'authenticated-encrypted-media',
  'encrypted-staged-attachments-and-retry', 'encrypted-thread-attachment',
  'durable-room-thread-drafts-and-reattach', 'formatted-api-peer-interoperability', 'element-ui-formatted-interoperability',
  'shared-backdrop-and-permissions', 'moderation-role-kick-ban-unban',
  'private-dm-backdrop-isolation', 'private-profile-save', 'standard-sso-token-callback',
  'revoked-active-session-and-encrypted-reauthentication', 'revoked-stored-session-recovery',
  'notification-rules-and-own-device-sync', 'home-activity-and-follow-own-device-sync',
  'diagnostic-failure-probe', 'cleanup',
]);
export const failureCategories = ['strict mode violation', 'Timeout', 'not a file input', 'matrix-http-status', 'media-requires-authentication', 'attachment-ciphertext', 'mxc-upload', 'single-thread-reply', 'thread-retry-same-ciphertext-transaction', 'standard-thread-relation', 'single-accepted-attachment', 'attachment-filename-caption', 'attachment-retry-transaction', 'attachment-decryption', 'standard-thread-attachment', 'draft-reattach-required', 'draft-reload-no-send', 'independent-draft-contexts', 'formatted-api-peer-subset', 'formatted-outbound-roundtrip', 'element-login', 'element-timeline', 'element-formatted-send', 'element-login-ui', 'element-room-timeline', 'element-outbound-emphasis', 'element-root-format', 'element-root-quote', 'element-root-list', 'element-return-room', 'element-return-composer', 'element-return-receive', 'element-return-main-event', 'element-return-detached', 'element-return-id-mismatch', 'element-return-strong', 'element-return-emphasis', 'element-return-code', 'element-formatted-subset', 'draft-stage-room', 'draft-stage-thread', 'draft-thread-composer', 'draft-thread-file', 'draft-thread-caption', 'draft-thread-persistence', 'draft-reload-room', 'draft-reload-thread', 'draft-reattach-thread', 'draft-send-reattached', 'draft-receive-reattached', 'draft-cleanup-contexts', 'notification-thread-rule-readback', 'notification-room-rule-readback', 'notification-account-rule-readback', 'notification-own-device-sync', 'notification-keyword-readback', 'home-follow-account-data', 'home-no-passive-receipts', 'home-return-filter', 'other'];
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function makeReport({ revision, platform, run, probe, elementUi, passed, failureStage, checks, metrics }) {
  invariant(checks.every((check) => checkNames.has(check.name)), 'report-check-name');
  invariant(failureStage === null || checkNames.has(failureStage), 'report-stage');
  return {
    schemaVersion: 1, revision: /^[a-f0-9]{40}$/.test(revision) ? revision : 'unknown', images: elementUi === true ? images : { synapse: images.synapse, dex: images.dex },
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
