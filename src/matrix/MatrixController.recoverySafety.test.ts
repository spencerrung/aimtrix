import { describe, expect, it, vi } from 'vitest';
import { encodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key.js';
import { MatrixController } from './MatrixController';
import { defaultRuntimeConfig } from '../config/runtimeConfig';

const key = encodeRecoveryKey(new Uint8Array(32).fill(7))!;
function fixture(matches: boolean, hasStorage = true) {
  const crypto = {
    bootstrapCrossSigning: vi.fn(), loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(),
    checkKeyBackupAndEnable: vi.fn(), restoreKeyBackup: vi.fn(),
    getActiveSessionBackupVersion: vi.fn().mockResolvedValue('1'),
    getKeyBackupInfo: vi.fn().mockResolvedValue({ version: '1' }),
    getCrossSigningStatus: vi.fn().mockResolvedValue({ publicKeysOnDevice: true, privateKeysInSecretStorage: true, privateKeysCachedLocally: { masterKey: false, selfSigningKey: false, userSigningKey: false } }),
  };
  const client = { getCrypto: () => crypto, secretStorage: {
    getKey: vi.fn().mockResolvedValue(hasStorage ? ['key-id', { algorithm: 'm.secret_storage.v1.aes-hmac-sha2' }] : null),
    checkKey: vi.fn().mockResolvedValue(matches), getDefaultKeyId: vi.fn().mockResolvedValue(hasStorage ? 'key-id' : null),
  } };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  Object.assign(controller, { client, activeSession: { userId: '@synthetic:test', deviceId: 'DEVICE' } });
  return { controller, client, crypto };
}

describe('recovery safety', () => {
  it('rejects a mismatched key before changing cross-signing or backup state', async () => {
    const { controller, crypto } = fixture(false);
    await expect(controller.restoreRecovery(key)).rejects.toThrow(/does not match/);
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(crypto.loadSessionBackupPrivateKeyFromSecretStorage).not.toHaveBeenCalled();
    expect(crypto.checkKeyBackupAndEnable).not.toHaveBeenCalled();
  });

  it('does not bootstrap a new identity when existing recovery storage is absent', async () => {
    const { controller, crypto } = fixture(false, false);
    await expect(controller.restoreRecovery(key)).rejects.toThrow(/no existing recovery storage/);
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it('refuses setup when recovery storage already exists', async () => {
    const { controller, crypto } = fixture(true);
    await expect(controller.setupRecovery('long synthetic passphrase', '')).rejects.toThrow(/already exists/);
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it('refuses to rotate an existing inaccessible cross-signing identity during new recovery setup', async () => {
    const { controller, client, crypto } = fixture(true, false);
    crypto.getKeyBackupInfo.mockResolvedValue(null as never);
    Object.assign(crypto, { isCrossSigningReady: vi.fn().mockResolvedValue(false) });
    await expect(controller.setupRecovery('long synthetic passphrase', '')).rejects.toThrow(/already has an encryption identity/);
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(client.secretStorage.getDefaultKeyId).toHaveBeenCalled();
  });

  it('does not claim recovery when the backup is present but untrusted', async () => {
    const { controller, crypto } = fixture(true);
    crypto.checkKeyBackupAndEnable.mockResolvedValue({ backupInfo: { version: '1' }, trustInfo: { trusted: false, matchesDecryptionKey: true } });
    await expect(controller.restoreRecovery(key)).rejects.toThrow('Recovery restore failed at backup-enable.');
    expect(crypto.restoreKeyBackup).not.toHaveBeenCalled();
  });

  it('restores from an active trusted backup and reports fixed progress stages', async () => {
    const { controller, crypto } = fixture(true);
    const progress = vi.fn();
    crypto.checkKeyBackupAndEnable.mockResolvedValue({ backupInfo: { version: '1' }, trustInfo: { trusted: true, matchesDecryptionKey: true } });
    crypto.restoreKeyBackup.mockResolvedValue({ imported: 2 });
    await expect(controller.restoreRecovery(key, progress)).resolves.toBe(2);
    expect(progress.mock.calls.map(([stage]) => stage)).toEqual(['checking-key', 'restoring-identity', 'loading-backup-key', 'enabling-backup', 'importing-room-keys']);
  });
});
