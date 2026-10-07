// Synthetic standard Matrix payloads pass through the production snapshot builder.
import { createRoot } from 'react-dom/client';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { buildWorkspaceSnapshot } from '../../src/matrix/buildWorkspaceSnapshot';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import '../../src/styles.css';

function event(id: string, body: string, relation?: Record<string, unknown>, extra: Record<string, unknown> = {}): MatrixEvent {
  const content = { msgtype: 'm.text', body, ...extra, ...(relation ? { 'm.relates_to': relation } : {}) };
  return { getId: () => id, getSender: () => '@me:example.test', getTs: () => 1700000000000,
    getType: () => 'm.room.message', getContent: () => content, isRedacted: () => false, status: null } as unknown as MatrixEvent;
}
const root = event('$root', 'Synthetic thread root');
const replies = [event('$thread', '>>output\nKeep this thread line', {
  rel_type: 'm.thread', event_id: '$root', is_falling_back: true, 'm.in_reply_to': { event_id: '$root' },
})];
const roomReply = event('$literal', '>42 is the threshold\nKeep this room line', { 'm.in_reply_to': { event_id: '$root' } });
const edited = event('$edited', '> <@buddy:example.test> Earlier\n\nBefore edit', { 'm.in_reply_to': { event_id: '$root' } });
const replacement = event('$replacement', '* > authored quotation\nKeep this edited line', { rel_type: 'm.replace', event_id: '$edited' },
  { 'm.new_content': { msgtype: 'm.text', body: '> authored quotation\nKeep this edited line' } });
const room = {
  roomId: 'welcome', name: 'Welcome Lounge', tags: {}, getMyMembership: () => 'join', getType: () => undefined,
  getLiveTimeline: () => ({ getEvents: () => [root, ...replies, roomReply, edited, replacement] }),
  getThreads: () => [{ id: '$root', length: replies.length, rootEvent: root, events: [root, ...replies] }],
  getMember: () => undefined, getMembers: () => [], getJoinedMembers: () => [], getUnreadNotificationCount: () => 0,
  getRoomUnreadNotificationCount: () => 0, getThreadUnreadNotificationCount: () => 0,
  getEventReadUpTo: () => null, getAccountData: () => undefined, getLastActiveTimestamp: () => 0,
  getDefaultRoomName: () => 'Welcome Lounge', getMxcAvatarUrl: () => undefined, hasEncryptionStateEvent: () => true,
  currentState: { getStateEvents: () => undefined, maySendStateEvent: () => false, maySendEvent: () => true },
} as unknown as Room;
const client = { getSafeUserId: () => '@me:example.test', getUser: () => null, getAccountData: () => undefined,
  getVisibleRooms: () => [room], getRoomPushRule: () => undefined } as unknown as MatrixClient;
const snapshot = buildWorkspaceSnapshot(client, 'online');

declare global { interface Window { replyBodyFixture: { copied?: string; edits: Array<{ eventId: string; body: string }> } } }
window.replyBodyFixture = { edits: [] };
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (body: string) => { window.replyBodyFixture.copied = body; } } });

export function Fixture() {
  const workspace = { ...demoWorkspace, mode: 'matrix' as const, messagesByRoom: snapshot.messagesByRoom, threadsByRoot: snapshot.threadsByRoot };
  return <Workspace workspace={workspace} config={defaultRuntimeConfig} theme="aqua" preferences={defaultUserPreferences}
    onPreferencesChange={() => {}} onThemeChange={() => {}} onSignOut={() => {}}
    onEditMessage={async (_roomId, eventId, body) => { window.replyBodyFixture.edits.push({ eventId, body }); }} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
