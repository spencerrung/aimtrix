import { describe, expect, it } from 'vitest';
import { connectionIssue, connectionIssueMessage, isSessionRejected } from './sessionRecovery';
import { databaseNames, parseStoredMatrixSession } from './sessionStore';

const stored = {
  baseUrl: 'https://matrix.example.test', serverName: 'example.test',
  userId: '@synthetic:example.test', deviceId: 'SYNTHETIC', accessToken: 'synthetic-token',
};

describe('session recovery records and safe errors', () => {
  it.each(['soft', 'hard'] as const)('round-trips a token-free %s recovery record without changing crypto ownership', (recovery) => {
    const record = parseStoredMatrixSession({ ...stored, accessToken: '', recovery });
    expect(record).toEqual({ ...stored, accessToken: '', recovery });
    expect(databaseNames(record!)).toEqual(databaseNames(stored));
  });

  it('retains distinct previous device identifiers but strips unrelated fields', () => {
    expect(parseStoredMatrixSession({ ...stored, retainedDeviceIds: ['OLDER', 'OLDER'], secret: 'do not retain' }))
      .toEqual({ ...stored, retainedDeviceIds: ['OLDER'] });
  });

  it.each([
    { accessToken: '', recovery: undefined },
    { recovery: 'soft' },
    { recovery: 'unexpected', accessToken: '' },
    { userId: 42 },
    { deviceId: {} },
    { accessToken: [] },
    { retainedDeviceIds: ['valid', 12] },
    { baseUrl: 'https://user:password@matrix.example.test' },
    { baseUrl: 'https://matrix.example.test/?token=synthetic' },
    { baseUrl: 'https://matrix.example.test/#synthetic' },
  ])('rejects malformed or credential-bearing recovery metadata %j', (change) => {
    expect(parseStoredMatrixSession({ ...stored, ...change })).toBeUndefined();
  });

  it.each(['M_UNKNOWN_TOKEN', 'M_MISSING_TOKEN', 'M_USER_DEACTIVATED'])('recognizes rejected sessions: %s', (errcode) => {
    expect(isSessionRejected({ errcode })).toBe(true);
  });

  it.each([null, undefined, 'M_UNKNOWN_TOKEN', { errcode: 'M_FORBIDDEN' }, { httpStatus: 401 }, new TypeError('Network unavailable')])('does not confuse ordinary errors with session rejection: %j', (error) => {
      expect(isSessionRejected(error)).toBe(false);
  });

  it('provides fixed actionable error copy without exposing server diagnostics', () => {
    const cases = [
      [{ errcode: 'M_CONSENT_NOT_GIVEN', message: 'private diagnostic' }, 'consent'],
      [{ name: 'QuotaExceededError', message: 'private diagnostic' }, 'storage'],
      [new Error('IndexedDB private diagnostic'), 'storage'],
      [new TypeError('private diagnostic'), 'offline'],
    ] as const;
    for (const [error, issue] of cases) {
      expect(connectionIssue(error)).toBe(issue);
      expect(connectionIssueMessage(issue)).not.toContain('private diagnostic');
      expect(connectionIssueMessage(issue)).toMatch(/try again/i);
    }
  });
});
