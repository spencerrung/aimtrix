// Synthetic standard Matrix payloads pass through the production snapshot builder.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { buildWorkspaceSnapshot } from '../../src/matrix/buildWorkspaceSnapshot';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import '../../src/styles.css';

function event(id: string, body: string, relation?: Record<string, unknown>): MatrixEvent {
  const content = { msgtype: 'm.text', body, ...(relation ? { 'm.relates_to': relation } : {}) };
  return { getId: () => id, getSender: () => '@buddy:example.test', getTs: () => 1700000000000,
    getType: () => 'm.room.message', getContent: () => content, isRedacted: () => false, status: null } as unknown as MatrixEvent;
}
const root = event('$root', 'Synthetic thread root');
const threadRelation = (target: string, fallingBack: boolean) => ({ rel_type: 'm.thread', event_id: '$root',
  is_falling_back: fallingBack, 'm.in_reply_to': { event_id: target } });
const replies = [event('$first', 'First ordinary contribution', threadRelation('$root', true)),
  event('$second', 'Second ordinary contribution', threadRelation('$first', true)),
  event('$explicit', 'An intentional reply', threadRelation('$first', false))];
const roomReply = event('$room-reply', 'An intentional room reply', { 'm.in_reply_to': { event_id: '$root' } });
const room = {
  roomId: 'welcome', name: 'Welcome Lounge', tags: {}, getMyMembership: () => 'join', getType: () => undefined,
  getLiveTimeline: () => ({ getEvents: () => [root, ...replies, roomReply] }),
  getThreads: () => [{ id: '$root', length: replies.length, rootEvent: root, events: [root, ...replies] }],
  getMember: () => undefined, getMembers: () => [], getJoinedMembers: () => [], getUnreadNotificationCount: () => 0,
  getRoomUnreadNotificationCount: () => 0, getThreadUnreadNotificationCount: () => 0,
  getEventReadUpTo: () => null, getAccountData: () => undefined, getLastActiveTimestamp: () => 0,
  getDefaultRoomName: () => 'Welcome Lounge', getMxcAvatarUrl: () => undefined, hasEncryptionStateEvent: () => true,
  currentState: { getStateEvents: () => undefined, maySendStateEvent: () => false },
} as unknown as Room;
const client = { getSafeUserId: () => '@me:example.test', getUser: () => null, getAccountData: () => undefined,
  getVisibleRooms: () => [room], getRoomPushRule: () => undefined } as unknown as MatrixClient;
const snapshot = buildWorkspaceSnapshot(client, 'online');

export function Fixture() {
  const [target, setTarget] = useState<string>();
  const [revision, setRevision] = useState(1);
  const workspace = { ...demoWorkspace, mode: 'matrix' as const, messagesByRoom: snapshot.messagesByRoom,
    threadsByRoot: { $root: { ...snapshot.threadsByRoot.$root, history: { mode: 'live' as const,
      revision, canLoadOlder: false, canLoadNewer: false,
      ...(target ? { targetEventId: target, targetStatus: 'found' as const } : {}) } } } };
  return <Workspace workspace={workspace} config={defaultRuntimeConfig} theme="aqua" preferences={defaultUserPreferences}
    onPreferencesChange={() => {}} onThemeChange={() => {}} onSignOut={() => {}}
    onThreadSelected={async (_roomId, _rootId, eventId) => { setTarget(eventId); setRevision((value) => value + 1); }} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
