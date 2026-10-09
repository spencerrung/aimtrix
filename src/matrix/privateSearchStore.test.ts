import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PrivateSearchStore, allowPrivateSearchRoom, deletePrivateSearchDatabase, markPrivateSearchEdit, privateSearchDatabaseName, prunePrivateSearchEvent, prunePrivateSearchRoom } from './privateSearchStore';

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

  it('restores 1000 joined rooms in one transaction while preserving unrelated indexed data', async () => {
    const store = await PrivateSearchStore.unlock(scope, passphrase);
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 });
    const blockedIds = Array.from({ length: 1000 }, (_, index) => `!blocked-${index}:test`);
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open(privateSearchDatabaseName(scope)); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('rooms', 'readwrite');
      for (const roomId of blockedIds) tx.objectStore('rooms').put({ roomId, blocked: true, indexed: 0, skipped: 0, complete: false });
      tx.oncomplete = () => resolve();
    });
    db.close();
    const opened = vi.spyOn(indexedDB, 'open');
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    try {
      await Promise.all([...blockedIds, blockedIds[0], hit.roomId].map((roomId) => allowPrivateSearchRoom(scope, roomId)));
      expect(opened).toHaveBeenCalledTimes(1);
      expect(transactions).toHaveBeenCalledTimes(1);
      expect(transactions).toHaveBeenCalledWith('rooms', 'readwrite');
    } finally { opened.mockRestore(); transactions.mockRestore(); }
    expect((await store.status()).rooms).toEqual([expect.objectContaining({ roomId: hit.roomId, indexed: 1 })]);
    expect((await store.search({ term: 'telescope' })).hits).toEqual([hit]);
    store.close(); await deletePrivateSearchDatabase(scope);
  });

  it('keeps accounts isolated and preserves leave then rejoin ordering after each batch commits', async () => {
    const store = await PrivateSearchStore.unlock(scope, passphrase);
    const isolated = await PrivateSearchStore.unlock(other, passphrase);
    await Promise.all([prunePrivateSearchRoom(scope, hit.roomId), prunePrivateSearchRoom(other, hit.roomId)]);
    await Promise.all([allowPrivateSearchRoom(scope, hit.roomId), allowPrivateSearchRoom(other, '!different:test')]);
    expect((await store.status()).rooms).toEqual([]);
    await expect(isolated.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 })).rejects.toThrow();
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 });
    await prunePrivateSearchRoom(scope, hit.roomId);
    await expect(store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 })).rejects.toThrow();
    await allowPrivateSearchRoom(scope, hit.roomId);
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 });
    expect((await store.search({ term: 'telescope' })).hits).toEqual([hit]);
    store.close(); isolated.close();
    await Promise.all([deletePrivateSearchDatabase(scope), deletePrivateSearchDatabase(other)]);
  });

  it('rejects every waiter on batch failure and permits a fresh attempt', async () => {
    const failure = new DOMException('Denied', 'SecurityError');
    const opened = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw failure; });
    try {
      const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => allowPrivateSearchRoom(scope, `!room-${index}:test`)));
      expect(opened).toHaveBeenCalledTimes(1);
      expect(results.every((result) => result.status === 'rejected' && result.reason === failure)).toBe(true);
    } finally { opened.mockRestore(); }
    await expect(allowPrivateSearchRoom(scope, hit.roomId)).resolves.toBeUndefined();
    await deletePrivateSearchDatabase(scope);
  });

  it('rejects all callers when a restore transaction aborts without clearing membership blocks', async () => {
    const store = await PrivateSearchStore.unlock(scope, passphrase);
    await prunePrivateSearchRoom(scope, hit.roomId);
    const original = IDBDatabase.prototype.transaction;
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      const tx = original.apply(this, args);
      queueMicrotask(() => tx.abort());
      return tx;
    });
    try {
      const results = await Promise.allSettled([allowPrivateSearchRoom(scope, hit.roomId), allowPrivateSearchRoom(scope, '!second:test')]);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(results.every((result) => result.status === 'rejected')).toBe(true);
    } finally { transaction.mockRestore(); }
    await expect(store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 })).rejects.toThrow();
    await allowPrivateSearchRoom(scope, hit.roomId);
    await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 });
    store.close(); await deletePrivateSearchDatabase(scope);
  });

  it.each([false, true])('does not recreate private search storage when clear follows a restore in the same turn (existing=%s)', async (existing) => {
    const clearing = { userId: '@restore-clear:test', homeserver: 'https://matrix.test' };
    if (existing) {
      const store = await PrivateSearchStore.unlock(clearing, passphrase);
      await store.putPage(hit.roomId, [hit], { roomId: hit.roomId, complete: true, indexed: 0, skipped: 0 });
      store.close();
    }
    await Promise.all([
      allowPrivateSearchRoom(clearing, '!restore:test'),
      deletePrivateSearchDatabase(clearing),
    ]);
    expect((await indexedDB.databases()).some((entry) => entry.name === privateSearchDatabaseName(clearing))).toBe(false);
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
