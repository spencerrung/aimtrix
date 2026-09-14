import { createClient, Room as SDKRoom, NotificationCountType } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event.js';
import { Thread as SDKThread } from 'matrix-js-sdk/lib/models/thread.js';
import { ThreadHistory, type ThreadHistoryView } from './ThreadHistory';
import { isVisibleTimelineEvent } from './historyEvents';

const roomId = '!thread:test';
const rootId = '$root';
function message(index: number, root = rootId) {
  return new MatrixEvent({ event_id: `$reply-${index}`, room_id: roomId, sender: '@synthetic:test', origin_server_ts: index,
    type: 'm.room.message', content: { msgtype: 'm.text', body: `Synthetic reply ${index}`, 'm.relates_to': { rel_type: 'm.thread', event_id: root } } });
}
function rootEvent() {
  return new MatrixEvent({ event_id: rootId, room_id: roomId, sender: '@synthetic:test', type: 'm.room.message', content: { msgtype: 'm.text', body: 'Synthetic root' } });
}
function fixture(events = Array.from({ length: 350 }, (_, index) => message(index))) {
  const root = rootEvent();
  let membership = 'join';
  const room = {
    roomId, getMyMembership: () => membership, hasPendingEvent: () => false,
    getThread: vi.fn().mockReturnValue(undefined), findEventById: vi.fn().mockReturnValue(undefined), createThread: vi.fn(),
  } as unknown as Room;
  const client = {
    getRoom: vi.fn((id: string) => id === roomId ? room : null),
    fetchRoomEvent: vi.fn().mockResolvedValue(root.event), getEventMapper: vi.fn(() => (raw: MatrixEvent['event']) => new MatrixEvent(raw)),
    fetchRelations: vi.fn(async (_room: string, _root: string, _relation: unknown, _type: unknown, options: { dir?: string; from?: string; limit?: number }) => {
      const position = options.from === undefined ? events.length : Number(options.from);
      const backward = options.dir !== 'f';
      const start = backward ? Math.max(0, position - (options.limit ?? 50)) : position;
      const end = backward ? position : Math.min(events.length, position + (options.limit ?? 50));
      const chunk = events.slice(start, end).map((event) => event.event);
      return { chunk: backward ? chunk.reverse() : chunk, next_batch: backward ? (start > 0 ? String(start) : undefined) : (end < events.length ? String(end) : undefined) };
    }),
    http: { authedRequest: vi.fn().mockResolvedValue({}) },
    paginateEventTimeline: vi.fn(), getThreadTimeline: vi.fn(),
    decryptEventIfNeeded: vi.fn<(event: MatrixEvent) => Promise<void>>().mockResolvedValue(undefined),
    sendReadReceipt: vi.fn(), sendReceipt: vi.fn(), setRoomReadMarkers: vi.fn(),
  };
  let activeClient: MatrixClient | undefined = client as unknown as MatrixClient;
  const views = new Map<string, ThreadHistoryView>();
  const publish = vi.fn();
  const history = new ThreadHistory(() => activeClient, views, publish);
  return { history, room, root, client, views, publish, events,
    ids: () => views.get(rootId)!.events.filter(isVisibleTimelineEvent).map((event) => event.getId()),
    view: () => views.get(rootId)!, state: () => views.get(rootId)!.state,
    leave: () => { membership = 'leave'; }, replaceClient: () => { activeClient = undefined; },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const originalForwardSupport = SDKThread.hasServerSideFwdPaginationSupport;
afterEach(() => { SDKThread.hasServerSideFwdPaginationSupport = originalForwardSupport; });

describe('ThreadHistory', () => {
  it('retrieves an old root and pages 350 replies both ways with a 250-row bound', async () => {
    const test = fixture();
    await test.history.open(roomId, rootId);
    expect(test.client.fetchRoomEvent).toHaveBeenCalledWith(roomId, rootId);
    expect(test.room.createThread).not.toHaveBeenCalled();
    expect(test.view()).toMatchObject({ rootStatus: 'found', root: expect.any(MatrixEvent) });
    for (let page = 0; page < 4; page += 1) await test.history.load(roomId, rootId, 'backward');
    expect(test.ids()).toHaveLength(250);
    expect(test.ids()[0]).toBe('$reply-100');
    await test.history.load(roomId, rootId, 'backward');
    expect(test.ids()[0]).toBe('$reply-50');
    expect(test.ids().at(-1)).toBe('$reply-299');
    expect(test.state()).toMatchObject({ mode: 'history', canLoadOlder: true, canLoadNewer: true });
    await test.history.load(roomId, rootId, 'forward');
    expect(test.ids().at(-1)).toBe('$reply-349');
    expect(test.client.decryptEventIfNeeded).toHaveBeenCalled();
    expect(test.client.paginateEventTimeline).not.toHaveBeenCalled();
    expect(test.client.sendReadReceipt).not.toHaveBeenCalled();
    expect(test.client.sendReceipt).not.toHaveBeenCalled();
    expect(test.client.setRoomReadMarkers).not.toHaveBeenCalled();
  });

  it('freezes historical arrivals, acknowledges cached reopen, and keeps latest metadata current', async () => {
    const test = fixture();
    await test.history.open(roomId, rootId);
    test.history.detach(roomId, rootId, true);
    const saved = test.ids();
    const next = message(350); test.events.push(next); test.history.observe(next, test.room, true);
    expect(test.ids()).toEqual(saved);
    expect(test.view().latestEvent?.getId()).toBe('$reply-350');
    expect(test.state().canLoadNewer).toBe(true);
    test.history.close();
    const previousRevision = test.state().revision;
    await test.history.open(roomId, rootId);
    expect(test.state().revision).toBeGreaterThan(previousRevision);
    expect(test.ids()).toEqual(saved);
    await test.history.latest(roomId, rootId);
    expect(test.ids().at(-1)).toBe('$reply-350');
    expect(test.state().mode).toBe('live');
  });

  it('fills latest through relation-only pages without losing bundled live proof', async () => {
    const test = fixture([message(100)]);
    test.client.fetchRoomEvent.mockResolvedValueOnce({ ...test.root.event, unsigned: { 'm.relations': { 'm.thread': { count: 100, latest_event: message(100).event } } } });
    const reaction = new MatrixEvent({ event_id: '$reaction', room_id: roomId, sender: '@synthetic:test', type: 'm.reaction', content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$reply-100', key: 'x' } } });
    test.client.fetchRelations.mockResolvedValueOnce({ chunk: [reaction.event], next_batch: 'second' })
      .mockResolvedValueOnce({ chunk: Array.from({ length: 50 }, (_, index) => message(51 + index).event).reverse(), next_batch: undefined });
    await test.history.open(roomId, rootId);
    expect(test.ids()).toHaveLength(50);
    expect(test.ids().at(-1)).toBe('$reply-100');
    expect(test.view().latestEvent?.getId()).toBe('$reply-100');
    expect(test.view().events).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ event_id: '$reaction' }) }));
    expect(new Set(test.ids()).size).toBe(test.ids().length);
  });

  it.each(['clear', 'close', 'client', 'leave', 'room'])('ignores a delayed root after %s', async (action) => {
    const test = fixture();
    const held = deferred<MatrixEvent['event']>();
    test.client.fetchRoomEvent.mockReturnValueOnce(held.promise);
    const opening = test.history.open(roomId, rootId);
    await vi.waitFor(() => expect(test.client.fetchRoomEvent).toHaveBeenCalled());
    if (action === 'clear') test.history.clear();
    else if (action === 'close') test.history.close();
    else if (action === 'client') test.replaceClient();
    else if (action === 'leave') test.leave();
    else test.history.roomSelected('!other:test');
    held.resolve(test.root.event); await opening;
    expect(test.room.createThread).not.toHaveBeenCalled();
    expect(test.client.fetchRelations).not.toHaveBeenCalled();
  });

  it('offers a sanitized inaccessible-root state and retries without an implicit read', async () => {
    const test = fixture();
    test.client.fetchRoomEvent.mockRejectedValueOnce(new Error('Synthetic private server detail'));
    await test.history.open(roomId, rootId);
    expect(test.view()).toMatchObject({ rootStatus: 'unavailable', state: { errorDirection: 'latest', loading: undefined } });
    expect(JSON.stringify(test.view())).not.toContain('private server');
    await test.history.open(roomId, rootId);
    expect(test.view().rootStatus).toBe('found');
  });

  it('retains replies beneath removed roots and applies accepted cached-only edits/redactions', async () => {
    const test = fixture([message(1)]);
    await test.history.open(roomId, rootId);
    const edit = new MatrixEvent({ event_id: '$edit', room_id: roomId, sender: '@synthetic:test', type: 'm.room.message', content: {
      msgtype: 'm.text', body: '* Synthetic edited', 'm.new_content': { msgtype: 'm.text', body: 'Synthetic edited' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$reply-1' },
    } });
    test.history.observe(edit, test.room);
    expect(test.view().events[0].getContent().body).toBe('Synthetic edited');
    const redaction = new MatrixEvent({ event_id: '$redaction', room_id: roomId, sender: '@synthetic:test', type: 'm.room.redaction', redacts: rootId, content: {} });
    test.history.observe(redaction, test.room);
    expect(test.view().rootStatus).toBe('removed');
    expect(test.ids()).toEqual(['$reply-1']);
    expect(test.history.hasEvent(roomId, '$reply-1')).toBe(true);
    expect(test.history.hasEvent('!other:test', '$reply-1')).toBe(false);
  });

  it('opens standard reply context independently and rejects foreign targets', async () => {
    SDKThread.hasServerSideFwdPaginationSupport = 2;
    const test = fixture();
    test.client.http.authedRequest.mockResolvedValueOnce({ event: message(900).event });
    await test.history.open(roomId, rootId, '$reply-900');
    expect(test.client.http.authedRequest).toHaveBeenCalledWith('GET', '/rooms/!thread%3Atest/context/%24reply-900', { limit: '0' });
    expect(test.state()).toMatchObject({ mode: 'context', targetEventId: '$reply-900', targetStatus: 'found' });
    test.client.http.authedRequest.mockResolvedValueOnce({ event: message(950, '$another-root').event });
    await test.history.open(roomId, rootId, '$reply-950');
    expect(test.state().targetStatus).toBe('unavailable');
    expect(test.client.getThreadTimeline).not.toHaveBeenCalled();
  });

  it('bounds legacy fallback pagination without SDK unbounded context', async () => {
    SDKThread.hasServerSideFwdPaginationSupport = 0;
    const test = fixture([]);
    let index = 0;
    test.client.fetchRelations.mockImplementation(async () => ({ chunk: [], next_batch: `older-${++index}` }));
    await test.history.open(roomId, rootId, '$missing');
    expect(test.client.fetchRelations).toHaveBeenCalledTimes(10);
    expect(test.state()).toMatchObject({ targetStatus: 'unavailable', loading: undefined });
  });

  it('keeps pages on network failure, stops repeated tokens, and removes departed-room data', async () => {
    const test = fixture([message(50)]);
    test.client.fetchRelations.mockResolvedValue({ chunk: [message(50).event], next_batch: 'stuck' });
    await test.history.open(roomId, rootId);
    await test.history.load(roomId, rootId);
    expect(test.client.fetchRelations.mock.calls.length).toBeLessThanOrEqual(4);
    test.client.fetchRelations.mockRejectedValueOnce(new Error('Private detail'));
    await test.history.load(roomId, rootId);
    expect(test.ids()).toEqual(['$reply-50']);
    expect(test.state()).toMatchObject({ mode: 'history', errorDirection: 'backward', loading: undefined });
    test.leave(); test.history.refresh(test.room);
    expect(test.views.size).toBe(0);
  });

  it('supersedes same-thread targets and retries the exact context after a network failure', async () => {
    SDKThread.hasServerSideFwdPaginationSupport = 2;
    const test = fixture();
    await test.history.open(roomId, rootId);
    const first = deferred<unknown>(); const second = deferred<unknown>();
    test.client.http.authedRequest.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const openingA = test.history.open(roomId, rootId, '$reply-900');
    await vi.waitFor(() => expect(test.client.http.authedRequest).toHaveBeenCalledTimes(1));
    const openingB = test.history.open(roomId, rootId, '$reply-950');
    await vi.waitFor(() => expect(test.client.http.authedRequest).toHaveBeenCalledTimes(2));
    first.resolve({ event: message(900).event }); await openingA;
    expect(test.state()).toMatchObject({ loading: 'context', targetEventId: '$reply-950' });
    second.reject(new Error('Private context failure')); await openingB;
    expect(test.state()).toMatchObject({ errorDirection: 'context', loading: undefined, targetEventId: '$reply-950' });
    test.client.http.authedRequest.mockResolvedValueOnce({ event: message(950).event });
    await test.history.open(roomId, rootId, '$reply-950');
    expect(test.state()).toMatchObject({ targetEventId: '$reply-950', targetStatus: 'found', error: undefined });
  });

  it('marks a missing root unavailable when latest is requested first', async () => {
    const test = fixture();
    test.client.fetchRoomEvent.mockRejectedValueOnce(new Error('Synthetic unavailable'));
    await test.history.latest(roomId, rootId);
    expect(test.view()).toMatchObject({ rootStatus: 'unavailable', state: { loading: undefined, errorDirection: 'latest' } });
  });

  it('preserves real encrypted SDK highlights while fetching an old own reply without constructing SDK threads', async () => {
    const userId = '@self:test';
    const client = createClient({ baseUrl: 'https://matrix.example.test', userId, timelineSupport: true });
    vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    const room = new SDKRoom(roomId, client, userId, { timelineSupport: true });
    client.store.storeRoom(room); room.updateMyMembership('join' as Parameters<typeof room.updateMyMembership>[0]);
    room.currentState.setStateEvents([new MatrixEvent({ type: 'm.room.encryption', room_id: roomId, state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } })]);
    const root = rootEvent(); room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
    const construct = vi.spyOn(room, 'createThread');
    room.setUnreadNotificationCount(NotificationCountType.Total, 3);
    room.setThreadUnreadNotificationCount(rootId, NotificationCountType.Total, 4);
    room.setUnreadNotificationCount(NotificationCountType.Highlight, 1);
    room.setThreadUnreadNotificationCount(rootId, NotificationCountType.Highlight, 2);
    const mainEvents = [...room.getLiveTimeline().getEvents()];
    const encrypted = { ...message(2).event, type: 'm.room.encrypted', content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'synthetic-ciphertext', 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } } };
    const decrypt = vi.spyOn(client, 'decryptEventIfNeeded').mockResolvedValue(undefined);
    const request = vi.spyOn(client.http, 'authedRequest').mockResolvedValue({ chunk: [encrypted, { ...message(1).event, sender: userId }] });
    const views = new Map<string, ThreadHistoryView>();
    const history = new ThreadHistory(() => client, views, vi.fn());
    await history.open(roomId, rootId);
    expect(views.get(rootId)?.events.map((event) => event.getId())).toEqual(['$reply-1', '$reply-2']);
    expect(decrypt).toHaveBeenCalledWith(views.get(rootId)?.events[1]);
    expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
    expect(construct).not.toHaveBeenCalled();
    expect(room.getThread(rootId)).toBeNull();
    expect(room.getLiveTimeline().getEvents()).toEqual(mainEvents);
    expect(room.getRoomUnreadNotificationCount(NotificationCountType.Total)).toBe(3);
    expect(room.getThreadUnreadNotificationCount(rootId, NotificationCountType.Total)).toBe(4);
    expect(room.getRoomUnreadNotificationCount(NotificationCountType.Highlight)).toBe(1);
    expect(room.getThreadUnreadNotificationCount(rootId, NotificationCountType.Highlight)).toBe(2);
    history.clear(); client.stopClient();
  });
  it('does not append older SDK history as the private live tail and accepts proven successors', async () => {
    const test = fixture(Array.from({ length: 500 }, (_, index) => message(index)));
    await test.history.open(roomId, rootId);
    vi.mocked(test.room.getThread).mockReturnValue({ events: test.events } as ReturnType<Room['getThread']>);
    test.history.refresh(test.room);
    expect(test.ids()).toEqual(Array.from({ length: 50 }, (_, index) => `$reply-${450 + index}`));
    test.history.observe(message(1), test.room);
    expect(test.ids().at(-1)).toBe('$reply-499');
    test.events.push(message(500)); test.history.refresh(test.room);
    expect(test.ids().at(-1)).toBe('$reply-500');
    expect(test.view().latestEvent?.getId()).toBe('$reply-500');
  });

  it('bounds disconnected far-context pages and reports a redacted target truthfully', async () => {
    SDKThread.hasServerSideFwdPaginationSupport = 2;
    const test = fixture();
    for (let index = 1000; index < 1045; index += 1) {
      test.client.http.authedRequest.mockResolvedValueOnce({ event: message(index).event });
      await test.history.open(roomId, rootId, `$reply-${index}`);
    }
    const internal = test.history as unknown as { navigation: Map<string, { pages: Set<unknown> }> };
    expect(internal.navigation.get(rootId)!.pages.size).toBeLessThanOrEqual(40);
    const removed = message(2000);
    removed.makeRedacted(new MatrixEvent({ type: 'm.room.redaction', content: {}, event_id: '$redaction' }), test.room);
    test.client.http.authedRequest.mockResolvedValueOnce({ event: removed.event });
    await test.history.open(roomId, rootId, '$reply-2000');
    expect(test.state()).toMatchObject({ targetStatus: 'removed', loading: undefined });
  });

  it('updates a bundled live preview outside the selected historical pages and does not apply older edits', async () => {
    SDKThread.hasServerSideFwdPaginationSupport = 2;
    const test = fixture();
    test.client.fetchRoomEvent.mockResolvedValueOnce({ ...test.root.event, unsigned: { 'm.relations': { 'm.thread': { latest_event: message(1000).event, count: 500 } } } });
    test.client.http.authedRequest.mockResolvedValueOnce({ event: message(900).event });
    await test.history.open(roomId, rootId, '$reply-900');
    expect(test.view().latestEvent?.getId()).toBe('$reply-1000');
    for (const timestamp of [20, 10]) {
      test.history.observe(new MatrixEvent({ event_id: `$edit-${timestamp}`, room_id: roomId, sender: '@synthetic:test', origin_server_ts: timestamp,
        type: 'm.room.message', content: { msgtype: 'm.text', body: '* edited', 'm.new_content': { msgtype: 'm.text', body: `Synthetic edit ${timestamp}` },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$reply-1000' } } }), test.room);
    }
    expect(test.view().latestEvent?.getContent().body).toBe('Synthetic edit 20');
    test.history.observe(new MatrixEvent({ event_id: '$redaction', room_id: roomId, type: 'm.room.redaction', redacts: '$reply-1000', content: {} }), test.room);
    expect(test.view().latestEvent).toBeUndefined();
    expect(test.ids()).toEqual(['$reply-900']);
  });

  it('preserves a proven live arrival during a pending latest fetch', async () => {
    const test = fixture();
    await test.history.open(roomId, rootId);
    const held = deferred<Awaited<ReturnType<typeof test.client.fetchRelations>>>();
    test.client.fetchRelations.mockReturnValueOnce(held.promise);
    const latest = test.history.latest(roomId, rootId);
    test.history.observe(message(350), test.room, true);
    held.resolve({ chunk: [message(349).event], next_batch: undefined });
    await latest;
    expect(test.ids()).toEqual(['$reply-349', '$reply-350']);
    expect(test.view().latestEvent?.getId()).toBe('$reply-350');
  });

  it('redacts all owned instances of a reply and deduplicates count changes', async () => {
    SDKThread.hasServerSideFwdPaginationSupport = 2;
    const test = fixture();
    test.client.fetchRoomEvent.mockResolvedValueOnce({ ...test.root.event, unsigned: { 'm.relations': { 'm.thread': { count: 1200, latest_event: message(900).event } } } });
    test.client.http.authedRequest.mockResolvedValueOnce({ event: message(900).event });
    await test.history.open(roomId, rootId, '$reply-900');
    expect(test.view().latestEvent).not.toBe(test.view().events[0]);
    const redaction = new MatrixEvent({ event_id: '$redaction', room_id: roomId, type: 'm.room.redaction', redacts: '$reply-900', content: {} });
    test.history.observe(redaction, test.room);
    test.history.observe(redaction, test.room);
    expect(test.view().events[0].isRedacted()).toBe(true);
    expect(test.view().latestEvent).toBeUndefined();
    expect(test.view()).toMatchObject({ replyCount: 1199, replyCountIsLowerBound: true });
    expect(test.state().targetStatus).toBe('removed');
  });

});
