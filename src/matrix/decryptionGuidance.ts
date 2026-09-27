import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api/index.js';

/** Only public reason codes reach the view model; never expose event content or key material. */
export function decryptionGuidance(reason: DecryptionFailureCode | null): string {
  switch (reason) {
    case DecryptionFailureCode.MEGOLM_KEY_WITHHELD_FOR_UNVERIFIED_DEVICE:
      return 'This device is unverified, so the sender withheld the key. Verify this session with another trusted device, then retry.';
    case DecryptionFailureCode.MEGOLM_KEY_WITHHELD:
      return 'The sender withheld this message key. Ask the sender to check their device trust and resend if appropriate.';
    case DecryptionFailureCode.HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED:
      return 'This older message needs your key backup. Restore your existing recovery key in Matrix and security settings.';
    case DecryptionFailureCode.HISTORICAL_MESSAGE_NO_KEY_BACKUP:
      return 'No key backup was available for this older message. Another trusted device may still have its key.';
    case DecryptionFailureCode.HISTORICAL_MESSAGE_WORKING_BACKUP:
      return 'Checking your key backup for this older message. If it stays unavailable, restore recovery in settings.';
    case DecryptionFailureCode.HISTORICAL_MESSAGE_USER_NOT_JOINED:
      return 'This message predates your room access; its key may not be available to this account.';
    case DecryptionFailureCode.SENDER_IDENTITY_PREVIOUSLY_VERIFIED:
    case DecryptionFailureCode.UNSIGNED_SENDER_DEVICE:
    case DecryptionFailureCode.UNKNOWN_SENDER_DEVICE:
      return 'The sender’s device identity needs review before this message can be trusted. Check device verification.';
    case DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID:
    case DecryptionFailureCode.OLM_UNKNOWN_MESSAGE_INDEX:
      return 'Waiting for this message key. Ask another trusted device to come online or restore your existing recovery key.';
    case DecryptionFailureCode.UNKNOWN_ERROR:
      return 'This encrypted message could not be opened. Check your connection and recovery status, then retry.';
    default:
      return 'Waiting for encryption keys…';
  }
}
