import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { inMainTimelineForReceipt } from 'matrix-js-sdk';
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
    highlightCount?: number;
    timelineHighlightCount?: number;
    threadUnreadCount?: number;
    threadHighlightCount?: number;
    muted?: boolean;
    pushRuleEnabled?: boolean;
    accountData?: Record<string, Record<string, unknown>>;
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
    getUnreadNotificationCount: (type: string) => type === 'total' ? options.unreadCount ?? 0 : options.highlightCount ?? 0,
    getRoomUnreadNotificationCount: (type: string) =>
      type === 'total' ? options.timelineUnreadCount ?? options.unreadCount ?? 0 : options.timelineHighlightCount ?? 0,
    getThreadUnreadNotificationCount: (_rootId: string, type: string) => type === 'total' ? options.threadUnreadCount ?? 0 : options.threadHighlightCount ?? 0,
    getEventReadUpTo: vi.fn(() => options.readUpToEventId ?? null),
    getAccountData: (type: string) => options.accountData?.[type] ? fakeEvent(type, options.accountData[type]) : undefined,
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
    getRoomPushRule: () => options.muted ? { actions: ['dont_notify'], enabled: options.pushRuleEnabled } : undefined,
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

  it('maps cross-client rich mention labels to their canonical Matrix IDs', () => {
    const client = fakeClient([
      fakeEvent('m.room.message', {
        msgtype: 'm.text',
        body: '@Spencer hello',
        format: 'org.matrix.custom.html',
        formatted_body: '<a href="https://matrix.to/#/%40me%3Atest">@Spencer</a> hello',
        'm.mentions': { user_ids: ['@me:test'] },
      }),
    ]);
    const [message] = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(message.mentions).toEqual([{ userId: '@me:test', label: '@Spencer' }]);
  });

  it('applies the latest valid Matrix replacement and keeps original event metadata', () => {
    const original = fakeEvent(
      'm.room.message',
      { msgtype: 'm.text', body: 'Before' },
      '$original:test',
      '@mara:test',
    );
    const replacement = fakeEvent(
      'm.room.message',
      {
        msgtype: 'm.text',
        body: '* After',
        'm.new_content': { msgtype: 'm.text', body: 'After' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$original:test' },
      },
      '$replacement:test',
      '@mara:test',
    );
    const client = fakeClient([original, replacement]);

    const messages = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: '$original:test',
      body: 'After',
      timestamp: 1000,
      edited: true,
    });
  });

  it('rejects SDK replacement aggregates that do not target the original event', () => {
    const wrongReplacement = fakeEvent(
      'm.room.message',
      {
        msgtype: 'm.text',
        body: '* Wrong',
        'm.new_content': { msgtype: 'm.text', body: 'Wrong' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$someone-else:test' },
      },
      '$wrong:test',
      '@mara:test',
    );
    const original = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Original' }, '$original:test', '@mara:test');
    Object.assign(original, { replacingEvent: () => wrongReplacement });
    const [message] = buildWorkspaceSnapshot(fakeClient([original]), 'online').messagesByRoom['!room:test'];

    expect(message).toMatchObject({ body: 'Original' });
    expect(message.edited).toBe(false);
  });

  it('breaks equal-timestamp replacement ties by greatest event ID', () => {
    const original = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Original' }, '$original:test', '@mara:test');
    const replacement = (eventId: string, body: string) => fakeEvent(
      'm.room.message',
      {
        msgtype: 'm.text',
        body: `* ${body}`,
        'm.new_content': { msgtype: 'm.text', body },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$original:test' },
      },
      eventId,
      '@mara:test',
    );
    const messages = buildWorkspaceSnapshot(
      fakeClient([original, replacement('$z:test', 'Greatest'), replacement('$a:test', 'Later in array')]),
      'online',
    ).messagesByRoom['!room:test'];

    expect(messages[0].body).toBe('Greatest');
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
  it('falls back to the private fully-read account marker when SDK receipts cannot resolve', () => {
    const client = fakeClient([
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Earlier synthetic message' }, '$read:test'),
      fakeEvent('m.reaction', {}, '$reaction:test'),
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Newer synthetic message' }, '$unread:test'),
    ], { unreadCount: 1, accountData: { 'm.fully_read': { event_id: '$reaction:test' } } });
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0].readUpToMessageId).toBe('$read:test');
    expect(client.getVisibleRooms()[0].getEventReadUpTo).toHaveBeenCalledWith('@me:test', true);
  });

  it('prefers a resolved server receipt over an older fully-read marker', () => {
    const client = fakeClient([
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'First synthetic message' }, '$first:test'),
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Second synthetic message' }, '$second:test'),
    ], { unreadCount: 1, readUpToEventId: '$second:test', accountData: { 'm.fully_read': { event_id: '$first:test' } } });
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0].readUpToMessageId).toBe('$second:test');
  });

  it.each([42, 'invalid', '$missing:test'])('does not invent a rendered read position for marker %s', (eventId) => {
    const client = fakeClient([fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic message' })], {
      unreadCount: 1, accountData: { 'm.fully_read': { event_id: eventId } },
    });
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0].readUpToMessageId).toBeUndefined();
  });

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

describe('buildWorkspaceSnapshot unread badges', () => {
  it('uses the legacy reminder only when the standard event is absent', () => {
    const accountData: Record<string, Record<string, unknown>> = { 'com.famedly.marked_unread': { unread: true } };
    const client = fakeClient([], { accountData });
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0]).toMatchObject({ markedUnread: true, badgeCount: 1 });
    accountData['m.marked_unread'] = { unread: false };
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0]).toMatchObject({ markedUnread: false, badgeCount: 0 });
    accountData['m.marked_unread'] = { unread: 'malformed' };
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0]).toMatchObject({ markedUnread: false, badgeCount: 0 });
  });

  it('does not mute a room whose dont_notify push rule is disabled', () => {
    const client = fakeClient([], { unreadCount: 8, highlightCount: 2, muted: true, pushRuleEnabled: false });
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0]).toMatchObject({ muted: false, unreadCount: 8, badgeCount: 8 });
  });

  it('clears only proven fully-read main counters, retaining thread totals and highlights without SDK mutation', () => {
    const main = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic main' }, '$main:test');
    const reply = Object.assign(fakeEvent('m.room.message', {
      msgtype: 'm.text', body: 'Synthetic reply', 'm.relates_to': { rel_type: 'm.thread', event_id: '$main:test' },
    }, '$thread:test'), { threadRootId: '$main:test', isRelation: () => true });
    const pending = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic pending' }, '$pending:test'), { status: 'sending' });
    const client = fakeClient([main, reply, pending], {
      unreadCount: 7, timelineUnreadCount: 3, highlightCount: 3, timelineHighlightCount: 2,
      threadUnreadCount: 4, threadHighlightCount: 1,
      threads: [{ id: '$main:test', length: 4, events: [main, reply] }],
      accountData: { 'm.fully_read': { event_id: '$main:test' } },
    });
    const snapshot = buildWorkspaceSnapshot(client, 'online', [], [], undefined, inMainTimelineForReceipt);
    expect(snapshot.rooms[0]).toMatchObject({ unreadCount: 4, timelineUnreadCount: 0, highlightCount: 1, badgeCount: 4, readUpToMessageId: undefined });
    expect(snapshot.threadsByRoot['$main:test']).toMatchObject({ unreadCount: 4, highlighted: true });
    expect(snapshot.spaces[0].unreadCount).toBe(4);
    expect(client.getVisibleRooms()[0].getUnreadNotificationCount('total' as never)).toBe(7);
  });

  it.each(['$earlier:test', '$unloaded:test', '$thread:test'])('does not clear main counts for an unproven fully-read boundary %s', (eventId) => {
    const earlier = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic earlier' }, '$earlier:test');
    const latest = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic latest' }, '$latest:test');
    const thread = Object.assign(fakeEvent('m.room.message', {
      msgtype: 'm.text', body: 'Synthetic thread', 'm.relates_to': { rel_type: 'm.thread', event_id: '$earlier:test' },
    }, '$thread:test'), { threadRootId: '$earlier:test', isRelation: () => true });
    const client = fakeClient([earlier, latest, thread], {
      unreadCount: 3, timelineUnreadCount: 2, accountData: { 'm.fully_read': { event_id: eventId } },
    });
    expect(buildWorkspaceSnapshot(client, 'online', [], [], undefined, inMainTimelineForReceipt).rooms[0])
      .toMatchObject({ unreadCount: 3, timelineUnreadCount: 2, badgeCount: 3 });
  });

  it('keeps a deliberate reminder when fully-read fallback clears main counts and does not inflate notification counts', () => {
    const client = fakeClient([fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic latest' }, '$latest:test')], {
      unreadCount: 2, highlightCount: 1, timelineHighlightCount: 1,
      accountData: { 'm.fully_read': { event_id: '$latest:test' }, 'm.marked_unread': { unread: true } },
    });
    expect(buildWorkspaceSnapshot(client, 'online', [], [], undefined, inMainTimelineForReceipt).rooms[0])
      .toMatchObject({ unreadCount: 0, timelineUnreadCount: 0, highlightCount: 0, badgeCount: 1, markedUnread: true });
  });

  it('uses the SDK aggregate once and exposes independent thread and main-timeline counts', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic root' }, '$root:test');
    const client = fakeClient([root], {
      unreadCount: 7, timelineUnreadCount: 3, highlightCount: 2,
      threadUnreadCount: 4, threadHighlightCount: 1,
      threads: [{ id: '$root:test', length: 4, events: [root] }],
    });
    const snapshot = buildWorkspaceSnapshot(client, 'online');
    expect(snapshot.rooms[0]).toMatchObject({ unreadCount: 7, timelineUnreadCount: 3, badgeCount: 7, highlightCount: 2, highlighted: true });
    expect(snapshot.spaces.find((space) => space.id === 'home')?.unreadCount).toBe(7);
    expect(snapshot.threadsByRoot['$root:test']).toMatchObject({ unreadCount: 4, highlighted: true });
    expect(snapshot.messagesByRoom['!room:test'][0].thread).toMatchObject({ unreadCount: 4, highlighted: true });
  });

  it.each([
    { highlightCount: 0, marker: false, badgeCount: 0 },
    { highlightCount: 2, marker: false, badgeCount: 2 },
    { highlightCount: 0, marker: true, badgeCount: 1 },
  ])('retains muted counts but displays mentions and explicit reminders: %j', ({ highlightCount, marker, badgeCount }) => {
    const client = fakeClient([], { unreadCount: 8, muted: true, highlightCount, accountData: { 'm.marked_unread': { unread: marker } } });
    const snapshot = buildWorkspaceSnapshot(client, 'online');
    expect(snapshot.rooms[0]).toMatchObject({ unreadCount: 8, badgeCount, muted: true, markedUnread: marker, highlighted: highlightCount > 0, group: badgeCount > 0 ? 'Favorites' : 'Rooms' });
    expect(snapshot.spaces.find((space) => space.id === 'home')?.unreadCount).toBe(badgeCount);
  });

  it('keeps the standard reminder usable without an Aimtrix extension and preserves unloaded saved locations', () => {
    const options = { accountData: { 'm.marked_unread': { unread: true } as Record<string, unknown> } };
    const client = fakeClient([], options);
    const first = buildWorkspaceSnapshot(client, 'online');
    expect(first.rooms[0]).toMatchObject({ unreadCount: 0, badgeCount: 1, markedUnread: true, unreadEventId: undefined });
    options.accountData['m.marked_unread']['dev.alucard.aimtrix.return_point'] = { event_id: '$older:test' };
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0].unreadEventId).toBe('$older:test');
    expect(first.rooms[0].unreadEventId).toBeUndefined();
  });

  it('refreshes thread notification metadata without mutating cached messages', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic root' }, '$root:test');
    const options = { threads: [{ id: '$root:test', length: 1, events: [root] }], threadUnreadCount: 1, threadHighlightCount: 1 };
    const client = fakeClient([root], options);
    const cache = createWorkspaceSnapshotCache();
    const first = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    options.threadUnreadCount = 0;
    options.threadHighlightCount = 0;
    const second = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(first.messagesByRoom['!room:test'][0].thread).toMatchObject({ unreadCount: 1, highlighted: true });
    expect(second.messagesByRoom['!room:test'][0].thread).toMatchObject({ unreadCount: 0, highlighted: false });
  });

  it('counts shared child rooms once per space and applies the same badge policy to home and directs', () => {
    const mutedClient = fakeClient([], { unreadCount: 8, highlightCount: 2, muted: true });
    const mutedRoom = mutedClient.getVisibleRooms()[0];
    const regularRoom = Object.assign(fakeClient([], { unreadCount: 3 }).getVisibleRooms()[0], { roomId: '!second:test' });
    const client = {
      ...mutedClient,
      getVisibleRooms: () => [mutedRoom, regularRoom],
      getAccountData: (type: string) => type === 'm.direct' ? fakeEvent(type, { '@mara:test': ['!room:test', '!second:test'] }) : undefined,
      getRoomPushRule: (_scope: string, roomId: string) => roomId === '!room:test' ? { actions: ['dont_notify'] } : undefined,
    } as unknown as MatrixClient;
    const snapshot = buildWorkspaceSnapshot(client, 'online', [
      { id: '!parent:test', name: 'Parent', roomType: 'm.space', childIds: ['!room:test', '!child:test'] },
      { id: '!child:test', name: 'Child', roomType: 'm.space', childIds: ['!room:test', '!second:test'] },
    ]);
    for (const spaceId of ['home', 'directs', '!parent:test', '!child:test']) {
      expect(snapshot.spaces.find((space) => space.id === spaceId)).toMatchObject({ unreadCount: 5, highlighted: true });
    }
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

describe('message delivery snapshots', () => {
  it('distinguishes every SDK phase, hides cancelled events, and keeps a stable transaction identity', () => {
    const statuses = ['queued', 'encrypting', 'sending', 'not_sent', 'sent', null, 'cancelled'] as const;
    const events = statuses.map((status, index) => Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic send' }, `$send-${index}`, '@me:test'), { status, getTxnId: () => `txn-${index}` }));
    const messages = buildWorkspaceSnapshot(fakeClient(events), 'online').messagesByRoom['!room:test'];
    expect(messages.map((message) => message.delivery)).toEqual(['queued', 'encrypting', 'sending', 'failed', 'accepted', 'accepted']);
    expect(messages.map((message) => message.pending)).toEqual([true, true, true, false, false, false]);
    expect(messages[3].transactionId).toBe('txn-3');
    expect(messages[3].deliveryError).toContain('Retrying reuses this message');
  });

  it('refreshes a failed non-tail event and reconciles the remote echo without duplicates', () => {
    const pending = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Earlier synthetic send' }, '$local', '@me:test'), { status: 'sending', getTxnId: () => 'stable-txn' }) as unknown as MatrixEvent;
    const events = [pending, fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Later synthetic send' })];
    const client = fakeClient(events);
    const cache = createWorkspaceSnapshotCache();
    const before = buildWorkspaceSnapshot(client, 'online', [], [], cache).messagesByRoom['!room:test'];
    Object.assign(pending, { status: 'not_sent', error: { errcode: 'M_FORBIDDEN', message: 'private server detail' } });
    const failed = buildWorkspaceSnapshot(client, 'online', [], [], cache).messagesByRoom['!room:test'];
    expect(failed[0]).not.toBe(before[0]);
    expect(failed[0].delivery).toBe('failed');
    expect(failed[0].deliveryError).toContain('permissions');
    expect(JSON.stringify(failed)).not.toContain('private server detail');
    Object.assign(pending, { status: null, getId: () => '$remote' });
    const accepted = buildWorkspaceSnapshot(client, 'online', [], [], cache).messagesByRoom['!room:test'];
    expect(accepted).toHaveLength(2);
    expect(accepted[0]).toMatchObject({ id: '$remote', transactionId: 'stable-txn', delivery: 'accepted' });
  });

  it('shows and reconciles SDK thread echoes missing from chronological timelines without mutating previous roots', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Thread root' }, '$root');
    const reply = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Local reply', 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } }, '$local', '@me:test'), { status: 'not_sent', getTxnId: () => 'thread-txn' }) as unknown as MatrixEvent;
    const threads: Array<{ id: string; length: number; events: MatrixEvent[] }> = [];
    const client = fakeClient([root], { threads });
    const cache = createWorkspaceSnapshotCache();
    const before = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    cache.localEvents.set('!room:test', new Map([['thread-txn', reply]]));
    const failed = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(failed.threadsByRoot.$root.messages).toHaveLength(1);
    expect(failed.messagesByRoom['!room:test']).toHaveLength(1);
    expect(failed.messagesByRoom['!room:test'][0].thread?.replyCount).toBe(1);
    expect(before.messagesByRoom['!room:test'][0].thread).toBeUndefined();
    threads.push({ id: '$root', length: 100, events: [] });
    expect(buildWorkspaceSnapshot(client, 'online', [], [], cache).threadsByRoot.$root.replyCount).toBe(101);
    threads.length = 0;
    Object.assign(reply, { status: null, getId: () => '$remote' });
    const acceptedWithoutTimeline = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(acceptedWithoutTimeline.threadsByRoot.$root.messages[0]).toMatchObject({ id: '$remote', delivery: 'accepted' });
    threads.push({ id: '$root', length: 100, events: [] });
    expect(buildWorkspaceSnapshot(client, 'online', [], [], cache).threadsByRoot.$root.replyCount).toBe(100);
    threads.length = 0;
    cache.localEvents.clear();
    threads.push({ id: '$root', length: 1, events: [reply] });
    const accepted = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(accepted.threadsByRoot.$root.messages).toEqual([expect.objectContaining({ id: '$remote', delivery: 'accepted', transactionId: 'thread-txn' })]);
    expect(failed.threadsByRoot.$root.messages[0].delivery).toBe('failed');
  });

  it('removes cancelled chronological thread replies from the displayed count', () => {
    const cancelled = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Cancelled', 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } }, '$cancelled', '@me:test'), { status: 'cancelled', threadRootId: '$root' }) as unknown as MatrixEvent;
    const snapshot = buildWorkspaceSnapshot(fakeClient([], { threads: [{ id: '$root', length: 1, events: [cancelled] }] }), 'online');
    expect(snapshot.threadsByRoot.$root).toBeUndefined();
  });

  it('keeps a failed thread edit visible when its target is outside loaded events', () => {
    const edit = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: '* Edited reply', 'm.new_content': { msgtype: 'm.text', body: 'Edited reply' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$older-reply' } }, '$edit', '@me:test'), { status: 'not_sent', threadRootId: '$root' }) as unknown as MatrixEvent;
    const snapshot = buildWorkspaceSnapshot(fakeClient([], { threads: [{ id: '$root', length: 1, events: [edit] }] }), 'online');
    expect(snapshot.threadsByRoot.$root.messages).toEqual([expect.objectContaining({ id: '$edit', threadRootId: '$root', delivery: 'failed', pendingEdit: true })]);
  });

  it('keeps failed edits recoverable without applying them to the accepted message', () => {
    const original = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Original' }, '$original', '@me:test');
    const edit = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: '* Edited', 'm.new_content': { msgtype: 'm.text', body: 'Edited' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$original' } }, '$edit', '@me:test'), { status: 'not_sent' }) as unknown as MatrixEvent;
    const client = fakeClient([original, edit]);
    const failed = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(failed.map((message) => message.body)).toEqual(['Original', '* Edited']);
    expect(failed[1]).toMatchObject({ delivery: 'failed', pendingEdit: true });
    Object.assign(edit, { status: null });
    const accepted = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ body: 'Edited', edited: true });
  });
});


describe('history window snapshots', () => {
  it('uses already-loaded late relations outside the selected pagination range', () => {
    const original = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Earlier' }, '$earlier');
    const reaction = fakeEvent('m.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$earlier', key: '✨' } }, '$late-reaction');
    const visibleChild = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Outside the selected window', 'm.relates_to': { rel_type: 'm.annotation', event_id: '$earlier', key: '✨' } }, '$visible-annotation');
    const client = fakeClient([original]);
    Object.assign(client.getVisibleRooms()[0], { getUnfilteredTimelineSet: () => ({ relations: { getAllChildEventsForEvent: (id: string) => id === '$earlier' ? [reaction, visibleChild] : [] } }) });
    const cache = createWorkspaceSnapshotCache();
    cache.history.set('!room:test', { events: [original], state: { mode: 'history', revision: 1, canLoadOlder: true, canLoadNewer: true } });
    const selected = buildWorkspaceSnapshot(client, 'online', [], [], cache).messagesByRoom['!room:test'];
    expect(selected).toHaveLength(1);
    expect(selected[0].reactions).toEqual([{ key: '✨', count: 1, reacted: false }]);
    expect(cache.history.get('!room:test')!.events).toEqual([original]);
  });

  it('renders selected older messages and their relations while the sidebar stays live', () => {
    const events = Array.from({ length: 400 }, (_, index) => fakeEvent('m.room.message', { msgtype: 'm.text', body: `Synthetic history ${index}` }, `$history-${index}`));
    const reaction = fakeEvent('m.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$history-10', key: '✨' } }, '$reaction');
    const edit = fakeEvent('m.room.message', { msgtype: 'm.text', body: '* Corrected', 'm.new_content': { msgtype: 'm.text', body: 'Corrected' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$history-10' } }, '$edit');
    const client = fakeClient(events);
    const cache = createWorkspaceSnapshotCache();
    cache.history.set('!room:test', { events: [...events.slice(0, 250), reaction, edit], state: { mode: 'history', revision: 1, canLoadOlder: false, canLoadNewer: true } });
    const snapshot = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    const messages = snapshot.messagesByRoom['!room:test'];
    expect(messages).toHaveLength(250);
    expect(messages[10]).toMatchObject({ id: '$history-10', body: 'Corrected', reactions: [{ key: '✨', count: 1, reacted: false }] });
    expect(snapshot.rooms[0].lastMessage).toBe('Synthetic history 399');
    expect(snapshot.historyByRoom?.['!room:test']).toMatchObject({ mode: 'history', canLoadNewer: true });
  });

  it('keeps unresolved reply targets actionable and does not append new local sends into old context', () => {
    const reply = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'A reply', 'm.relates_to': { 'm.in_reply_to': { event_id: '$older' } } }, '$reply');
    const pending = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'New synthetic send' }, '$pending', '@me:test'), { status: 'sending', getTxnId: () => 'pending-txn' }) as unknown as MatrixEvent;
    const cache = createWorkspaceSnapshotCache();
    cache.localEvents.set('!room:test', new Map([['pending-txn', pending]]));
    cache.history.set('!room:test', { events: [reply], state: { mode: 'context', revision: 1, canLoadOlder: true, canLoadNewer: true, targetEventId: '$reply', targetStatus: 'found' } });
    const snapshot = buildWorkspaceSnapshot(fakeClient([reply, pending]), 'online', [], [], cache);
    expect(snapshot.messagesByRoom['!room:test']).toHaveLength(1);
    expect(snapshot.messagesByRoom['!room:test'][0].replyTo).toEqual({ eventId: '$older', senderName: 'Earlier message', body: 'Open the original message' });
  });
});
