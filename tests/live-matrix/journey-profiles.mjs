import assert from 'node:assert/strict';

export const journeyChecks = [
  "isolated-accounts",
  "password-login-three-devices",
  "first-use-encrypted-direct-conversation",
  "encrypted-room-create-and-join",
  "space-child-parent-and-recommendation-administration",
  "room-access-and-discovery-administration",
  "room-moderator-permission-transition",
  "room-knock-and-upgrade-administration",
  "element-ui-encrypted-room",
  "encrypted-send-receive-and-latency",
  "password-two-device-recovery-setup-and-restore",
  "incoming-two-device-sas-verification",
  "element-ui-incoming-sas-verification",
  "element-ui-incoming-qr-verification",
  "element-ui-aimtrix-declines-verification",
  "element-ui-withdraws-verification",
  "element-ui-encrypted-message",
  "encrypted-retry-reconnect-and-cancel",
  "encrypted-thread-retry",
  "private-read-tracking-and-reminders",
  "encrypted-history-and-context",
  "private-encrypted-search-key-availability",
  "withheld-key-guidance-live",
  "standard-favorites-and-own-device-sync",
  "matrix-links-and-navigation-history",
  "encrypted-thread-history-and-links",
  "authenticated-encrypted-media",
  "encrypted-poll-create",
  "element-ui-encrypted-poll",
  "element-ui-poll-vote",
  "encrypted-poll-vote",
  "element-ui-poll-vote-replaced",
  "encrypted-poll-pagination",
  "encrypted-poll-end",
  "element-ui-poll-ended",
  "encrypted-location-interop",
  "element-ui-encrypted-location",
  "element-ui-location-to-aimtrix",
  "encrypted-voice-interop",
  "element-ui-encrypted-voice",
  "element-ui-encrypted-voice-playback",
  "encrypted-staged-attachments-and-retry",
  "encrypted-thread-attachment",
  "durable-room-thread-drafts-and-reattach",
  "formatted-api-peer-interoperability",
  "saved-reference-own-device-and-context",
  "shared-pins-and-member-permission",
  "old-cross-room-server-search-and-context",
  "notification-rules-and-own-device-sync",
  "home-activity-and-follow-own-device-sync",
  "element-ui-unencrypted-poll-roundtrip",
  "element-ui-formatted-interoperability",
  "shared-backdrop-and-permissions",
  "moderation-role-kick-ban-unban",
  "private-dm-backdrop-isolation",
  "private-profile-save",
  "standard-sso-token-callback",
  "standard-sso-recovery-guidance",
  "revoked-active-session-and-encrypted-reauthentication",
  "revoked-stored-session-recovery",
  "confirmed-recovery-reset-and-key-replacement",
  "encrypted-account-switch-and-local-isolation"
];
export const historyChecks = [
  "encrypted-history-and-context",
  "private-encrypted-search-key-availability",
  "withheld-key-guidance-live",
  "matrix-links-and-navigation-history",
  "encrypted-thread-history-and-links"
];
const historySetup = [
  "isolated-accounts",
  "password-login-three-devices",
  "encrypted-room-create-and-join",
  "encrypted-send-receive-and-latency",
  "encrypted-retry-reconnect-and-cancel",
  "encrypted-thread-retry"
];
export function expectedJourneyChecks(profile = 'full', element = false) {
  assert.ok(['full', 'core', 'history'].includes(profile), 'unknown journey profile');
  assert.ok(profile !== 'history' || !element, 'history profile has no Element peer');
  return journeyChecks.filter((name) => {
    if (profile === 'history') return historySetup.includes(name) || historyChecks.includes(name);
    return (element || !name.startsWith('element-ui-')) && (profile !== 'core' || !historyChecks.includes(name));
  });
}
export function assertJourneyCoverage(actual, profile, element) {
  assert.deepEqual(actual, expectedJourneyChecks(profile, element), 'journey coverage mismatch');
}
