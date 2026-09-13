import { describe, expect, it, vi } from 'vitest';
import { createClient, MatrixEvent, NotificationCountType, Room } from 'matrix-js-sdk';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts.js';
import { EventStatus } from 'matrix-js-sdk/lib/models/event-status.js';
import { sendConfirmedReceipt } from './sendConfirmedReceipt';

const roomId = '!synthetic:example.test';
const userId = '@self:example.test';

function message(id: string, rootId?: string) {
  return new MatrixEvent({
    event_id: id,
    room_id: roomId,
    sender: '@peer:example.test',
    type: 'm.room.message',
    origin_server_ts: 1000,
    content: {
      msgtype: 'm.text', body: 'Synthetic receipt test message',
      ...(rootId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } } : {}),
    },
  });
}

function fixture() {
  const client = createClient({ baseUrl: 'https://matrix.example.test', userId });
  const room = new Room(roomId, client, userId, { timelineSupport: true });
  client.store.storeRoom(room);
  vi.spyOn(client, 'isInitialSyncComplete').mockReturnValue(true);
  vi.spyOn(client, 'getPushActionsForEvent').mockReturnValue({ notify: true, tweaks: { highlight: true } });
  room.currentState.setStateEvents([new MatrixEvent({
    type: 'm.room.encryption', state_key: '', room_id: roomId,
    content: { algorithm: 'm.megolm.v1.aes-sha2' },
  })]);
  const root = message('$root:test');
  room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const reply = message('$reply:test', root.getId());
  const thread = room.createThread(root.getId()!, root, [root, reply], false);
  room.setUnreadNotificationCount(NotificationCountType.Total, 3);
  room.setUnreadNotificationCount(NotificationCountType.Highlight, 2);
  room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Total, 4);
  room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Highlight, 1);
  const request = vi.spyOn(client.http, 'authedRequest').mockResolvedValue({});
  const localEcho = vi.spyOn(room, 'addLocalEchoReceipt');
  const counts = () => ({
    main: room.getRoomUnreadNotificationCount(NotificationCountType.Total),
    mainHighlights: room.getRoomUnreadNotificationCount(NotificationCountType.Highlight),
    thread: room.getThreadUnreadNotificationCount(thread.id, NotificationCountType.Total),
    threadHighlights: room.getThreadUnreadNotificationCount(thread.id, NotificationCountType.Highlight),
  });
  return { client, room, root, reply, thread, request, localEcho, counts };
}

describe('confirmed scoped receipts', () => {
  it('exercises the SDK encrypted highlight regression caused by a synthetic receipt', () => {
    const { room, root, reply, counts } = fixture();
    expect(counts()).toEqual({ main: 3, mainHighlights: 2, thread: 4, threadHighlights: 1 });
    room.addLocalEchoReceipt(userId, root, ReceiptType.ReadPrivate, false);
    expect(counts().mainHighlights).toBe(0);
    room.addLocalEchoReceipt(userId, reply, ReceiptType.ReadPrivate, false);
    expect(counts().threadHighlights).toBe(0);
  });

  it.each([
    { context: 'main', type: ReceiptType.Read },
    { context: 'main', type: ReceiptType.ReadPrivate },
    { context: 'thread', type: ReceiptType.Read },
    { context: 'thread', type: ReceiptType.ReadPrivate },
  ] as const)('preserves real SDK counters and receipts through failed $context $type requests and retries', async ({ context, type }) => {
    const { client, room, root, reply, thread, request, localEcho, counts } = fixture();
    const event = context === 'main' ? root : reply;
    const scope = context === 'main' ? 'main' : thread.id;
    const before = counts();
    request.mockRejectedValueOnce(new Error('Synthetic offline failure'));
    await expect(sendConfirmedReceipt(client, event, type, scope)).rejects.toThrow('Synthetic offline failure');
    expect(counts()).toEqual(before);
    expect(localEcho).not.toHaveBeenCalled();
    const destination = context === 'main' ? room : thread;
    expect(destination.getReadReceiptForUserId(userId, false, type)).toBeNull();
    await sendConfirmedReceipt(client, event, type, scope);
    expect(request).toHaveBeenLastCalledWith('POST', `/rooms/!synthetic%3Aexample.test/receipt/${type}/${encodeURIComponent(event.getId()!)}`, undefined, { thread_id: scope });
    expect(counts()).toEqual(before);
    expect(destination.getReadReceiptForUserId(userId, false, type)).toBeNull();
    room.addReceipt(new MatrixEvent({ type: 'm.receipt', room_id: roomId, content: {
      [event.getId()!]: { [type]: { [userId]: { ts: 2000, thread_id: scope } } },
    } }));
    expect(destination.getReadReceiptForUserId(userId, true, type)?.eventId).toBe(event.getId());
    expect(context === 'main' ? counts().mainHighlights : counts().threadHighlights).toBe(0);
    expect(context === 'main' ? counts().threadHighlights : counts().mainHighlights).toBe(context === 'main' ? 1 : 2);
    expect(localEcho).not.toHaveBeenCalled();
  });

  it('never retries a rejected private scoped receipt as public or unthreaded', async () => {
    const { client, reply, thread, request } = fixture();
    request.mockRejectedValue({ errcode: 'M_INVALID_PARAM' });
    await expect(sendConfirmedReceipt(client, reply, ReceiptType.ReadPrivate, thread.id)).rejects.toMatchObject({ errcode: 'M_INVALID_PARAM' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual(['POST', '/rooms/!synthetic%3Aexample.test/receipt/m.read.private/%24reply%3Atest', undefined, { thread_id: '$root:test' }]);
  });

  it('encodes opaque event IDs and rejects pending events before sending', async () => {
    const { client, request } = fixture();
    const event = message('$opaque/with?query:test');
    await sendConfirmedReceipt(client, event, ReceiptType.ReadPrivate, 'main');
    expect(request.mock.calls[0][1]).toBe('/rooms/!synthetic%3Aexample.test/receipt/m.read.private/%24opaque%2Fwith%3Fquery%3Atest');
    request.mockClear();
    event.setStatus(EventStatus.SENDING);
    await expect(sendConfirmedReceipt(client, event, ReceiptType.ReadPrivate, 'main')).rejects.toThrow('not available');
    expect(request).not.toHaveBeenCalled();
  });
});
