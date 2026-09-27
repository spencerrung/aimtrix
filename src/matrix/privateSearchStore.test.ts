import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PrivateSearchStore, deletePrivateSearchDatabase, markPrivateSearchEdit, privateSearchDatabaseName, prunePrivateSearchEvent, prunePrivateSearchRoom } from './privateSearchStore';

beforeAll(() => { vi.stubGlobal('crypto', webcrypto); });
const scope = { userId: '@one:test', homeserver: 'https://matrix.test/base/' };
const other = { userId: '@two:test', homeserver: 'https://matrix.test/base' };
const passphrase = 'a long local passphrase';
const hit = { roomId: '!room:test', eventId: '$one', senderId: '@friend:test', body: 'private synthetic telescope', timestamp: 12345, kind: 'message' as const };

describe('private encrypted search store', () => {
  it('encrypts content at rest, reopens with the passphrase, and isolates accounts', async () => {
    const store = await PrivateSearchStore.unlock(scope, passphrase);
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 });
    expect(await store.search({ term: 'telescope' })).toMatchObject({ hits: [hit], corrupt: 0 });
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open(privateSearchDatabaseName(scope)); request.onsuccess = () => resolve(request.result); });
    const raw = await new Promise<unknown>((resolve) => { const request = db.transaction('events').objectStore('events').getAll(); request.onsuccess = () => resolve(request.result); });
    expect(JSON.stringify(raw)).not.toContain('telescope');
    db.close(); store.close();
    await expect(PrivateSearchStore.unlock(scope, 'a wrong passphrase')).rejects.toThrow('incorrect');
    const reopened = await PrivateSearchStore.unlock(scope, passphrase);
    expect((await reopened.search({ term: 'telescope' })).hits).toEqual([hit]);
    const isolated = await PrivateSearchStore.unlock(other, passphrase);
    expect((await isolated.search({ term: 'telescope' })).hits).toEqual([]);
    reopened.close(); isolated.close();
    await Promise.all([deletePrivateSearchDatabase(scope), deletePrivateSearchDatabase(other)]);
  });

  it('handles filters, damaged rows, redactions, room loss, and explicit deletion', async () => {
    const store = await PrivateSearchStore.unlock(scope, passphrase);
    await store.putPage(hit.roomId, [hit, { ...hit, eventId: '$two', body: 'another link https://test.invalid', kind: 'link', timestamp: 20000 }],
      { roomId: hit.roomId, complete: false, indexed: 0, skipped: 2 });
    expect((await store.search({ term: 'link', kind: 'links', senderId: hit.senderId, after: 15000 })).hits).toHaveLength(1);
    expect((await store.search({ term: 'link', before: 15000 })).hits).toHaveLength(0);
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open(privateSearchDatabaseName(scope)); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve) => { const tx = db.transaction('events', 'readwrite'); tx.objectStore('events').put({ key: `${hit.roomId}\0$bad`, roomId: hit.roomId, eventId: '$bad', timestamp: 30000, iv: new Uint8Array(12), data: new Uint8Array(3).buffer }); tx.oncomplete = () => resolve(); });
    db.close();
    expect((await store.search({ term: 'link' })).corrupt).toBe(1);
    await store.remove(hit.roomId, '$two');
    expect((await store.search({ term: 'link' })).hits).toHaveLength(0);
    await store.removeRoom(hit.roomId);
    expect((await store.status()).rooms).toEqual([]);
    expect((await store.status()).total).toBe(0);
    store.close(); await deletePrivateSearchDatabase(scope);
    const empty = await PrivateSearchStore.unlock(scope, passphrase);
    expect((await empty.status()).total).toBe(0);
    empty.close(); await deletePrivateSearchDatabase(scope);
  });

  it('rejects a future database schema without overwriting it', async () => {
    const future = { userId: '@future:test', homeserver: 'https://matrix.test' };
    await new Promise<void>((resolve) => { const request = indexedDB.open(privateSearchDatabaseName(future), 3); request.onupgradeneeded = () => request.result.createObjectStore('future'); request.onsuccess = () => { request.result.close(); resolve(); }; });
    await expect(PrivateSearchStore.unlock(future, passphrase)).rejects.toThrow();
    await deletePrivateSearchDatabase(future);
  });

  it('prunes redacted events and lost rooms while the passphrase is locked', async () => {
    const store = await PrivateSearchStore.unlock(scope, passphrase);
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: false, indexed: 0, skipped: 0 });
    store.close();
    await prunePrivateSearchEvent(scope, hit.roomId, hit.eventId);
    let reopened = await PrivateSearchStore.unlock(scope, passphrase);
    expect((await reopened.search({ term: 'telescope' })).hits).toEqual([]);
    await reopened.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: false, indexed: 0, skipped: 0 });
    reopened.close();
    await prunePrivateSearchRoom(scope, hit.roomId);
    reopened = await PrivateSearchStore.unlock(scope, passphrase);
    expect(await reopened.status()).toMatchObject({ rooms: [], total: 0 });
    reopened.close(); await deletePrivateSearchDatabase(scope);
  });

  it('reports storage denial without retaining a partial unlocked index', async () => {
    const original = indexedDB;
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Denied', 'SecurityError'); } });
    await expect(PrivateSearchStore.unlock(scope, passphrase)).rejects.toThrow('Denied');
    vi.stubGlobal('indexedDB', original);
    const store = await PrivateSearchStore.unlock(scope, passphrase);
    expect((await store.status()).total).toBe(0);
    store.close(); await deletePrivateSearchDatabase(scope);
  });

  it('removes edited-away text and refuses to restore it from older pages', async () => {
    let store = await PrivateSearchStore.unlock(scope, passphrase);
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, indexed: 0, skipped: 0, complete: false });
    store.close();
    await markPrivateSearchEdit(scope, hit.roomId, hit.eventId, 20000);
    store = await PrivateSearchStore.unlock(scope, passphrase);
    expect((await store.search({ term: 'telescope' })).hits).toEqual([]);
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, indexed: 0, skipped: 0, complete: false });
    expect((await store.search({ term: 'telescope' })).hits).toEqual([]);
    await store.putPage(hit.roomId, [{ ...hit, body: 'updated synthetic message', timestamp: 20000, revisionTs: 20000 }],
      { roomId: hit.roomId, indexed: 0, skipped: 0, complete: false });
    await markPrivateSearchEdit(scope, hit.roomId, hit.eventId, 10000);
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, indexed: 1, skipped: 0, complete: false });
    expect((await store.search({ term: 'updated' })).hits).toHaveLength(1);
    expect((await store.search({ term: 'telescope' })).hits).toEqual([]);
    store.close(); await deletePrivateSearchDatabase(scope);
  });

  it('rechecks a second tab’s redaction and membership block after encryption', async () => {
    const store = await PrivateSearchStore.unlock(scope, passphrase);
    const originalCrypto = globalThis.crypto;
    const encrypt = webcrypto.subtle.encrypt.bind(webcrypto.subtle);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: {
      encrypt: async (...args: Parameters<SubtleCrypto['encrypt']>) => { entered(); await gate; return Reflect.apply(encrypt, webcrypto.subtle, args) as Promise<ArrayBuffer>; },
    } });
    try {
      const writing = store.putPage(hit.roomId, [hit], { roomId: hit.roomId, indexed: 0, skipped: 0, complete: false });
      await started;
      await prunePrivateSearchEvent(scope, hit.roomId, hit.eventId);
      release(); await writing;
      expect((await store.search({ term: 'telescope' })).hits).toEqual([]);
    } finally { release(); vi.stubGlobal('crypto', originalCrypto); }
    store.close(); await deletePrivateSearchDatabase(scope);

    const again = await PrivateSearchStore.unlock(scope, passphrase);
    const originalAgain = globalThis.crypto;
    let releaseRoom!: () => void;
    let enteredRoom!: () => void;
    const roomGate = new Promise<void>((resolve) => { releaseRoom = resolve; });
    const roomStarted = new Promise<void>((resolve) => { enteredRoom = resolve; });
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: {
      encrypt: async (...args: Parameters<SubtleCrypto['encrypt']>) => { enteredRoom(); await roomGate; return Reflect.apply(encrypt, webcrypto.subtle, args) as Promise<ArrayBuffer>; },
    } });
    try {
      const writing = again.putPage(hit.roomId, [hit], { roomId: hit.roomId, indexed: 0, skipped: 0, complete: false });
      await roomStarted;
      await prunePrivateSearchRoom(scope, hit.roomId);
      releaseRoom();
      await expect(writing).rejects.toThrow();
      expect((await again.status()).total).toBe(0);
    } finally { releaseRoom(); vi.stubGlobal('crypto', originalAgain); }
    again.close(); await deletePrivateSearchDatabase(scope);
  });
});
