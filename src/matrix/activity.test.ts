import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { ActivityStore, parseThreadFollows, THREAD_FOLLOW_EVENT } from './activity';

const raw = (id: string, root?: string, ts = 1) => ({ event_id: id, room_id: '!room:test', sender: '@other:test', type: 'm.room.message', origin_server_ts: ts,
  content: { msgtype: 'm.text', body: 'Synthetic activity', ...(root ? { 'm.relates_to': { rel_type: 'm.thread', event_id: root } } : {}) } });
function setup() {
  let receipt: { eventId: string; data: { thread_id?: string } } | null = null;
  let ordering: number | null = null;
  let accountData: MatrixEvent | undefined;
  let membership = 'join';
  const getReceipt = vi.fn(() => receipt);
  const context = { getReadReceiptForUserId: getReceipt, getUnfilteredTimelineSet: () => ({ compareEventOrdering: () => ordering }) };
  const room = { ...context, roomId: '!room:test', name: 'Synthetic room', getMyMembership: () => membership,
    getAccountData: () => accountData, getThreads: () => [], getThread: () => context, getMember: () => ({ name: 'Synthetic sender' }) } as unknown as Room;
  const http = vi.fn(async (_method: unknown, path: string): Promise<unknown> => path === '/notifications' ? { notifications: [] } : { chunk: [] });
  const mapper = vi.fn((event) => new MatrixEvent(event));
  const client = { getRooms: () => [room], getRoom: (id: string) => id === room.roomId ? room : null, getUserId: () => '@self:test', getSafeUserId: () => '@self:test',
    http: { authedRequest: http }, getEventMapper: () => mapper, decryptEventIfNeeded: vi.fn(async () => undefined),
    getPushActionsForEvent: () => ({ notify: true, tweaks: {} }), doesServerSupportThread: async () => ({ list: 2 }), fetchRoomEvent: vi.fn(async (_room, id) => raw(id)),
  } as unknown as MatrixClient;
  let current: MatrixClient | undefined = client;
  const changed = vi.fn();
  const store = new ActivityStore(() => current, changed);
  return { store, client, room, http, mapper, changed, getReceipt,
    owner: (next?: MatrixClient) => { current = next; }, receipt: (value: typeof receipt, order: number | null = null) => { receipt = value; ordering = order; },
    membership: (value: string) => { membership = value; }, follows: (threads: Record<string, boolean>) => { accountData = new MatrixEvent({ type: THREAD_FOLLOW_EVENT, content: { version: 1, threads } }); } };
}
const notification = (event: ReturnType<typeof raw>, read = false) => ({ room_id: '!room:test', event, ts: event.origin_server_ts, read, actions: [] });

describe('ActivityStore', () => {
  it('keeps separate thread notification events and paginates without timeline writes', async () => {
    const f = setup();
    f.http.mockResolvedValueOnce({ notifications: [notification(raw('$one', '$root')), notification(raw('$two', '$root', 2))], next_token: 'older' })
      .mockResolvedValueOnce({ notifications: [notification(raw('$three'))] });
    await f.store.loadOlder(); await f.store.loadOlder();
    expect(f.store.snapshot().items.map((item) => item.eventId)).toEqual(['$two', '$one', '$three']);
    expect(f.http.mock.calls[1]).toEqual(['GET', '/notifications', { limit: 30, from: 'older' }]);
    expect(f.store.snapshot().canLoadOlder).toBe(false);
  });
  it('stops cyclic cursors and deduplicates repeated events', async () => {
    const f = setup(); f.http.mockResolvedValue({ notifications: [notification(raw('$one'))], next_token: 'same' });
    await f.store.loadOlder(); await f.store.loadOlder(); await f.store.loadOlder();
    expect(f.http).toHaveBeenCalledTimes(2); expect(f.store.snapshot().items).toHaveLength(1);
  });
  it('retains the cursor and existing rows on safe retry errors', async () => {
    const f = setup(); f.http.mockResolvedValueOnce({ notifications: [notification(raw('$one'))], next_token: 'older' }).mockRejectedValueOnce(new Error('private server details'));
    await f.store.loadOlder(); await f.store.loadOlder();
    expect(f.store.snapshot().error).toBe('Activity could not refresh. Try again.'); expect(f.store.snapshot().items).toHaveLength(1);
    f.http.mockResolvedValueOnce({ notifications: [] }); await f.store.loadOlder(); expect(f.store.snapshot().error).toBeUndefined();
    expect(f.http.mock.calls[2]).toEqual(['GET', '/notifications', { limit: 30, from: 'older' }]);
  });
  it('discards requests completed after logout', async () => {
    const f = setup(); let finish!: (value: unknown) => void; f.http.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = f.store.loadOlder(); f.owner(); finish({ notifications: [notification(raw('$secret'))] }); await pending;
    expect(f.store.snapshot().items).toEqual([]); expect(f.store.snapshot().loading).toBe(false);
  });
  it('rejects wrong-room and non-message notifications and removes departed rooms', async () => {
    const f = setup(); f.http.mockResolvedValueOnce({ notifications: [notification({ ...raw('$wrong'), room_id: '!elsewhere:test' }), notification(raw('$valid'))] });
    await f.store.loadOlder(); expect(f.store.snapshot().items).toHaveLength(1); f.membership('leave'); expect(f.store.snapshot().items).toEqual([]);
  });
  it('treats server notification read flags as advisory and uses real scoped receipts', async () => {
    const f = setup(); f.http.mockResolvedValueOnce({ notifications: [notification(raw('$one', '$root'), true)] }); await f.store.loadOlder();
    expect(f.store.snapshot().items[0].read).toBe('unknown');
    f.receipt({ eventId: '$one', data: { thread_id: 'main' } }); expect(f.store.snapshot().items[0].read).toBe('unknown');
    f.receipt({ eventId: '$one', data: { thread_id: '$root' } }); expect(f.store.snapshot().items[0].read).toBe('read');
    expect(f.getReceipt).toHaveBeenCalledWith('@self:test', true, 'm.read.private');
  });
  it('only reports unread when timeline ordering establishes it', async () => {
    const f = setup(); f.http.mockResolvedValueOnce({ notifications: [notification(raw('$one'))] }); await f.store.loadOlder();
    f.receipt({ eventId: '$other', data: { thread_id: 'main' } }, 1); expect(f.store.snapshot().items[0].read).toBe('unread');
    f.receipt({ eventId: '$other', data: {} }, -1); expect(f.store.snapshot().items[0].read).toBe('read');
    f.receipt({ eventId: '$other', data: {} }); expect(f.store.snapshot().items[0].read).toBe('unknown');
  });
  it('recognizes only owned event objects and clears ownership at account transitions', async () => {
    const f = setup(); f.http.mockResolvedValueOnce({ notifications: [notification(raw('$one'))] }); await f.store.loadOlder();
    const owned = f.mapper.mock.results[0].value as MatrixEvent;
    expect(f.store.owns(owned)).toBe(true); expect(f.store.owns(new MatrixEvent(raw('$one')))).toBe(false);
    f.owner(); expect(f.store.owns(owned)).toBe(false);
  });
  it('exposes undecrypted activity honestly and refreshes after keys arrive', async () => {
    const f = setup(); f.http.mockResolvedValueOnce({ notifications: [notification({ ...raw('$one'), type: 'm.room.encrypted' })] });
    await f.store.loadOlder(); expect(f.store.snapshot().coverage.encryptedPending).toBe(true);
    const event = f.mapper.mock.results[0].value as MatrixEvent;
    vi.spyOn(event, 'getType').mockReturnValue('m.room.message');
    vi.spyOn(event, 'getContent').mockReturnValue(raw('$one').content);
    f.store.observe(event); expect(f.store.snapshot().items[0].body).toBe('Synthetic activity'); expect(f.store.snapshot().coverage.encryptedPending).toBe(false);
  });
  it('loads participated threads and honors explicit hide preferences', async () => {
    const f = setup(); f.follows({ '$root': false });
    f.http.mockResolvedValueOnce({ chunk: [{ ...raw('$root'), unsigned: { 'm.relations': { 'm.thread': { latest_event: raw('$reply', '$root', 8) } } } }] });
    await f.store.loadMoreThreads(); expect(f.store.snapshot().items).toEqual([]);
    f.follows({ '$root': true }); expect(f.store.snapshot().items[0]).toMatchObject({ eventId: '$reply', threadRootId: '$root', followed: true, participated: true });
  });
  it('loads explicit follows on servers without thread lists', async () => {
    const f = setup(); vi.spyOn(f.client, 'doesServerSupportThread').mockResolvedValue({ threads: 0, list: 0, fwdPagination: 0 }); f.follows({ '$root': true });
    await f.store.loadMoreThreads(); expect(f.client.fetchRoomEvent).toHaveBeenCalledWith('!room:test', '$root');
    expect(f.store.snapshot().coverage.threadsUnsupported).toBe(true); expect(f.store.snapshot().items[0].followed).toBe(true);
  });
  it('serializes follow changes using fresh room account data and publishes confirmed writes', async () => {
    const f = setup(); let server = { version: 1, threads: { '$existing': true } as Record<string, boolean> };
    f.http.mockImplementation(async (method, _path, _query?: unknown, body?: unknown) => { if (method === 'PUT') { server = body as typeof server; return {}; } return server; });
    await Promise.all([f.store.setThreadFollow('!room:test', '$one', true), f.store.setThreadFollow('!room:test', '$two', false)]);
    expect(server.threads).toEqual({ '$existing': true, '$one': true, '$two': false }); expect(f.store.followState('!room:test', '$two')).toBe(false);
    f.follows({ '$two': true }); expect(f.store.followState('!room:test', '$two')).toBe(true);
  });
  it('caps notification history without claiming complete coverage', async () => {
    const f = setup(); let page = 0;
    f.http.mockImplementation(async () => ({ notifications: Array.from({ length: 30 }, (_, index) => notification(raw(`$${page * 30 + index}`, undefined, page * 30 + index))), next_token: String(++page) }));
    for (let index = 0; index < 22; index++) await f.store.loadOlder();
    expect(f.http).toHaveBeenCalledTimes(20); expect(f.store.snapshot().items).toHaveLength(500);
    expect(f.store.snapshot().coverage.limited).toBe(true); expect(f.store.snapshot().canLoadOlder).toBe(false);
  });
  it('keeps cached followed threads current on refresh and live replies', async () => {
    const f = setup(); f.follows({ '$root': true }); await f.store.loadMoreThreads();
    f.store.observe(new MatrixEvent(raw('$reply', '$root', 8)), f.room, true);
    expect(f.store.snapshot().items.find((item) => item.kind === 'thread')?.eventId).toBe('$reply');
    await f.store.refresh(); expect(f.client.fetchRoomEvent).toHaveBeenCalledTimes(2);
    expect(f.store.snapshot().items.find((item) => item.kind === 'thread')?.eventId).toBe('$reply');
  });
  it('offers retry when a followed root cannot load', async () => {
    const f = setup(); f.follows({ '$root': true }); vi.mocked(f.client.fetchRoomEvent).mockRejectedValueOnce(new Error('private details'));
    await f.store.loadMoreThreads(); expect(f.store.snapshot().canLoadMoreThreads).toBe(true);
    expect(f.store.snapshot().threadError).toBe('Some followed threads are unavailable.');
    await f.store.loadMoreThreads(); expect(f.store.snapshot().items[0].eventId).toBe('$root');
  });
  it('does not save follow preferences after the owner changes during a read', async () => {
    const f = setup(); let finish!: (value: unknown) => void;
    f.http.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = f.store.setThreadFollow('!room:test', '$root', true);
    await Promise.resolve(); f.owner(); finish({ version: 1, threads: {} });
    await expect(pending).rejects.toThrow('The conversation changed.'); expect(f.http).toHaveBeenCalledTimes(1);
  });
  it('clears silently so shutdown cannot republish the previous session', async () => {
    const f = setup(); f.http.mockResolvedValueOnce({ notifications: [notification(raw('$one'))] }); await f.store.loadOlder();
    f.changed.mockClear(); f.store.clear(); expect(f.changed).not.toHaveBeenCalled(); expect(f.store.snapshot().items).toEqual([]);
  });
  it('keeps failed writes out of preferences and sanitizes server errors', async () => {
    const f = setup(); f.http.mockResolvedValueOnce({ version: 1, threads: {} }).mockRejectedValueOnce(new Error('private failure'));
    await expect(f.store.setThreadFollow('!room:test', '$one', true)).rejects.toThrow('Thread following could not save. Try again.');
    expect(f.store.followState('!room:test', '$one')).toBeUndefined();
  });
});
describe('parseThreadFollows', () => {
  it('validates version, IDs and booleans, retaining explicit false', () => {
    expect(parseThreadFollows({ version: 1, threads: { '$yes': true, '$no': false, invalid: true, '$bad': 'true' } })).toEqual({ '$yes': true, '$no': false });
    expect(parseThreadFollows({ threads: { '$yes': true } })).toEqual({});
  });
  it('bounds remote preference payloads', () => {
    expect(Object.keys(parseThreadFollows({ version: 1, threads: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`$${index}`, true])) }))).toHaveLength(128);
  });
});
