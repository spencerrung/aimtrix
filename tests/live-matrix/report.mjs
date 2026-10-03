import { images, invariant } from './stack.mjs';
export const checkNames = new Set([
  'setup', 'disposable-stack', 'application-server', 'isolated-accounts',
  'password-login-three-devices', 'encrypted-room-create-and-join', 'element-ui-encrypted-room', 'element-ui-encrypted-message', 'element-ui-incoming-sas-verification', 'element-ui-incoming-qr-verification', 'element-ui-aimtrix-declines-verification', 'element-ui-withdraws-verification',
  'first-use-encrypted-direct-conversation',
  'encrypted-retry-reconnect-and-cancel', 'encrypted-thread-retry',
  'private-read-tracking-and-reminders', 'encrypted-thread-history-and-links',
  'standard-favorites-and-own-device-sync', 'matrix-links-and-navigation-history',
  'encrypted-send-receive-and-latency', 'password-two-device-recovery-setup-and-restore', 'incoming-two-device-sas-verification', 'encrypted-history-and-context', 'private-encrypted-search-key-availability', 'withheld-key-guidance-live', 'authenticated-encrypted-media',
  'encrypted-staged-attachments-and-retry', 'encrypted-thread-attachment',
  'encrypted-poll-create', 'encrypted-poll-vote', 'encrypted-poll-pagination', 'encrypted-poll-end', 'encrypted-location-interop', 'encrypted-voice-interop',
  'element-ui-encrypted-poll', 'element-ui-poll-vote', 'element-ui-poll-vote-replaced', 'element-ui-poll-ended', 'element-ui-unencrypted-poll-roundtrip', 'element-ui-encrypted-location', 'element-ui-location-to-aimtrix', 'element-ui-encrypted-voice', 'element-ui-encrypted-voice-playback',
  'durable-room-thread-drafts-and-reattach', 'formatted-api-peer-interoperability', 'element-ui-formatted-interoperability',
  'saved-reference-own-device-and-context', 'shared-pins-and-member-permission', 'old-cross-room-server-search-and-context',
  'shared-backdrop-and-permissions', 'moderation-role-kick-ban-unban',
  'room-access-and-discovery-administration',
  'room-moderator-permission-transition',
  'room-knock-and-upgrade-administration',
  'space-child-parent-and-recommendation-administration',
  'private-dm-backdrop-isolation', 'private-profile-save', 'standard-sso-token-callback', 'standard-sso-recovery-guidance',
  'revoked-active-session-and-encrypted-reauthentication', 'revoked-stored-session-recovery', 'confirmed-recovery-reset-and-key-replacement',
  'encrypted-account-switch-and-local-isolation',
  'notification-rules-and-own-device-sync', 'home-activity-and-follow-own-device-sync',
  'diagnostic-failure-probe', 'cleanup',
  'cache-reload-first-login', 'cache-reload-seed', 'cache-reload-readiness-profile',
  'sustained-sync-setup', 'sustained-sync-delivery',
  'encrypted-sustained-sync-setup', 'encrypted-sustained-sync-delivery',
  'large-account-seed', 'large-account-server-membership', 'large-account-history-seed', 'large-account-initial-sync',
  'large-account-history-navigation', 'large-account-sustained-delivery',
  'delegated-auth-account', 'delegated-auth-discovery', 'delegated-auth-login', 'delegated-auth-account-settings',
  'delegated-auth-recovery-setup', 'delegated-auth-recovery-restore', 'delegated-auth-logout',
]);
export const failureCategories = ['strict mode violation', 'Timeout', 'not a file input', 'matrix-http-status', 'media-requires-authentication', 'attachment-ciphertext', 'mxc-upload', 'single-thread-reply', 'thread-retry-same-ciphertext-transaction', 'standard-thread-relation', 'single-accepted-attachment', 'attachment-filename-caption', 'attachment-retry-transaction', 'attachment-decryption', 'standard-thread-attachment', 'draft-reattach-required', 'draft-reload-no-send', 'independent-draft-contexts', 'formatted-api-peer-subset', 'formatted-outbound-roundtrip', 'element-login', 'element-timeline', 'element-formatted-send', 'element-login-ui', 'element-room-timeline', 'element-outbound-emphasis', 'element-root-format', 'element-root-quote', 'element-root-list', 'element-return-room', 'element-return-composer', 'element-return-receive', 'element-return-main-event', 'element-return-detached', 'element-return-id-mismatch', 'element-return-strong', 'element-return-emphasis', 'element-return-code', 'element-formatted-subset', 'draft-stage-room', 'draft-stage-thread', 'draft-thread-composer', 'draft-thread-file', 'draft-thread-caption', 'draft-thread-persistence', 'draft-reload-room', 'draft-reload-thread', 'draft-reattach-thread', 'draft-send-reattached', 'draft-receive-reattached', 'draft-cleanup-contexts', 'home-open-thread', 'home-mute-thread', 'home-thread-mute-saved', 'home-follow-thread', 'home-hide-before-follow', 'home-follow-click', 'home-follow-saved', 'home-open-home', 'home-send-activity', 'home-show-mention', 'home-show-thread', 'home-second-follow', 'home-hide-shared', 'home-open-exact', 'home-exact-render', 'home-exact-still-home', 'home-exact-wrong-room', 'home-exact-event-missing', 'home-exact-event-hidden', 'home-return', 'home-cleanup-rooms', 'notification-open-controls', 'notification-mode-all', 'notification-mode-mentions', 'notification-mode-nothing', 'notification-mode-default', 'notification-account-dnd', 'notification-second-device', 'notification-keyword-add-remove', 'notification-health', 'notification-thread-rule-readback', 'notification-room-rule-readback', 'notification-account-rule-readback', 'notification-own-device-sync', 'notification-keyword-readback', 'home-follow-account-data', 'home-no-passive-receipts', 'home-return-filter', 'other'];
failureCategories.push('poll-open-control', 'poll-dialog-input', 'poll-submit', 'poll-render', 'poll-vote-control', 'poll-vote-confirm', 'poll-create-decrypted', 'poll-vote-reconciled', 'poll-pagination-root', 'poll-pagination-pages', 'poll-pagination-results', 'poll-end-reconciled', 'location-open-control', 'location-dialog-input', 'location-submit', 'location-render', 'location-decrypted', 'voice-no-premature-upload', 'voice-encrypted-upload', 'voice-decrypted-download');
failureCategories.push('element-encrypted-login', 'element-encrypted-room', 'element-encrypted-composer', 'element-encrypted-fill', 'element-encrypted-send', 'element-encrypted-receive', 'element-encrypted-message', 'element-poll-render', 'element-location-render', 'element-voice-render');
failureCategories.push('element-poll-vote-radio', 'element-poll-vote-enabled', 'element-poll-vote-control', 'element-poll-vote-encrypted', 'element-poll-vote-received', 'element-poll-replacement', 'element-poll-ended');
failureCategories.push('element-location-return-room', 'element-location-open-menu', 'element-location-menu-item', 'element-location-share-menu', 'element-location-pin-option', 'element-location-map', 'element-location-send', 'element-location-open-context', 'element-location-received', 'element-location-return-live', 'plain-poll-room', 'plain-poll-create', 'plain-poll-element-render', 'plain-poll-element-vote', 'plain-poll-aimtrix-count', 'plain-poll-invalid-replacement', 'plain-poll-end', 'plain-poll-late-vote', 'plain-poll-competing-ends');
failureCategories.push('element-voice-worker-ready', 'element-voice-open-event', 'element-voice-tile', 'element-voice-body', 'element-voice-player-ready', 'element-voice-media-error', 'element-voice-player-enabled', 'element-voice-playing', 'element-voice-playback-complete');
failureCategories.push('element-back-at-login', 'element-left-room-route', 'element-room-not-rendered', 'element-composer-hidden', 'element-room-dialog', 'element-room-no-composer');
failureCategories.push('element-sas-login', 'element-sas-request', 'element-sas-incoming', 'element-sas-incoming-method', 'element-sas-method', 'element-sas-emoji', 'element-sas-confirm', 'element-sas-complete');
failureCategories.push('element-qr-login', 'element-qr-request', 'element-qr-incoming', 'element-qr-scan-ready', 'element-qr-code', 'element-qr-camera-frame', 'element-qr-camera-decode', 'element-qr-reciprocate', 'element-qr-confirm', 'element-qr-complete');
failureCategories.push('element-cancel-login', 'element-cancel-request', 'element-cancel-incoming', 'element-cancel-aimtrix-decline', 'element-cancel-peer-notice', 'element-cancel-aimtrix-cleared', 'element-withdraw-login', 'element-withdraw-request', 'element-withdraw-incoming', 'element-withdraw-control', 'element-withdraw-aimtrix-cleared');
failureCategories.push('sso-recovery-create-room', 'sso-recovery-encryption-state', 'sso-recovery-open-room', 'sso-recovery-send-marker', 'sso-recovery-setup', 'sso-recovery-server-backup', 'sso-recovery-second-login', 'sso-recovery-old-event', 'sso-recovery-restore', 'sso-recovery-imported-keys', 'sso-recovery-decrypted-event');
failureCategories.push('withheld-read-ciphertext', 'withheld-post-fresh-event', 'withheld-load-fresh-event', 'withheld-send-to-device', 'withheld-actionable-guidance', 'withheld-generic-guidance', 'withheld-key-pending', 'withheld-unattempted', 'withheld-backup-pending', 'withheld-historical-backup', 'withheld-historical-no-backup', 'withheld-not-joined', 'withheld-sender-trust', 'withheld-unknown-error', 'withheld-event-gone', 'withheld-not-encrypted', 'withheld-other-guidance');
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
failureCategories.push('encrypted-sync-room', 'encrypted-sync-wire', 'encrypted-sync-bounded-timeline', 'encrypted-sync-duration');
failureCategories.push('large-account-room-count', 'large-account-room-created', 'large-account-server-joined-rooms', 'large-account-complete-sync', 'large-account-sync-response', 'large-account-bounded-rows', 'large-account-ready-budget', 'large-account-history-page', 'large-account-bounded-timeline', 'large-account-history-start', 'large-account-sustained-duration');
failureCategories.push('first-use-guide', 'first-use-create-direct', 'first-use-standard-direct', 'first-use-encryption-state', 'first-use-opened-room', 'first-use-open-details', 'first-use-peer-membership', 'first-use-encrypted-wire', 'first-use-peer-decryption');
failureCategories.push('admin-open-drawer', 'admin-Who may join', 'admin-Who may see history', 'admin-Guest access', 'admin-member-denied', 'admin-alias-create', 'admin-alias-complete', 'admin-page-health', 'admin-directory-probe', 'admin-directory-selector-missing', 'admin-directory-selector-hidden', 'admin-directory-ui-disabled', 'admin-directory-room-unknown', 'admin-directory-server-unavailable', 'admin-directory-option-missing', 'admin-directory-already-selected', 'admin-directory-modal-open', 'admin-directory-save', 'admin-directory-write-forbidden', 'admin-directory-write-invalid', 'admin-directory-write-rejected', 'admin-directory-close', 'admin-directory-refresh-failed', 'admin-directory-write-not-retained', 'admin-directory-readback', 'admin-directory-private', 'admin-directory-private-modal-open', 'admin-directory-private-save', 'admin-directory-private-write-rejected', 'admin-directory-private-close', 'admin-directory-private-refresh-failed', 'admin-directory-private-write-not-retained', 'admin-directory-private-readback', 'admin-acl', 'admin-alias-remove');
failureCategories.push('moderator-grant', 'moderator-join-rule-threshold', 'moderator-open-controls', 'moderator-change-join-rule', 'moderator-owner-only-denial', 'moderator-demote');
failureCategories.push('space-create-parent', 'space-create-child', 'space-open-parent', 'space-add-room', 'space-add-subspace', 'space-canonical-parent', 'space-remove-subspace', 'space-remove-room', 'space-partial-write-candidate', 'space-partial-write-rollback');
failureCategories.push('upgrade-capabilities', 'upgrade-create-room', 'upgrade-open-room', 'upgrade-enable-knock', 'upgrade-publish-knock', 'upgrade-outsider-knock', 'upgrade-control', 'upgrade-tombstone', 'upgrade-version-readback', 'upgrade-encryption-state', 'upgrade-replacement-membership', 'upgrade-confirmation-close', 'upgrade-replacement-control', 'upgrade-control-lost-after-save', 'upgrade-control-lost-before-save', 'upgrade-open-replacement', 'upgrade-join-failed', 'upgrade-selection-stale', 'upgrade-encrypted-send', 'upgrade-peer-old-room-list', 'upgrade-old-room-guidance', 'upgrade-peer-open-replacement', 'upgrade-peer-join-failed', 'upgrade-restore-daily-room');
failureCategories.push('delegated-session', 'delegated-callback-cleanup', 'delegated-whoami', 'delegated-metadata', 'delegated-local-cleanup', 'delegated-revocation');
failureCategories.push('delegated-password-control-hidden', 'delegated-deactivation-control-hidden');
failureCategories.push('delegated-recovery-room-created', 'delegated-recovery-room-encrypted', 'delegated-recovery-event-accepted',
  'delegated-recovery-outcome', 'delegated-recovery-passphrase-retained', 'delegated-recovery-no-key-export',
  'delegated-recovery-key-generated', 'delegated-recovery-server-backup', 'delegated-recovery-distinct-device',
  'delegated-recovery-old-event-unavailable', 'delegated-recovery-imported-keys', 'delegated-recovery-key-cleared');
failureCategories.push('delegated-recovery-open-create', 'delegated-recovery-create-form', 'delegated-recovery-room-submit',
  'delegated-recovery-room-response', 'delegated-recovery-session-read', 'delegated-recovery-state-request',
  'delegated-recovery-state-unauthorized', 'delegated-recovery-state-missing', 'delegated-recovery-state-http',
  'delegated-recovery-room-encryption', 'delegated-recovery-room-open', 'delegated-recovery-send',
  'delegated-recovery-settings', 'delegated-recovery-setup-action', 'delegated-recovery-backup',
  'delegated-recovery-dismiss-key', 'delegated-recovery-close-settings');
failureCategories.push('mas-config-invalid', 'mas-compose-start', 'mas-synapse-readiness', 'mas-container-missing',
  'mas-container-exited', 'mas-discovery-404', 'mas-discovery-5xx', 'mas-discovery-unreachable');
failureCategories.push('mas-runtime-permission', 'mas-runtime-database', 'mas-runtime-policy', 'mas-runtime-homeserver',
  'mas-runtime-assets', 'mas-runtime-bind-in-use', 'mas-runtime-bind-unavailable', 'mas-runtime-bind',
  'mas-runtime-config', 'mas-runtime-unknown', 'mas-start-probe-timeout');
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function makeReport({ revision, platform, browserVersion, cpuCount, memoryGiB, run, probe, elementUi, delegatedAuth, passed, failureStage, checks, metrics }) {
  invariant(checks.every((check) => checkNames.has(check.name)), 'report-check-name');
  invariant(failureStage === null || checkNames.has(failureStage), 'report-stage');
  return {
    schemaVersion: 1, revision: /^[a-f0-9]{40}$/.test(revision) ? revision : 'unknown', images: delegatedAuth === true
      ? { synapse: images.synapse, mas: images.mas, postgres: images.postgres }
      : elementUi === true ? { synapse: images.synapse, dex: images.dex, element: images.element } : { synapse: images.synapse, dex: images.dex },
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
      'encryptedSyncRoomCount', 'encryptedSyncEventCount', 'encryptedSyncWireCount', 'encryptedSyncDurationMs', 'encryptedSyncP95Ms', 'encryptedSyncMaxMs', 'encryptedSyncResponses', 'encryptedSyncHeapGrowthMiB',
      'largeAccountRoomCount', 'largeAccountSeededRooms', 'largeAccountSeedMs', 'largeAccountServerJoinedRooms', 'largeAccountHistorySeededEvents', 'largeAccountShellReadyMs', 'largeAccountLastRoomVisibleMs', 'largeAccountDeepRoomReadyMs', 'largeAccountUiRooms', 'largeAccountDeepRoomOpenMs', 'largeAccountRenderedRows', 'largeAccountDomNodes', 'largeAccountSyncResponses', 'largeAccountHeapGrowthMiB', 'largeAccountHistoryPages', 'largeAccountIncrementalEvents', 'largeAccountIncrementalDurationMs', 'largeAccountIncrementalP95Ms', 'largeAccountIncrementalMaxMs', 'largeAccountIncrementalHeapGrowthMiB', 'largeAccountIncrementalHeapAt0MiB', 'largeAccountIncrementalHeapAt100MiB', 'largeAccountIncrementalHeapAt200MiB', 'largeAccountIncrementalHeapAt300MiB', 'largeAccountIncrementalNodesAt0', 'largeAccountIncrementalNodesAt300', 'largeAccountIncrementalListenersAt0', 'largeAccountIncrementalListenersAt300',
      'communityBeforeDirectoryMs',
      'delegatedLoginCompleted', 'delegatedLogoutCompleted', 'delegatedRecoverySupported', 'delegatedRecoveryRestored',
      'delegatedRecoveryStateHttpStatus',
    ].filter((key) => finite(metrics[key])).map((key) => [key, Math.round(metrics[key])])),
  };
}
