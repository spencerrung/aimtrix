import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { inMainTimelineForReceipt } from 'matrix-js-sdk';
import { MatrixEvent as SDKEvent, RoomState } from 'matrix-js-sdk';
import { HISTORY_MESSAGE_LIMIT } from './historyEvents';
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
    tags?: Record<string, Record<string, unknown>>;
    canonicalAlias?: string;
    directUserId?: string;
    threads?: Array<{
      id: string; length: number; events: MatrixEvent[]; rootEvent?: MatrixEvent;
      replyToEvent?: MatrixEvent; hasCurrentUserParticipated?: boolean;
      getReadReceiptForUserId?: (userId: string) => { eventId: string } | null;
      timelineSet?: { relations: { getAllChildEventsForEvent: (eventId: string) => MatrixEvent[] } };
    }>;
  } = {},
): MatrixClient {
  const room = {
    roomId: '!room:test',
    name: 'Sticker Room',
    tags: options.tags ?? {},
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
      getStateEvents: (type: string) => type === 'm.room.canonical_alias' && options.canonicalAlias
        ? fakeEvent(type, { alias: options.canonicalAlias }) : undefined,
      maySendStateEvent: () => false,
    },
  } as unknown as Room;

  return {
    getSafeUserId: () => '@me:test',
    getUser: () => null,
    getAccountData: (type: string) => type === 'm.direct' && options.directUserId
      ? fakeEvent(type, { [options.directUserId]: ['!room:test'] }) : undefined,
    getVisibleRooms: () => [room],
    getRoomPushRule: () => options.muted ? { actions: ['dont_notify'], enabled: options.pushRuleEnabled } : undefined,
  } as unknown as MatrixClient;
}

describe('favorite and navigation room summaries', () => {
  it('uses only the standard favorite tag, independently of unread badges', () => {
    const favorite = fakeClient([], { tags: { 'm.favourite': { order: 0.5 }, 'org.example.custom': {} } });
    expect(buildWorkspaceSnapshot(favorite, 'online').rooms[0]).toMatchObject({ favorite: true, group: 'Favorites', badgeCount: 0 });
    const unread = fakeClient([], { unreadCount: 3 });
    expect(buildWorkspaceSnapshot(unread, 'online').rooms[0]).toMatchObject({ favorite: false, group: 'Favorites' });
    const custom = fakeClient([], { tags: { 'org.example.favorite': {} } });
    expect(buildWorkspaceSnapshot(custom, 'online').rooms[0]).toMatchObject({ favorite: false, group: 'Rooms' });
  });

  it('reflects tag additions and removals even when message snapshots are cached', () => {
    const client = fakeClient([]);
    const room = client.getVisibleRooms()[0];
    const cache = createWorkspaceSnapshotCache();
    expect(buildWorkspaceSnapshot(client, 'online', [], undefined, cache).rooms[0].favorite).toBe(false);
    room.tags = { 'm.favourite': {} };
    expect(buildWorkspaceSnapshot(client, 'online', [], undefined, cache).rooms[0].favorite).toBe(true);
    room.tags = {};
    expect(buildWorkspaceSnapshot(client, 'online', [], undefined, cache).rooms[0].group).toBe('Rooms');
  });

  it('keeps invitations in their group even if another client favorites them', () => {
    const client = fakeClient([], { tags: { 'm.favourite': {} } });
    client.getVisibleRooms()[0].getMyMembership = () => 'invite';
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0]).toMatchObject({ favorite: true, group: 'Invites' });
  });

  it('exposes the canonical alias and m.direct counterpart before that person joins', () => {
    const client = fakeClient([], { canonicalAlias: '#synthetic:test', directUserId: '@other:test' });
    expect(buildWorkspaceSnapshot(client, 'online').rooms[0]).toMatchObject({
      canonicalAlias: '#synthetic:test', directUserId: '@other:test', kind: 'direct',
    });
    expect(buildWorkspaceSnapshot(fakeClient([]), 'online').rooms[0]).toMatchObject({
      canonicalAlias: undefined, directUserId: undefined,
    });
  });

  it('ignores malformed navigation metadata while retaining standard Unicode aliases', () => {
    expect(buildWorkspaceSnapshot(fakeClient([], { canonicalAlias: '#team lounge:test', directUserId: '@legacy person:test' }), 'online').rooms[0])
      .toMatchObject({ canonicalAlias: '#team lounge:test', directUserId: '@legacy person:test', kind: 'direct' });
    expect(buildWorkspaceSnapshot(fakeClient([], { canonicalAlias: '#missing-server', directUserId: 'not-a-user' }), 'online').rooms[0])
      .toMatchObject({ canonicalAlias: undefined, directUserId: undefined, kind: 'room' });
  });
});

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

describe('safe rich content and action capabilities', () => {
  it.each(['m.image', 'm.video', 'm.audio', 'm.file'])('keeps a %s caption separate from its safe download filename', (msgtype) => {
    const [captioned, legacy] = buildWorkspaceSnapshot(fakeClient([
      fakeEvent('m.room.message', { msgtype, body: 'A readable caption', filename: '../folder/report\u0000.txt', url: 'mxc://test/file' }, '$captioned'),
      fakeEvent('m.room.message', { msgtype, body: 'legacy.txt', url: 'mxc://test/legacy' }, '$legacy'),
    ]), 'online').messagesByRoom['!room:test'];
    expect(captioned).toMatchObject({ body: 'A readable caption', fileName: 'report.txt' });
    expect(legacy).toMatchObject({ body: 'legacy.txt', fileName: 'legacy.txt' });
  });
  it.each(['m.text', 'm.notice', 'm.emote'])('preserves formatted replacement and mention parity for %s', (msgtype) => {
    const original = fakeEvent('m.room.message', { msgtype, body: 'Before' }, '$original');
    const edit = fakeEvent('m.room.message', {
      msgtype, body: '* After', 'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
      'm.new_content': { msgtype, body: 'Alice after', format: 'org.matrix.custom.html', formatted_body: '<p><a href="https://matrix.to/#/@alice:test">Alice</a> <strong>after</strong></p>', 'm.mentions': { user_ids: ['@alice:test'] } },
    }, '$edit');
    const [message] = buildWorkspaceSnapshot(fakeClient([original, edit]), 'online').messagesByRoom['!room:test'];
    expect(message).toMatchObject({ body: 'Alice after', kind: msgtype.slice(2), edited: true, mentionUserIds: ['@alice:test'], mentions: [{ userId: '@alice:test', label: 'Alice' }] });
    expect(message.formatted).toEqual([{ type: 'element', tag: 'p', children: [
      { type: 'link', href: 'https://matrix.to/#/@alice:test', userId: '@alice:test', children: [{ type: 'text', text: 'Alice' }] },
      { type: 'text', text: ' ' }, { type: 'element', tag: 'strong', children: [{ type: 'text', text: 'after' }] },
    ] }]);
  });

  it('ignores malformed replacement content and keeps a truthful fallback for unknown message kinds', () => {
    const original = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Original' }, '$original');
    const edit = fakeEvent('m.room.message', { msgtype: 'm.text', body: '* Invalid', 'm.relates_to': { rel_type: 'm.replace', event_id: '$original' }, 'm.new_content': { msgtype: 'm.text' } }, '$edit');
    const unknown = fakeEvent('m.room.message', { msgtype: 'org.example.future', body: 'Plain fallback', format: 'org.matrix.custom.html', formatted_body: '<script>never render</script>' }, '$future');
    const empty = fakeEvent('m.room.message', { msgtype: 'org.example.future' }, '$empty');
    const rows = buildWorkspaceSnapshot(fakeClient([original, edit, unknown, empty]), 'online').messagesByRoom['!room:test'];
    expect(rows.map((message) => message.body)).toEqual(['Original', 'Plain fallback', 'This message type is not supported yet.']);
    expect(rows[1]).toMatchObject({ kind: 'unsupported', fallbackType: 'org.example.future', formatted: undefined });
  });

  it('uses actual SDK event permissions instead of a fixed moderator power threshold', () => {
    const own = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Own' }, '$own', '@me:test');
    const peer = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Peer' }, '$peer');
    const client = fakeClient([own, peer]);
    const room = client.getVisibleRooms()[0];
    const state = new RoomState(room.roomId);
    state.setStateEvents([new SDKEvent({ room_id: room.roomId, type: 'm.room.create', state_key: '', sender: '@creator:test', content: { room_version: '10', creator: '@creator:test' } })]);
    state.setStateEvents([new SDKEvent({ room_id: room.roomId, type: 'm.room.member', state_key: '@me:test', sender: '@me:test', content: { membership: 'join' } })]);
    Object.assign(room, { currentState: state });
    let revision = 0;
    const levels = (events: Record<string, number>, power = 10, redact = 100) => state.setStateEvents([new SDKEvent({
      room_id: room.roomId, type: 'm.room.power_levels', state_key: '', sender: '@me:test', event_id: `$power-${++revision}`,
      content: { users: { '@me:test': power }, events, events_default: 0, state_default: 99, redact },
    })]);
    levels({ 'm.room.pinned_events': 5, 'm.reaction': 20 });
    let rows = buildWorkspaceSnapshot(client, 'online').messagesByRoom[room.roomId];
    expect(rows[0].actions).toEqual({ reply: true, thread: true, edit: true, pin: true, react: false, redact: true });
    expect(rows[1].actions?.redact).toBe(false);
    levels({ 'm.room.pinned_events': 100, 'm.room.redaction': 100, 'm.room.encrypted': 100 }, 90);
    rows = buildWorkspaceSnapshot(client, 'online').messagesByRoom[room.roomId];
    expect(rows[0].actions).toEqual({ reply: false, thread: false, edit: false, pin: false, react: true, redact: false });
    levels({ 'm.room.encrypted': 100 }, 90, 50);
    rows = buildWorkspaceSnapshot(client, 'online').messagesByRoom[room.roomId];
    expect(rows[0].actions?.react).toBe(true);
    expect(rows[0].actions?.reply).toBe(false);
    expect(rows[1].actions?.redact).toBe(true);
    Object.assign(room, { getMyMembership: () => 'invite' });
    rows = buildWorkspaceSnapshot(client, 'online').messagesByRoom[room.roomId];
    expect(Object.values(rows[0].actions!)).toEqual([false, false, false, false, false, false]);
  });

  it('gates pending message actions and keeps room/thread/root formatted content equivalent', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Root', format: 'org.matrix.custom.html', formatted_body: '<b>Root</b>' }, '$root');
    const reply = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Reply', format: 'org.matrix.custom.html', formatted_body: '<b>Reply</b>', 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } }, '$reply');
    const pending = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Pending' }, '$pending', '@me:test'), { status: 'sent' });
    const client = fakeClient([root, pending], { threads: [{ id: '$root', length: 1, rootEvent: root, events: [root, reply] }] });
    Object.assign(client.getVisibleRooms()[0].currentState, { maySendEvent: () => true, maySendStateEvent: () => true, maySendRedactionForEvent: () => true });
    const snapshot = buildWorkspaceSnapshot(client, 'online');
    expect(snapshot.threadsByRoot.$root.root?.formatted).toEqual(snapshot.messagesByRoom['!room:test'][0].formatted);
    expect(snapshot.threadsByRoot.$root.messages[0].formatted).toEqual([{ type: 'element', tag: 'strong', children: [{ type: 'text', text: 'Reply' }] }]);
    expect(Object.values(snapshot.messagesByRoom['!room:test'][1].actions!)).toEqual([false, false, false, false, false, false]);
  });

  it('keeps own reaction removal separate from adding denied reactions and refreshes capability changes', () => {
    const original = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Message' }, '$original');
    const reaction = fakeEvent('m.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$original', key: '✨' } }, '$reaction', '@me:test');
    const client = fakeClient([original, reaction]);
    const state = client.getVisibleRooms()[0].currentState;
    Object.assign(state, { maySendEvent: () => false, maySendRedactionForEvent: () => true });
    const cache = createWorkspaceSnapshotCache();
    const before = buildWorkspaceSnapshot(client, 'online', [], [], cache).messagesByRoom['!room:test'][0];
    expect(before.actions?.react).toBe(false);
    expect(before.reactions?.[0]).toMatchObject({ reacted: true, canRemove: true });
    Object.assign(state, { maySendRedactionForEvent: () => false });
    cache.roomVersions.set('!room:test', 1);
    const after = buildWorkspaceSnapshot(client, 'online', [], [], cache).messagesByRoom['!room:test'][0];
    expect(after).not.toBe(before);
    expect(after.reactions?.[0].canRemove).toBe(false);
    expect(before.reactions?.[0].canRemove).toBe(true);
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
  const replyEvent = (id: string, body = 'Synthetic reply', rootId = '$root:test', sender = '@mara:test') =>
    fakeEvent('m.room.message', { msgtype: 'm.text', body, 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } }, id, sender);

  it('keeps a durable SDK root when the room window has moved on and bounds live replies', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic old root' }, '$root:test');
    const replies = Array.from({ length: 400 }, (_, index) => Object.assign(replyEvent(`$reply-${index}`), { getTs: () => index + 2000 }));
    const snapshot = buildWorkspaceSnapshot(fakeClient([], {
      threads: [{ id: '$root:test', length: 400, rootEvent: root, events: replies, hasCurrentUserParticipated: true }],
    }), 'online');
    expect(snapshot.messagesByRoom['!room:test']).toEqual([]);
    expect(snapshot.threadsByRoot['$root:test']).toMatchObject({
      roomId: '!room:test', rootStatus: 'found', root: { id: '$root:test', body: 'Synthetic old root' },
      replyCount: 400, participated: true, latestActivity: 2399, latestReplyEventId: '$reply-399',
    });
    expect(snapshot.threadsByRoot['$root:test'].messages).toHaveLength(HISTORY_MESSAGE_LIMIT);
    expect(snapshot.threadsByRoot['$root:test'].messages[0].id).toBe('$reply-150');
  });

  it('uses the selected historical thread page while live metadata and accepted-tail proof stay current', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Independent root' }, '$root:test');
    const old = replyEvent('$old');
    const latest = Object.assign(replyEvent('$latest', 'Latest accepted reply'), { getTs: () => 9000 });
    const pending = Object.assign(replyEvent('$pending', 'Pending reply', '$root:test', '@me:test'), { status: 'not_sent', getTxnId: () => 'synthetic-pending', getTs: () => 10000 });
    const cache = createWorkspaceSnapshotCache();
    cache.threadHistory.set('$root:test', { roomId: '!room:test', rootId: '$root:test', root, rootStatus: 'found', events: [old], state: { mode: 'history', revision: 7, canLoadOlder: true, canLoadNewer: true } });
    cache.localEvents.set('!room:test', new Map([['synthetic-pending', pending]]));
    const client = fakeClient([], { threads: [{ id: '$root:test', length: 20, events: [latest], replyToEvent: pending }] });
    const snapshot = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    const thread = snapshot.threadsByRoot['$root:test'];
    expect(thread.messages.map((message) => message.id)).toEqual(['$old']);
    expect(thread).toMatchObject({ root: { body: 'Independent root' }, history: { mode: 'history', revision: 7 }, replyCount: 21, latestReplyEventId: '$latest', latestActivity: 10000 });
    expect(thread.participated).toBeUndefined();
    cache.threadHistory.get('$root:test')!.state.revision = 8;
    expect(thread.history?.revision).toBe(7);
  });

  it.each(['loading', 'removed', 'unavailable'] as const)('keeps a requested empty thread visible with a truthful %s root state', (rootStatus) => {
    const cache = createWorkspaceSnapshotCache();
    cache.threadHistory.set('$root:test', { roomId: '!room:test', rootId: '$root:test', rootStatus, events: [], state: { mode: 'live', revision: 1, canLoadOlder: false, canLoadNewer: false } });
    const snapshot = buildWorkspaceSnapshot(fakeClient([]), 'online', [], [], cache);
    expect(snapshot.threadsByRoot['$root:test']).toMatchObject({ roomId: '!room:test', rootStatus, messages: [], replyCount: 0 });
    expect(snapshot.threadsByRoot['$root:test'].root).toBeUndefined();
  });

  it('hides retained root content after a newer SDK root has been redacted', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic removed root' }, '$root:test');
    const removed = Object.assign(fakeEvent('m.room.message', {}, '$root:test'), { isRedacted: () => true });
    const cache = createWorkspaceSnapshotCache();
    const reply = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic reply', 'm.relates_to': { rel_type: 'm.thread', event_id: '$root:test', 'm.in_reply_to': { event_id: '$root:test' } } }, '$reply');
    cache.threadHistory.set('$root:test', { roomId: '!room:test', rootId: '$root:test', root, rootStatus: 'found', events: [reply], state: { mode: 'live', revision: 2, canLoadOlder: false, canLoadNewer: false } });
    const snapshot = buildWorkspaceSnapshot(fakeClient([], { threads: [{ id: '$root:test', length: 1, events: [], rootEvent: removed }] }), 'online', [], [], cache);
    expect(snapshot.threadsByRoot['$root:test']).toMatchObject({ rootStatus: 'removed', messages: [{ id: '$reply' }] });
    expect(snapshot.threadsByRoot['$root:test'].root).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('Synthetic removed root');
  });

  it('retains encryption placeholders and encrypted media without crossing room or thread boundaries', () => {
    const root = Object.assign(fakeEvent('m.room.encrypted', {}, '$root:test'), { threadRootId: '$root:test' });
    const encrypted = Object.assign(fakeEvent('m.room.encrypted', {}, '$encrypted'), { threadRootId: '$root:test' });
    const file = { url: 'mxc://synthetic.test/file', key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'synthetic-key', ext: true }, iv: 'synthetic-iv', hashes: { sha256: 'synthetic-hash' }, v: 'v2' };
    const media = fakeEvent('m.room.message', { msgtype: 'm.file', body: 'Synthetic attachment', file, info: { mimetype: 'text/plain' }, 'm.relates_to': { rel_type: 'm.thread', event_id: '$root:test' } }, '$media');
    const wrongRoom = Object.assign(replyEvent('$wrong-room'), { getRoomId: () => '!other:test' });
    const cache = createWorkspaceSnapshotCache();
    cache.threadHistory.set('$other-root', { roomId: '!other:test', rootId: '$other-root', rootStatus: 'unavailable', events: [], state: { mode: 'live', revision: 1, canLoadOlder: false, canLoadNewer: false } });
    const snapshot = buildWorkspaceSnapshot(fakeClient([], { threads: [{ id: '$root:test', length: 2, rootEvent: root, events: [encrypted, media, wrongRoom, replyEvent('$wrong-thread', 'Wrong thread', '$other-root')] }] }), 'online', [], [], cache);
    expect(snapshot.threadsByRoot['$root:test'].root).toMatchObject({ kind: 'encrypted', body: 'Waiting for encryption keys…' });
    expect(snapshot.threadsByRoot['$root:test'].messages).toMatchObject([{ id: '$encrypted', kind: 'encrypted' }, { id: '$media', encryptedFile: file }]);
    expect(snapshot.threadsByRoot['$root:test'].messages).toHaveLength(2);
    expect(snapshot.threadsByRoot['$other-root']).toBeUndefined();
  });

  it('applies loaded thread edits and reactions with only thread-scoped reader receipts', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic root' }, '$root:test');
    const reply = replyEvent('$reply', 'Before');
    const edit = fakeEvent('m.room.message', { msgtype: 'm.text', body: '* After', 'm.new_content': { msgtype: 'm.text', body: 'After' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' } }, '$edit');
    const reaction = fakeEvent('m.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$reply', key: '✨' } }, '$reaction');
    const threadReceipt = vi.fn((userId: string) => userId === '@mara:test' ? { eventId: '$reply' } : null);
    const client = fakeClient([], { threads: [{ id: '$root:test', length: 1, rootEvent: root, events: [reply], getReadReceiptForUserId: threadReceipt, timelineSet: { relations: { getAllChildEventsForEvent: (eventId) => eventId === '$reply' ? [edit, reaction] : [] } } }] });
    const room = client.getVisibleRooms()[0];
    Object.assign(room, { getJoinedMembers: () => [{ userId: '@mara:test', name: 'Mara', getMxcAvatarUrl: () => undefined }, { userId: '@other:test', name: 'Other', getMxcAvatarUrl: () => undefined }], getReadReceiptForUserId: () => ({ eventId: '$reply' }) });
    const snapshot = buildWorkspaceSnapshot(client, 'online');
    expect(snapshot.threadsByRoot['$root:test'].messages[0]).toMatchObject({ body: 'After', edited: true, reactions: [{ key: '✨', count: 1 }], readBy: [{ id: '@mara:test', displayName: 'Mara' }] });
    expect(snapshot.threadsByRoot['$root:test'].messages[0].readBy).toHaveLength(1);
    expect(threadReceipt).toHaveBeenCalledWith('@other:test');
  });

  it('uses server-bundled totals and participation with a separately decrypted live tail when no SDK thread exists', () => {
    const root = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic root' }, '$root:test'), {
      getServerAggregatedRelation: (type: string) => type === 'm.thread' ? { count: 1200, current_user_participated: false } : undefined,
    });
    const latest = Object.assign(replyEvent('$latest', 'Decrypted latest reply'), { getRoomId: () => '!room:test', getTs: () => 2000 });
    const cache = createWorkspaceSnapshotCache();
    cache.threadHistory.set('$root:test', { roomId: '!room:test', rootId: '$root:test', root, rootStatus: 'found', latestEvent: latest, events: [replyEvent('$older')], state: { mode: 'history', revision: 4, canLoadOlder: true, canLoadNewer: true } });
    const snapshot = buildWorkspaceSnapshot(fakeClient([root]), 'online', [], [], cache);
    expect(snapshot.threadsByRoot['$root:test']).toMatchObject({ replyCount: 1200, participated: false, latestReplyEventId: '$latest', latestActivity: 2000, latestReply: { body: 'Decrypted latest reply' }, messages: [{ id: '$older' }] });
    expect(snapshot.threadsByRoot['$root:test'].replyCountIsLowerBound).toBeUndefined();
    expect(snapshot.messagesByRoom['!room:test'][0].thread?.replyCount).toBe(1200);
  });

  it('marks unknown partial totals as lower bounds and leaves unproven participation unknown', () => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic root' }, '$root:test');
    const cache = createWorkspaceSnapshotCache();
    const state = { mode: 'live' as const, revision: 1, canLoadOlder: true, canLoadNewer: false };
    cache.threadHistory.set('$root:test', { roomId: '!room:test', rootId: '$root:test', root, rootStatus: 'found', events: [replyEvent('$reply')], state });
    const client = fakeClient([root]);
    const partial = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(partial.threadsByRoot['$root:test']).toMatchObject({ replyCount: 1, replyCountIsLowerBound: true, latestReplyEventId: '$reply' });
    expect(partial.threadsByRoot['$root:test'].participated).toBeUndefined();
    expect(partial.messagesByRoom['!room:test'][0].thread?.replyCountIsLowerBound).toBe(true);
    state.canLoadOlder = false;
    expect(buildWorkspaceSnapshot(client, 'online', [], [], cache).threadsByRoot['$root:test'].replyCountIsLowerBound).toBeUndefined();
  });

  it('preserves controller-owned count uncertainty and participation when a minimal SDK thread appears', () => {
    const root = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic root' }, '$root:test'), {
      getServerAggregatedRelation: () => ({ count: 1200, current_user_participated: false }),
    });
    const latest = Object.assign(replyEvent('$newest'), { getRoomId: () => '!room:test' });
    const cache = createWorkspaceSnapshotCache();
    const view = { roomId: '!room:test', rootId: '$root:test', root, rootStatus: 'found' as const, replyCount: 1200, replyCountIsLowerBound: true, participated: true,
      latestEvent: latest, events: [replyEvent('$older')], state: { mode: 'history' as const, revision: 1, canLoadOlder: true, canLoadNewer: true } };
    cache.threadHistory.set('$root:test', view);
    const client = fakeClient([root], { threads: [{ id: '$root:test', length: 1, events: [latest], hasCurrentUserParticipated: false }] });
    const snapshot = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(snapshot.threadsByRoot['$root:test']).toMatchObject({ replyCount: 1200, replyCountIsLowerBound: true, participated: true, latestReplyEventId: '$newest' });
    expect(snapshot.messagesByRoom['!room:test'][0].thread).toMatchObject({ replyCount: 1200, replyCountIsLowerBound: true });
    view.replyCount = 1201;
    view.replyCountIsLowerBound = false;
    const refreshed = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(refreshed.threadsByRoot['$root:test'].replyCount).toBe(1201);
    expect(refreshed.threadsByRoot['$root:test'].replyCountIsLowerBound).toBeUndefined();
  });

  it.each(['wrong-room', 'wrong-thread', 'pending', 'redacted', 'edit', 'root'])('rejects an invalid cached live-tail proof: %s', (invalid) => {
    const root = fakeEvent('m.room.message', { msgtype: 'm.text', body: 'Synthetic root' }, '$root:test');
    let latest = Object.assign(replyEvent('$latest', 'Invalid cached tail', invalid === 'wrong-thread' ? '$other-root' : '$root:test'), { getRoomId: () => invalid === 'wrong-room' ? '!other:test' : '!room:test' });
    if (invalid === 'pending') Object.assign(latest, { status: 'sending' });
    if (invalid === 'redacted') Object.assign(latest, { isRedacted: () => true });
    if (invalid === 'edit') latest = Object.assign(fakeEvent('m.room.message', { msgtype: 'm.text', body: '* Invalid cached edit', 'm.relates_to': { rel_type: 'm.replace', event_id: '$old' } }, '$edit'), { getRoomId: () => '!room:test', threadRootId: '$root:test' });
    if (invalid === 'root') latest = Object.assign(root, { getRoomId: () => '!room:test' });
    const cache = createWorkspaceSnapshotCache();
    cache.threadHistory.set('$root:test', { roomId: '!room:test', rootId: '$root:test', root, rootStatus: 'found', latestEvent: latest, events: [replyEvent('$old')], state: { mode: 'history', revision: 1, canLoadOlder: true, canLoadNewer: true } });
    const summary = buildWorkspaceSnapshot(fakeClient([]), 'online', [], [], cache).threadsByRoot['$root:test'];
    expect(summary.latestReplyEventId).toBeUndefined();
    expect(summary.latestReply).toBeUndefined();
  });

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
