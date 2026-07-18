import type { EncryptedMediaInfo } from './mediaContext';
import type {
  MatrixClient,
  MatrixEvent,
  NotificationCountType,
  Room,
  RoomMember,
  User,
} from 'matrix-js-sdk';

const matrixEventType = {
  direct: 'm.direct',
  encrypted: 'm.room.encrypted',
  message: 'm.room.message',
  reaction: 'm.reaction',
  sticker: 'm.sticker',
  topic: 'm.room.topic',
} as const;

const matrixMessageType = {
  text: 'm.text',
  notice: 'm.notice',
  emote: 'm.emote',
  image: 'm.image',
  file: 'm.file',
  audio: 'm.audio',
  video: 'm.video',
} as const;
import {
  colorForId,
  initialsFor,
  type ConnectionState,
  type MemberSummary,
  type MessageSummary,
  type PresenceState,
  type RoomSummary,
  type SpaceSummary,
  type WorkspaceSnapshot,
} from './viewModels';

interface RelationContent {
  rel_type?: string;
  event_id?: string;
  key?: string;
  'm.in_reply_to'?: { event_id?: string };
}

interface MessageContent {
  [key: string]: unknown;
  body?: string;
  msgtype?: string;
  url?: string;
  file?: EncryptedMediaInfo & { url?: string };
  info?: { mimetype?: string };
  'm.new_content'?: MessageContent;
  'm.relates_to'?: RelationContent;
}

function mapPresence(value?: string): PresenceState {
  if (value === 'online') return 'online';
  if (value === 'unavailable') return 'away';
  return 'offline';
}

function mediaSource(mxcUrl?: string | null): string | undefined {
  return mxcUrl?.startsWith('mxc://') ? mxcUrl : undefined;
}

function memberAvatar(member?: RoomMember | null): string | undefined {
  return mediaSource(member?.getMxcAvatarUrl());
}

function stripReplyFallback(body: string): string {
  const lines = body.split('\n');
  let index = 0;
  while (index < lines.length && lines[index].startsWith('>')) index += 1;
  if (index > 0 && lines[index] === '') index += 1;
  return lines.slice(index).join('\n') || body;
}

function eventBody(
  event: MatrixEvent,
  replacement?: MatrixEvent,
): {
  body: string;
  kind: MessageSummary['kind'];
  mediaUrl?: string;
  edited?: boolean;
  encryptedFile?: MessageSummary['encryptedFile'];
  mimeType?: string;
  mediaKind?: MessageSummary['mediaKind'];
} | undefined {
  if (event.isRedacted()) return undefined;
  const type = event.getType();
  if (type === matrixEventType.encrypted) {
    return { body: 'Waiting for encryption keys…', kind: 'encrypted' };
  }
  const originalContent = event.getContent<MessageContent>();
  if (type === matrixEventType.sticker) {
    if (typeof originalContent.body !== 'string') return undefined;
    return {
      body: originalContent.body,
      kind: 'sticker',
      mediaUrl: mediaSource(originalContent.url),
    };
  }
  if (type !== matrixEventType.message) return undefined;

  const replacementContent = replacement?.getContent<MessageContent>()['m.new_content'];
  const content = replacementContent ?? originalContent;
  if (typeof content.body !== 'string') return undefined;
  const body = originalContent['m.relates_to']?.['m.in_reply_to']
    ? stripReplyFallback(content.body)
    : content.body;

  switch (content.msgtype) {
    case matrixMessageType.text:
      return { body, kind: 'text', edited: Boolean(replacementContent) };
    case matrixMessageType.notice:
      return { body, kind: 'notice', edited: Boolean(replacementContent) };
    case matrixMessageType.emote:
      return { body, kind: 'emote', edited: Boolean(replacementContent) };
    case matrixMessageType.image:
    case matrixMessageType.file:
    case matrixMessageType.audio:
    case matrixMessageType.video: {
      const mediaKind =
        content.msgtype === matrixMessageType.image
          ? 'image'
          : content.msgtype === matrixMessageType.video
            ? 'video'
            : content.msgtype === matrixMessageType.audio
              ? 'audio'
              : 'file';
      return {
        body: body || mediaKind,
        kind: 'media',
        mediaUrl: mediaSource(content.file?.url ?? content.url),
        encryptedFile: content.file,
        mimeType: content.info?.mimetype,
        mediaKind,
      };
    }
    default:
      return undefined;
  }
}

function messagesForRoom(client: MatrixClient, room: Room, userId: string): MessageSummary[] {
  const events = room.getLiveTimeline().getEvents().slice(-250);
  const eventById = new Map(
    events.flatMap((event) => (event.getId() ? [[event.getId()!, event] as const] : [])),
  );
  const replacements = new Map<string, MatrixEvent>();
  const reactions = new Map<
    string,
    Map<string, { senders: Set<string>; ownEventId?: string }>
  >();

  for (const event of events) {
    const content = event.getContent<MessageContent>();
    const relation = content['m.relates_to'];
    const eventId = event.getId();
    const senderId = event.getSender();
    if (relation?.rel_type === 'm.replace' && relation.event_id) {
      const existing = replacements.get(relation.event_id);
      if (!existing || existing.getTs() < event.getTs()) replacements.set(relation.event_id, event);
    }
    if (
      event.getType() === matrixEventType.reaction &&
      relation?.rel_type === 'm.annotation' &&
      relation.event_id &&
      relation.key &&
      senderId &&
      eventId &&
      !event.isRedacted()
    ) {
      const byKey = reactions.get(relation.event_id) ?? new Map();
      const reaction = byKey.get(relation.key) ?? { senders: new Set<string>() };
      reaction.senders.add(senderId);
      if (senderId === userId) reaction.ownEventId = eventId;
      byKey.set(relation.key, reaction);
      reactions.set(relation.event_id, byKey);
    }
  }

  return events.flatMap((event): MessageSummary[] => {
    const content = event.getContent<MessageContent>();
    if (content['m.relates_to']?.rel_type === 'm.replace') return [];
    const eventId = event.getId();
    const senderId = event.getSender();
    const rendered = eventBody(event, eventId ? replacements.get(eventId) : undefined);
    if (!rendered || !senderId || !eventId) return [];
    const sender = room.getMember(senderId);
    const replyEventId = content['m.relates_to']?.['m.in_reply_to']?.event_id;
    const replyEvent = replyEventId ? eventById.get(replyEventId) : undefined;
    const replySenderId = replyEvent?.getSender();
    const replyRendered = replyEvent ? eventBody(replyEvent, replacements.get(replyEventId!)) : undefined;
    const eventReactions = [...(reactions.get(eventId)?.entries() ?? [])].map(
      ([key, reaction]) => ({
        key,
        count: reaction.senders.size,
        reacted: reaction.senders.has(userId),
        ownEventId: reaction.ownEventId,
      }),
    );

    return [{
      id: eventId,
      roomId: room.roomId,
      senderId,
      senderName: sender?.name || senderId,
      senderAvatarUrl: memberAvatar(sender),
      body: rendered.body,
      timestamp: event.getTs(),
      kind: rendered.kind,
      mediaUrl: rendered.mediaUrl,
      encryptedFile: rendered.encryptedFile,
      mimeType: rendered.mimeType,
      mediaKind: rendered.mediaKind,
      edited: rendered.edited,
      replyTo: replyEventId && replyRendered
        ? {
            eventId: replyEventId,
            senderName: (replySenderId && room.getMember(replySenderId)?.name) || replySenderId || 'Unknown',
            body: replyRendered.body,
          }
        : undefined,
      reactions: eventReactions.length ? eventReactions : undefined,
      isOwn: senderId === userId,
      pending: event.status !== null,
    }];
  });
}

function directRoomIds(client: MatrixClient): Set<string> {
  const getAccountData = client.getAccountData.bind(client) as unknown as (
    eventType: string,
  ) => MatrixEvent | undefined;
  const directEvent = getAccountData(matrixEventType.direct);
  const content = directEvent?.getContent<Record<string, unknown>>() ?? {};
  const ids = new Set<string>();
  for (const roomIds of Object.values(content)) {
    if (Array.isArray(roomIds)) {
      for (const roomId of roomIds) if (typeof roomId === 'string') ids.add(roomId);
    }
  }
  return ids;
}

function otherDirectMember(room: Room, userId: string): RoomMember | undefined {
  return room.getJoinedMembers().find((member) => member.userId !== userId);
}

function roomTopic(room: Room): string | undefined {
  const event = room.currentState.getStateEvents(matrixEventType.topic, '');
  const topic = event?.getContent<{ topic?: unknown }>().topic;
  return typeof topic === 'string' && topic.trim() ? topic.trim() : undefined;
}

function membersForRoom(client: MatrixClient, room: Room): MemberSummary[] {
  return room
    .getMembers()
    .filter(
      (member) =>
        member.membership === 'join' ||
        member.membership === 'invite' ||
        member.membership === 'ban',
    )
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 200)
    .map((member) => ({
      id: member.userId,
      displayName: member.name,
      avatarUrl: memberAvatar(member),
      presence: mapPresence(member.user?.presence),
      role: member.powerLevel >= 100 ? 'Admin' : member.powerLevel >= 50 ? 'Moderator' : undefined,
      powerLevel: member.powerLevel,
      membership: member.membership as 'join' | 'invite' | 'ban',
    }));
}

function currentUser(client: MatrixClient, userId: string): User | null {
  return client.getUser(userId);
}

export function buildWorkspaceSnapshot(
  client: MatrixClient,
  connection: ConnectionState,
): WorkspaceSnapshot {
  const userId = client.getSafeUserId();
  const matrixUser = currentUser(client, userId);
  const directIds = directRoomIds(client);
  const visible = client
    .getVisibleRooms()
    .filter((room) => room.getMyMembership() === 'join' || room.getMyMembership() === 'invite');
  const spaceRooms = visible.filter(
    (room) => room.getMyMembership() === 'join' && room.getType() === 'm.space',
  );
  const chatRooms = visible.filter((room) => room.getType() !== 'm.space');
  const messagesByRoom: Record<string, MessageSummary[]> = {};
  const membersByRoom: Record<string, MemberSummary[]> = {};

  const rooms: RoomSummary[] = chatRooms.map((room) => {
    const messages = messagesForRoom(client, room, userId);
    const pinnedEvent = room.currentState.getStateEvents('m.room.pinned_events', '');
    const pinnedIds = new Set(
      (pinnedEvent?.getContent<{ pinned?: unknown }>().pinned as unknown[] | undefined)?.filter(
        (eventId): eventId is string => typeof eventId === 'string',
      ) ?? [],
    );
    for (const message of messages) message.pinned = pinnedIds.has(message.id);
    messagesByRoom[room.roomId] = messages;
    membersByRoom[room.roomId] = membersForRoom(client, room);
    const membership = room.getMyMembership() === 'invite' ? 'invite' : 'join';
    const isDirect = directIds.has(room.roomId);
    const directMember = isDirect ? otherDirectMember(room, userId) : undefined;
    const latest = messages.at(-1);
    const unreadCount = room.getUnreadNotificationCount('total' as NotificationCountType);
    const highlightCount = room.getUnreadNotificationCount('highlight' as NotificationCountType);

    return {
      id: room.roomId,
      name: room.name || room.getDefaultRoomName(userId),
      avatarUrl: mediaSource(room.getMxcAvatarUrl()) ?? memberAvatar(directMember),
      kind: isDirect ? 'direct' : 'room',
      group:
        membership === 'invite'
          ? 'Invites'
          : unreadCount > 0
            ? 'Favorites'
            : isDirect
              ? 'Direct Messages'
              : 'Rooms',
      membership,
      presence: isDirect ? mapPresence(directMember?.user?.presence) : undefined,
      statusMessage: isDirect
        ? directMember?.user?.presenceStatusMsg || undefined
        : roomTopic(room),
      lastMessage: latest?.body ?? roomTopic(room) ?? 'No messages yet',
      unreadCount,
      highlighted: highlightCount > 0,
      encrypted: room.hasEncryptionStateEvent(),
      topic: roomTopic(room),
      canManage: (room.getMember(userId)?.powerLevel ?? 0) >= 50,
      ownPowerLevel: room.getMember(userId)?.powerLevel ?? 0,
      typingUsers: room
        .getJoinedMembers()
        .filter((member) => member.userId !== userId && member.typing)
        .map((member) => member.name),
      muted: client
        .getRoomPushRule('global', room.roomId)
        ?.actions.some((action) => action === 'dont_notify'),
      updatedAt: latest?.timestamp ?? room.getLastActiveTimestamp(),
    };
  });

  rooms.sort((left, right) => {
    if (left.unreadCount !== right.unreadCount) return right.unreadCount - left.unreadCount;
    return right.updatedAt - left.updatedAt;
  });

  const spaces: SpaceSummary[] = [
    {
      id: 'home',
      name: 'All conversations',
      initials: 'A',
      color: '#267ec1',
      roomIds: chatRooms.map((room) => room.roomId),
    },
    ...spaceRooms.map((space) => ({
      id: space.roomId,
      name: space.name || 'Space',
      avatarUrl: mediaSource(space.getMxcAvatarUrl()),
      initials: initialsFor(space.name || 'Space'),
      color: colorForId(space.roomId),
      roomIds: space.currentState
        .getStateEvents('m.space.child')
        .map((event) => event.getStateKey())
        .filter((roomId): roomId is string => Boolean(roomId)),
    })),
  ];

  return {
    mode: 'matrix',
    connection,
    user: {
      id: userId,
      displayName: matrixUser?.displayName || userId,
      avatarUrl: mediaSource(matrixUser?.avatarUrl),
      presence: mapPresence(matrixUser?.presence),
      statusMessage: matrixUser?.presenceStatusMsg || 'Available',
    },
    spaces,
    rooms,
    messagesByRoom,
    membersByRoom,
  };
}
