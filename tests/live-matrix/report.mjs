import { images, invariant } from './stack.mjs';
export const checkNames = new Set([
  'setup', 'disposable-stack', 'application-server', 'isolated-accounts',
  'password-login-three-devices', 'encrypted-room-create-and-join', 'element-ui-encrypted-room', 'element-ui-encrypted-message', 'element-ui-incoming-sas-verification', 'element-ui-incoming-qr-verification',
  'first-use-encrypted-direct-conversation',
  'encrypted-retry-reconnect-and-cancel', 'encrypted-thread-retry',
  'private-read-tracking-and-reminders', 'encrypted-thread-history-and-links',
  'standard-favorites-and-own-device-sync', 'matrix-links-and-navigation-history',
  'encrypted-send-receive-and-latency', 'password-two-device-recovery-setup-and-restore', 'incoming-two-device-sas-verification', 'encrypted-history-and-context', 'private-encrypted-search-key-availability', 'withheld-key-guidance-live', 'authenticated-encrypted-media',
  'encrypted-staged-attachments-and-retry', 'encrypted-thread-attachment',
  'encrypted-poll-create', 'encrypted-poll-vote', 'encrypted-poll-end', 'encrypted-location-interop', 'encrypted-voice-interop',
  'element-ui-encrypted-poll', 'element-ui-encrypted-location', 'element-ui-encrypted-voice',
  'durable-room-thread-drafts-and-reattach', 'formatted-api-peer-interoperability', 'element-ui-formatted-interoperability',
  'saved-reference-own-device-and-context', 'shared-pins-and-member-permission', 'old-cross-room-server-search-and-context',
  'shared-backdrop-and-permissions', 'moderation-role-kick-ban-unban',
  'room-access-and-discovery-administration',
  'room-moderator-permission-transition',
  'room-knock-and-upgrade-administration',
  'space-child-parent-and-recommendation-administration',
  'private-dm-backdrop-isolation', 'private-profile-save', 'standard-sso-token-callback', 'standard-sso-recovery-guidance',
  'revoked-active-session-and-encrypted-reauthentication', 'revoked-stored-session-recovery', 'confirmed-recovery-reset-and-key-replacement',
  'notification-rules-and-own-device-sync', 'home-activity-and-follow-own-device-sync',
  'diagnostic-failure-probe', 'cleanup',
  'cache-reload-first-login', 'cache-reload-seed', 'cache-reload-readiness-profile',
  'sustained-sync-setup', 'sustained-sync-delivery',
]);
export const failureCategories = ['strict mode violation', 'Timeout', 'not a file input', 'matrix-http-status', 'media-requires-authentication', 'attachment-ciphertext', 'mxc-upload', 'single-thread-reply', 'thread-retry-same-ciphertext-transaction', 'standard-thread-relation', 'single-accepted-attachment', 'attachment-filename-caption', 'attachment-retry-transaction', 'attachment-decryption', 'standard-thread-attachment', 'draft-reattach-required', 'draft-reload-no-send', 'independent-draft-contexts', 'formatted-api-peer-subset', 'formatted-outbound-roundtrip', 'element-login', 'element-timeline', 'element-formatted-send', 'element-login-ui', 'element-room-timeline', 'element-outbound-emphasis', 'element-root-format', 'element-root-quote', 'element-root-list', 'element-return-room', 'element-return-composer', 'element-return-receive', 'element-return-main-event', 'element-return-detached', 'element-return-id-mismatch', 'element-return-strong', 'element-return-emphasis', 'element-return-code', 'element-formatted-subset', 'draft-stage-room', 'draft-stage-thread', 'draft-thread-composer', 'draft-thread-file', 'draft-thread-caption', 'draft-thread-persistence', 'draft-reload-room', 'draft-reload-thread', 'draft-reattach-thread', 'draft-send-reattached', 'draft-receive-reattached', 'draft-cleanup-contexts', 'home-open-thread', 'home-mute-thread', 'home-thread-mute-saved', 'home-follow-thread', 'home-hide-before-follow', 'home-follow-click', 'home-follow-saved', 'home-open-home', 'home-send-activity', 'home-show-mention', 'home-show-thread', 'home-second-follow', 'home-hide-shared', 'home-open-exact', 'home-exact-render', 'home-exact-still-home', 'home-exact-wrong-room', 'home-exact-event-missing', 'home-exact-event-hidden', 'home-return', 'home-cleanup-rooms', 'notification-open-controls', 'notification-mode-all', 'notification-mode-mentions', 'notification-mode-nothing', 'notification-mode-default', 'notification-account-dnd', 'notification-second-device', 'notification-keyword-add-remove', 'notification-health', 'notification-thread-rule-readback', 'notification-room-rule-readback', 'notification-account-rule-readback', 'notification-own-device-sync', 'notification-keyword-readback', 'home-follow-account-data', 'home-no-passive-receipts', 'home-return-filter', 'other'];
failureCategories.push('poll-open-control', 'poll-dialog-input', 'poll-submit', 'poll-render', 'poll-vote-control', 'poll-vote-confirm', 'poll-create-decrypted', 'poll-vote-reconciled', 'poll-end-reconciled', 'location-open-control', 'location-dialog-input', 'location-submit', 'location-render', 'location-decrypted', 'voice-no-premature-upload', 'voice-encrypted-upload', 'voice-decrypted-download');
failureCategories.push('element-encrypted-login', 'element-encrypted-room', 'element-encrypted-composer', 'element-encrypted-fill', 'element-encrypted-send', 'element-encrypted-receive', 'element-encrypted-message', 'element-poll-render', 'element-location-render', 'element-voice-render');
failureCategories.push('element-back-at-login', 'element-left-room-route', 'element-room-not-rendered', 'element-composer-hidden', 'element-room-dialog', 'element-room-no-composer');
failureCategories.push('element-sas-login', 'element-sas-request', 'element-sas-incoming', 'element-sas-incoming-method', 'element-sas-method', 'element-sas-emoji', 'element-sas-confirm', 'element-sas-complete');
failureCategories.push('element-qr-login', 'element-qr-request', 'element-qr-incoming', 'element-qr-scan-ready', 'element-qr-code', 'element-qr-camera-decode', 'element-qr-confirm', 'element-qr-complete');
failureCategories.push('sso-recovery-create-room', 'sso-recovery-encryption-state', 'sso-recovery-open-room', 'sso-recovery-send-marker', 'sso-recovery-setup', 'sso-recovery-server-backup', 'sso-recovery-second-login', 'sso-recovery-old-event', 'sso-recovery-restore', 'sso-recovery-imported-keys', 'sso-recovery-decrypted-event');
failureCategories.push('withheld-load-old-event', 'withheld-read-ciphertext', 'withheld-send-to-device', 'withheld-actionable-guidance');
failureCategories.push('reset-existing-backup', 'reset-confirmation', 'reset-new-key', 'reset-backup-replaced', 'reset-old-key-rejected', 'reset-new-key-restores');
failureCategories.push('saved-open-source', 'saved-write', 'saved-own-device', 'saved-exact-context', 'saved-remove-own-device', 'saved-removal-sync', 'saved-access-loss', 'saved-remove-after-leave',
  'pin-source', 'pin-server-state', 'pin-peer-collection', 'pin-member-denied', 'pin-remove-sync',
  'search-create-peer', 'search-old-history', 'search-query', 'search-exact-context');
failureCategories.push('moderation-open-drawer', 'moderation-people-tab', 'moderation-set-role', 'moderation-kick', 'moderation-invite', 'moderation-ban', 'moderation-unban');
failureCategories.push('private-search-keyed-device', 'private-search-keyed-result', 'private-search-no-plaintext-upload', 'private-search-exact-context',
  'private-search-new-device', 'private-search-missing-keys', 'private-search-sending-still-available', 'private-search-delete');
failureCategories.push('recovery-key-generated', 'recovery-key-dismissed', 'recovery-key-cleared', 'recovery-old-event-unavailable', 'recovery-old-event-undecryptable', 'recovery-marker-event-id', 'recovery-imported-keys');
failureCategories.push('recovery-open-first-settings', 'recovery-setup-control', 'recovery-setup-result', 'recovery-setup-unsupported', 'recovery-setup-failed', 'recovery-setup-pending', 'recovery-server-backup', 'recovery-server-secret-storage', 'recovery-new-device-history', 'recovery-open-second-settings', 'recovery-restore-result', 'recovery-restore-cross-signing', 'recovery-restore-backup', 'recovery-restore-room-keys', 'recovery-restore-key-mismatch', 'recovery-restore-no-backup', 'recovery-restore-failed', 'recovery-restore-zero-import', 'recovery-restore-unmatched-count', 'recovery-restore-unmatched-success', 'recovery-restore-unmatched-error', 'recovery-restore-pending', 'recovery-restore-pending-identity', 'recovery-restore-pending-backup-key', 'recovery-restore-pending-backup-trust', 'recovery-restore-pending-import', 'recovery-restore-dialog-gone', 'recovery-restore-idle', 'recovery-old-event-restored');
failureCategories.push('verification-new-device', 'verification-distinct-device', 'verification-open-initiator', 'verification-device-row', 'verification-device-refresh', 'verification-button', 'verification-incoming-request', 'verification-emoji', 'verification-matching-emoji', 'verification-completion');
failureCategories.push('sso-recovery-outcome', 'sso-recovery-passphrase-retained', 'sso-recovery-no-key-export', 'sso-recovery-key-generated', 'sso-recovery-distinct-device', 'sso-recovery-key-cleared');
failureCategories.push('cache-reload-timeout');
failureCategories.push('sustained-sync-room', 'sustained-sync-bounded-timeline', 'sustained-sync-duration');
failureCategories.push('first-use-guide', 'first-use-create-direct', 'first-use-standard-direct', 'first-use-encryption-state', 'first-use-opened-room', 'first-use-open-details', 'first-use-peer-membership', 'first-use-encrypted-wire', 'first-use-peer-decryption');
failureCategories.push('admin-open-drawer', 'admin-Who may join', 'admin-Who may see history', 'admin-Guest access', 'admin-member-denied', 'admin-alias-create', 'admin-alias-complete', 'admin-page-health', 'admin-directory-probe', 'admin-directory-selector-missing', 'admin-directory-selector-hidden', 'admin-directory-ui-disabled', 'admin-directory-room-unknown', 'admin-directory-server-unavailable', 'admin-directory-option-missing', 'admin-directory-already-selected', 'admin-directory-modal-open', 'admin-directory-save', 'admin-directory-write-forbidden', 'admin-directory-write-invalid', 'admin-directory-write-rejected', 'admin-directory-close', 'admin-directory-refresh-failed', 'admin-directory-write-not-retained', 'admin-directory-readback', 'admin-directory-private', 'admin-directory-private-modal-open', 'admin-directory-private-save', 'admin-directory-private-write-rejected', 'admin-directory-private-close', 'admin-directory-private-refresh-failed', 'admin-directory-private-write-not-retained', 'admin-directory-private-readback', 'admin-acl', 'admin-alias-remove');
failureCategories.push('moderator-grant', 'moderator-join-rule-threshold', 'moderator-open-controls', 'moderator-change-join-rule', 'moderator-owner-only-denial', 'moderator-demote');
failureCategories.push('space-create-parent', 'space-create-child', 'space-open-parent', 'space-add-room', 'space-add-subspace', 'space-canonical-parent', 'space-remove-subspace', 'space-remove-room', 'space-partial-write-candidate', 'space-partial-write-rollback');
failureCategories.push('upgrade-capabilities', 'upgrade-create-room', 'upgrade-open-room', 'upgrade-enable-knock', 'upgrade-publish-knock', 'upgrade-outsider-knock', 'upgrade-control', 'upgrade-tombstone', 'upgrade-version-readback', 'upgrade-encryption-state', 'upgrade-replacement-membership', 'upgrade-confirmation-close', 'upgrade-replacement-control', 'upgrade-control-lost-after-save', 'upgrade-control-lost-before-save', 'upgrade-open-replacement', 'upgrade-join-failed', 'upgrade-selection-stale', 'upgrade-encrypted-send', 'upgrade-peer-old-room-list', 'upgrade-old-room-guidance', 'upgrade-peer-open-replacement', 'upgrade-peer-join-failed', 'upgrade-restore-daily-room');
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function makeReport({ revision, platform, browserVersion, cpuCount, memoryGiB, run, probe, elementUi, passed, failureStage, checks, metrics }) {
  invariant(checks.every((check) => checkNames.has(check.name)), 'report-check-name');
  invariant(failureStage === null || checkNames.has(failureStage), 'report-stage');
  return {
    schemaVersion: 1, revision: /^[a-f0-9]{40}$/.test(revision) ? revision : 'unknown', images: elementUi === true ? images : { synapse: images.synapse, dex: images.dex },
    platform: ['linux/x64', 'linux/arm64', 'darwin/x64', 'darwin/arm64', 'win32/x64'].includes(platform) ? platform : 'other',
    browser: 'Chromium', browserVersion: /^\d+(?:\.\d+){1,4}$/.test(browserVersion ?? '') ? browserVersion : 'unknown',
    cpuCount: Number.isInteger(cpuCount) && cpuCount > 0 && cpuCount <= 1024 ? cpuCount : 0,
    memoryGiB: Number.isInteger(memoryGiB) && memoryGiB > 0 && memoryGiB <= 65536 ? memoryGiB : 0,
    run: Number.isInteger(run) && run > 0 && run <= 2 ? run : 1,
    probe: probe === true, passed: passed === true, failureStage,
    checks: checks.map(({ name, passed, durationMs, category }) => ({ name, passed: passed === true,
      ...(finite(durationMs) ? { durationMs: Math.round(durationMs) } : {}),
      ...(failureCategories.includes(category) ? { category } : {}),
    })),
    metrics: Object.fromEntries(['sendReceiveMs', 'sharedBackdropMs', 'attachmentInputCount',
      'cacheReloadSeedMs', 'cacheReloadMessages', 'cacheReloadReadyMs', 'cacheReloadSyncResponses', 'cacheReloadReadyWithin90s',
      'sustainedSyncRoomCount', 'sustainedSyncEventCount', 'sustainedSyncDurationMs', 'sustainedSyncP95Ms', 'sustainedSyncMaxMs', 'sustainedSyncResponses', 'sustainedSyncHeapGrowthMiB',
      'communityBeforeDirectoryMs',
    ].filter((key) => finite(metrics[key])).map((key) => [key, Math.round(metrics[key])])),
  };
}
