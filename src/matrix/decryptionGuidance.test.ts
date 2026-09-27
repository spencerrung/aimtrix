import { describe, expect, it } from 'vitest';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api/index.js';
import { decryptionGuidance } from './decryptionGuidance';

describe('decryption guidance', () => {
  it('distinguishes pending, withheld and historical backup failures without leaking event data', () => {
    expect(decryptionGuidance(null)).toBe('Waiting for encryption keys…');
    expect(decryptionGuidance(DecryptionFailureCode.MEGOLM_KEY_WITHHELD_FOR_UNVERIFIED_DEVICE)).toMatch(/Verify this session/);
    expect(decryptionGuidance(DecryptionFailureCode.MEGOLM_KEY_WITHHELD)).toMatch(/sender withheld/);
    expect(decryptionGuidance(DecryptionFailureCode.HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED)).toMatch(/Restore your existing recovery key/);
    expect(decryptionGuidance(DecryptionFailureCode.HISTORICAL_MESSAGE_USER_NOT_JOINED)).toMatch(/predates your room access/);
  });
});
