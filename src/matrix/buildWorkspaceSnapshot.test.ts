import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import {
  buildWorkspaceSnapshot,
  createWorkspaceSnapshotCache,
} from './buildWorkspaceSnapshot';

function fakeEvent(
  type: string,
  content: Record<string, unknown>,
  id = '$event:test',
  sender = '@mara:test',
): MatrixEvent {
  return {
    getId: () => id,
    getSender: () => sender,
    getTs: () => 1000,
    getType: () => type,
    getContent: () => content,
    isRedacted: () => false,
    status: null,
  } as unknown as MatrixEvent;
}

function fakeClient(
  events: MatrixEvent[],
  options: {
    unreadCount?: number;
    timelineUnreadCount?: number;
    readUpToEventId?: string;
    threads?: Array<{ id: string; length: number; events: MatrixEvent[] }>;
  } = {},
): MatrixClient {
  const room = {
    roomId: '!room:test',
    name: 'Sticker Room',
    getMyMembership: () => 'join',
    getType: () => undefined,
    getLiveTimeline: () => ({ getEvents: () => events }),
    getThreads: () => options.threads ?? [],
    getMember: vi.fn().mockReturnValue(undefined),
    getMembers: () => [],
    getJoinedMembers: () => [],
    getUnreadNotificationCount: (type: string) => type === 'total' ? options.unreadCount ?? 0 : 0,
    getRoomUnreadNotificationCount: (type: string) =>
      type === 'total' ? options.timelineUnreadCount ?? options.unreadCount ?? 0 : 0,
    getEventReadUpTo: () => options.readUpToEventId ?? null,
    getLastActiveTimestamp: () => 0,
    getDefaultRoomName: () => 'Sticker Room',
    getMxcAvatarUrl: () => undefined,
    hasEncryptionStateEvent: () => true,
    currentState: {
      getStateEvents: () => undefined,
      maySendStateEvent: () => false,
    },
  } as unknown as Room;

  return {
    getSafeUserId: () => '@me:test',
    getUser: () => null,
    getAccountData: () => undefined,
    getVisibleRooms: () => [room],
    getRoomPushRule: () => undefined,
  } as unknown as MatrixClient;
}

describe('buildWorkspaceSnapshot stickers', () => {
  it('preserves standard Matrix mention user IDs for message rendering', () => {
    const client = fakeClient([
      fakeEvent('m.room.message', {
        msgtype: 'm.text', body: '@Spencer hello', 'm.mentions': { user_ids: ['@me:test'] },
      }),
    ]);
    const [message] = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(message.mentionUserIds).toEqual(['@me:test']);
  });

  it('renders plain stickers from their original Matrix media URL', () => {
    const client = fakeClient([
      fakeEvent('m.sticker', {
        body: 'Laughing bubble',
        url: 'mxc://test/sticker',
        info: { mimetype: 'image/svg+xml' },
      }),
    ]);

    const [message] = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(message).toMatchObject({
      kind: 'sticker',
      body: 'Laughing bubble',
      mediaUrl: 'mxc://test/sticker',
      mimeType: 'image/svg+xml',
      encryptedFile: undefined,
    });
  });

  it('renders encrypted stickers from content.file with decryption metadata', () => {
    const client = fakeClient([
      fakeEvent('m.sticker', {
        body: 'Encrypted hello',
        file: {
          url: 'mxc://test/encrypted-sticker',
          key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'key', ext: true },
          iv: 'iv',
          hashes: { sha256: 'hash' },
        },
        info: { mimetype: 'image/png' },
      }),
    ]);

    const [message] = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(message).toMatchObject({
      kind: 'sticker',
      body: 'Encrypted hello',
      mediaUrl: 'mxc://test/encrypted-sticker',
      mimeType: 'image/png',
    });
    expect((message.encryptedFile as unknown as { url?: string })?.url).toBe('mxc://test/encrypted-sticker');
    expect(message.encryptedFile?.key.k).toBe('key');
  });

  it('preserves code-file metadata on standard Matrix file messages', () => {
    const client = fakeClient([
      fakeEvent('m.room.message', {
        msgtype: 'm.file',
        body: 'snippet.ts',
        url: 'mxc://test/snippet',
        info: { mimetype: 'text/plain' },
        'dev.alucard.aimtrix.code.v1': { language: 'typescript' },
      }),
    ]);

    const [message] = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(message).toMatchObject({
      kind: 'media',
      mediaKind: 'file',
      codeFile: true,
      codeLanguage: 'typescript',
      mediaUrl: 'mxc://test/snippet',
    });
  });
});

describe('buildWorkspaceSnapshot read position', () => {
  it('maps the current user receipt to the preceding rendered message', () => {
    const client = fakeClient(
      [
        fakeEvent('m.room.message', { msgtype: 'm.text', body: 'read' }, '$read:test'),
        fakeEvent('m.reaction', {}, '$reaction:test'),
        fakeEvent('m.room.message', { msgtype: 'm.text', body: 'unread' }, '$unread:test'),
      ],
      { unreadCount: 1, readUpToEventId: '$reaction:test' },
    );

    const snapshot = buildWorkspaceSnapshot(client, 'online');

    expect(snapshot.rooms[0].readUpToMessageId).toBe('$read:test');
  });

  it('does not place aggregate thread-only unreads on the main timeline', () => {
    const client = fakeClient(
      [fakeEvent('m.room.message', { msgtype: 'm.text', body: 'read' }, '$read:test')],
      { unreadCount: 4, timelineUnreadCount: 0, readUpToEventId: '$read:test' },
    );

    const snapshot = buildWorkspaceSnapshot(client, 'online');

    expect(snapshot.rooms[0]).toMatchObject({
      unreadCount: 4,
      timelineUnreadCount: 0,
      readUpToMessageId: undefined,
    });
  });
});

describe('buildWorkspaceSnapshot threads', () => {
  it('keeps thread replies out of the main timeline and exposes a root summary', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Ship it?' }, '$root:test');
    const reply = fakeEvent('m.room.message', {
      msgtype: 'm.text',
      body: 'Absolutely.',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$root:test',
        'm.in_reply_to': { event_id: '$root:test' },
      },
    }, '$reply:test');
    const snapshot = buildWorkspaceSnapshot(fakeClient([root], {
      threads: [{ id: '$root:test', length: 1, events: [root, reply] }],
    }), 'online');

    expect(snapshot.messagesByRoom['!room:test']).toHaveLength(1);
    expect(snapshot.messagesByRoom['!room:test'][0]).toMatchObject({
      id: '$root:test',
      isThreadRoot: true,
      thread: { replyCount: 1, latestReply: { body: 'Absolutely.' } },
    });
    expect(snapshot.threadsByRoot['$root:test'].messages).toMatchObject([
      { id: '$reply:test', threadRootId: '$root:test', body: 'Absolutely.' },
    ]);
  });
});

describe('buildWorkspaceSnapshot cache', () => {
  it('reuses message arrays when the room version and timeline are unchanged', () => {
    const client = fakeClient([
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'hello' }),
    ]);
    const cache = createWorkspaceSnapshotCache();
    const first = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    const second = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(second.messagesByRoom['!room:test']).toBe(first.messagesByRoom['!room:test']);
  });

  it('rebuilds and keeps stable message identities when the room version bumps', () => {
    const events = [
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'hello' }, '$a:test'),
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'world' }, '$b:test'),
    ];
    const client = fakeClient(events);
    const cache = createWorkspaceSnapshotCache();
    const first = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    cache.roomVersions.set('!room:test', 1);
    events.push(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'again' }, '$c:test'));
    const second = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    const firstMessages = first.messagesByRoom['!room:test'];
    const secondMessages = second.messagesByRoom['!room:test'];
    expect(secondMessages).not.toBe(firstMessages);
    expect(secondMessages).toHaveLength(3);
    expect(secondMessages[0]).toBe(firstMessages[0]);
    expect(secondMessages[1]).toBe(firstMessages[1]);
  });
});
