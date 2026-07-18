import { describe, expect, it } from 'vitest';
import {
  clearStoredSession,
  databaseNames,
  loadStoredSession,
  saveStoredSession,
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
    saveStoredSession(session);
    expect(loadStoredSession()).toEqual(session);
    clearStoredSession();
    expect(loadStoredSession()).toBeUndefined();
  });

  it('uses isolated deterministic database names', () => {
    expect(databaseNames(session)).toEqual(databaseNames(session));
    expect(databaseNames({ ...session, deviceId: 'OTHER' })).not.toEqual(databaseNames(session));
  });

  it('removes malformed session values', () => {
    localStorage.setItem('aimtrix.matrix-session.v1', '{bad');
    expect(loadStoredSession()).toBeUndefined();
    expect(localStorage.getItem('aimtrix.matrix-session.v1')).toBeNull();
  });
});
