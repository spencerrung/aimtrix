import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as sdk from 'matrix-js-sdk';
import { MatrixController } from './MatrixController';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { type PrivateSearchStore } from './privateSearchStore';

beforeAll(() => { vi.stubGlobal('crypto', webcrypto); });
const scope = { userId: '@private:test', homeserver: 'https://matrix.test' };
const roomId = '!private:test';
const passphrase = 'a long local passphrase';
function raw(eventId: string, timestamp: number) {
  return { event_id: eventId, room_id: roomId, sender: '@friend:test', origin_server_ts: timestamp,
    type: 'm.room.encrypted', content: { algorithm: 'm.megolm.v1.aes-sha2' } };
}
function fixture(options: { pages?: Array<{ chunk: ReturnType<typeof raw>[]; end?: string }>; live?: sdk.MatrixEvent[]; clear?: Record<string, Record<string, unknown>>; types?: Record<string, string> } = {}) {
  const pages = [...options.pages ?? []];
  const room = { roomId, getMyMembership: vi.fn().mockReturnValue('join'),
    getLiveTimeline: vi.fn().mockReturnValue({ getPaginationToken: () => pages.length ? 'start' : null, getEvents: () => options.live ?? [] }) };
  const client = {
    getRoom: vi.fn().mockReturnValue(room), getRooms: vi.fn().mockReturnValue([room]), getUserId: vi.fn().mockReturnValue(scope.userId),
    isRoomEncrypted: vi.fn().mockReturnValue(true), search: vi.fn(), createMessagesRequest: vi.fn().mockImplementation(async () => pages.shift() ?? { chunk: [], end: undefined }),
    decryptEventIfNeeded: vi.fn().mockImplementation(async (event: sdk.MatrixEvent) => {
      const content = options.clear?.[event.getId() ?? ''];
      if (content) Object.assign(event, { clearEvent: { type: options.types?.[event.getId() ?? ''] ?? 'm.room.message', content } });
    }),
  };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  Object.assign(controller, { client, sdk, activeSession: { userId: scope.userId, baseUrl: scope.homeserver }, snapshot: { status: 'ready' } });
  return { controller, client, room };
}

describe('controller private encrypted history indexing', () => {
  it('backfills independent encrypted pages, counts missing keys and searches without server plaintext', async () => {
    const test = fixture({ pages: [{ chunk: [raw('$older', 1000), raw('$missing', 1100)] }],
      live: [new sdk.MatrixEvent(raw('$recent', 2000))],
      clear: { $older: { msgtype: 'm.text', body: 'synthetic older nebula' }, $recent: { msgtype: 'm.text', body: 'synthetic recent nebula' } } });
    await test.controller.unlockPrivateSearch(passphrase);
    const status = await test.controller.indexEncryptedHistory(roomId, vi.fn());
    expect(status).toMatchObject({ total: 2, rooms: [{ roomId, indexed: 2, skipped: 1, complete: true }] });
    const page = await test.controller.searchHistory({ term: 'nebula', roomId });
    expect(page.privateHits?.map((hit) => hit.eventId)).toEqual(['$recent', '$older']);
    expect(test.client.search).not.toHaveBeenCalled();
    expect(test.client.createMessagesRequest).toHaveBeenCalledWith(roomId, 'start', 50, expect.any(String));
    await test.controller.clearPrivateSearch();
    expect((await test.controller.privateSearchStatus()).unlocked).toBe(false);
  });

  it('removes a room when self membership changes even before the SDK room getter updates', async () => {
    const test = fixture({ live: [new sdk.MatrixEvent(raw('$recent', 2000))], clear: { $recent: { msgtype: 'm.text', body: 'synthetic private body' } } });
    await test.controller.unlockPrivateSearch(passphrase);
    await test.controller.indexEncryptedHistory(roomId, vi.fn());
    expect((await test.controller.privateSearchStatus()).total).toBe(1);
    (test.controller as unknown as { handleMyMembership: (room: unknown, membership: string) => void }).handleMyMembership(test.room, 'leave');
    expect(test.room.getMyMembership()).toBe('join');
    await vi.waitFor(async () => expect((await test.controller.privateSearchStatus()).total).toBe(0));
    await test.controller.clearPrivateSearch();
  });

  it('queues membership cleanup after an in-flight indexed write', async () => {
    const test = fixture({ live: [new sdk.MatrixEvent(raw('$recent', 2000))], clear: { $recent: { msgtype: 'm.text', body: 'synthetic private body' } } });
    await test.controller.unlockPrivateSearch(passphrase);
    const store = (test.controller as unknown as { privateSearch: PrivateSearchStore }).privateSearch;
    const actual = store.putPage.bind(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(store, 'putPage').mockImplementation(async (...args) => { entered(); await gate; return actual(...args); });
    const indexing = test.controller.indexEncryptedHistory(roomId, vi.fn());
    await started;
    (test.controller as unknown as { handleMyMembership: (room: unknown, membership: string) => void }).handleMyMembership(test.room, 'leave');
    release();
    await expect(indexing).rejects.toThrow('room access');
    await vi.waitFor(async () => expect((await test.controller.privateSearchStatus()).total).toBe(0));
    await test.controller.clearPrivateSearch();
  });

  it('uses replacement content for an older edit, not the original stale words', async () => {
    const test = fixture({ pages: [{ chunk: [raw('$edit', 3000), raw('$original', 1000)] }],
      clear: { $edit: { msgtype: 'm.text', body: '* updated', 'm.new_content': { msgtype: 'm.text', body: 'updated synthetic text' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$original' } },
        $original: { msgtype: 'm.text', body: 'outdated synthetic text' } } });
    await test.controller.unlockPrivateSearch(passphrase);
    await test.controller.indexEncryptedHistory(roomId, vi.fn());
    expect((await test.controller.searchHistory({ term: 'updated', roomId })).privateHits?.map((hit) => hit.eventId)).toEqual(['$original']);
    expect((await test.controller.searchHistory({ term: 'outdated', roomId })).privateHits).toEqual([]);
    await test.controller.clearPrivateSearch();
  });

  it('ignores a replacement that targets another sender’s event', async () => {
    const forged = { ...raw('$forged', 3000), sender: '@attacker:test' };
    const test = fixture({ pages: [{ chunk: [forged, raw('$original', 1000)] }],
      clear: { $forged: { msgtype: 'm.text', body: '* forged', 'm.new_content': { msgtype: 'm.text', body: 'forged synthetic text' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$original' } },
        $original: { msgtype: 'm.text', body: 'authentic synthetic text' } } });
    await test.controller.unlockPrivateSearch(passphrase);
    await test.controller.indexEncryptedHistory(roomId, vi.fn());
    expect((await test.controller.searchHistory({ term: 'authentic', roomId })).privateHits?.map((hit) => hit.eventId)).toEqual(['$original']);
    expect((await test.controller.searchHistory({ term: 'forged', roomId })).privateHits).toEqual([]);
    await test.controller.clearPrivateSearch();
  });

  it('ignores a replacement targeting an encrypted non-message event', async () => {
    const test = fixture({ pages: [{ chunk: [raw('$edit', 3000), raw('$state', 1000)] }],
      clear: { $edit: { msgtype: 'm.text', body: '* forged', 'm.new_content': { msgtype: 'm.text', body: 'forged synthetic text' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$state' } },
        $state: { body: 'not a message' } }, types: { $state: 'm.room.topic' } });
    await test.controller.unlockPrivateSearch(passphrase);
    await test.controller.indexEncryptedHistory(roomId, vi.fn());
    expect((await test.controller.searchHistory({ term: 'forged', roomId })).privateHits).toEqual([]);
    await test.controller.clearPrivateSearch();
  });

});
