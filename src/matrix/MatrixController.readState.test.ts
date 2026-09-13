import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event.js';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { MatrixController } from './MatrixController';

const roomId = '!synthetic:test';
const rootId = '$root:test';
function event(id: string, thread = false) {
  const value = new MatrixEvent({ event_id: id, room_id: roomId, type: 'm.room.message', sender: '@other:test',
    content: { msgtype: 'm.text', body: 'Synthetic test message', ...(thread ? { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId, is_falling_back: false } } : {}) } });
  return value;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const main = event('$main:test');
  const reply = event('$reply:test', true);
  const events = [main, reply];
  const thread = { events: [event(rootId), reply] };
  const account = new Map<string, unknown>();
  const room = {
    roomId, getLiveTimeline: () => ({ getEvents: () => events }), getThread: () => thread,
    hasPendingEvent: () => false,
    getAccountData: (type: string) => account.has(type) ? { getContent: () => account.get(type) } : undefined,
    getReadReceiptForUserId: vi.fn().mockReturnValue(null),
    setUnreadNotificationCount: vi.fn(), setThreadUnreadNotificationCount: vi.fn(),
  };
  const client = {
    getRoom: () => room, getSafeUserId: () => '@me:test',
    isVersionSupported: vi.fn().mockResolvedValue(true), doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(false),
    http: { authedRequest: vi.fn().mockResolvedValue({}) },
    setRoomReadMarkers: vi.fn().mockResolvedValue({}), setRoomAccountData: vi.fn().mockResolvedValue({}),
  };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const internals = controller as unknown as { client?: MatrixClient; sdk: unknown; scheduleWorkspacePublish: () => void; lifecycleRevision: number; handleRoomAccountData: (event: MatrixEvent, room: unknown) => void; snapshotCache: { roomVersions: Map<string, number> } };
  internals.client = client as unknown as MatrixClient;
  internals.sdk = { inMainTimelineForReceipt: (value: MatrixEvent) => value.threadRootId === undefined };
  internals.scheduleWorkspacePublish = vi.fn();
  return { controller, internals, client, room, events, thread, account, main, reply };
}
const path = (type: string, id: string) => `/rooms/${encodeURIComponent(roomId)}/receipt/${type}/${encodeURIComponent(id)}`;

describe('private read bookkeeping', () => {
  it.each([true, false])('uses explicit receipt privacy in both contexts (%s)', async (publicReceipt) => {
    const { controller, client, room } = fixture();
    await controller.markRoomRead(roomId, { publicReceipt });
    await controller.markThreadRead(roomId, rootId, { publicReceipt });
    const type = publicReceipt ? 'm.read' : 'm.read.private';
    expect(client.http.authedRequest).toHaveBeenNthCalledWith(1, 'POST', path(type, '$main:test'), undefined, { thread_id: 'main' });
    expect(client.http.authedRequest).toHaveBeenNthCalledWith(2, 'POST', path(type, '$reply:test'), undefined, { thread_id: rootId });
    expect(client.setRoomReadMarkers).toHaveBeenCalledExactlyOnceWith(roomId, '$main:test');
    expect(room.setUnreadNotificationCount).toHaveBeenCalledTimes(2);
    expect(room.setThreadUnreadNotificationCount).toHaveBeenCalledWith(rootId, 'total', 0);
    expect(room.setThreadUnreadNotificationCount).toHaveBeenCalledTimes(2);
  });

  it('supports the stable MSC flag and does not confuse privacy changes with duplicate receipts', async () => {
    const { controller, client } = fixture();
    client.isVersionSupported.mockResolvedValue(false);
    client.doesServerSupportUnstableFeature.mockResolvedValue(true);
    await controller.markRoomRead(roomId, { publicReceipt: false });
    await controller.markRoomRead(roomId, { publicReceipt: true });
    expect(client.doesServerSupportUnstableFeature).toHaveBeenCalledWith('org.matrix.msc2285.stable');
    expect(client.http.authedRequest.mock.calls.map((call) => call[1])).toEqual([path('m.read.private', '$main:test'), path('m.read', '$main:test')]);
  });

  it('uses only a private fully-read marker on older servers and reports unsupported private threads', async () => {
    const { controller, client, room } = fixture();
    client.isVersionSupported.mockResolvedValue(false);
    await controller.markRoomRead(roomId, { publicReceipt: false });
    await expect(controller.markThreadRead(roomId, rootId, { publicReceipt: false })).rejects.toThrow('does not support private thread');
    expect(client.http.authedRequest).not.toHaveBeenCalled();
    expect(client.setRoomReadMarkers).toHaveBeenCalledExactlyOnceWith(roomId, '$main:test');
    expect(room.setThreadUnreadNotificationCount).not.toHaveBeenCalled();
  });

  it('does not send anything or clear counts when capability lookup fails', async () => {
    const { controller, client, room } = fixture();
    client.isVersionSupported.mockRejectedValue(new Error('offline'));
    await expect(controller.markRoomRead(roomId, { publicReceipt: false })).rejects.toThrow('offline');
    expect(client.http.authedRequest).not.toHaveBeenCalled();
    expect(client.setRoomReadMarkers).not.toHaveBeenCalled();
    expect(room.setUnreadNotificationCount).not.toHaveBeenCalled();
  });

  it('retries a failed fully-read write even after the receipt is confirmed by sync', async () => {
    const { controller, client, room } = fixture();
    client.setRoomReadMarkers.mockRejectedValueOnce(new Error('offline'));
    await expect(controller.markRoomRead(roomId)).rejects.toThrow('offline');
    room.getReadReceiptForUserId.mockReturnValue({ eventId: '$main:test' });
    await controller.markRoomRead(roomId);
    expect(client.http.authedRequest).toHaveBeenCalledTimes(1);
    expect(client.setRoomReadMarkers).toHaveBeenCalledTimes(2);
  });

  it('serializes positions, preserves new arrivals, and never rewinds the fully-read marker', async () => {
    const { controller, client, room, events } = fixture();
    const held = deferred();
    client.http.authedRequest.mockReturnValueOnce(held.promise);
    const first = controller.markRoomRead(roomId, { eventId: '$main:test' });
    events.push(event('$new:test'));
    const second = controller.markRoomRead(roomId, { eventId: '$new:test' });
    expect(client.http.authedRequest).toHaveBeenCalledTimes(1);
    held.resolve();
    await first;
    expect(room.setUnreadNotificationCount).not.toHaveBeenCalled();
    await second;
    await controller.markRoomRead(roomId, { eventId: '$main:test' });
    expect(client.setRoomReadMarkers.mock.calls).toEqual([[roomId, '$main:test'], [roomId, '$new:test']]);
    expect(client.http.authedRequest).toHaveBeenCalledTimes(2);
  });

  it('tries a queued new position after an earlier read fails', async () => {
    const { controller, client, events } = fixture();
    const held = deferred();
    client.http.authedRequest.mockReturnValueOnce(held.promise);
    const first = controller.markRoomRead(roomId);
    const failed = expect(first).rejects.toThrow('offline');
    events.push(event('$new:test'));
    const second = controller.markRoomRead(roomId);
    held.reject(new Error('offline'));
    await failed; await second;
    expect(client.setRoomReadMarkers).toHaveBeenCalledExactlyOnceWith(roomId, '$new:test');
  });

  it('does not apply a previous session completion to the new session', async () => {
    const { controller, client, room, internals } = fixture();
    const held = deferred();
    client.http.authedRequest.mockReturnValueOnce(held.promise);
    const read = controller.markRoomRead(roomId, { explicit: true });
    internals.client = undefined;
    internals.lifecycleRevision += 1;
    held.resolve(); await read;
    expect(client.setRoomReadMarkers).not.toHaveBeenCalled();
    expect(client.setRoomAccountData).not.toHaveBeenCalled();
    expect(room.setUnreadNotificationCount).not.toHaveBeenCalled();
  });

  it('keeps a newer deliberate reminder after an older explicit read finishes', async () => {
    const { controller, client } = fixture();
    const held = deferred();
    client.http.authedRequest.mockReturnValueOnce(held.promise);
    const read = controller.markRoomRead(roomId, { explicit: true });
    await controller.markRoomUnread(roomId, '$main:test');
    held.resolve(); await read;
    expect(client.setRoomAccountData).toHaveBeenCalledExactlyOnceWith(roomId, 'm.marked_unread', { unread: true, 'dev.alucard.aimtrix.return_point': { event_id: '$main:test' } });
    expect(client.setRoomReadMarkers).toHaveBeenCalledTimes(1);
  });

  it('honors remote and legacy reminders, allows explicit clear, and invalidates cached snapshots on sync', async () => {
    const { controller, client, account, internals, room } = fixture();
    account.set('com.famedly.marked_unread', { unread: true });
    await controller.markRoomRead(roomId);
    expect(client.http.authedRequest).not.toHaveBeenCalled();
    account.set('m.marked_unread', { unread: false });
    await controller.markRoomRead(roomId, { explicit: true });
    expect(client.setRoomAccountData).toHaveBeenCalledWith(roomId, 'm.marked_unread', { unread: false });
    const before = internals.snapshotCache.roomVersions.get(roomId) ?? 0;
    internals.handleRoomAccountData(new MatrixEvent({ type: 'm.marked_unread', content: { unread: false } }), room);
    expect(internals.snapshotCache.roomVersions.get(roomId)).toBeGreaterThan(before);
  });

  it('never moves receipts backward when marking an unloaded message unread and validates the return point', async () => {
    const { controller, client } = fixture();
    await controller.markRoomUnread(roomId, '$unloaded:test');
    await expect(controller.markRoomUnread(roomId, 'invalid')).rejects.toThrow('valid message');
    expect(client.setRoomAccountData).toHaveBeenCalledTimes(1);
    expect(client.http.authedRequest).not.toHaveBeenCalled();
    expect(client.setRoomReadMarkers).not.toHaveBeenCalled();
  });

  it('restores automatic reads after a failed reminder write', async () => {
    const { controller, client } = fixture();
    client.setRoomAccountData.mockRejectedValueOnce(new Error('offline'));
    await expect(controller.markRoomUnread(roomId)).rejects.toThrow('offline');
    await controller.markRoomRead(roomId);
    expect(client.http.authedRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects pending, main, and other-thread targets without clearing any thread', async () => {
    const { controller, client, thread, main, room } = fixture();
    thread.events.push(main, event('$elsewhere:test'));
    await controller.markThreadRead(roomId, rootId, { eventId: main.getId() });
    await controller.markThreadRead(roomId, rootId, { eventId: rootId });
    await controller.markRoomRead(roomId, { eventId: '$reply:test' });
    expect(client.http.authedRequest).not.toHaveBeenCalled();
    expect(room.setThreadUnreadNotificationCount).not.toHaveBeenCalled();
  });
  it('keeps a newer reminder received from another device during an explicit read', async () => {
    const { controller, client, internals, room, account } = fixture();
    const held = deferred();
    client.http.authedRequest.mockReturnValueOnce(held.promise);
    const read = controller.markRoomRead(roomId, { explicit: true });
    account.set('m.marked_unread', { unread: true });
    internals.handleRoomAccountData(new MatrixEvent({ type: 'm.marked_unread', content: { unread: true } }), room);
    held.resolve(); await read;
    expect(client.setRoomAccountData).not.toHaveBeenCalled();
    const sent = client.http.authedRequest.mock.calls.length;
    await controller.markRoomRead(roomId);
    expect(client.http.authedRequest).toHaveBeenCalledTimes(sent);
  });

  it('uses the current private preference when an older public request leaves the queue', async () => {
    const { controller, client, events } = fixture();
    const held = deferred();
    client.http.authedRequest.mockReturnValueOnce(held.promise);
    const first = controller.markRoomRead(roomId, { publicReceipt: true });
    events.push(event('$new:test'));
    const second = controller.markRoomRead(roomId, { publicReceipt: true });
    controller.setNotificationPreferences({ desktopNotifications: false, notificationSounds: false, soundVolume: 0, sendReadReceipts: false });
    held.resolve(); await first; await second;
    expect(client.http.authedRequest.mock.calls.map((call) => call[1])).toEqual([path('m.read', '$main:test'), path('m.read.private', '$new:test')]);
  });

  it('does not execute a queued clear after a newer remote reminder arrives', async () => {
    const { controller, client, internals, room, account } = fixture();
    const held = deferred();
    client.setRoomAccountData.mockReturnValueOnce(held.promise);
    const reminder = controller.markRoomUnread(roomId, '$main:test');
    const read = controller.markRoomRead(roomId, { explicit: true });
    await vi.waitFor(() => expect(client.setRoomReadMarkers).toHaveBeenCalled());
    // Another device saves a different return point while our write is pending.
    const remote = { unread: true, 'dev.alucard.aimtrix.return_point': { event_id: '$new-point:test' } };
    account.set('m.marked_unread', remote);
    internals.handleRoomAccountData(new MatrixEvent({ type: 'm.marked_unread', content: remote }), room);
    held.resolve(); await reminder; await read;
    expect(client.setRoomAccountData).toHaveBeenCalledTimes(1);
  });

  it('can explicitly clear a reminder in a room without a loaded accepted event', async () => {
    const { controller, client, events, account } = fixture();
    events.length = 0;
    account.set('m.marked_unread', { unread: true });
    await controller.markRoomRead(roomId, { explicit: true });
    expect(client.setRoomAccountData).toHaveBeenCalledExactlyOnceWith(roomId, 'm.marked_unread', { unread: false });
    expect(client.http.authedRequest).not.toHaveBeenCalled();
  });

});
