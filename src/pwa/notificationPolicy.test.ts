import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimNotification, normalizeNotificationPolicy, notificationsPaused, NotificationGuard } from './notificationPolicy';
const at = (hour: number, minute = 0) => new Date(2026, 8, 19, hour, minute).getTime();
const policy = (startMinute: number, endMinute: number) => ({ quietHours: { enabled: true, startMinute, endMinute } });
describe('local notification policy shared with the service worker', () => {
  it('uses start-inclusive/end-exclusive local-time ranges, including midnight', () => {
    expect(notificationsPaused(policy(9 * 60, 17 * 60), at(9))).toBe(true);
    expect(notificationsPaused(policy(9 * 60, 17 * 60), at(17))).toBe(false);
    expect(notificationsPaused(policy(22 * 60, 8 * 60), at(23))).toBe(true);
    expect(notificationsPaused(policy(22 * 60, 8 * 60), at(7, 59))).toBe(true);
    expect(notificationsPaused(policy(22 * 60, 8 * 60), at(8))).toBe(false);
    expect(notificationsPaused(policy(60, 60), at(1))).toBe(false);
  });
  it('expires a temporary pause and rejects malformed schedules', () => {
    expect(notificationsPaused({ pauseUntil: at(12) }, at(11))).toBe(true);
    expect(notificationsPaused({ pauseUntil: at(12) }, at(12))).toBe(false);
    expect(normalizeNotificationPolicy({ pauseUntil: Infinity, quietHours: { enabled: true, startMinute: -1, endMinute: 1500 } })).toMatchObject({ pauseUntil: 0, quietHours: { enabled: false } });
  });
  it('suppresses paused events without consuming them and revokes queued old-owner work', async () => {
    const guard = new NotificationGuard();
    const normal = normalizeNotificationPolicy({});
    guard.setContext({ owner: 'synthetic-owner-001', policy: { ...normal, pauseUntil: Date.now() + 60000 } });
    expect(await guard.accept('$pending')).toBeUndefined();
    guard.setContext({ owner: 'synthetic-owner-001', policy: normal });
    expect(await guard.accept('$pending')).toBe('synthetic-owner-001');
    const old = guard.accept('$later');
    guard.setContext({ owner: 'synthetic-owner-002', policy: normal });
    expect(await old).toBeUndefined();
    guard.clearContext('synthetic-owner-001');
    expect(await guard.accept('$later')).toBe('synthetic-owner-002');
    guard.clearContext('synthetic-owner-002');
    expect(await guard.isCurrent('synthetic-owner-002')).toBe(false);
    expect(await guard.accept('$final')).toBeUndefined();
  });

  it('reports worker metadata failures while keeping the foreground pause active', async () => {
    const implementation = globalThis.aimtrixNotificationPolicy;
    globalThis.aimtrixNotificationPolicy = { ...implementation, transaction: vi.fn().mockRejectedValue(new Error('Synthetic denied storage')) };
    try {
      const guard = new NotificationGuard(true);
      await expect(guard.setContext({ owner: 'synthetic-owner-001', policy: { ...normalizeNotificationPolicy({}), pauseUntil: Date.now() + 60000 } })).rejects.toThrow('Synthetic denied storage');
      expect(await guard.accept('$paused')).toBeUndefined();
    } finally { globalThis.aimtrixNotificationPolicy = implementation; }
  });

  it('bounds identifiers and expires old deduplication entries without storing content', () => {
    const first = claimNotification([], 'owner:$event', 100);
    expect(claimNotification(first.seen, 'owner:$event', 101).accepted).toBe(false);
    expect(claimNotification(first.seen, 'other-owner:$event', 101).accepted).toBe(true);
    expect(claimNotification(first.seen, 'owner:$event', 86400100).accepted).toBe(true);
    let seen = first.seen;
    for (let index = 0; index < 200; index++) seen = claimNotification(seen, `owner:${index}`, 102).seen;
    expect(seen).toHaveLength(128);
  });
});


describe('notification metadata transaction lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never writes a stale owner when a blocked connection succeeds later', async () => {
    const database = { close: vi.fn(), transaction: vi.fn() };
    const request: any = { result: database };
    vi.stubGlobal('indexedDB', { open: vi.fn(() => request) });
    const change = vi.fn(() => ({ state: { owner: 'synthetic-old-owner' }, result: undefined }));
    const pending = globalThis.aimtrixNotificationPolicy.transaction(change);
    const rejected = expect(pending).rejects.toThrow('Notification metadata storage blocked');
    request.onblocked();
    await rejected;
    request.onsuccess();
    expect(database.close).toHaveBeenCalledOnce();
    expect(database.transaction).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });

  it('aborts a late upgrade after an abandoned blocked open', async () => {
    const database = { close: vi.fn(), createObjectStore: vi.fn() };
    const request: any = { result: database, transaction: { abort: vi.fn() } };
    vi.stubGlobal('indexedDB', { open: vi.fn(() => request) });
    const pending = globalThis.aimtrixNotificationPolicy.transaction(() => ({ state: {}, result: undefined }));
    const rejected = expect(pending).rejects.toThrow('Notification metadata storage blocked');
    request.onblocked(); await rejected;
    request.onupgradeneeded();
    expect(request.transaction.abort).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(database.createObjectStore).not.toHaveBeenCalled();
  });

  it.each(['transaction', 'objectStore', 'get'])('rejects and closes after a synchronous %s setup failure', async (stage) => {
    const failure = () => { throw new Error('Synthetic private database diagnostic'); };
    const store = { get: stage === 'get' ? failure : vi.fn() };
    const tx = { objectStore: stage === 'objectStore' ? failure : () => store, abort: vi.fn() };
    const database = { close: vi.fn(), transaction: stage === 'transaction' ? failure : () => tx };
    const request: any = { result: database };
    vi.stubGlobal('indexedDB', { open: vi.fn(() => request) });
    const pending = globalThis.aimtrixNotificationPolicy.transaction(() => ({ state: {}, result: undefined }));
    const rejected = expect(pending).rejects.toThrow('Notification metadata update failed');
    expect(() => request.onsuccess()).not.toThrow();
    await rejected;
    expect(database.close).toHaveBeenCalledOnce();
    if (stage !== 'transaction') expect(tx.abort).toHaveBeenCalledOnce();
  });
});
