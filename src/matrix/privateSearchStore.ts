import type { HistorySearchFilters, HistorySearchHit } from './historySearch';

export interface PrivateSearchScope { userId: string; homeserver: string }
function normalizeScope(scope: PrivateSearchScope): PrivateSearchScope {
  if (!scope.userId) throw new Error('A Matrix account is required.');
  const url = new URL(scope.homeserver);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('A Matrix homeserver is required.');
  return { userId: scope.userId, homeserver: url.href.replace(/\/+$/, '') };
}

const VERSION = 2;
export const MAX_PRIVATE_SEARCH_EVENTS = 5_000;
const MAX_BODY = 2_000;
const ITERATIONS = 310_000;
const verifier = new TextEncoder().encode('aimtrix-private-search-v1');

interface Sealed { iv: Uint8Array; data: ArrayBuffer }
interface Meta { id: 'meta'; version: 1; scope: PrivateSearchScope; salt: Uint8Array; check: Sealed }
interface StoredHit extends Sealed { key: string; roomId: string; eventId: string; timestamp: number; revisionTs?: number }
export interface IndexedHit extends HistorySearchHit { revisionTs?: number }
export interface IndexedRoom { roomId: string; cursor?: string; complete: boolean; indexed: number; skipped: number; oldest?: number; newest?: number; blocked?: boolean }
export interface PrivateSearchStatus { unlocked: boolean; rooms: IndexedRoom[]; total: number; cleanupIssue?: boolean }

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Private search storage failed.'));
});
const transactionDone = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error('Private search storage failed.'));
  tx.onerror = () => reject(tx.error ?? new Error('Private search storage failed.'));
});
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const keyFor = (roomId: string, eventId: string) => `${roomId}\0${eventId}`;

export function privateSearchDatabaseName(scope: PrivateSearchScope): string {
  return `aimtrix.private-search.v1:${encodeURIComponent(JSON.stringify(normalizeScope(scope)))}`;
}

function openDatabase(scope: PrivateSearchScope): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(privateSearchDatabaseName(scope), VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('rooms')) db.createObjectStore('rooms', { keyPath: 'roomId' });
      if (!db.objectStoreNames.contains('superseded')) db.createObjectStore('superseded', { keyPath: 'key' });
    };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error ?? new Error('Private search storage is unavailable.'));
    request.onblocked = () => { blocked = true; reject(new Error('Close other Aimtrix tabs to update private search storage.')); };
  });
}

async function derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (passphrase.length < 12) throw new Error('Use at least 12 characters for the local search passphrase.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function seal(key: CryptoKey, bytes: Uint8Array, associated: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(associated) }, key, bytes as BufferSource);
  return { iv, data };
}
async function unseal(key: CryptoKey, value: Sealed, associated: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: value.iv as BufferSource,
    additionalData: new TextEncoder().encode(associated) }, key, value.data));
}

/** Passphrase stays in memory only. IndexedDB contains authenticated ciphertext and non-secret coverage metadata. */
export class PrivateSearchStore {
  private closed = false;
  private constructor(private readonly db: IDBDatabase, private readonly key: CryptoKey, private readonly scopeKey: string) {}

  public static async unlock(scope: PrivateSearchScope, passphrase: string): Promise<PrivateSearchStore> {
    const normalized = normalizeScope(scope);
    const db = await openDatabase(normalized);
    try {
      const scopeKey = JSON.stringify(normalized);
      const tx = db.transaction('meta', 'readonly');
      const meta = await requestResult(tx.objectStore('meta').get('meta')) as Meta | undefined;
      if (meta) {
        if (meta.version !== 1 || JSON.stringify(meta.scope) !== scopeKey) throw new Error('Private search storage has an unsupported version or account. Clear its site data before reusing it.');
        const key = await derive(passphrase, meta.salt);
        try {
          const clear = await unseal(key, meta.check, scopeKey);
          if (clear.length !== verifier.length || clear.some((value, index) => value !== verifier[index])) throw new Error();
        } catch { throw new Error('Local search passphrase is incorrect or the index is damaged.'); }
        return new PrivateSearchStore(db, key, scopeKey);
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await derive(passphrase, salt);
      const check = await seal(key, verifier, scopeKey);
      const create = db.transaction('meta', 'readwrite');
      create.objectStore('meta').add({ id: 'meta', version: 1, scope: normalized, salt, check } satisfies Meta);
      await transactionDone(create);
      return new PrivateSearchStore(db, key, scopeKey);
    } catch (error) { db.close(); throw error; }
  }

  public close(): void { this.closed = true; this.db.close(); }
  private ensureOpen(): void { if (this.closed) throw new Error('The private search index is locked.'); }

  public async status(): Promise<PrivateSearchStatus> {
    this.ensureOpen();
    const tx = this.db.transaction(['rooms', 'events'], 'readonly');
    const [rooms, events] = await Promise.all([
      requestResult(tx.objectStore('rooms').getAll()) as Promise<IndexedRoom[]>,
      requestResult(tx.objectStore('events').getAll()) as Promise<StoredHit[]>,
    ]);
    return { unlocked: true, rooms: rooms.filter((room) => !room.blocked).map((room) => this.coverage(room, events)), total: events.length };
  }

  public async room(roomId: string): Promise<IndexedRoom | undefined> {
    this.ensureOpen();
    const tx = this.db.transaction(['rooms', 'events'], 'readonly');
    const [room, events] = await Promise.all([
      requestResult(tx.objectStore('rooms').get(roomId)) as Promise<IndexedRoom | undefined>,
      requestResult(tx.objectStore('events').getAll()) as Promise<StoredHit[]>,
    ]);
    return room?.blocked ? undefined : room ? this.coverage(room, events) : undefined;
  }

  private coverage(room: IndexedRoom, events: StoredHit[]): IndexedRoom {
    const times = events.filter((event) => event.roomId === room.roomId).map((event) => event.timestamp);
    return { ...room, indexed: times.length, oldest: times.length ? Math.min(...times) : undefined, newest: times.length ? Math.max(...times) : undefined };
  }

  public async putPage(roomId: string, events: IndexedHit[], progress: IndexedRoom): Promise<IndexedRoom> {
    this.ensureOpen();
    const latest = new Map<string, IndexedHit>();
    for (const event of events) {
      const key = keyFor(event.roomId, event.eventId);
      const prior = latest.get(key);
      if (!prior || (event.revisionTs ?? 0) > (prior.revisionTs ?? 0)) latest.set(key, event);
    }
    const sealed = await Promise.all([...latest.values()].map(async (hit): Promise<StoredHit> => {
      const key = keyFor(hit.roomId, hit.eventId);
      const data = new TextEncoder().encode(JSON.stringify({ senderId: hit.senderId, body: hit.body.slice(0, MAX_BODY), kind: hit.kind }));
      return { key, roomId: hit.roomId, eventId: hit.eventId, timestamp: hit.timestamp, revisionTs: hit.revisionTs,
        ...await seal(this.key, data, `${this.scopeKey}:${key}`) };
    }));
    this.ensureOpen();
    const tx = this.db.transaction(['events', 'rooms', 'superseded'], 'readwrite');
    const done = transactionDone(tx);
    const [existing, superseded, currentRoom] = await Promise.all([
      requestResult(tx.objectStore('events').getAll()) as Promise<StoredHit[]>,
      requestResult(tx.objectStore('superseded').getAll()) as Promise<Array<{ key: string; revisionTs: number; redacted?: boolean }>>,
      requestResult(tx.objectStore('rooms').get(roomId)) as Promise<IndexedRoom | undefined>,
    ]);
    if (currentRoom?.blocked) { tx.abort(); await done; throw new Error('Room access changed. The private index was cleared.'); }
    const current = new Map(existing.map((row) => [row.key, row]));
    const tombstones = new Map(superseded.map((row) => [row.key, row]));
    let capacity = MAX_PRIVATE_SEARCH_EVENTS - current.size;
    for (const item of sealed) {
      const prior = current.get(item.key);
      const tombstone = tombstones.get(item.key);
      if (tombstone?.redacted || tombstone && (!item.revisionTs || item.revisionTs < tombstone.revisionTs)) continue;
      if (prior && (!item.revisionTs || item.revisionTs <= (prior.revisionTs ?? 0))) continue;
      if (!prior && capacity <= 0) continue;
      if (!prior) capacity -= 1;
      tx.objectStore('events').put(item);
      if (item.revisionTs) tx.objectStore('superseded').put({ key: item.key, revisionTs: item.revisionTs });
      current.set(item.key, item);
    }
    const roomTimes = [...current.values()].filter((row) => row.roomId === roomId).map((row) => row.timestamp);
    const next: IndexedRoom = { ...progress, roomId, indexed: roomTimes.length,
      oldest: roomTimes.length ? Math.min(...roomTimes) : undefined,
      newest: roomTimes.length ? Math.max(...roomTimes) : undefined };
    tx.objectStore('rooms').put(next);
    await done;
    return next;
  }

  public async search(filters: HistorySearchFilters, signal?: AbortSignal): Promise<{ hits: HistorySearchHit[]; corrupt: number }> {
    this.ensureOpen();
    const rows = await requestResult(this.db.transaction('events', 'readonly').objectStore('events').getAll()) as StoredHit[];
    const term = filters.term.trim().toLowerCase();
    const hits: HistorySearchHit[] = [];
    let corrupt = 0;
    for (let index = 0; index < rows.length; index += 1) {
      if (signal?.aborted || this.closed) throw new DOMException('Search cancelled.', 'AbortError');
      const row = rows[index];
      if (filters.roomId && row.roomId !== filters.roomId || filters.after && row.timestamp < filters.after || filters.before && row.timestamp > filters.before) continue;
      try {
        const clear = JSON.parse(new TextDecoder().decode(await unseal(this.key, row, `${this.scopeKey}:${row.key}`))) as { senderId: string; body: string; kind: HistorySearchHit['kind'] };
        if (filters.senderId && clear.senderId !== filters.senderId || filters.kind === 'media' && clear.kind !== 'media' || filters.kind === 'links' && clear.kind !== 'link') continue;
        if (term && clear.body.toLowerCase().includes(term)) hits.push({ roomId: row.roomId, eventId: row.eventId, timestamp: row.timestamp, ...clear });
      } catch { corrupt += 1; }
      if (index % 50 === 0) await delay();
    }
    return { hits: hits.sort((a, b) => b.timestamp - a.timestamp), corrupt };
  }

  public async remove(roomId: string, eventId: string): Promise<void> {
    this.ensureOpen();
    const key = keyFor(roomId, eventId);
    const tx = this.db.transaction(['events', 'superseded'], 'readwrite');
    tx.objectStore('events').delete(key);
    tx.objectStore('superseded').put({ key, revisionTs: Number.MAX_SAFE_INTEGER, redacted: true });
    await transactionDone(tx);
  }

  public async removeRoom(roomId: string): Promise<void> {
    this.ensureOpen();
    await blockAndClearRoom(this.db, roomId);
  }
}

function blockAndClearRoom(db: IDBDatabase, roomId: string): Promise<void> {
  const tx = db.transaction(['events', 'rooms', 'superseded'], 'readwrite');
  for (const storeName of ['events', 'superseded'] as const) {
    const store = tx.objectStore(storeName);
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      for (const key of keys.result) if (String(key).startsWith(`${roomId}\0`)) store.delete(key);
    };
  }
  tx.objectStore('rooms').put({ roomId, blocked: true, complete: true, indexed: 0, skipped: 0 });
  return transactionDone(tx);
}

export async function deletePrivateSearchDatabase(scope: PrivateSearchScope): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(privateSearchDatabaseName(scope));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Private search data could not be removed. Clear this site data.'));
    request.onblocked = () => reject(new Error('Close other Aimtrix tabs to remove private search data.'));
  });
}

/** Sync redactions and membership loss must prune ciphertext even while the index is locked. */
export async function prunePrivateSearchEvent(scope: PrivateSearchScope, roomId: string, eventId: string): Promise<void> {
  const db = await openDatabase(scope);
  try {
    const key = keyFor(roomId, eventId);
    const tx = db.transaction(['events', 'superseded'], 'readwrite');
    tx.objectStore('events').delete(key);
    tx.objectStore('superseded').put({ key, revisionTs: Number.MAX_SAFE_INTEGER, redacted: true });
    await transactionDone(tx);
  } finally { db.close(); }
}

export async function prunePrivateSearchRoom(scope: PrivateSearchScope, roomId: string): Promise<void> {
  const db = await openDatabase(scope);
  try {
    await blockAndClearRoom(db, roomId);
  } finally { db.close(); }
}

/** An edit removes stale text immediately and prevents older pages from restoring it. */
export async function markPrivateSearchEdit(scope: PrivateSearchScope, roomId: string, eventId: string, revisionTs: number): Promise<void> {
  const db = await openDatabase(scope);
  try {
    const key = keyFor(roomId, eventId);
    const tx = db.transaction(['events', 'superseded'], 'readwrite');
    const existing = tx.objectStore('superseded').get(key);
    existing.onsuccess = () => {
      const prior = existing.result as { revisionTs?: number; redacted?: boolean } | undefined;
      if (prior?.redacted || (prior?.revisionTs ?? 0) > revisionTs) return;
      tx.objectStore('events').delete(key);
      tx.objectStore('superseded').put({ key, revisionTs });
    };
    await transactionDone(tx);
  } finally { db.close(); }
}

/** A verified rejoin may start a fresh room index after membership-loss cleanup. */
export async function allowPrivateSearchRoom(scope: PrivateSearchScope, roomId: string): Promise<void> {
  const db = await openDatabase(scope);
  try {
    const tx = db.transaction('rooms', 'readwrite');
    const current = tx.objectStore('rooms').get(roomId);
    current.onsuccess = () => { if ((current.result as IndexedRoom | undefined)?.blocked) tx.objectStore('rooms').delete(roomId); };
    await transactionDone(tx);
  } finally { db.close(); }
}
