import { beforeEach, describe, expect, it } from 'vitest';
import {
  accountId,
  createBrowserCredentialStore,
  databaseNames,
  parseStoredMatrixSession,
  tokenFreeRecoverySession,
  type StoredMatrixSession,
} from './sessionStore';

const session: StoredMatrixSession = {
  baseUrl: 'https://matrix.example.com',
  serverName: 'example.com',
  accessToken: 'test-token-not-a-real-secret',
  userId: '@alex:example.com',
  deviceId: 'DEVICE',
};

beforeEach(() => localStorage.clear());

describe('sessionStore', () => {
  it('round-trips a valid session and clears it', () => {
    const credentials = createBrowserCredentialStore();
    return credentials.save(session).then(async () => {
      expect(await credentials.load()).toEqual(session);
      await credentials.clear();
      expect(await credentials.load()).toBeUndefined();
    });
  });

  it('uses isolated deterministic database names', () => {
    expect(databaseNames(session)).toEqual(databaseNames(session));
    expect(databaseNames({ ...session, deviceId: 'OTHER' })).not.toEqual(databaseNames(session));
  });

  it('removes malformed session values', () => {
    localStorage.setItem('aimtrix.matrix-session.v1', '{bad');
    const credentials = createBrowserCredentialStore();
    return credentials.load().then((loaded) => {
      expect(loaded).toBeUndefined();
      expect(localStorage.getItem('aimtrix.matrix-session.v1')).toBeNull();
    });
  });

  it('migrates a legacy account and switches without mixing credentials or deleting the other account', async () => {
    localStorage.setItem('aimtrix.matrix-session.v1', JSON.stringify(session));
    const credentials = createBrowserCredentialStore();
    const other = { ...session, baseUrl: 'https://other.example.com', serverName: 'other.example.com', accessToken: 'synthetic-other-token' };
    expect(await credentials.list()).toEqual([{ id: accountId(session), userId: session.userId,
      homeserver: session.baseUrl, serverName: session.serverName, active: true, recovery: false }]);
    await credentials.select(null);
    expect(await credentials.load()).toBeUndefined();
    await credentials.save(other);
    expect(await credentials.get(accountId(session))).toEqual(session);
    expect(await credentials.load()).toEqual(other);
    await credentials.save({ ...other, accessToken: 'synthetic-rotated-token' });
    expect(await credentials.list()).toHaveLength(2);
    expect(await credentials.select(accountId(session))).toEqual(session);
    expect(await credentials.load()).toEqual(session);
    await credentials.clear();
    expect(await credentials.load()).toBeUndefined();
    expect(await credentials.select(accountId(other))).toMatchObject({ accessToken: 'synthetic-rotated-token' });
    expect(await credentials.list()).toHaveLength(1);
  });

  it('rejects malformed vaults and does not select unknown accounts', async () => {
    const credentials = createBrowserCredentialStore();
    await credentials.save(session);
    await expect(credentials.select('unknown')).rejects.toThrow('Account is unavailable');
    expect(await credentials.load()).toEqual(session);
    localStorage.setItem('aimtrix.matrix-session.v1', JSON.stringify({ kind: 'aimtrix.account-vault.v1',
      active: accountId(session), accounts: [session, session] }));
    expect(await credentials.load()).toBeUndefined();
    expect(localStorage.getItem('aimtrix.matrix-session.v1')).toBeNull();
  });

  it('rejects a seventeenth account without corrupting the saved vault', async () => {
    const credentials = createBrowserCredentialStore();
    for (let index = 0; index < 16; index++) {
      await credentials.save({ ...session, userId: `@synthetic${index}:example.com` });
      expect(await credentials.list()).toHaveLength(index + 1);
    }
    await expect(credentials.save({ ...session, userId: '@synthetic16:example.com' })).rejects.toThrow('maximum of 16');
    expect(await credentials.list()).toHaveLength(16);
    expect(await credentials.load()).toMatchObject({ userId: '@synthetic15:example.com' });
  });

  it('preserves an account vault written by a newer client', async () => {
    const future = JSON.stringify({ kind: 'aimtrix.account-vault.v2', active: accountId(session), accounts: [session] });
    localStorage.setItem('aimtrix.matrix-session.v1', future);
    const credentials = createBrowserCredentialStore();
    await expect(credentials.load()).rejects.toThrow('newer Aimtrix version');
    await expect(credentials.save(session)).rejects.toThrow('newer Aimtrix version');
    expect(localStorage.getItem('aimtrix.matrix-session.v1')).toBe(future);
  });

  it('refuses removal when the device set changes after cleanup locks were selected', async () => {
    const credentials = createBrowserCredentialStore();
    await credentials.save(session);
    await credentials.save({ ...session, deviceId: 'NEW', retainedDeviceIds: [session.deviceId] });
    await expect(credentials.remove(accountId(session), session)).rejects.toThrow('saved account changed');
    expect(await credentials.get(accountId(session))).toMatchObject({ deviceId: 'NEW' });
    await expect(credentials.remove(accountId(session), { ...session, deviceId: 'NEW', retainedDeviceIds: [session.deviceId] })).resolves.toBeDefined();
  });

  it('accepts complete delegated credentials and strips both tokens for recovery', () => {
    const delegated = { ...session, oauth: {
      clientId: 'synthetic-public-client', issuer: 'https://auth.example.com', refreshToken: 'synthetic-refresh-token',
    } };
    expect(parseStoredMatrixSession(delegated)).toEqual(delegated);
    const recovery = tokenFreeRecoverySession(delegated, 'soft');
    expect(recovery).toEqual({ ...session, accessToken: '', recovery: 'soft' });
    expect(parseStoredMatrixSession(recovery)).toEqual(recovery);
    expect(parseStoredMatrixSession({ ...delegated, accessToken: '', recovery: 'soft' })).toBeUndefined();
    expect(parseStoredMatrixSession({ ...delegated, oauth: { ...delegated.oauth, issuer: 'http://remote.example.com' } })).toBeUndefined();
  });
});
