import type { EncryptedMediaInfo } from './mediaContext';
import {
  DIRECT_BACKGROUNDS_EVENT,
  ROOM_BACKGROUND_EVENT,
  backgroundPermissionForThreshold,
  parseDirectBackgrounds,
  parseRoomBackground,
} from './roomBackgrounds';
import { resolveReadReceiptTarget, resolveReadReceiptTargets } from './readReceipts';
import {
  resolveSpaceRelations,
  type SpaceHierarchyRoomData,
  type SpaceRelationSeed,
} from './spaceHierarchy';
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
  spaceChild: 'm.space.child',
  spaceParent: 'm.space.parent',
  powerLevels: 'm.room.power_levels',
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
  type SpaceRoomPreview,
  type SpaceSummary,
  type WorkspaceSnapshot,
} from './viewModels';

interface RelationContent {
  rel_type?: string;
  event_id?: string;
  key?: string;
  'm.in_reply_to'?: { event_id?: string };
}

interface CachedMessages {
  version: number;
  fingerprint: string;
  value: MessageSummary[];
}

interface CachedMembers {
  version: number;
  presence: number;
  value: MemberSummary[];
}

export interface WorkspaceSnapshotCache {
  roomVersions: Map<string, number>;
  presenceVersion: number;
  messages: Map<string, CachedMessages>;
  members: Map<string, CachedMembers>;
}

export function createWorkspaceSnapshotCache(): WorkspaceSnapshotCache {
  return {
    roomVersions: new Map<string, number>(),
    presenceVersion: 0,
    messages: new Map<string, CachedMessages>(),
    members: new Map<string, CachedMembers>(),
  };
}

function timelineFingerprint(events: MatrixEvent[]): string {
  const last = events.at(-1);
  return `${events.length}:${last?.getId() ?? ''}:${last?.status ?? ''}`;
}

function reactionsEqual(
  left: NonNullable<MessageSummary['reactions']>,
  right: NonNullable<MessageSummary['reactions']>,
): boolean {
  return left.length === right.length && left.every((reaction, index) => {
    const other = right[index];
    return reaction.key === other.key &&
      reaction.count === other.count &&
      reaction.reacted === other.reacted &&
      reaction.ownEventId === other.ownEventId;
  });
}

function readersEqual(
  left: NonNullable<MessageSummary['readBy']>,
  right: NonNullable<MessageSummary['readBy']>,
): boolean {
  return left.length === right.length && left.every((reader, index) => {
    const other = right[index];
    return reader.id === other.id &&
      reader.displayName === other.displayName &&
      reader.avatarUrl === other.avatarUrl;
  });
}

function messagesEqual(left: MessageSummary, right: MessageSummary): boolean {
  return left.senderId === right.senderId &&
    left.senderName === right.senderName &&
    left.senderAvatarUrl === right.senderAvatarUrl &&
    left.body === right.body &&
    left.timestamp === right.timestamp &&
    left.kind === right.kind &&
    left.mediaUrl === right.mediaUrl &&
    left.mimeType === right.mimeType &&
    left.mediaKind === right.mediaKind &&
    left.edited === right.edited &&
    left.pinned === right.pinned &&
    left.pending === right.pending &&
    left.isOwn === right.isOwn &&
    left.encryptedFile === right.encryptedFile &&
    left.replyTo?.eventId === right.replyTo?.eventId &&
    left.replyTo?.senderName === right.replyTo?.senderName &&
    left.replyTo?.body === right.replyTo?.body &&
    (left.reactions === undefined
      ? right.reactions === undefined
      : right.reactions !== undefined && reactionsEqual(left.reactions, right.reactions)) &&
    (left.readBy === undefined
      ? right.readBy === undefined
      : right.readBy !== undefined && readersEqual(left.readBy, right.readBy));
}

function reuseUnchangedMessages(
  previous: MessageSummary[],
  next: MessageSummary[],
): MessageSummary[] {
  if (!previous.length) return next;
  const previousById = new Map(previous.map((message) => [message.id, message]));
  return next.map((message) => {
    const existing = previousById.get(message.id);
    return existing && messagesEqual(existing, message) ? existing : message;
  });
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
    const file = originalContent.file;
    return {
      body: originalContent.body,
      kind: 'sticker',
      mediaUrl: mediaSource(file?.url ?? originalContent.url),
      encryptedFile: file,
      mimeType: originalContent.info?.mimetype,
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

function messagesForRoom(
  client: MatrixClient,
  room: Room,
  userId: string,
  pinnedIds: ReadonlySet<string>,
): MessageSummary[] {
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

  const messages = events.flatMap((event): MessageSummary[] => {
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
      pinned: pinnedIds.has(eventId),
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

  const joinedReaders = room
    .getJoinedMembers()
    .filter((candidate) => candidate.userId !== userId)
    .slice(0, 100);
  const memberById = new Map(joinedReaders.map((member) => [member.userId, member]));
  const getReceipt = (room as unknown as {
    getReadReceiptForUserId?: (memberId: string) => { eventId: string } | null;
  }).getReadReceiptForUserId?.bind(room);
  if (getReceipt) {
    const targets = resolveReadReceiptTargets(
      events.flatMap((event) => event.getId() ?? []),
      messages.map((message) => message.id),
      joinedReaders.flatMap((member) => {
        const receipt = getReceipt(member.userId);
        return receipt ? [{ readerId: member.userId, eventId: receipt.eventId }] : [];
      }),
    );
    for (const message of messages) {
      const readers = targets.get(message.id) ?? [];
      message.readBy = readers.flatMap((readerId) => {
        const member = memberById.get(readerId);
        return member ? [{
          id: member.userId,
          displayName: member.name || member.userId,
          avatarUrl: memberAvatar(member),
        }] : [];
      });
      if (!message.readBy.length) message.readBy = undefined;
    }
  }

  return messages;
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
      role: member.powerLevel >= 100 ? 'Admin' : member.powerLevel >= 50 ? 'Moderator' : member.powerLevel >= 25 ? 'Decorator' : undefined,
      powerLevel: member.powerLevel,
      membership: member.membership as 'join' | 'invite' | 'ban',
    }));
}

function currentUser(client: MatrixClient, userId: string): User | null {
  return client.getUser(userId);
}

function orderedSpaceRelations(room: Room, eventType: string): string[] {
  return room.currentState
    .getStateEvents(eventType)
    .flatMap((event) => {
      const id = event.getStateKey();
      const content = event.getContent<{ via?: unknown; order?: unknown }>();
      const via = Array.isArray(content.via)
        ? content.via.filter((server): server is string => typeof server === 'string' && server.length > 0)
        : [];
      if (!id || !via.length) return [];
      const order =
        typeof content.order === 'string' && /^[\x20-\x7E]{1,50}$/.test(content.order)
          ? content.order
          : undefined;
      return [{ id, order }];
    })
    .sort((left, right) => {
      if (left.order && right.order) return left.order.localeCompare(right.order) || left.id.localeCompare(right.id);
      if (left.order) return -1;
      if (right.order) return 1;
      return left.id.localeCompare(right.id);
    })
    .map((relation) => relation.id);
}

function mapSpaceMembership(value?: string): 'join' | 'invite' | 'leave' {
  if (value === 'join' || value === 'invite') return value;
  return 'leave';
}

export function buildWorkspaceSnapshot(
  client: MatrixClient,
  connection: ConnectionState,
  hierarchyRooms: SpaceHierarchyRoomData[] = [],
  rootSpaceOrder: string[] = [],
  cache?: WorkspaceSnapshotCache,
): WorkspaceSnapshot {
  const userId = client.getSafeUserId();
  const matrixUser = currentUser(client, userId);
  const directIds = directRoomIds(client);
  const directBackgroundEvent = (
    client as unknown as { getAccountData: (type: string) => MatrixEvent | undefined }
  ).getAccountData(DIRECT_BACKGROUNDS_EVENT);
  const directBackgrounds = parseDirectBackgrounds(directBackgroundEvent?.getContent());
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
    const roomVersion = cache?.roomVersions.get(room.roomId) ?? 0;
    const timelineEvents = cache ? room.getLiveTimeline().getEvents() : undefined;
    const fingerprint = timelineEvents ? timelineFingerprint(timelineEvents) : '';
    const cachedMessages = cache?.messages.get(room.roomId);
    const messages =
      cachedMessages && cachedMessages.version === roomVersion && cachedMessages.fingerprint === fingerprint
        ? cachedMessages.value
        : (() => {
            const pinnedEvent = room.currentState.getStateEvents('m.room.pinned_events', '');
            const pinnedIds = new Set(
              (pinnedEvent?.getContent<{ pinned?: unknown }>().pinned as unknown[] | undefined)?.filter(
                (eventId): eventId is string => typeof eventId === 'string',
              ) ?? [],
            );
            const rebuilt = messagesForRoom(client, room, userId, pinnedIds);
            const reconciled = cachedMessages
              ? reuseUnchangedMessages(cachedMessages.value, rebuilt)
              : rebuilt;
            cache?.messages.set(room.roomId, { version: roomVersion, fingerprint, value: reconciled });
            return reconciled;
          })();
    messagesByRoom[room.roomId] = messages;
    const cachedMembers = cache?.members.get(room.roomId);
    membersByRoom[room.roomId] =
      cachedMembers && cachedMembers.version === roomVersion && cachedMembers.presence === cache?.presenceVersion
        ? cachedMembers.value
        : (() => {
            const rebuilt = membersForRoom(client, room);
            cache?.members.set(room.roomId, { version: roomVersion, presence: cache.presenceVersion, value: rebuilt });
            return rebuilt;
          })();
    const membership = room.getMyMembership() === 'invite' ? 'invite' : 'join';
    const isDirect = directIds.has(room.roomId);
    const directMember = isDirect ? otherDirectMember(room, userId) : undefined;
    const latest = messages.at(-1);
    const unreadCount = room.getUnreadNotificationCount('total' as NotificationCountType);
    const timelineUnreadCount = room.getRoomUnreadNotificationCount(
      'total' as NotificationCountType,
    );
    const highlightCount = room.getUnreadNotificationCount('highlight' as NotificationCountType);
    const readUpToEventId = timelineUnreadCount > 0 ? room.getEventReadUpTo(userId) : null;
    const readUpToMessageId = readUpToEventId
      ? resolveReadReceiptTarget(
          room.getLiveTimeline().getEvents().flatMap((event) => event.getId() ?? []),
          messages.map((message) => message.id),
          readUpToEventId,
        )
      : undefined;
    const ownPowerLevel = room.getMember(userId)?.powerLevel ?? 0;
    const powerLevelEvent = room.currentState.getStateEvents(matrixEventType.powerLevels, '');
    const powerLevelContent = powerLevelEvent?.getContent<{
      events?: Record<string, number>;
      state_default?: number;
    }>() ?? {};
    const backgroundThreshold = powerLevelContent.events?.[ROOM_BACKGROUND_EVENT]
      ?? powerLevelContent.state_default
      ?? 50;
    const sharedBackground = parseRoomBackground(
      room.currentState.getStateEvents(ROOM_BACKGROUND_EVENT, '')?.getContent(),
    );
    const background = isDirect ? directBackgrounds[room.roomId] : sharedBackground;
    const canChangeBackground = isDirect || (
      typeof room.currentState.maySendStateEvent === 'function'
        ? room.currentState.maySendStateEvent(ROOM_BACKGROUND_EVENT, userId)
        : ownPowerLevel >= backgroundThreshold
    );
    const canManageBackgroundPolicy = !isDirect && (
      typeof room.currentState.maySendStateEvent === 'function'
        ? room.currentState.maySendStateEvent(matrixEventType.powerLevels, userId)
        : ownPowerLevel >= 100
    );

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
      timelineUnreadCount,
      readUpToMessageId,
      highlighted: highlightCount > 0,
      encrypted: room.hasEncryptionStateEvent(),
      topic: roomTopic(room),
      canManage: ownPowerLevel >= 50,
      ownPowerLevel,
      typingUsers: room
        .getJoinedMembers()
        .filter((member) => member.userId !== userId && member.typing)
        .map((member) => member.name),
      muted: client
        .getRoomPushRule('global', room.roomId)
        ?.actions.some((action) => action === 'dont_notify'),
      background,
      backgroundPolicy: {
        mode: isDirect ? 'members' : backgroundPermissionForThreshold(backgroundThreshold),
        requiredPowerLevel: isDirect ? 0 : backgroundThreshold,
        canChange: canChangeBackground,
        canManage: canManageBackgroundPolicy,
      },
      updatedAt: latest?.timestamp ?? room.getLastActiveTimestamp(),
    };
  });

  rooms.sort((left, right) => {
    if (left.unreadCount !== right.unreadCount) return right.unreadCount - left.unreadCount;
    return right.updatedAt - left.updatedAt;
  });

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const hierarchyById = new Map(hierarchyRooms.map((room) => [room.id, room]));
  const joinedSpaceById = new Map(spaceRooms.map((space) => [space.roomId, space]));
  const spaceIds = [...new Set([
    ...spaceRooms.map((space) => space.roomId),
    ...hierarchyRooms
      .filter((room) => room.roomType === 'm.space')
      .map((room) => room.id)
      .filter((spaceId) => !joinedSpaceById.has(spaceId)),
  ])];
  const seeds: SpaceRelationSeed[] = spaceIds.map((spaceId) => {
    const joinedSpace = joinedSpaceById.get(spaceId);
    const hierarchySpace = hierarchyById.get(spaceId);
    return {
      id: spaceId,
      childIds: joinedSpace
        ? orderedSpaceRelations(joinedSpace, matrixEventType.spaceChild)
        : hierarchySpace?.childIds ?? [],
      parentIds: joinedSpace
        ? orderedSpaceRelations(joinedSpace, matrixEventType.spaceParent)
        : [],
    };
  });
  const knownRoomIds = new Set([
    ...rooms.map((room) => room.id),
    ...hierarchyRooms
      .filter((room) => room.roomType !== 'm.space')
      .map((room) => room.id),
  ]);
  const relations = resolveSpaceRelations(seeds, knownRoomIds);
  const relationById = new Map(relations.map((relation) => [relation.id, relation]));
  const nestedSpaces: SpaceSummary[] = spaceIds.map((spaceId) => {
    const joinedSpace = joinedSpaceById.get(spaceId);
    const hierarchySpace = hierarchyById.get(spaceId);
    const relation = relationById.get(spaceId) ?? {
      childIds: [],
      directRoomIds: [],
      childSpaceIds: [],
      parentSpaceIds: [],
      roomIds: [],
    };
    const name = joinedSpace?.name || hierarchySpace?.name || 'Space';
    const ownPowerLevel = joinedSpace?.getMember(userId)?.powerLevel ?? 0;
    const powerLevelContent = joinedSpace?.currentState
      .getStateEvents(matrixEventType.powerLevels, '')
      ?.getContent<{ events?: Record<string, number>; state_default?: number }>() ?? {};
    const backgroundThreshold = powerLevelContent.events?.[ROOM_BACKGROUND_EVENT]
      ?? powerLevelContent.state_default
      ?? 50;
    const background = joinedSpace
      ? parseRoomBackground(joinedSpace.currentState.getStateEvents(ROOM_BACKGROUND_EVENT, '')?.getContent())
      : undefined;
    const canChangeBackground = joinedSpace?.currentState.maySendStateEvent(
      ROOM_BACKGROUND_EVENT,
      userId,
    ) ?? false;
    const canManageBackgroundPolicy = joinedSpace?.currentState.maySendStateEvent(
      matrixEventType.powerLevels,
      userId,
    ) ?? false;
    if (joinedSpace) {
      const spaceVersion = cache?.roomVersions.get(spaceId) ?? 0;
      const cachedSpaceMembers = cache?.members.get(spaceId);
      membersByRoom[spaceId] =
        cachedSpaceMembers && cachedSpaceMembers.version === spaceVersion && cachedSpaceMembers.presence === cache?.presenceVersion
          ? cachedSpaceMembers.value
          : (() => {
              const rebuilt = membersForRoom(client, joinedSpace);
              cache?.members.set(spaceId, { version: spaceVersion, presence: cache.presenceVersion, value: rebuilt });
              return rebuilt;
            })();
    }
    const relatedRooms = relation.roomIds.flatMap((roomId) => {
      const room = roomById.get(roomId);
      return room ? [room] : [];
    });
    return {
      id: spaceId,
      name,
      avatarUrl: mediaSource(joinedSpace?.getMxcAvatarUrl() ?? hierarchySpace?.avatarUrl),
      initials: initialsFor(name),
      color: colorForId(spaceId),
      kind: 'matrix' as const,
      membership: joinedSpace
        ? mapSpaceMembership(joinedSpace.getMyMembership())
        : mapSpaceMembership(hierarchySpace?.membership),
      canManage: joinedSpace?.currentState.maySendStateEvent(matrixEventType.spaceChild, userId) ?? false,
      ownPowerLevel,
      background,
      backgroundPolicy: joinedSpace ? {
        mode: backgroundPermissionForThreshold(backgroundThreshold),
        requiredPowerLevel: backgroundThreshold,
        canChange: canChangeBackground,
        canManage: canManageBackgroundPolicy,
      } : undefined,
      childIds: relation.childIds,
      directRoomIds: relation.directRoomIds,
      childSpaceIds: relation.childSpaceIds,
      parentSpaceIds: relation.parentSpaceIds,
      roomIds: relation.roomIds,
      unreadCount: relatedRooms.reduce((total, room) => total + room.unreadCount, 0),
      highlighted: relatedRooms.some((room) => room.highlighted),
    };
  });
  const rootOrderRank = new Map(rootSpaceOrder.map((spaceId, index) => [spaceId, index]));
  const orderedNestedSpaces = [
    ...nestedSpaces
      .filter((space) => space.parentSpaceIds.length === 0)
      .sort((left, right) =>
        (rootOrderRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (rootOrderRank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      ),
    ...nestedSpaces.filter((space) => space.parentSpaceIds.length > 0),
  ];
  const spaces: SpaceSummary[] = [
    {
      id: 'home',
      name: 'All conversations',
      initials: 'A',
      color: '#267ec1',
      kind: 'home',
      membership: 'join',
      canManage: false,
      childIds: chatRooms.map((room) => room.roomId),
      directRoomIds: chatRooms.map((room) => room.roomId),
      childSpaceIds: orderedNestedSpaces
        .filter((space) => space.parentSpaceIds.length === 0)
        .map((space) => space.id),
      parentSpaceIds: [],
      roomIds: chatRooms.map((room) => room.roomId),
      unreadCount: rooms.reduce((total, room) => total + room.unreadCount, 0),
      highlighted: rooms.some((room) => room.highlighted),
    },
    {
      id: 'directs',
      name: 'Direct Messages',
      initials: 'DM',
      color: '#607fa0',
      kind: 'directs',
      membership: 'join',
      canManage: false,
      childIds: rooms.filter((room) => room.kind === 'direct').map((room) => room.id),
      directRoomIds: rooms.filter((room) => room.kind === 'direct').map((room) => room.id),
      childSpaceIds: [],
      parentSpaceIds: [],
      roomIds: rooms.filter((room) => room.kind === 'direct').map((room) => room.id),
      unreadCount: rooms
        .filter((room) => room.kind === 'direct')
        .reduce((total, room) => total + room.unreadCount, 0),
      highlighted: rooms.some((room) => room.kind === 'direct' && room.highlighted),
    },
    ...orderedNestedSpaces,
  ];
  const spaceRoomPreviews: Record<string, SpaceRoomPreview> = Object.fromEntries(
    hierarchyRooms
      .filter((room) => room.roomType !== 'm.space')
      .map((room) => [
        room.id,
        {
          id: room.id,
          name: roomById.get(room.id)?.name || room.name || 'Matrix room',
          avatarUrl: mediaSource(room.avatarUrl),
          topic: room.topic,
          membership: roomById.has(room.id)
            ? roomById.get(room.id)?.membership === 'invite'
              ? 'invite'
              : 'join'
            : mapSpaceMembership(room.membership),
        },
      ]),
  );

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
    spaceRoomPreviews,
    rooms,
    messagesByRoom,
    membersByRoom,
  };
}
