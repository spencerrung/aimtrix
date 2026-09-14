import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { MatrixController } from './MatrixController';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const roomId = '!synthetic:test';
  const room = { roomId, tags: { 'org.example.custom': {} }, getMyMembership: () => 'join', getType: () => undefined };
  const direct: Record<string, unknown> = { '@other:test': ['!left:test', roomId] };
  const client = {
    getRoom: vi.fn((id: string) => id === roomId ? room : null),
    getAccountData: vi.fn(() => ({ getContent: () => direct })),
    getRoomIdForAlias: vi.fn().mockResolvedValue({ room_id: roomId, servers: ['test'] }),
    setRoomTag: vi.fn().mockResolvedValue({}), deleteRoomTag: vi.fn().mockResolvedValue({}),
    joinRoom: vi.fn(), createRoom: vi.fn(), on: vi.fn(), removeListener: vi.fn(), getRooms: () => [],
  };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const internals = controller as unknown as {
    client?: MatrixClient; lifecycleRevision: number; scheduleWorkspacePublish: () => void;
    handleRoomTags: (event: MatrixEvent, room: Room) => void;
    snapshotCache: { roomVersions: Map<string, number> };
    sdk: unknown; attachClientListeners: () => void; detachClientListeners: () => void;
  };
  internals.client = client as unknown as MatrixClient;
  internals.scheduleWorkspacePublish = vi.fn();
  return { controller, internals, client, room, roomId, direct };
}

describe('standard favorite tags', () => {
  it('writes and deletes only m.favourite, leaving snapshots to authoritative tag sync', async () => {
    const { controller, client, roomId, room, internals } = fixture();
    await controller.setRoomFavorite(roomId, true);
    await controller.setRoomFavorite(roomId, false);
    expect(client.setRoomTag).toHaveBeenCalledExactlyOnceWith(roomId, 'm.favourite', {});
    expect(client.deleteRoomTag).toHaveBeenCalledExactlyOnceWith(roomId, 'm.favourite');
    expect(room.tags).toEqual({ 'org.example.custom': {} });
    expect(internals.scheduleWorkspacePublish).toHaveBeenCalledTimes(2);
  });

  it('preserves existing favorite ordering and metadata when a favorite is set again', async () => {
    const { controller, client, roomId, room } = fixture();
    Object.assign(room.tags, { 'm.favourite': { order: 0.25, 'org.example.custom': 'synthetic' } });
    await controller.setRoomFavorite(roomId, true);
    expect(client.setRoomTag).toHaveBeenCalledExactlyOnceWith(roomId, 'm.favourite', { order: 0.25, 'org.example.custom': 'synthetic' });
    expect(room.tags).toMatchObject({ 'org.example.custom': {}, 'm.favourite': { order: 0.25 } });
  });

  it('keeps rapid writes ordered even when an earlier write fails', async () => {
    const { controller, client, roomId } = fixture();
    const held = deferred();
    client.setRoomTag.mockReturnValueOnce(held.promise);
    const first = controller.setRoomFavorite(roomId, true);
    const failed = expect(first).rejects.toThrow('favorite could not be saved');
    const second = controller.setRoomFavorite(roomId, false);
    await vi.waitFor(() => expect(client.setRoomTag).toHaveBeenCalledTimes(1));
    expect(client.deleteRoomTag).not.toHaveBeenCalled();
    held.reject(new Error('Synthetic private server detail'));
    await failed;
    await second;
    expect(client.deleteRoomTag).toHaveBeenCalledTimes(1);
  });

  it('does not report or publish failed writes and permits an explicit retry', async () => {
    const { controller, client, roomId, internals } = fixture();
    client.setRoomTag.mockRejectedValueOnce(new Error('Synthetic private server detail'));
    await expect(controller.setRoomFavorite(roomId, true)).rejects.toThrow('The favorite could not be saved. Try again.');
    expect(internals.scheduleWorkspacePublish).not.toHaveBeenCalled();
    await controller.setRoomFavorite(roomId, true);
    expect(client.setRoomTag).toHaveBeenCalledTimes(2);
  });

  it.each(['client', 'revision'])('rejects late and queued writes when the %s changes', async (change) => {
    const { controller, client, roomId, internals } = fixture();
    const held = deferred();
    client.setRoomTag.mockReturnValueOnce(held.promise);
    const first = controller.setRoomFavorite(roomId, true);
    const second = controller.setRoomFavorite(roomId, false);
    const results = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(client.setRoomTag).toHaveBeenCalledTimes(1));
    if (change === 'client') internals.client = undefined;
    else internals.lifecycleRevision += 1;
    held.resolve();
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(client.deleteRoomTag).not.toHaveBeenCalled();
    expect(internals.scheduleWorkspacePublish).not.toHaveBeenCalled();
  });

  it('rechecks membership before sending a queued write', async () => {
    const { controller, client, room, roomId } = fixture();
    const held = deferred();
    client.setRoomTag.mockReturnValueOnce(held.promise);
    const first = controller.setRoomFavorite(roomId, true);
    const second = controller.setRoomFavorite(roomId, false);
    const failure = expect(second).rejects.toThrow('Only joined');
    await vi.waitFor(() => expect(client.setRoomTag).toHaveBeenCalledTimes(1));
    room.getMyMembership = () => 'leave';
    held.resolve();
    await first;
    await failure;
    expect(client.deleteRoomTag).not.toHaveBeenCalled();
  });

  it('invalidates current room snapshots on SDK tags and ignores detached rooms', () => {
    const { internals, room, roomId } = fixture();
    internals.handleRoomTags({} as MatrixEvent, { ...room } as unknown as Room);
    expect(internals.scheduleWorkspacePublish).not.toHaveBeenCalled();
    internals.handleRoomTags({} as MatrixEvent, room as unknown as Room);
    expect(internals.snapshotCache.roomVersions.get(roomId)).toBe(1);
    expect(internals.scheduleWorkspacePublish).toHaveBeenCalledTimes(1);
  });

  it('attaches and detaches the SDK tag event listener', () => {
    const { internals, client } = fixture();
    internals.sdk = {
      ClientEvent: { Sync: 'sync', AccountData: 'accountData' },
      RoomEvent: { Tags: 'Room.tags' }, RoomStateEvent: {}, MatrixEventEvent: {},
    };
    internals.attachClientListeners();
    expect(client.on).toHaveBeenCalledWith('Room.tags', internals.handleRoomTags);
    internals.detachClientListeners();
    expect(client.removeListener).toHaveBeenCalledWith('Room.tags', internals.handleRoomTags);
  });
});

describe('joined-only Matrix navigation', () => {
  it('preserves an event target and resolves aliases using the SDK', async () => {
    const { controller, client, roomId } = fixture();
    await expect(controller.resolveNavigationTarget({ roomId, eventId: '$target:test', via: ['test'] }))
      .resolves.toEqual({ roomId, eventId: '$target:test' });
    expect(client.getRoomIdForAlias).not.toHaveBeenCalled();
    await expect(controller.resolveNavigationTarget({ roomAlias: '#synthetic:test', eventId: '$target:test' }))
      .resolves.toEqual({ roomId, eventId: '$target:test' });
    expect(client.getRoomIdForAlias).toHaveBeenCalledExactlyOnceWith('#synthetic:test');
    expect(client.joinRoom).not.toHaveBeenCalled();
  });

  it('reuses a joined DM and requires an explicit start for an unknown person', async () => {
    const { controller, client, roomId } = fixture();
    await expect(controller.resolveNavigationTarget({ userId: '@other:test' })).resolves.toEqual({ roomId });
    await expect(controller.resolveNavigationTarget({ userId: '@unknown:test' })).rejects.toThrow('Use Start conversation');
    expect(client.createRoom).not.toHaveBeenCalled();
    expect(client.joinRoom).not.toHaveBeenCalled();
    expect(client.getRoomIdForAlias).not.toHaveBeenCalled();
  });

  it.each(['invite', 'leave', 'ban'])('does not navigate or join a %s room', async (membership) => {
    const { controller, client, room, roomId } = fixture();
    room.getMyMembership = () => membership;
    await expect(controller.resolveNavigationTarget({ roomId })).rejects.toThrow('Join this conversation');
    expect(client.joinRoom).not.toHaveBeenCalled();
  });

  it('rejects malformed targets before resolution and sanitizes alias failures', async () => {
    const { controller, client, roomId } = fixture();
    await expect(controller.resolveNavigationTarget({ roomId, eventId: 'not-an-event' })).rejects.toThrow('not supported');
    expect(client.getRoom).not.toHaveBeenCalled();
    client.getRoomIdForAlias.mockRejectedValue(new Error('Synthetic private server detail'));
    await expect(controller.resolveNavigationTarget({ roomAlias: '#synthetic:test' }))
      .rejects.toThrow('That room alias could not be resolved. Check the link and try again.');
  });

  it('rejects alias results after a session changes', async () => {
    const { controller, client, internals, roomId } = fixture();
    const held = deferred();
    client.getRoomIdForAlias.mockImplementation(() => held.promise.then(() => ({ room_id: roomId })));
    const resolving = controller.resolveNavigationTarget({ roomAlias: '#synthetic:test' });
    internals.lifecycleRevision += 1;
    held.resolve();
    await expect(resolving).rejects.toThrow('session changed');
    expect(client.getRoom).not.toHaveBeenCalled();
  });

  it('rejects disconnected mutations and navigation instead of silently succeeding', async () => {
    const { controller, internals, roomId, client } = fixture();
    internals.client = undefined;
    await expect(controller.setRoomFavorite(roomId, true)).rejects.toThrow('not connected');
    await expect(controller.resolveNavigationTarget({ roomId })).rejects.toThrow('not connected');
    expect(client.setRoomTag).not.toHaveBeenCalled();
  });
});
