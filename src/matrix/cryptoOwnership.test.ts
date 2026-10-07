import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireCryptoOwnership, type CryptoOwnership } from './cryptoOwnership';

const owners: CryptoOwnership[] = [];
afterEach(async () => { await Promise.all(owners.splice(0).map((owner) => owner.release())); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('exclusive crypto ownership', () => {
  it('never steals from an unresponsive owner after the takeover deadline', async () => {
    vi.useFakeTimers();
    const owner = (await acquireCryptoOwnership('synthetic'))!; owners.push(owner);
    const takeover = acquireCryptoOwnership('synthetic', { takeover: true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await takeover).toBeUndefined();
    expect(await acquireCryptoOwnership('synthetic')).toBeUndefined();
    await owner.release();
    const next = (await acquireCryptoOwnership('synthetic'))!; owners.push(next);
    expect(next).toBeDefined();
  });

  it('cancels pending takeover without releasing the current owner', async () => {
    const owner = (await acquireCryptoOwnership('synthetic'))!; owners.push(owner);
    const abort = new AbortController();
    const takeover = acquireCryptoOwnership('synthetic', { takeover: true, signal: abort.signal });
    abort.abort();
    expect(await takeover).toBeUndefined();
    expect(await acquireCryptoOwnership('synthetic')).toBeUndefined();
  });

  it('supports exclusion and retry when cooperative messaging is unavailable', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const owner = (await acquireCryptoOwnership('synthetic'))!; owners.push(owner);
    expect(await acquireCryptoOwnership('synthetic', { takeover: true })).toBeUndefined();
    await owner.release();
    const next = (await acquireCryptoOwnership('synthetic'))!; owners.push(next);
    expect(next).toBeDefined();
  });
});
