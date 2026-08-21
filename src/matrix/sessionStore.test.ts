import { describe, expect, it } from 'vitest';
import {
  createBrowserCredentialStore,
  databaseNames,
  type StoredMatrixSession,
} from './sessionStore';

const session: StoredMatrixSession = {
  baseUrl: 'https://matrix.example.com',
  serverName: 'example.com',
  accessToken: 'test-token-not-a-real-secret',
  userId: '@alex:example.com',
  deviceId: 'DEVICE',
};

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
});
