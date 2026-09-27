import { buildWorkspaceSnapshot, createWorkspaceSnapshotCache } from '../../src/matrix/buildWorkspaceSnapshot';
import type { MatrixClient, Room } from 'matrix-js-sdk';

export function profileSnapshot(roomCount: number, cycles: number) {
  const rooms = Array.from({ length: roomCount }, (_, index) => {
    const timeline: never[] = [];
    return {
      roomId: `!synthetic-${index}:test`,
      name: `Synthetic room ${index}`,
      tags: {},
      getMyMembership: () => 'join',
      getType: () => undefined,
      getLiveTimeline: () => ({ getEvents: () => timeline }),
      getThreads: () => [],
      getMember: () => undefined,
      getMembers: () => [],
      getJoinedMembers: () => [],
      getUnreadNotificationCount: () => 0,
      getRoomUnreadNotificationCount: () => 0,
      getEventReadUpTo: () => null,
      getAccountData: () => undefined,
      getLastActiveTimestamp: () => roomCount - index,
      getDefaultRoomName: () => `Synthetic room ${index}`,
      getMxcAvatarUrl: () => undefined,
      hasEncryptionStateEvent: () => true,
      currentState: { getStateEvents: () => undefined, maySendStateEvent: () => false },
    } as unknown as Room;
  });
  const client = {
    getSafeUserId: () => '@synthetic:test',
    getUser: () => null,
    getAccountData: () => undefined,
    getVisibleRooms: () => rooms,
    getRoomPushRule: () => undefined,
  } as unknown as MatrixClient;
  const cache = createWorkspaceSnapshotCache();
  const firstStart = performance.now();
  const first = buildWorkspaceSnapshot(client, 'online', [], [], cache);
  const firstMs = performance.now() - firstStart;
  const timings: number[] = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    cache.roomVersions.set(rooms[0].roomId, cycle + 1);
    const start = performance.now();
    buildWorkspaceSnapshot(client, 'online', [], [], cache);
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return {
    roomCount: first.rooms.length,
    initialSnapshotMs: Math.round(firstMs),
    incrementalSnapshotMedianMs: timings.length ? Math.round(timings[Math.floor(timings.length / 2)]) : undefined,
    incrementalSnapshotP95Ms: timings.length ? Math.round(timings[Math.ceil(timings.length * 0.95) - 1]) : undefined,
    cachedMessageRooms: cache.messages.size,
    cachedMemberRooms: cache.members.size,
  };
}
