import type { EncryptedMediaInfo } from './mediaContext';
import type { RoomBackground, RoomBackgroundPolicy } from './roomBackgrounds';

export type PresenceState = 'online' | 'away' | 'busy' | 'offline';
export type RoomKind = 'direct' | 'room' | 'space';
export type ConnectionState = 'connecting' | 'online' | 'catching-up' | 'offline';

export interface UserSummary {
  id: string;
  displayName: string;
  avatarUrl?: string;
  presence: PresenceState;
  statusMessage: string;
}

export interface SpaceSummary {
  id: string;
  name: string;
  avatarUrl?: string;
  initials: string;
  color: string;
  kind: 'home' | 'directs' | 'matrix';
  membership: 'join' | 'invite' | 'leave';
  canManage: boolean;
  ownPowerLevel?: number;
  background?: RoomBackground;
  backgroundPolicy?: RoomBackgroundPolicy;
  childIds: string[];
  directRoomIds: string[];
  childSpaceIds: string[];
  parentSpaceIds: string[];
  roomIds: string[];
  unreadCount: number;
  highlighted: boolean;
}

export interface SpaceRoomPreview {
  id: string;
  name: string;
  avatarUrl?: string;
  topic?: string;
  membership: 'join' | 'invite' | 'leave';
}

export interface RoomSummary {
  id: string;
  name: string;
  avatarUrl?: string;
  kind: RoomKind;
  group: 'Invites' | 'Favorites' | 'Direct Messages' | 'Rooms';
  membership: 'join' | 'invite';
  presence?: PresenceState;
  statusMessage?: string;
  lastMessage: string;
  unreadCount: number;
  timelineUnreadCount?: number;
  readUpToMessageId?: string;
  highlighted: boolean;
  encrypted: boolean;
  topic?: string;
  canManage?: boolean;
  ownPowerLevel?: number;
  typingUsers?: string[];
  muted?: boolean;
  background?: RoomBackground;
  backgroundPolicy?: RoomBackgroundPolicy;
  updatedAt: number;
}

export interface ReadReceiptSummary {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export interface MessageSummary {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  body: string;
  timestamp: number;
  kind: 'text' | 'notice' | 'emote' | 'media' | 'sticker' | 'encrypted';
  isOwn: boolean;
  pending?: boolean;
  edited?: boolean;
  replyTo?: {
    eventId: string;
    senderName: string;
    body: string;
  };
  reactions?: Array<{
    key: string;
    count: number;
    reacted: boolean;
    ownEventId?: string;
  }>;
  mediaUrl?: string;
  encryptedFile?: EncryptedMediaInfo;
  mimeType?: string;
  mediaKind?: 'image' | 'video' | 'audio' | 'file';
  pinned?: boolean;
  readBy?: ReadReceiptSummary[];
}

export interface MemberSummary {
  id: string;
  displayName: string;
  avatarUrl?: string;
  presence: PresenceState;
  role?: string;
  powerLevel?: number;
  membership?: 'join' | 'invite' | 'ban';
}

export interface CallSummary {
  roomId: string;
  state: string;
  incoming: boolean;
  video: boolean;
  microphoneMuted: boolean;
  videoMuted: boolean;
  screensharing: boolean;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  error?: string;
}

export interface WorkspaceSnapshot {
  mode: 'demo' | 'matrix';
  connection: ConnectionState;
  user: UserSummary;
  spaces: SpaceSummary[];
  spaceRoomPreviews: Record<string, SpaceRoomPreview>;
  rooms: RoomSummary[];
  messagesByRoom: Record<string, MessageSummary[]>;
  membersByRoom: Record<string, MemberSummary[]>;
  call?: CallSummary;
}

export function initialsFor(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

const swatches = ['#1c6eaa', '#8054b8', '#b23f61', '#a9571e', '#287b57', '#455fb3'];

export function colorForId(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return swatches[Math.abs(hash) % swatches.length];
}
