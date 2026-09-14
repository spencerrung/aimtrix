import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { MatrixEvent, type IEvent } from 'matrix-js-sdk/lib/models/event.js';
import { createClient, Room as SDKRoom } from 'matrix-js-sdk';
import { EventStatus } from 'matrix-js-sdk/lib/models/event-status.js';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { MatrixController } from './MatrixController';
import type { ThreadHistoryView } from './ThreadHistory';
import { buildWorkspaceSnapshot, type WorkspaceSnapshotCache } from './buildWorkspaceSnapshot';

const roomId = '!thread:test';
const rootId = '$root';
function fixture() {
  const loaded = new Map<string, MatrixEvent>();
  const root = new MatrixEvent({ event_id: rootId, room_id: roomId, sender: '@synthetic:test', type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'Synthetic root' }, unsigned: { 'm.relations': { 'm.thread': { count: 5 } } } });
  const room = {
    roomId, getMyMembership: vi.fn().mockReturnValue('join'), getType: () => undefined,
    hasEncryptionStateEvent: vi.fn().mockReturnValue(true), getEventForTxnId: () => undefined,
    setThreadUnreadNotificationCount: vi.fn(), hasPendingEvent: vi.fn().mockReturnValue(false), findEventById: (id: string) => loaded.get(id), getThread: vi.fn().mockReturnValue(undefined),
  };
  const client = {
    getRoom: vi.fn((id: string) => id === roomId ? room : null), fetchRoomEvent: vi.fn().mockResolvedValue(root.event),
    getEventMapper: () => (raw: MatrixEvent['event']) => new MatrixEvent(raw),
    decryptEventIfNeeded: vi.fn<(event: MatrixEvent) => Promise<void>>().mockResolvedValue(undefined),
    getCrypto: vi.fn().mockReturnValue({}), makeTxnId: () => 'synthetic-transaction',
    sendEvent: vi.fn().mockResolvedValue({ event_id: '$accepted' }), sendMessage: vi.fn(), http: { authedRequest: vi.fn().mockResolvedValue({}) },
  };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const internal = controller as unknown as { client?: MatrixClient; lifecycleRevision: number; sdk: unknown; scheduleWorkspacePublish: () => void; snapshotCache: { threadHistory: Map<string, ThreadHistoryView> } };
  internal.client = client as unknown as MatrixClient;
  internal.sdk = { EventType: { RoomMessage: 'm.room.message' }, MsgType: { Text: 'm.text' } };
  internal.scheduleWorkspacePublish = vi.fn();
  return { controller, internal, client, room, root, loaded };
}

describe('MatrixController thread history integration', () => {
  it('classifies old bundled roots and decrypted replies without moving the main timeline', async () => {
    const test = fixture();
    await expect(test.controller.resolveNavigationTarget({ roomId, eventId: rootId })).resolves.toEqual({ roomId, eventId: rootId, threadRootId: rootId });
    const reply = new MatrixEvent({ event_id: '$reply', room_id: roomId, sender: '@synthetic:test', type: 'm.room.encrypted', content: {} });
    test.loaded.set('$reply', reply);
    test.client.decryptEventIfNeeded.mockImplementation(async (event) => {
      if (event === reply) vi.spyOn(event, 'getOriginalContent').mockReturnValue({ 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } });
    });
    await expect(test.controller.resolveNavigationTarget({ roomId, eventId: '$reply' })).resolves.toEqual({ roomId, eventId: '$reply', threadRootId: rootId });
    expect(test.internal.scheduleWorkspacePublish).not.toHaveBeenCalled();
  });

  it('does not confuse ordinary replies, missing events, or wrong-room responses with thread links', async () => {
    const test = fixture();
    const reply = new MatrixEvent({ event_id: '$reply', room_id: roomId, sender: '@synthetic:test', type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Synthetic reply', 'm.relates_to': { 'm.in_reply_to': { event_id: rootId } } } });
    test.loaded.set('$reply', reply);
    await expect(test.controller.resolveNavigationTarget({ roomId, eventId: '$reply' })).resolves.toEqual({ roomId, eventId: '$reply' });
    test.client.fetchRoomEvent.mockRejectedValueOnce(new Error('Private detail'));
    await expect(test.controller.resolveNavigationTarget({ roomId, eventId: '$missing' })).resolves.toEqual({ roomId, eventId: '$missing' });
    test.client.fetchRoomEvent.mockResolvedValueOnce({ ...test.root.event, room_id: '!other:test' });
    await expect(test.controller.resolveNavigationTarget({ roomId, eventId: rootId })).resolves.toEqual({ roomId, eventId: rootId });
  });

  it.each(['client', 'membership'])('rejects classification when %s changes during decryption', async (change) => {
    const test = fixture();
    test.loaded.set(rootId, test.root);
    test.client.decryptEventIfNeeded.mockImplementation(async () => {
      if (change === 'client') test.internal.client = undefined;
      else test.room.getMyMembership.mockReturnValue('leave');
    });
    await expect(test.controller.resolveNavigationTarget({ roomId, eventId: rootId })).rejects.toThrow('session or conversation changed');
  });

  it('sends plain thread text using the SDK thread overload without quoting or inventing mentions', async () => {
    const test = fixture();
    await test.controller.sendThreadMessage(roomId, rootId, '  Synthetic thread reply  ');
    expect(test.client.sendEvent).toHaveBeenCalledExactlyOnceWith(roomId, rootId, 'm.room.message', { msgtype: 'm.text', body: 'Synthetic thread reply', 'm.relates_to': { rel_type: 'm.thread', event_id: rootId, is_falling_back: true, 'm.in_reply_to': { event_id: rootId } } }, 'synthetic-transaction');
    expect(test.client.sendMessage).not.toHaveBeenCalled();
  });

  it.each(['crypto', 'membership', 'pending-root'])('blocks thread sends with unavailable %s', async (condition) => {
    const test = fixture();
    if (condition === 'crypto') test.client.getCrypto.mockReturnValue(undefined);
    else if (condition === 'membership') test.room.getMyMembership.mockReturnValue('leave');
    else test.room.hasPendingEvent.mockReturnValue(true);
    await expect(test.controller.sendThreadMessage(roomId, rootId, 'Synthetic thread reply')).rejects.toThrow();
    expect(test.client.sendEvent).not.toHaveBeenCalled();
  });

  it('does not mark a bounded historical thread tail as read', async () => {
    const test = fixture();
    test.internal.snapshotCache.threadHistory.set(rootId, {
      roomId, rootId, rootStatus: 'found', root: test.root, events: [],
      state: { mode: 'history', revision: 1, canLoadOlder: true, canLoadNewer: true },
    });
    await expect(test.controller.markThreadRead(roomId, rootId, { eventId: '$historical-reply' })).resolves.toBeUndefined();
    expect(test.client.sendEvent).not.toHaveBeenCalled();
    expect(test.internal.scheduleWorkspacePublish).not.toHaveBeenCalled();
  });

  it('closes active thread work when opening a different room', async () => {
    const test = fixture();
    const internal = test.controller as unknown as { threadHistory: { roomSelected: (id: string) => void }; roomHistory: { open: (id: string) => Promise<void> } };
    const selected = vi.spyOn(internal.threadHistory, 'roomSelected');
    vi.spyOn(internal.roomHistory, 'open').mockResolvedValue(undefined);
    await test.controller.openRoomHistory('!other:test');
    expect(selected).toHaveBeenCalledWith('!other:test');
    expect(test.room as unknown as Room).toBeDefined();
  });
  it('sends a scoped receipt from a cache-only live event and preserves later detached unread state', async () => {
    const test = fixture();
    const reply = new MatrixEvent({ event_id: '$reply', room_id: roomId, sender: '@synthetic:test', type: 'm.room.message', content: { msgtype: 'm.text', body: 'Synthetic reply', 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } } });
    const view: ThreadHistoryView = { roomId, rootId, rootStatus: 'found', root: test.root, events: [reply], latestEvent: reply,
      state: { mode: 'live', revision: 1, canLoadOlder: true, canLoadNewer: false } };
    test.internal.snapshotCache.threadHistory.set(rootId, view);
    let resolve!: (value: object) => void;
    test.client.http.authedRequest.mockReturnValueOnce(new Promise<object>((yes) => { resolve = yes; }));
    const reading = test.controller.markThreadRead(roomId, rootId, { eventId: '$reply' });
    await vi.waitFor(() => expect(test.client.http.authedRequest).toHaveBeenCalled());
    view.state.mode = 'history'; view.latestEvent = new MatrixEvent({ ...reply.event, event_id: '$newer' });
    resolve({}); await reading;
    expect(test.client.http.authedRequest).toHaveBeenCalledWith('POST', '/rooms/!thread%3Atest/receipt/m.read/%24reply', undefined, { thread_id: rootId });
    expect(test.room.setThreadUnreadNotificationCount).not.toHaveBeenCalled();
  });

  it('keeps one accepted retry in the snapshot after SDK ownership while the first relations page is pending', async () => {
    const userId = '@self:test';
    const client = createClient({ baseUrl: 'https://matrix.example.test', userId, timelineSupport: true });
    const room = new SDKRoom(roomId, client, userId, { timelineSupport: true });
    vi.spyOn(client, 'getRoomPushRule').mockReturnValue(undefined);
    vi.spyOn(room, 'getType').mockReturnValue(undefined);
    client.store.storeRoom(room);
    room.updateMyMembership('join' as Parameters<typeof room.updateMyMembership>[0]);
    const root = new MatrixEvent({ event_id: rootId, room_id: roomId, sender: userId, type: 'm.room.message', content: { msgtype: 'm.text', body: 'Synthetic root' } });
    room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
    const reply = new MatrixEvent({ event_id: '~local', room_id: roomId, sender: userId, type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Synthetic retry', 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } } });
    reply.setTxnId('synthetic-retry'); reply.setStatus(EventStatus.NOT_SENT);
    let resolvePage!: (value: Awaited<ReturnType<MatrixClient['fetchRelations']>>) => void;
    const page = new Promise<Awaited<ReturnType<MatrixClient['fetchRelations']>>>((resolve) => { resolvePage = resolve; });
    vi.spyOn(client, 'fetchRelations').mockReturnValue(page);
    vi.spyOn(client, 'decryptEventIfNeeded').mockResolvedValue(undefined);
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    const internal = controller as unknown as {
      client: MatrixClient; sdk: unknown; snapshotCache: WorkspaceSnapshotCache;
      scheduleWorkspacePublish: () => void; handleLocalEcho: (event: MatrixEvent, room: SDKRoom) => void;
    };
    internal.client = client;
    internal.sdk = { EventType: { RoomMessage: 'm.room.message' }, MsgType: { Text: 'm.text' } };
    internal.scheduleWorkspacePublish = vi.fn();
    internal.handleLocalEcho(reply, room);
    const messages = () => buildWorkspaceSnapshot(client, 'online', [], [], internal.snapshotCache).threadsByRoot[rootId].messages;
    const opening = controller.openThreadHistory(roomId, rootId);
    await vi.waitFor(() => expect(client.fetchRelations).toHaveBeenCalled());
    expect(messages()).toEqual([expect.objectContaining({ delivery: 'failed' })]);
    vi.spyOn(client, 'resendEvent').mockImplementation(async () => {
      reply.handleRemoteEcho({ ...reply.event, event_id: '$accepted-retry' });
      // SDK remote echo transfers ownership before emitting LocalEchoUpdated.
      vi.spyOn(room, 'findEventById').mockImplementation((id) => id === rootId ? root : id === reply.getId() ? reply : undefined);
      internal.handleLocalEcho(reply, room);
      return { event_id: reply.getId()! };
    });
    await controller.retryMessage(roomId, reply.getId()!);
    expect(internal.snapshotCache.localEvents.size).toBe(0);
    expect(messages()).toEqual([expect.objectContaining({ id: '$accepted-retry', delivery: 'accepted' })]);
    expect(internal.snapshotCache.threadHistory.get(rootId)?.state.loading).toBe('latest');
    const receipt = vi.spyOn(client.http, 'authedRequest');
    await controller.markThreadRead(roomId, rootId, { eventId: '$accepted-retry' });
    expect(receipt).not.toHaveBeenCalled();
    resolvePage({ chunk: [reply.event as IEvent] });
    await opening;
    expect(messages()).toEqual([expect.objectContaining({ id: '$accepted-retry', delivery: 'accepted' })]);
    expect(internal.snapshotCache.threadHistory.get(rootId)?.state.loading).toBeUndefined();
  });

});
