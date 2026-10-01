import { images, invariant } from './stack.mjs';
export const checkNames = new Set([
  'setup', 'disposable-stack', 'application-server', 'isolated-accounts',
  'password-login-three-devices', 'encrypted-room-create-and-join', 'element-ui-encrypted-room', 'element-ui-encrypted-message',
  'encrypted-retry-reconnect-and-cancel', 'encrypted-thread-retry',
  'private-read-tracking-and-reminders', 'encrypted-thread-history-and-links',
  'standard-favorites-and-own-device-sync', 'matrix-links-and-navigation-history',
  'encrypted-send-receive-and-latency', 'password-two-device-recovery-setup-and-restore', 'encrypted-history-and-context', 'private-encrypted-search-key-availability', 'authenticated-encrypted-media',
  'encrypted-staged-attachments-and-retry', 'encrypted-thread-attachment',
  'encrypted-poll-create', 'encrypted-poll-vote', 'encrypted-poll-end', 'encrypted-location-interop', 'encrypted-voice-interop',
  'element-ui-encrypted-poll', 'element-ui-encrypted-location', 'element-ui-encrypted-voice',
  'durable-room-thread-drafts-and-reattach', 'formatted-api-peer-interoperability', 'element-ui-formatted-interoperability',
  'saved-reference-own-device-and-context', 'shared-pins-and-member-permission', 'old-cross-room-server-search-and-context',
  'shared-backdrop-and-permissions', 'moderation-role-kick-ban-unban',
  'private-dm-backdrop-isolation', 'private-profile-save', 'standard-sso-token-callback',
  'revoked-active-session-and-encrypted-reauthentication', 'revoked-stored-session-recovery',
  'notification-rules-and-own-device-sync', 'home-activity-and-follow-own-device-sync',
  'diagnostic-failure-probe', 'cleanup',
]);
export const failureCategories = ['strict mode violation', 'Timeout', 'not a file input', 'matrix-http-status', 'media-requires-authentication', 'attachment-ciphertext', 'mxc-upload', 'single-thread-reply', 'thread-retry-same-ciphertext-transaction', 'standard-thread-relation', 'single-accepted-attachment', 'attachment-filename-caption', 'attachment-retry-transaction', 'attachment-decryption', 'standard-thread-attachment', 'draft-reattach-required', 'draft-reload-no-send', 'independent-draft-contexts', 'formatted-api-peer-subset', 'formatted-outbound-roundtrip', 'element-login', 'element-timeline', 'element-formatted-send', 'element-login-ui', 'element-room-timeline', 'element-outbound-emphasis', 'element-root-format', 'element-root-quote', 'element-root-list', 'element-return-room', 'element-return-composer', 'element-return-receive', 'element-return-main-event', 'element-return-detached', 'element-return-id-mismatch', 'element-return-strong', 'element-return-emphasis', 'element-return-code', 'element-formatted-subset', 'draft-stage-room', 'draft-stage-thread', 'draft-thread-composer', 'draft-thread-file', 'draft-thread-caption', 'draft-thread-persistence', 'draft-reload-room', 'draft-reload-thread', 'draft-reattach-thread', 'draft-send-reattached', 'draft-receive-reattached', 'draft-cleanup-contexts', 'home-open-thread', 'home-mute-thread', 'home-thread-mute-saved', 'home-follow-thread', 'home-hide-before-follow', 'home-follow-click', 'home-follow-saved', 'home-open-home', 'home-send-activity', 'home-show-mention', 'home-show-thread', 'home-second-follow', 'home-hide-shared', 'home-open-exact', 'home-exact-render', 'home-exact-still-home', 'home-exact-wrong-room', 'home-exact-event-missing', 'home-exact-event-hidden', 'home-return', 'home-cleanup-rooms', 'notification-open-controls', 'notification-mode-all', 'notification-mode-mentions', 'notification-mode-nothing', 'notification-mode-default', 'notification-account-dnd', 'notification-second-device', 'notification-keyword-add-remove', 'notification-health', 'notification-thread-rule-readback', 'notification-room-rule-readback', 'notification-account-rule-readback', 'notification-own-device-sync', 'notification-keyword-readback', 'home-follow-account-data', 'home-no-passive-receipts', 'home-return-filter', 'other'];
failureCategories.push('poll-open-control', 'poll-dialog-input', 'poll-submit', 'poll-render', 'poll-vote-control', 'poll-vote-confirm', 'poll-create-decrypted', 'poll-vote-reconciled', 'poll-end-reconciled', 'location-open-control', 'location-dialog-input', 'location-submit', 'location-render', 'location-decrypted', 'voice-no-premature-upload', 'voice-encrypted-upload', 'voice-decrypted-download');
failureCategories.push('element-encrypted-login', 'element-encrypted-room', 'element-encrypted-composer', 'element-encrypted-fill', 'element-encrypted-send', 'element-encrypted-receive', 'element-encrypted-message', 'element-poll-render', 'element-location-render', 'element-voice-render');
failureCategories.push('element-back-at-login', 'element-left-room-route', 'element-room-not-rendered', 'element-composer-hidden', 'element-room-dialog', 'element-room-no-composer');
failureCategories.push('saved-open-source', 'saved-write', 'saved-own-device', 'saved-exact-context', 'saved-remove-own-device', 'saved-removal-sync', 'saved-access-loss', 'saved-remove-after-leave',
  'pin-source', 'pin-server-state', 'pin-peer-collection', 'pin-member-denied', 'pin-remove-sync',
  'search-create-peer', 'search-old-history', 'search-query', 'search-exact-context');
failureCategories.push('moderation-open-drawer', 'moderation-people-tab', 'moderation-set-role', 'moderation-kick', 'moderation-invite', 'moderation-ban', 'moderation-unban');
failureCategories.push('private-search-keyed-device', 'private-search-keyed-result', 'private-search-no-plaintext-upload', 'private-search-exact-context',
  'private-search-new-device', 'private-search-missing-keys', 'private-search-sending-still-available', 'private-search-delete');
failureCategories.push('recovery-key-generated', 'recovery-key-dismissed', 'recovery-key-cleared');
failureCategories.push('recovery-open-first-settings', 'recovery-setup-control', 'recovery-setup-result', 'recovery-setup-unsupported', 'recovery-setup-failed', 'recovery-setup-pending', 'recovery-open-second-settings', 'recovery-restore-result', 'recovery-restore-failed');
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
