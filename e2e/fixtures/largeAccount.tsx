/* eslint-disable react-refresh/only-export-components */
// Synthetic large-account workload. No homeserver, credentials, or private content.
import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { WorkspaceSnapshot } from '../../src/matrix/viewModels';
import '../../src/styles.css';

declare global {
  interface Window {
    largeAccountFixture: {
      readyAt: number;
      revision: number;
      publish: (target?: 'hidden' | 'visible' | 'offpage') => void;
    };
    largeAccountSnapshotRefs: WeakRef<WorkspaceSnapshot>[];
  }
}

const count = Math.min(20_000, Math.max(1, Number(new URL(location.href).searchParams.get('rooms')) || 10_000));
const withLargeSpace = new URL(location.href).searchParams.has('space');
const withNestedSpace = new URL(location.href).searchParams.has('nested');
const rooms = Array.from({ length: count }, (_, index) => ({
  ...demoWorkspace.rooms[0],
  id: `!synthetic-${index}:test`,
  name: `Synthetic room ${String(index).padStart(5, '0')}`,
  kind: 'room' as const,
  group: 'Rooms' as const,
  favorite: false,
  unreadCount: 0,
  badgeCount: 0,
  highlightCount: 0,
  lastMessage: `Synthetic message ${index}`,
  updatedAt: count - index,
}));
const firstRoomId = rooms[0].id;
const lastRoomId = rooms.at(-1)!.id;
const messages = Array.from({ length: 250 }, (_, index) => ({
  ...demoWorkspace.messagesByRoom.welcome[0],
  id: `$synthetic-${index}`,
  roomId: firstRoomId,
  body: `Synthetic message ${index}`,
  timestamp: index + 1,
}));
const initial: WorkspaceSnapshot = {
  ...demoWorkspace,
  mode: 'matrix',
  rooms,
  spaces: demoWorkspace.spaces.map((space) => ({
    ...space,
    childIds: withNestedSpace && space.id === 'friends'
      ? [...rooms.slice(0, -1).map((room) => room.id), 'vidja-gamez']
      : withNestedSpace && space.id === 'vidja-gamez'
        ? [lastRoomId]
        : space.kind === 'home' || withLargeSpace && space.name === 'Friends' ? rooms.map((room) => room.id) : [],
    directRoomIds: [],
    roomIds: withNestedSpace && space.id === 'vidja-gamez'
      ? [lastRoomId]
      : space.kind === 'home' || withLargeSpace && space.name === 'Friends' ? rooms.map((room) => room.id) : [],
  })),
  messagesByRoom: { [firstRoomId]: messages, [lastRoomId]: messages.map((message) => ({ ...message, id: `${message.id}-last`, roomId: lastRoomId })) },
  membersByRoom: { [firstRoomId]: [] },
  threadsByRoot: {},
};

window.largeAccountFixture = { readyAt: 0, revision: 0, publish: () => {} };
window.largeAccountSnapshotRefs = [];

function Fixture() {
  const [workspace, setWorkspace] = useState(initial);
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    window.largeAccountFixture.readyAt ||= performance.now();
    window.largeAccountFixture.revision = revision;
    window.largeAccountFixture.publish = (target = 'hidden') => {
      const roomId = target === 'visible' ? lastRoomId : target === 'offpage' ? rooms[Math.floor(count / 2)].id : firstRoomId;
      setWorkspace((current) => {
        const next = {
          ...current,
          rooms: current.rooms.map((room) => room.id === roomId
            ? { ...room, lastMessage: `Synthetic update ${revision + 1}`, updatedAt: room.updatedAt + 1 }
            : room),
          messagesByRoom: target === 'visible' ? {
            ...current.messagesByRoom,
            [lastRoomId]: [
              ...current.messagesByRoom[lastRoomId].slice(1),
              { ...messages[0], id: `$visible-update-${revision + 1}`, roomId: lastRoomId, body: `Synthetic visible update ${revision + 1}`, timestamp: count + revision + 1 },
            ],
          } : current.messagesByRoom,
        };
        window.largeAccountSnapshotRefs.push(new WeakRef(next));
        return next;
      });
      setRevision((value) => value + 1);
    };
  }, [revision]);
  return <Workspace workspace={workspace} config={defaultRuntimeConfig} theme="aqua" preferences={defaultUserPreferences} onSignOut={() => {}} />;
}

createRoot(document.getElementById('root')!).render(<Fixture />);

export {};
