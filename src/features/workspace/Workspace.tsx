import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Check,
  ChevronDown,
  Copy,
  DoorOpen,
  Film,
  Folder,
  FolderOpen,
  GripVertical,
  Images,
  Info,
  Lock,
  Paintbrush,
  PanelRight,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  SmilePlus,
  Sparkles,
  Sticker,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  WifiOff,
  X,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Avatar } from '../../components/Avatar';
import { CallShelf } from '../calls/CallShelf';
import { GifPicker, type GifChoice } from '../media/GifPicker';
import { loadStickerPack, mergeStickerPacks } from '../media/stickerPacks';
import { ProfileDialog } from '../profile/ProfileDialog';
import { BrandMark } from '../../components/BrandMark';
import { RoomDialog, type PublicRoomChoice } from '../rooms/RoomDialog';
import type { MatrixSettingsActions } from '../settings/MatrixSettingsPanel';
import {
  SettingsDialog,
  type ProfileUpdate,
} from '../settings/SettingsDialog';
import type { RuntimeConfig, ThemeName } from '../../config/runtimeConfig';
import { useMediaSource } from '../../matrix/useMediaSource';
import {
  defaultRoomBackground,
  roomBackgroundPresetNames,
  thresholdForBackgroundPermission,
  type RoomBackground,
  type RoomBackgroundPermission,
} from '../../matrix/roomBackgrounds';
import type { UserPreferences } from '../../settings/preferences';
import {
  defaultProfilePersonalization,
  type ProfilePersonalization,
} from '../../settings/profilePersonalization';
import {
  colorForId,
  type MessageSummary,
  type RoomSummary,
  type SpaceRoomPreview,
  type SpaceSummary,
  type WorkspaceSnapshot,
} from '../../matrix/viewModels';

interface WorkspaceProps {
  workspace: WorkspaceSnapshot;
  config: RuntimeConfig;
  theme: ThemeName;
  preferences: UserPreferences;
  profilePersonalization?: ProfilePersonalization;
  onThemeChange: (theme: ThemeName) => void;
  onPreferencesChange: (preferences: UserPreferences) => void;
  onProfilePersonalizationChange?: (personalization: ProfilePersonalization) => void;
  onUploadProfileBanner?: (file: File) => Promise<string>;
  onUpdateProfile?: (update: ProfileUpdate) => Promise<void>;
  matrixSettingsActions?: MatrixSettingsActions;
  onSendMessage?: (roomId: string, body: string) => Promise<void>;
  onRoomSelected?: (roomId: string) => Promise<void>;
  onSpaceSelected?: (spaceId: string) => Promise<void>;
  onReorganizeSpaceChildren?: (update: {
    childId: string;
    sourceSpaceId: string;
    targetSpaceId: string;
    sourceChildIds: string[];
    targetChildIds: string[];
  }) => Promise<void>;
  onReorderRootSpaces?: (spaceIds: string[]) => Promise<void>;
  onSendReply?: (
    roomId: string,
    body: string,
    target: { id: string; senderId: string; body: string },
  ) => Promise<void>;
  onEditMessage?: (roomId: string, eventId: string, body: string) => Promise<void>;
  onRedactMessage?: (roomId: string, eventId: string) => Promise<void>;
  onTogglePinnedMessage?: (roomId: string, eventId: string, pinned: boolean) => Promise<void>;
  onToggleReaction?: (
    roomId: string,
    eventId: string,
    key: string,
    ownReactionEventId?: string,
  ) => Promise<void>;
  onSendTyping?: (roomId: string, typing: boolean) => Promise<void>;
  onSendSticker?: (
    roomId: string,
    sticker: { id: string; name: string; src: string },
  ) => Promise<void>;
  onUploadAttachment?: (roomId: string, file: File, onProgress?: (loaded: number, total: number) => void) => Promise<void>;
  onCancelUpload?: () => void;
  onSendGif?: (roomId: string, gif: GifChoice) => Promise<void>;
  onMarkRoomRead?: (roomId: string) => Promise<void>;
  onJoinRoom?: (roomIdOrAlias: string) => Promise<void>;
  onSearchPublicRooms?: (query: string) => Promise<PublicRoomChoice[]>;
  onCreateDirectRoom?: (userId: string) => Promise<string>;
  onCreateRoom?: (options: {
    name: string;
    topic?: string;
    public: boolean;
    encrypted: boolean;
    space?: boolean;
  }) => Promise<string>;
  onRejectInvite?: (roomId: string) => Promise<void>;
  onStartCall?: (roomId: string, video: boolean) => Promise<void>;
  onAnswerCall?: (video: boolean) => Promise<void>;
  onRejectCall?: () => void;
  onHangupCall?: () => void;
  onCallMicrophone?: (muted: boolean) => Promise<void>;
  onCallVideo?: (muted: boolean) => Promise<void>;
  onScreenshare?: (enabled: boolean) => Promise<void>;
  onUpdateRoom?: (roomId: string, update: { name?: string; topic?: string }) => Promise<void>;
  onUpdateRoomAvatar?: (roomId: string, file: File) => Promise<void>;
  onUploadRoomBackground?: (file: File) => Promise<string>;
  onSetRoomBackground?: (roomId: string, background: RoomBackground, personal: boolean) => Promise<void>;
  onSetRoomBackgroundPolicy?: (roomId: string, permission: RoomBackgroundPermission) => Promise<void>;
  onEnableRoomEncryption?: (roomId: string) => Promise<void>;
  onSetRoomMuted?: (roomId: string, muted: boolean) => Promise<void>;
  onInviteToRoom?: (roomId: string, userId: string) => Promise<void>;
  onRemoveRoomMember?: (roomId: string, userId: string, action: 'kick' | 'ban' | 'unban') => Promise<void>;
  onSetRoomMemberPower?: (roomId: string, userId: string, level: number) => Promise<void>;
  onLeaveRoom?: (roomId: string) => Promise<void>;
  onSignOut: () => void;
}

const roomGroups: RoomSummary['group'][] = ['Invites', 'Favorites', 'Direct Messages', 'Rooms'];
const themes: Array<{ id: ThemeName; label: string }> = [
  { id: 'aqua', label: 'Aqua' },
  { id: 'graphite', label: 'Graphite' },
  { id: 'midnight', label: 'Midnight' },
];

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

function groupLabel(group: RoomSummary['group']): string {
  if (group === 'Favorites') return 'New & Favorite';
  if (group === 'Invites') return 'Invitations';
  return group;
}

function connectionCopy(connection: WorkspaceSnapshot['connection']): string {
  switch (connection) {
    case 'online':
      return 'Online';
    case 'connecting':
      return 'Connecting';
    case 'catching-up':
      return 'Catching up';
    case 'offline':
      return 'Offline';
  }
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const isDisabled = disabled ?? onClick === undefined;
  return (
    <button
      className={`icon-button${active ? ' icon-button--active' : ''}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={isDisabled}
    >
      {children}
    </button>
  );
}

function SpaceButton({
  space,
  active,
  reorderable,
  onSelect,
  onDragStart,
  onDrop,
  onMove,
}: {
  space: WorkspaceSnapshot['spaces'][number];
  active: boolean;
  reorderable: boolean;
  onSelect: () => void;
  onDragStart?: () => void;
  onDrop?: () => void;
  onMove?: (offset: -1 | 1) => void;
}) {
  const mediaSrc = useMediaSource(space.avatarUrl, 80);
  const [failedSrc, setFailedSrc] = useState<string>();
  const showImage = Boolean(mediaSrc && failedSrc !== mediaSrc);

  return (
    <button
      className={`space-button${active ? ' space-button--active' : ''}`}
      type="button"
      aria-label={space.name}
      aria-pressed={active}
      title={reorderable ? `${space.name} · drag to reorder` : space.name}
      draggable={reorderable}
      aria-keyshortcuts={reorderable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      onClick={onSelect}
      onDragStart={(event) => {
        if (!reorderable) return;
        event.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragOver={(event) => {
        if (reorderable) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!reorderable) return;
        event.preventDefault();
        onDrop?.();
      }}
      onKeyDown={(event) => {
        if (!reorderable || !event.altKey) return;
        if (event.key === 'ArrowUp') { event.preventDefault(); onMove?.(-1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); onMove?.(1); }
      }}
    >
      {showImage ? (
        <img
          src={mediaSrc}
          alt=""
          loading="lazy"
          onError={() => setFailedSrc(mediaSrc)}
        />
      ) : (
        <span style={{ '--space-color': space.color } as CSSProperties}>{space.initials}</span>
      )}
      {space.unreadCount > 0 ? (
        <b className={space.highlighted ? 'is-highlighted' : ''}>{space.unreadCount}</b>
      ) : null}
    </button>
  );
}

function SpaceRail({
  workspace,
  activeSpace,
  onSelect,
  onReorder,
}: {
  workspace: WorkspaceSnapshot;
  activeSpace: string;
  onSelect: (spaceId: string) => void;
  onReorder?: (spaceIds: string[]) => Promise<void>;
}) {
  const [draggedSpaceId, setDraggedSpaceId] = useState<string>();
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const systemSpaces = workspace.spaces.filter((space) => space.kind !== 'matrix');
  const matrixRoots = workspace.spaces.filter(
    (space) => space.kind === 'matrix' && space.parentSpaceIds.length === 0,
  );
  const orderedIds = [
    ...localOrder.filter((spaceId) => matrixRoots.some((space) => space.id === spaceId)),
    ...matrixRoots.map((space) => space.id).filter((spaceId) => !localOrder.includes(spaceId)),
  ];
  const orderedRoots = orderedIds.flatMap((spaceId) => {
    const space = matrixRoots.find((candidate) => candidate.id === spaceId);
    return space ? [space] : [];
  });
  const reorder = async (spaceId: string, targetIndex: number) => {
    const sourceIndex = orderedIds.indexOf(spaceId);
    if (sourceIndex < 0) return;
    const next = [...orderedIds];
    next.splice(sourceIndex, 1);
    const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    next.splice(Math.max(0, Math.min(adjustedIndex, next.length)), 0, spaceId);
    if (next.every((id, index) => id === orderedIds[index])) return;
    setLocalOrder(next);
    try {
      await onReorder?.(next);
    } catch {
      setLocalOrder(orderedIds);
    }
  };

  return (
    <nav className="space-rail" aria-label="Spaces">
      <div className="space-rail__brand"><BrandMark compact /></div>
      <div className="space-rail__items">
        {systemSpaces.map((space) => (
          <SpaceButton
            key={space.id}
            space={space}
            active={activeSpace === space.id}
            reorderable={false}
            onSelect={() => onSelect(space.id)}
          />
        ))}
        {orderedRoots.length ? <div className="space-rail__divider" role="separator" /> : null}
        {orderedRoots.map((space, rootIndex) => {
          const reorderable = space.membership === 'join' && (workspace.mode === 'demo' || Boolean(onReorder));
          return (
            <SpaceButton
              key={space.id}
              space={space}
              active={activeSpace === space.id}
              reorderable={reorderable}
              onSelect={() => onSelect(space.id)}
              onDragStart={() => setDraggedSpaceId(space.id)}
              onDrop={() => {
                if (draggedSpaceId) void reorder(draggedSpaceId, rootIndex);
                setDraggedSpaceId(undefined);
              }}
              onMove={(offset) => void reorder(space.id, rootIndex + (offset > 0 ? 2 : -1))}
            />
          );
        })}
      </div>
    </nav>
  );
}

interface SpaceChildArrangement {
  parentId: string;
  index: number;
  count: number;
  targetSpaces: SpaceSummary[];
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
  onMove: (offset: -1 | 1) => void;
  onMoveTo: (spaceId: string) => void;
}

function ArrangeControls({
  label,
  arrangement,
}: {
  label: string;
  arrangement: SpaceChildArrangement;
}) {
  return (
    <span className="space-arrange-controls">
      <button
        className="space-drag-handle"
        type="button"
        draggable
        aria-label={`Drag ${label}`}
        title={`Drag ${label}`}
        onDragStart={arrangement.onDragStart}
        onDragEnd={arrangement.onDragEnd}
      ><GripVertical size={14} /></button>
      <button type="button" aria-label={`Move ${label} up`} disabled={arrangement.index === 0} onClick={() => arrangement.onMove(-1)}><ArrowUp size={12} /></button>
      <button type="button" aria-label={`Move ${label} down`} disabled={arrangement.index === arrangement.count - 1} onClick={() => arrangement.onMove(1)}><ArrowDown size={12} /></button>
      {arrangement.targetSpaces.length > 1 ? (
        <select
          aria-label={`Move ${label} to another subspace`}
          value={arrangement.parentId}
          onChange={(event) => arrangement.onMoveTo(event.target.value)}
        >
          {arrangement.targetSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
        </select>
      ) : null}
    </span>
  );
}

function roomRowPropsEqual(
  previous: BuddyRoomRowProps,
  next: BuddyRoomRowProps,
): boolean {
  const left = previous.room;
  const right = next.room;
  return (
    previous.selected === next.selected &&
    previous.depth === next.depth &&
    previous.arrangement === next.arrangement &&
    previous.onSelect === next.onSelect &&
    previous.onAcceptInvite === next.onAcceptInvite &&
    previous.onRejectInvite === next.onRejectInvite &&
    left.id === right.id &&
    left.name === right.name &&
    left.avatarUrl === right.avatarUrl &&
    left.presence === right.presence &&
    left.statusMessage === right.statusMessage &&
    left.lastMessage === right.lastMessage &&
    left.encrypted === right.encrypted &&
    left.unreadCount === right.unreadCount &&
    left.highlighted === right.highlighted &&
    left.membership === right.membership
  );
}

interface BuddyRoomRowProps {
  room: RoomSummary;
  selected: boolean;
  depth?: number;
  onSelect: (roomId: string) => void;
  onAcceptInvite?: (roomId: string) => void;
  onRejectInvite?: (roomId: string) => void;
  arrangement?: SpaceChildArrangement;
}

const BuddyRoomRow = memo(function BuddyRoomRow({
  room,
  selected,
  depth = 0,
  onSelect,
  onAcceptInvite,
  onRejectInvite,
  arrangement,
}: BuddyRoomRowProps) {
  const style = { '--space-depth': depth } as CSSProperties;
  if (room.membership === 'invite') {
    return (
      <div className="buddy-row buddy-row--invite buddy-row--nested" style={style}>
        <Avatar name={room.name} src={room.avatarUrl} color={colorForId(room.id)} size="small" />
        <span className="buddy-row__copy">
          <strong>{room.name}</strong>
          <span>Invited you to chat</span>
        </span>
        <span className="invite-actions">
          <button type="button" onClick={() => onAcceptInvite?.(room.id)}>Join</button>
          <button type="button" onClick={() => onRejectInvite?.(room.id)}>Decline</button>
        </span>
      </div>
    );
  }
  if (arrangement) {
    return (
      <div
        className="buddy-row buddy-row--nested buddy-row--arranging"
        style={style}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); arrangement.onDropBefore(); }}
      >
        <Avatar
          name={room.name}
          src={room.avatarUrl}
          color={colorForId(room.id)}
          presence={room.presence}
          size="small"
        />
        <span className="buddy-row__copy"><strong>{room.name}</strong><span>Room in this space</span></span>
        <ArrangeControls label={room.name} arrangement={arrangement} />
      </div>
    );
  }
  return (
    <button
      className={`buddy-row buddy-row--nested${selected ? ' buddy-row--selected' : ''}`}
      style={style}
      type="button"
      onClick={() => onSelect(room.id)}
    >
      <Avatar
        name={room.name}
        src={room.avatarUrl}
        color={colorForId(room.id)}
        presence={room.presence}
        size="small"
      />
      <span className="buddy-row__copy">
        <strong>{room.name}</strong>
        <span>{room.statusMessage || room.lastMessage}</span>
      </span>
      <span className="buddy-row__meta">
        {room.encrypted ? <Lock size={10} aria-label="Encrypted" /> : null}
        {room.unreadCount > 0 ? (
          <b className={room.highlighted ? 'is-highlighted' : ''}>{room.unreadCount}</b>
        ) : null}
      </span>
    </button>
  );
}, roomRowPropsEqual);

function SpacePreviewRow({
  room,
  depth,
  joining,
  onJoin,
  arrangement,
}: {
  room: SpaceRoomPreview;
  depth: number;
  joining: boolean;
  onJoin: () => void;
  arrangement?: SpaceChildArrangement;
}) {
  const style = { '--space-depth': depth } as CSSProperties;
  if (arrangement) {
    return (
      <div
        className="buddy-row buddy-row--nested buddy-row--arranging space-preview-row"
        style={style}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); arrangement.onDropBefore(); }}
      >
        <Avatar name={room.name} src={room.avatarUrl} color={colorForId(room.id)} size="small" />
        <span className="buddy-row__copy"><strong>{room.name}</strong><span>Room preview in this space</span></span>
        <ArrangeControls label={room.name} arrangement={arrangement} />
      </div>
    );
  }
  return (
    <button
      className="buddy-row buddy-row--nested space-preview-row"
      style={style}
      type="button"
      onClick={onJoin}
      disabled={joining}
    >
      <Avatar name={room.name} src={room.avatarUrl} color={colorForId(room.id)} size="small" />
      <span className="buddy-row__copy">
        <strong>{room.name}</strong>
        <span>{room.topic || 'Room preview — join to start chatting'}</span>
      </span>
      <span className="space-preview-row__join">{joining ? 'Joining…' : 'Join'}</span>
    </button>
  );
}

function spaceContainsQuery(
  spaceId: string,
  workspace: WorkspaceSnapshot,
  query: string,
  getChildIds: (space: SpaceSummary) => string[] = (space) => space.childIds,
  ancestry: ReadonlySet<string> = new Set(),
): boolean {
  if (!query) return true;
  if (ancestry.has(spaceId)) return false;
  const space = workspace.spaces.find((candidate) => candidate.id === spaceId);
  if (!space) return false;
  if (space.name.toLowerCase().includes(query)) return true;
  const nextAncestry = new Set(ancestry).add(spaceId);
  return getChildIds(space).some((childId) => {
    const childSpace = workspace.spaces.find((candidate) => candidate.id === childId);
    if (childSpace) {
      return spaceContainsQuery(childId, workspace, query, getChildIds, nextAncestry);
    }
    const room = workspace.rooms.find((candidate) => candidate.id === childId);
    const preview = workspace.spaceRoomPreviews[childId];
    return (room?.name || preview?.name || '').toLowerCase().includes(query);
  });
}

function backgroundsMatch(left?: RoomBackground, right?: RoomBackground): boolean {
  return Boolean(left && right) &&
    left!.preset === right!.preset &&
    (left!.mxcUrl ?? undefined) === (right!.mxcUrl ?? undefined) &&
    Boolean(left!.blockSpaceInheritance) === Boolean(right!.blockSpaceInheritance);
}

function organizedSpaceRoomIds(
  space: SpaceSummary,
  workspace: WorkspaceSnapshot,
  getChildIds: (space: SpaceSummary) => string[],
  ancestry: ReadonlySet<string> = new Set(),
): string[] {
  if (ancestry.has(space.id)) return [];
  const nextAncestry = new Set(ancestry).add(space.id);
  return [...new Set(getChildIds(space).flatMap((childId) => {
    const childSpace = workspace.spaces.find((candidate) => candidate.id === childId);
    return childSpace
      ? organizedSpaceRoomIds(childSpace, workspace, getChildIds, nextAncestry)
      : [childId];
  }))];
}

function SpaceBranch({
  space,
  workspace,
  selectedRoomId,
  depth,
  query,
  collapsed,
  joiningRoomIds,
  arranging,
  arrangement,
  getChildIds,
  arrangementFor,
  onDropInto,
  onToggle,
  onSelectRoom,
  onJoin,
  onRejectInvite,
  ancestry = new Set(),
}: {
  space: SpaceSummary;
  workspace: WorkspaceSnapshot;
  selectedRoomId?: string;
  depth: number;
  query: string;
  collapsed: Record<string, boolean>;
  joiningRoomIds: ReadonlySet<string>;
  arranging: boolean;
  arrangement?: SpaceChildArrangement;
  getChildIds: (space: SpaceSummary) => string[];
  arrangementFor: (parent: SpaceSummary, childId: string, index: number, count: number) => SpaceChildArrangement | undefined;
  onDropInto: (spaceId: string) => void;
  onToggle: (spaceId: string) => void;
  onSelectRoom: (roomId: string) => void;
  onJoin: (roomId: string) => void;
  onRejectInvite?: (roomId: string) => void;
  ancestry?: ReadonlySet<string>;
}) {
  if (ancestry.has(space.id) || !spaceContainsQuery(space.id, workspace, query, getChildIds)) return null;
  const nextAncestry = new Set(ancestry).add(space.id);
  const isCollapsed = query ? false : collapsed[`space:${space.id}`] ?? false;
  const childIds = getChildIds(space);
  const organizedRoomCount = organizedSpaceRoomIds(space, workspace, getChildIds).length;
  const visibleChildIds = childIds.filter((childId) => {
    if (!query) return true;
    const room = workspace.rooms.find((candidate) => candidate.id === childId);
    const preview = workspace.spaceRoomPreviews[childId];
    const childSpace = workspace.spaces.find((candidate) => candidate.id === childId);
    return room?.name.toLowerCase().includes(query) ||
      preview?.name.toLowerCase().includes(query) ||
      Boolean(childSpace && spaceContainsQuery(childSpace.id, workspace, query, getChildIds));
  });

  return (
    <section className={`space-branch${arrangement ? ' space-branch--arranging' : ''}`} style={{ '--space-depth': depth } as CSSProperties}>
      <div
        className="space-branch__heading"
        onDragOver={arrangement ? (event) => event.preventDefault() : undefined}
        onDrop={arrangement ? (event) => { event.preventDefault(); event.stopPropagation(); arrangement.onDropBefore(); } : undefined}
      >
        <button
          className="space-branch__toggle"
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => onToggle(space.id)}
        >
          <ChevronDown size={13} className={isCollapsed ? 'is-collapsed' : ''} />
          <span className="space-branch__folder" style={{ '--space-color': space.color } as CSSProperties}>
            {isCollapsed ? <Folder size={16} /> : <FolderOpen size={16} />}
          </span>
          <span><strong>{space.name}</strong><small>{organizedRoomCount} {organizedRoomCount === 1 ? 'room' : 'rooms'}</small></span>
          {space.unreadCount > 0 ? <b className={space.highlighted ? 'is-highlighted' : ''}>{space.unreadCount}</b> : null}
        </button>
        {arrangement ? <ArrangeControls label={space.name} arrangement={arrangement} /> : null}
        {!arrangement && space.membership === 'leave' ? <button className="space-branch__join" type="button" onClick={() => onJoin(space.id)}>Join</button> : null}
      </div>
      {!isCollapsed ? (
        <div className="space-branch__children">
          {visibleChildIds.map((childId) => {
            const index = childIds.indexOf(childId);
            const childArrangement = arrangementFor(space, childId, index, childIds.length);
            const childSpace = workspace.spaces.find((candidate) => candidate.id === childId);
            if (childSpace) {
              return (
                <SpaceBranch
                  key={childId}
                  space={childSpace}
                  workspace={workspace}
                  selectedRoomId={selectedRoomId}
                  depth={depth + 1}
                  query={query}
                  collapsed={collapsed}
                  joiningRoomIds={joiningRoomIds}
                  arranging={arranging}
                  arrangement={childArrangement}
                  getChildIds={getChildIds}
                  arrangementFor={arrangementFor}
                  onDropInto={onDropInto}
                  onToggle={onToggle}
                  onSelectRoom={onSelectRoom}
                  onJoin={onJoin}
                  onRejectInvite={onRejectInvite}
                  ancestry={nextAncestry}
                />
              );
            }
            const room = workspace.rooms.find((candidate) => candidate.id === childId);
            const preview = workspace.spaceRoomPreviews[childId];
            return room ? (
              <BuddyRoomRow
                key={childId}
                room={room}
                selected={selectedRoomId === childId}
                depth={depth + 1}
                onSelect={onSelectRoom}
                onAcceptInvite={onJoin}
                onRejectInvite={onRejectInvite}
                arrangement={childArrangement}
              />
            ) : preview ? (
              <SpacePreviewRow
                key={childId}
                room={preview}
                depth={depth + 1}
                joining={joiningRoomIds.has(childId)}
                onJoin={() => onJoin(childId)}
                arrangement={childArrangement}
              />
            ) : null;
          })}
          {arranging && space.canManage ? (
            <div
              className="space-branch__dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDropInto(space.id); }}
            >Drop here to move into {space.name}</div>
          ) : null}
          {!visibleChildIds.length ? <p className="space-branch__empty">No visible rooms in this subspace.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function BuddyPanel({
  workspace,
  selectedRoomId,
  query,
  onQueryChange,
  onSelectRoom,
  onOpenProfile,
  onOpenSettings,
  onAddRoom,
  onAcceptInvite,
  onRejectInvite,
  onReorganize,
  scopeName,
  scopeSpace,
}: {
  workspace: WorkspaceSnapshot;
  selectedRoomId?: string;
  scopeName: string;
  scopeSpace?: SpaceSummary;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectRoom: (roomId: string) => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onAddRoom: () => void;
  onAcceptInvite?: (roomId: string) => Promise<void>;
  onRejectInvite?: (roomId: string) => Promise<void>;
  onReorganize?: (update: {
    childId: string;
    sourceSpaceId: string;
    targetSpaceId: string;
    sourceChildIds: string[];
    targetChildIds: string[];
  }) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [joiningRoomIds, setJoiningRoomIds] = useState<Set<string>>(new Set());
  const [spaceNotice, setSpaceNotice] = useState<string>();
  const [arranging, setArranging] = useState(false);
  const [draggedChild, setDraggedChild] = useState<{ childId: string; parentId: string }>();
  const [childOrderOverrides, setChildOrderOverrides] = useState<Record<string, string[]>>({});
  const organizationQueue = useRef<Promise<void>>(Promise.resolve());
  const normalizedQuery = query.trim().toLowerCase();
  const showSpaceTree = scopeSpace?.kind === 'matrix';
  const canArrange = Boolean(
    showSpaceTree &&
    scopeSpace?.canManage &&
    (workspace.mode === 'demo' || onReorganize),
  );
  const getChildIds = (space: SpaceSummary): string[] => {
    const override = childOrderOverrides[space.id];
    if (!override) return space.childIds;
    return override;
  };
  const organizedScopeRoomCount = scopeSpace
    ? organizedSpaceRoomIds(scopeSpace, workspace, getChildIds).length
    : 0;
  const descendantSpaceIds = (spaceId: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(spaceId)) return seen;
    seen.add(spaceId);
    const space = workspace.spaces.find((candidate) => candidate.id === spaceId);
    for (const childId of space ? getChildIds(space) : []) {
      if (workspace.spaces.some((candidate) => candidate.id === childId)) descendantSpaceIds(childId, seen);
    }
    return seen;
  };
  const arrangementTargets = (childId: string): SpaceSummary[] => {
    if (!scopeSpace) return [];
    const disallowed = workspace.spaces.some((space) => space.id === childId)
      ? descendantSpaceIds(childId)
      : new Set<string>();
    const treeIds = descendantSpaceIds(scopeSpace.id, new Set());
    return workspace.spaces
      .filter((space) => treeIds.has(space.id))
      .filter((space, index, values) =>
        space.kind === 'matrix' &&
        space.canManage &&
        !disallowed.has(space.id) &&
        values.findIndex((candidate) => candidate.id === space.id) === index,
      );
  };
  const moveSpaceChild = async (
    childId: string,
    sourceSpaceId: string,
    targetSpaceId: string,
    targetIndex: number,
  ) => {
    const sourceSpace = workspace.spaces.find((space) => space.id === sourceSpaceId);
    const targetSpace = workspace.spaces.find((space) => space.id === targetSpaceId);
    if (!sourceSpace?.canManage || !targetSpace?.canManage) return;
    if (
      workspace.spaces.some((space) => space.id === childId) &&
      descendantSpaceIds(childId, new Set()).has(targetSpaceId)
    ) {
      setSpaceNotice('A subspace cannot be moved into itself or one of its descendants.');
      return;
    }
    const sourceCurrent = getChildIds(sourceSpace);
    const targetCurrent = sourceSpaceId === targetSpaceId ? sourceCurrent : getChildIds(targetSpace);
    const sourceIndex = sourceCurrent.indexOf(childId);
    if (sourceIndex < 0) return;
    let sourceNext: string[];
    let targetNext: string[];
    if (sourceSpaceId === targetSpaceId) {
      targetNext = [...sourceCurrent];
      targetNext.splice(sourceIndex, 1);
      const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      targetNext.splice(Math.max(0, Math.min(adjustedIndex, targetNext.length)), 0, childId);
      sourceNext = targetNext;
    } else {
      sourceNext = sourceCurrent.filter((id) => id !== childId);
      targetNext = targetCurrent.filter((id) => id !== childId);
      targetNext.splice(Math.max(0, Math.min(targetIndex, targetNext.length)), 0, childId);
    }
    if (
      sourceSpaceId === targetSpaceId &&
      targetNext.every((id, index) => id === sourceCurrent[index])
    ) return;

    const previousOverrides = childOrderOverrides;
    setChildOrderOverrides((current) => ({
      ...current,
      [sourceSpaceId]: sourceNext,
      [targetSpaceId]: targetNext,
    }));
    setSpaceNotice('Saving space organization…');
    try {
      const update = {
        childId,
        sourceSpaceId,
        targetSpaceId,
        sourceChildIds: sourceNext,
        targetChildIds: targetNext,
      };
      const operation = organizationQueue.current.then(async () => {
        await onReorganize?.(update);
      });
      organizationQueue.current = operation.catch(() => undefined);
      await operation;
      setSpaceNotice('Space organization saved.');
    } catch {
      setChildOrderOverrides(previousOverrides);
      setSpaceNotice('Aimtrix could not save that space change. Check your permissions.');
    } finally {
      setDraggedChild(undefined);
    }
  };
  const arrangementFor = (
    parent: SpaceSummary,
    childId: string,
    index: number,
    count: number,
  ): SpaceChildArrangement | undefined => {
    if (!arranging || !parent.canManage || !childId) return undefined;
    return {
      parentId: parent.id,
      index,
      count,
      targetSpaces: arrangementTargets(childId),
      onDragStart: (event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        setDraggedChild({ childId, parentId: parent.id });
      },
      onDragEnd: () => setDraggedChild(undefined),
      onDropBefore: () => {
        if (draggedChild) void moveSpaceChild(draggedChild.childId, draggedChild.parentId, parent.id, index);
      },
      onMove: (offset) => void moveSpaceChild(childId, parent.id, parent.id, index + (offset > 0 ? 2 : -1)),
      onMoveTo: (spaceId) => {
        if (spaceId === parent.id) return;
        const target = workspace.spaces.find((space) => space.id === spaceId);
        if (target) void moveSpaceChild(childId, parent.id, spaceId, getChildIds(target).length);
      },
    };
  };
  const dropIntoSpace = (spaceId: string) => {
    if (!draggedChild) return;
    const target = workspace.spaces.find((space) => space.id === spaceId);
    if (target) void moveSpaceChild(
      draggedChild.childId,
      draggedChild.parentId,
      spaceId,
      getChildIds(target).length,
    );
  };
  const joinFromSpace = async (roomId: string) => {
    if (!onAcceptInvite || joiningRoomIds.has(roomId)) return;
    setJoiningRoomIds((current) => new Set(current).add(roomId));
    setSpaceNotice(undefined);
    try {
      await onAcceptInvite(roomId);
      if (!workspace.spaces.some((space) => space.id === roomId)) onSelectRoom(roomId);
    } catch {
      setSpaceNotice('Aimtrix could not join that room or subspace.');
    } finally {
      setJoiningRoomIds((current) => {
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
    }
  };

  return (
    <aside className="buddy-panel" aria-label="Buddy list">
      <div className="buddy-panel__heading">
        <div>
          <p className="eyebrow">Buddy List</p>
          <h2>{scopeName}</h2>
        </div>
        <div className="buddy-panel__heading-actions">
          {canArrange ? (
            <IconButton
              label={arranging ? 'Finish arranging space' : 'Arrange rooms and subspaces'}
              active={arranging}
              onClick={() => {
                setArranging((current) => !current);
                setDraggedChild(undefined);
                onQueryChange('');
              }}
            ><GripVertical size={16} /></IconButton>
          ) : null}
          <IconButton label="Join or create room" onClick={onAddRoom}><Plus size={17} /></IconButton>
        </div>
      </div>
      <label className="buddy-search">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">Search conversations</span>
        <input
          type="search"
          placeholder={arranging ? 'Finish arranging to search' : 'Find a buddy or room'}
          value={query}
          disabled={arranging}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <div className={`buddy-groups${showSpaceTree ? ' buddy-groups--space-tree' : ''}`}>
        {showSpaceTree && scopeSpace ? (
          <>
            <div className="space-tree__summary">
              <span><FolderOpen size={14} /> Space map</span>
              <b>{organizedScopeRoomCount} {organizedScopeRoomCount === 1 ? 'room' : 'rooms'}</b>
            </div>
            {spaceNotice ? <p className="space-tree__notice" role="alert">{spaceNotice}</p> : null}
            {getChildIds(scopeSpace).map((childId, index, childIds) => {
              const childArrangement = arrangementFor(scopeSpace, childId, index, childIds.length);
              const childSpace = workspace.spaces.find((candidate) => candidate.id === childId);
              if (childSpace) {
                return (
                  <SpaceBranch
                    key={childId}
                    space={childSpace}
                    workspace={workspace}
                    selectedRoomId={selectedRoomId}
                    depth={0}
                    query={normalizedQuery}
                    collapsed={collapsed}
                    joiningRoomIds={joiningRoomIds}
                    arranging={arranging}
                    arrangement={childArrangement}
                    getChildIds={getChildIds}
                    arrangementFor={arrangementFor}
                    onDropInto={dropIntoSpace}
                    onToggle={(spaceId) => setCollapsed((current) => ({
                      ...current,
                      [`space:${spaceId}`]: !(current[`space:${spaceId}`] ?? false),
                    }))}
                    onSelectRoom={onSelectRoom}
                    onJoin={(roomId) => void joinFromSpace(roomId)}
                    onRejectInvite={(roomId) => void onRejectInvite?.(roomId)}
                  />
                );
              }
              const room = workspace.rooms.find((candidate) => candidate.id === childId);
              const preview = workspace.spaceRoomPreviews[childId];
              const name = room?.name || preview?.name || '';
              if (normalizedQuery && !name.toLowerCase().includes(normalizedQuery)) return null;
              return room ? (
                <BuddyRoomRow
                  key={childId}
                  room={room}
                  selected={selectedRoomId === childId}
                  onSelect={onSelectRoom}
                  onAcceptInvite={joinFromSpace}
                  onRejectInvite={onRejectInvite}
                  arrangement={childArrangement}
                />
              ) : preview ? (
                <SpacePreviewRow
                  key={childId}
                  room={preview}
                  depth={0}
                  joining={joiningRoomIds.has(childId)}
                  onJoin={() => void joinFromSpace(childId)}
                  arrangement={childArrangement}
                />
              ) : null;
            })}
            {arranging ? (
              <div
                className="space-branch__dropzone space-tree__root-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); dropIntoSpace(scopeSpace.id); }}
              >Drop here to move into {scopeSpace.name}</div>
            ) : null}
            {normalizedQuery && !spaceContainsQuery(scopeSpace.id, workspace, normalizedQuery, getChildIds) ? (
              <p className="space-tree__empty">No rooms or subspaces match that search.</p>
            ) : null}
          </>
        ) : (
          roomGroups.map((group) => {
            const rooms = workspace.rooms.filter(
              (room) => room.group === group && room.name.toLowerCase().includes(normalizedQuery),
            );
            if (rooms.length === 0) return null;
            const isCollapsed = collapsed[group] ?? false;
            return (
              <section className="buddy-group" key={group}>
                <button
                  className="buddy-group__toggle"
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((current) => ({ ...current, [group]: !isCollapsed }))}
                >
                  <ChevronDown size={14} className={isCollapsed ? 'is-collapsed' : ''} />
                  <span>{groupLabel(group)}</span>
                  <span>{rooms.length}</span>
                </button>
                {!isCollapsed ? (
                  <div className="buddy-group__rooms">
                    {rooms.map((room) => (
                      <BuddyRoomRow
                        key={room.id}
                        room={room}
                        selected={selectedRoomId === room.id}
                        onSelect={onSelectRoom}
                        onAcceptInvite={onAcceptInvite}
                        onRejectInvite={onRejectInvite}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>

      <div className="self-card">
        <button className="self-card__profile" type="button" onClick={onOpenProfile}>
          <Avatar
            name={workspace.user.displayName}
            src={workspace.user.avatarUrl}
            color={colorForId(workspace.user.id)}
            presence={workspace.user.presence}
            size="small"
          />
          <span>
            <strong>{workspace.user.displayName}</strong>
            <small>{workspace.user.statusMessage}</small>
          </span>
        </button>
        <button
          className="self-card__settings"
          type="button"
          aria-label="Open settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={17} />
        </button>
      </div>
    </aside>
  );
}

const TimelineMessage = memo(function TimelineMessage({
  message,
  dataSaver,
  autoplayMedia,
  onReply,
  onEdit,
  onDelete,
  onPin,
  canPin,
  onReact,
  onMediaLoad,
}: {
  message: MessageSummary;
  dataSaver: boolean;
  autoplayMedia: boolean;
  onReply: (message: MessageSummary) => void;
  onEdit: (message: MessageSummary) => void;
  onDelete: (message: MessageSummary) => void;
  onPin: (message: MessageSummary) => void;
  canPin: boolean;
  onReact: (message: MessageSummary, key: string, ownReactionEventId?: string) => void;
  onMediaLoad: () => void;
}) {
  const gatedMedia =
    Boolean(message.mediaUrl) &&
    (dataSaver || (!autoplayMedia && message.mimeType === 'image/gif'));
  const [mediaRevealed, setMediaRevealed] = useState(!gatedMedia);
  const mediaSrc = useMediaSource(
    mediaRevealed ? message.mediaUrl : undefined,
    message.kind === 'sticker' ? 320 : 720,
    message.encryptedFile,
    message.mimeType,
  );
  return (
    <article className={`timeline-message${message.isOwn ? ' timeline-message--own' : ''}`}>
      <Avatar
        name={message.senderName}
        src={message.senderAvatarUrl}
        color={colorForId(message.senderId)}
        size="small"
      />
      <div className="timeline-message__content">
        <header>
          <strong style={{ '--sender-color': colorForId(message.senderId) } as CSSProperties}>
            {message.senderName}
          </strong>
          <time dateTime={new Date(message.timestamp).toISOString()}>{formatTime(message.timestamp)}</time>
          {message.edited ? <span className="sending-label">edited</span> : null}
          {message.pinned ? <span className="sending-label pinned-label"><Pin size={10} /> pinned</span> : null}
          {message.pending ? <span className="sending-label">sending…</span> : null}
        </header>
        {message.replyTo ? (
          <blockquote className="message-reply-context">
            <strong>{message.replyTo.senderName}</strong>
            <span>{message.replyTo.body}</span>
          </blockquote>
        ) : null}
        {!mediaRevealed && message.mediaUrl ? (
          <button className="message-media-gate" type="button" onClick={() => setMediaRevealed(true)}><Images size={16} /> Load {message.mimeType === 'image/gif' ? 'animated media' : 'media'}</button>
        ) : mediaSrc && message.mediaKind === 'video' ? (
          <video className="message-media" src={mediaSrc} controls preload="metadata" onLoadedMetadata={onMediaLoad} />
        ) : mediaSrc && message.mediaKind === 'audio' ? (
          <audio className="message-audio" src={mediaSrc} controls preload="metadata" />
        ) : mediaSrc && message.mediaKind === 'file' ? (
          <a className="message-file" href={mediaSrc} download={message.body}><Paperclip size={15} /> {message.body}</a>
        ) : mediaSrc ? (
          <img
            className={message.kind === 'sticker' ? 'message-sticker' : 'message-media'}
            src={mediaSrc}
            alt={message.body}
            loading="lazy"
            onLoad={onMediaLoad}
          />
        ) : (
          <p className={`message-kind--${message.kind}`}>
            {message.kind === 'emote' ? `${message.senderName} ` : ''}{message.body}
          </p>
        )}
        {message.reactions?.length ? (
          <div className="reaction-row" aria-label="Message reactions">
            {message.reactions.map((reaction) => (
              <button
                type="button"
                className={reaction.reacted ? 'reaction reaction--mine' : 'reaction'}
                key={reaction.key}
                aria-label={`${reaction.key}, ${reaction.count} reactions`}
                onClick={() => onReact(message, reaction.key, reaction.ownEventId)}
              >
                {reaction.key} <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        {message.readBy?.length ? (
          <div
            className="read-indicators"
            role="img"
            aria-label={`Read by ${message.readBy.map((reader) => reader.displayName).join(', ')}`}
            title={`Read by ${message.readBy.map((reader) => reader.displayName).join(', ')}`}
          >
            {message.readBy.slice(0, 5).map((reader) => (
              <span className="read-indicator" key={reader.id}>
                <Avatar
                  name={reader.displayName}
                  src={reader.avatarUrl}
                  color={colorForId(reader.id)}
                  size="small"
                />
              </span>
            ))}
            {message.readBy.length > 5 ? <b>+{message.readBy.length - 5}</b> : null}
          </div>
        ) : null}
      </div>
      <div className="message-actions">
        <button type="button" aria-label="Reply" title="Reply" onClick={() => onReply(message)}><Reply size={14} /></button>
        <button type="button" aria-label="React with thumbs up" title="React" onClick={() => onReact(message, '👍')}><SmilePlus size={14} /></button>
        {canPin ? <button type="button" aria-label={message.pinned ? 'Unpin message' : 'Pin message'} title={message.pinned ? 'Unpin' : 'Pin'} onClick={() => onPin(message)}><Pin size={14} /></button> : null}
        {message.isOwn && message.kind === 'text' ? (
          <><button type="button" aria-label="Edit message" title="Edit" onClick={() => onEdit(message)}><Pencil size={14} /></button><button type="button" aria-label="Delete message" title="Delete" onClick={() => onDelete(message)}><Trash2 size={14} /></button></>
        ) : null}
      </div>
    </article>
  );
});

function Conversation({
  room,
  messages,
  draft,
  sending,
  notice,
  uploadInProgress,
  failedUploadName,
  replyTarget,
  editingMessage,
  onBack,
  onDraftChange,
  onSubmit,
  onToggleDetails,
  onOpenBackground,
  onStartReply,
  onStartEdit,
  onDeleteMessage,
  onTogglePin,
  onCancelContext,
  onReact,
  onSendSticker,
  onUploadAttachment,
  onCancelUpload,
  onRetryUpload,
  onLoadMore,
  gifEndpoint,
  stickerPacks,
  onSendGif,
  callsEnabled,
  onStartCall,
  dataSaver,
  autoplayMedia,
}: {
  room?: RoomSummary;
  messages: MessageSummary[];
  draft: string;
  sending: boolean;
  notice?: string;
  uploadInProgress: boolean;
  failedUploadName?: string;
  replyTarget?: MessageSummary;
  editingMessage?: MessageSummary;
  onBack: () => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onToggleDetails: () => void;
  onOpenBackground: () => void;
  onStartReply: (message: MessageSummary) => void;
  onStartEdit: (message: MessageSummary) => void;
  onDeleteMessage: (message: MessageSummary) => void;
  onTogglePin: (message: MessageSummary) => void;
  onCancelContext: () => void;
  onReact: (message: MessageSummary, key: string, ownReactionEventId?: string) => void;
  onSendSticker: (sticker: { id: string; name: string; src: string }) => void;
  onUploadAttachment: (file: File) => void;
  onCancelUpload: () => void;
  onRetryUpload: () => void;
  onLoadMore: () => Promise<void>;
  gifEndpoint?: string;
  stickerPacks: Array<{ name: string; manifestUrl: string }>;
  onSendGif: (gif: GifChoice) => void;
  callsEnabled: boolean;
  onStartCall: (video: boolean) => void;
  dataSaver: boolean;
  autoplayMedia: boolean;
}) {
  const timeline = useRef<HTMLElement>(null);
  const loadingHistory = useRef(false);
  const stickToBottom = useRef(true);
  const scrollPositions = useRef(new Map<string, number>());
  const previousRoomId = useRef<string | undefined>(undefined);
  const catalogRequested = useRef(false);
  const [colonIndex, setColonIndex] = useState(0);
  const [colonDismissed, setColonDismissed] = useState<string>();
  const [composerCaret, setComposerCaret] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);
  const [stickerCache, setStickerCache] = useState<Record<string, Array<{ id: string; name: string; src: string }>>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [emojiCatalog, setEmojiCatalog] = useState<Array<{ emoji: string; name: string }>>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('aimtrix.recent-emoji.v1') || '[]') as string[]; } catch { return []; }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [messageQuery, setMessageQuery] = useState('');
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerPack, setStickerPack] = useState<Array<{ id: string; name: string; src: string }>>([]);
  const [stickerStatus, setStickerStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [stickerManifest, setStickerManifest] = useState('/stickers/aqua/manifest.json');
  const roomBackgroundSource = useMediaSource(
    dataSaver ? undefined : room?.background?.mxcUrl,
    1600,
  );
  const hasRoomBackground = Boolean(
    room?.background?.mxcUrl || (room?.background?.preset && room.background.preset !== 'none'),
  );
  const roomBackgroundStyle = roomBackgroundSource
    ? ({ '--room-backdrop-image': `url("${roomBackgroundSource}")` } as CSSProperties)
    : undefined;
  const visibleMessages = messageQuery.trim()
    ? messages.filter((message) =>
        `${message.senderName} ${message.body}`.toLowerCase().includes(messageQuery.trim().toLowerCase()),
      )
    : messages;
  const fallbackEmojis = ['😀', '😂', '🥹', '😍', '😎', '🤔', '😭', '😡', '👍', '👀', '✨', '💙', '🎉', '🔥', '🫧', '☕', '💾', '🌈'];
  const visibleEmojis = (emojiCatalog.length
    ? emojiCatalog
    : fallbackEmojis.map((emoji) => ({ emoji, name: emoji })))
    .filter((item) => !emojiQuery.trim() || `${item.name} ${item.emoji}`.toLowerCase().includes(emojiQuery.toLowerCase()))
    .sort((left, right) => {
      const leftRank = recentEmojis.indexOf(left.emoji);
      const rightRank = recentEmojis.indexOf(right.emoji);
      return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank);
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (colonResults.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setColonIndex((index) => (index + 1) % colonResults.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setColonIndex((index) => (index - 1 + colonResults.length) % colonResults.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pickColonResult(colonResults[colonIndex % colonResults.length]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setColonDismissed(colon?.query);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  useLayoutEffect(() => {
    const element = timeline.current;
    if (!element) return;
    if (previousRoomId.current !== room?.id) {
      previousRoomId.current = room?.id;
      const saved = room?.id ? scrollPositions.current.get(room.id) : undefined;
      element.scrollTop = saved ?? element.scrollHeight;
      stickToBottom.current =
        saved === undefined || element.scrollHeight - saved - element.clientHeight < 180;
    } else if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [room?.id, messages.length]);

  const handleMediaLoad = useCallback(() => {
    const element = timeline.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, []);

  const anyTrayOpen = gifOpen || stickerOpen || emojiOpen;

  useEffect(() => {
    if (!anyTrayOpen) return;
    const closeTrays = () => {
      setGifOpen(false);
      setStickerOpen(false);
      setEmojiOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeTrays();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.emoji-tray, .sticker-tray, .gif-picker, .composer')
      ) {
        return;
      }
      closeTrays();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [anyTrayOpen]);

  const loadEmojiCatalog = useCallback(() => {
    if (catalogRequested.current) return;
    catalogRequested.current = true;
    void fetch('/emoji/catalog.json')
      .then((response) => response.json())
      .then((catalog: Array<{ emoji: string; name: string }>) => {
        if (Array.isArray(catalog)) setEmojiCatalog(catalog);
      })
      .catch(() => {
        catalogRequested.current = false;
      });
  }, []);

  useEffect(() => {
    if (emojiOpen) loadEmojiCatalog();
  }, [emojiOpen, loadEmojiCatalog]);

  const colon = (() => {
    if (!composerFocused) return undefined;
    const caret = Math.min(composerCaret, draft.length);
    const match = /(?:^|\s):([a-z0-9_+-]{2,})$/i.exec(draft.slice(0, caret));
    return match ? { query: match[1].toLowerCase(), start: caret - match[1].length - 1, caret } : undefined;
  })();

  useEffect(() => {
    if (colon) loadEmojiCatalog();
  }, [colon, loadEmojiCatalog]);

  const [lastColonQuery, setLastColonQuery] = useState(colon?.query);
  if (lastColonQuery !== colon?.query) {
    setLastColonQuery(colon?.query);
    setColonIndex(0);
  }

  const colonResults = (() => {
    if (!colon || colonDismissed === colon.query) return [] as Array<
      ({ type: 'emoji' } & { emoji: string; name: string }) |
      ({ type: 'sticker' } & { id: string; name: string; src: string })
    >;
    const query = colon.query;
    const rank = (name: string) => {
      const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!normalized.includes(query)) return -1;
      return normalized.startsWith(query) ? 0 : 1;
    };
    const emojiMatches = emojiCatalog
      .map((entry) => ({ entry, score: rank(entry.name) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => left.score - right.score)
      .slice(0, 6)
      .map(({ entry }) => ({ type: 'emoji' as const, ...entry }));
    const stickerMatches = Object.values(stickerCache)
      .flat()
      .filter((sticker) => rank(sticker.name) >= 0)
      .slice(0, 4)
      .map((sticker) => ({ type: 'sticker' as const, ...sticker }));
    return [...emojiMatches, ...stickerMatches];
  })();

  const pickColonResult = (result: (typeof colonResults)[number]) => {
    if (!colon) return;
    const before = draft.slice(0, colon.start);
    const after = draft.slice(colon.caret);
    if (result.type === 'emoji') {
      onDraftChange(`${before}${result.emoji}${after}`);
      const next = [result.emoji, ...recentEmojis.filter((recent) => recent !== result.emoji)].slice(0, 18);
      setRecentEmojis(next);
      localStorage.setItem('aimtrix.recent-emoji.v1', JSON.stringify(next));
    } else {
      onDraftChange(`${before}${after}`);
      onSendSticker({ id: result.id, name: result.name, src: result.src });
    }
    setColonDismissed(colon.query);
  };

  useEffect(() => {
    if (!stickerOpen) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setStickerStatus('loading');
        setStickerPack([]);
      }
    });
    void loadStickerPack(stickerManifest, controller.signal)
      .then((items) => {
        setStickerCache((current) => ({ ...current, [stickerManifest]: items }));
        setStickerPack(items);
        setStickerStatus('idle');
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setStickerStatus('error');
      });
    return () => controller.abort();
  }, [stickerManifest, stickerOpen]);

  if (!room) {
    return (
      <main className="conversation conversation--empty">
        <BrandMark />
        <h2>Your buddy list is quiet</h2>
        <p>Join a room or start a direct conversation to begin chatting.</p>
      </main>
    );
  }

  return (
    <main
      className={`conversation${hasRoomBackground ? ` conversation--backdrop room-backdrop--${room.background?.preset ?? 'none'}${roomBackgroundSource ? ' has-custom-backdrop' : ''}` : ''}`}
      style={roomBackgroundStyle}
      aria-label={`Conversation with ${room.name}`}
    >
      <header className="conversation-header">
        <IconButton label="Back to buddy list" onClick={onBack}>
          <ArrowLeft className="mobile-back" size={18} />
        </IconButton>
        <Avatar
          name={room.name}
          src={room.avatarUrl}
          color={colorForId(room.id)}
          presence={room.presence}
          size="small"
        />
        <div className="conversation-header__copy">
          <h2>{room.name}</h2>
          <p>{room.statusMessage || (room.kind === 'direct' ? 'Direct message' : 'Matrix room')}</p>
        </div>
        <div className="conversation-header__actions">
          <IconButton label="Search loaded messages" active={searchOpen} onClick={() => setSearchOpen((open) => !open)}><Search size={17} /></IconButton>
          {room.encrypted ? <span className="encrypted-pill"><ShieldCheck size={13} /> Encrypted</span> : null}
          {callsEnabled && room.kind === 'direct' ? (
            <span className="header-call-actions">
              <IconButton label="Start voice call" onClick={() => onStartCall(false)}><Phone size={17} /></IconButton>
              <IconButton label="Start video call" onClick={() => onStartCall(true)}><Video size={17} /></IconButton>
            </span>
          ) : null}
          <IconButton label="Decorate conversation background" onClick={onOpenBackground}><Paintbrush size={17} /></IconButton>
          <IconButton label="Toggle room details" onClick={onToggleDetails}>
            <PanelRight size={18} />
          </IconButton>
        </div>
      </header>
      {searchOpen ? (
        <label className="message-search">
          <Search size={15} />
          <span className="sr-only">Search loaded messages</span>
          <input autoFocus value={messageQuery} placeholder="Search loaded messages" onChange={(event) => setMessageQuery(event.target.value)} />
          {messageQuery ? <span>{visibleMessages.length} found</span> : null}
          <button type="button" aria-label="Close message search" onClick={() => { setSearchOpen(false); setMessageQuery(''); }}><X size={14} /></button>
        </label>
      ) : null}

      <section ref={timeline} className="timeline" aria-label="Messages" aria-live="polite" onScroll={() => {
        const element = timeline.current;
        if (!element) return;
        stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 180;
        if (room?.id) scrollPositions.current.set(room.id, element.scrollTop);
        if (element.scrollTop > 80 || loadingHistory.current) return;
        loadingHistory.current = true;
        const previousHeight = element.scrollHeight;
        const roomAtStart = room?.id;
        void onLoadMore().finally(() => {
          requestAnimationFrame(() => {
            if (timeline.current && previousRoomId.current === roomAtStart) {
              timeline.current.scrollTop += timeline.current.scrollHeight - previousHeight;
            }
            loadingHistory.current = false;
          });
        });
      }}>
        <div className="conversation-intro">
          <Avatar
            name={room.name}
            src={room.avatarUrl}
            color={colorForId(room.id)}
            presence={room.presence}
            size="large"
          />
          <h1>{room.name}</h1>
          <p>{room.statusMessage || `This is the beginning of ${room.name}. Say hello.`}</p>
          {room.encrypted ? (
            <span className="intro-encryption"><Lock size={12} /> Messages in this room are encrypted.</span>
          ) : null}
        </div>
        {visibleMessages.length ? (
          visibleMessages.map((message) => (
            <TimelineMessage
              message={message}
              dataSaver={dataSaver}
              autoplayMedia={autoplayMedia}
              key={message.id}
              onReply={onStartReply}
              onEdit={onStartEdit}
              onDelete={onDeleteMessage}
              onPin={onTogglePin}
              canPin={Boolean(room.canManage)}
              onReact={onReact}
              onMediaLoad={handleMediaLoad}
            />
          ))
        ) : (
          <div className="timeline-empty"><Sparkles size={20} /> {messageQuery ? 'No loaded messages match.' : 'No messages here yet.'}</div>
        )}
      </section>

      <div className="typing-strip" aria-live="polite">
        {notice ? <>{notice}{uploadInProgress ? <button className="cancel-upload" type="button" onClick={onCancelUpload}>Cancel</button> : failedUploadName ? <button className="cancel-upload" type="button" onClick={onRetryUpload}>Retry {failedUploadName}</button> : null}</> : room.typingUsers?.length ? <><i /><i /><i /> {room.typingUsers.slice(0, 2).join(' and ')} {room.typingUsers.length === 1 ? 'is' : 'are'} typing</> : room.id === 'welcome' ? <><i /><i /><i /> Mara is typing</> : <>&nbsp;</>}
      </div>
      {replyTarget || editingMessage ? (
        <div className="composer-context">
          <div>
            <strong>{editingMessage ? 'Editing message' : `Replying to ${replyTarget?.senderName}`}</strong>
            <span>{editingMessage?.body || replyTarget?.body}</span>
          </div>
          <button type="button" aria-label="Cancel reply or edit" onClick={onCancelContext}><X size={15} /></button>
        </div>
      ) : null}
      {gifOpen && gifEndpoint ? (
        <GifPicker endpoint={gifEndpoint} onSelect={(gif) => { onSendGif(gif); setGifOpen(false); }} />
      ) : null}
      {stickerOpen ? (
        <div className="sticker-tray" aria-label="Sticker picker">
          <header><strong>Sticker packs</strong><select aria-label="Sticker pack" value={stickerManifest} onChange={(event) => setStickerManifest(event.target.value)}>{stickerPacks.map((pack) => <option value={pack.manifestUrl} key={pack.manifestUrl}>{pack.name}</option>)}</select></header>
          <div aria-busy={stickerStatus === 'loading'}>
            {stickerStatus === 'loading' ? <p><span className="spinner" /> Loading stickers…</p> : stickerStatus === 'error' ? <p role="alert">This sticker pack could not be loaded.</p> : stickerPack.map((sticker) => (
              <button
                type="button"
                key={`${sticker.id}:${sticker.src}`}
                aria-label={`Send ${sticker.name}`}
                onClick={() => {
                  onSendSticker(sticker);
                  setStickerOpen(false);
                }}
              ><ResolvedStickerImage sticker={sticker} /></button>
            ))}
          </div>
        </div>
      ) : null}
      {emojiOpen ? (
        <div className="emoji-tray" aria-label="Emoji picker">
          <header><strong>Emoji</strong><span>{recentEmojis.length ? 'Recents first' : 'Search by name'}</span></header>
          <label className="emoji-search"><Search size={13} /><span className="sr-only">Search emoji</span><input autoFocus value={emojiQuery} placeholder="Search emoji" onChange={(event) => setEmojiQuery(event.target.value)} /></label>
          <div>
            {visibleEmojis.map(({ emoji, name }) => (
              <button
                type="button"
                key={emoji}
                aria-label={`Insert ${emoji}`}
                title={name}
                onClick={() => {
                  onDraftChange(`${draft}${emoji}`);
                  const next = [emoji, ...recentEmojis.filter((recent) => recent !== emoji)].slice(0, 18);
                  setRecentEmojis(next);
                  localStorage.setItem('aimtrix.recent-emoji.v1', JSON.stringify(next));
                  setEmojiOpen(false);
                  setEmojiQuery('');
                }}
              >{emoji}</button>
            ))}
          </div>
        </div>
      ) : null}
      {colonResults.length ? (
        <div className="colon-complete" role="listbox" aria-label="Emoji and sticker suggestions">
          {colonResults.map((result, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === colonIndex % colonResults.length}
              className={index === colonIndex % colonResults.length ? 'is-active' : ''}
              key={result.type === 'emoji' ? result.emoji : `${result.id}:${result.src}`}
              onMouseDown={(event) => {
                event.preventDefault();
                pickColonResult(result);
              }}
              onMouseEnter={() => setColonIndex(index)}
            >
              {result.type === 'emoji' ? (
                <span className="colon-complete__emoji">{result.emoji}</span>
              ) : (
                <span className="colon-complete__sticker"><ResolvedStickerImage sticker={result} /></span>
              )}
              <span className="colon-complete__name">:{result.name.replace(/\s+/g, '')}:</span>
              {result.type === 'sticker' ? <small>sticker</small> : null}
            </button>
          ))}
        </div>
      ) : null}
      <form className="composer" onSubmit={submit}>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          aria-label="Choose attachment"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUploadAttachment(file);
            event.target.value = '';
          }}
        />
        <IconButton label="Attach a file" onClick={() => fileInput.current?.click()}>
          <Paperclip size={18} />
        </IconButton>
        <label className="composer__field">
          <span className="sr-only">Message {room.name}</span>
          <textarea
            rows={1}
            value={draft}
            placeholder={`Message ${room.name}`}
            onChange={(event) => {
              setComposerCaret(event.target.selectionStart ?? event.target.value.length);
              onDraftChange(event.target.value);
            }}
            onSelect={(event) => setComposerCaret(event.currentTarget.selectionStart ?? 0)}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
        </label>
        {gifEndpoint ? (
          <IconButton label="Search GIFs" active={gifOpen} onClick={() => {
            setGifOpen((open) => !open);
            setStickerOpen(false);
            setEmojiOpen(false);
          }}><Film size={18} /></IconButton>
        ) : null}
        <IconButton
          label="Open sticker pack"
          active={stickerOpen}
          onClick={() => {
            setStickerOpen((open) => !open);
            setEmojiOpen(false);
            setGifOpen(false);
          }}
        ><Sticker size={18} /></IconButton>
        <IconButton label="Add emoji" active={emojiOpen} onClick={() => {
          setEmojiOpen((open) => !open);
          setStickerOpen(false);
          setGifOpen(false);
        }}>
          <Smile size={19} />
        </IconButton>
        <button className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || sending}>
          <Send size={17} />
        </button>
      </form>
    </main>
  );
}

function ResolvedStickerImage({ sticker }: { sticker: { name: string; src: string } }) {
  const source = useMediaSource(sticker.src, 180);
  return source ? <img src={source} alt="" /> : <span className="spinner" aria-label={`Loading ${sticker.name}`} />;
}

function MomentPreview({ message }: { message: MessageSummary }) {
  const source = useMediaSource(
    message.mediaUrl,
    220,
    message.encryptedFile,
    message.mimeType,
  );
  if (source && (message.mediaKind === 'image' || message.kind === 'sticker')) {
    return <img src={source} alt={message.body} loading="lazy" />;
  }
  return <Images size={22} />;
}

const backgroundLabels: Record<RoomBackground['preset'], string> = {
  none: 'None',
  'aero-sky': 'Aero sky',
  'blue-lagoon': 'Blue lagoon',
  'green-meadow': 'Green meadow',
  'citrus-grove': 'Citrus grove',
  'soft-twilight': 'Soft twilight',
  'graphite-grid': 'Graphite grid',
};

function RoomBackgroundPanel({
  room,
  space,
  membersByRoom,
  demo,
  dataSaver,
  onSetBackground,
  onUpload,
  onSetPolicy,
  onSetMemberPower,
}: {
  room: RoomSummary;
  space?: SpaceSummary;
  membersByRoom: WorkspaceSnapshot['membersByRoom'];
  demo: boolean;
  dataSaver: boolean;
  onSetBackground?: (roomId: string, background: RoomBackground, personal: boolean) => Promise<void>;
  onUpload?: (file: File) => Promise<string>;
  onSetPolicy?: (roomId: string, permission: RoomBackgroundPermission) => Promise<void>;
  onSetMemberPower?: (roomId: string, userId: string, level: number) => Promise<void>;
}) {
  const personal = room.kind === 'direct';
  const [target, setTarget] = useState<'room' | 'space'>('room');
  const targetSpace = !personal && target === 'space' ? space : undefined;
  const targetId = targetSpace?.id ?? room.id;
  const targetName = targetSpace?.name ?? room.name;
  const targetPolicy = targetSpace?.backgroundPolicy ?? room.backgroundPolicy;
  const targetMembers = membersByRoom[targetId] ?? [];
  const initialBackground = targetSpace?.background ?? room.background ?? defaultRoomBackground;
  const [draft, setDraft] = useState<RoomBackground>(initialBackground);
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const customSource = useMediaSource(dataSaver ? undefined : draft.mxcUrl, 700);
  const canChange = personal || Boolean(targetPolicy?.canChange) || demo;
  const previewStyle = customSource
    ? ({ '--room-backdrop-image': `url("${customSource}")` } as CSSProperties)
    : undefined;

  const chooseTarget = (nextTarget: 'room' | 'space') => {
    setTarget(nextTarget);
    const nextBackground = nextTarget === 'space' ? space?.background : room.background;
    setDraft(nextBackground ?? defaultRoomBackground);
    setStatus(undefined);
  };

  const save = async () => {
    if (!onSetBackground) return;
    setBusy(true);
    setStatus(personal ? 'Saving your private DM backdrop…' : `Saving the shared ${targetSpace ? 'space' : 'room'} backdrop…`);
    try {
      await onSetBackground(targetId, draft, personal);
      setStatus(personal ? 'Your DM backdrop was saved privately.' : `${targetSpace ? 'Space' : 'Room'} backdrop saved.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The backdrop could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!onUpload) return;
    setBusy(true);
    setStatus('Uploading backdrop to Matrix…');
    try {
      const mxcUrl = await onUpload(file);
      setDraft({ preset: 'none', mxcUrl });
      setStatus('Image uploaded. Choose Save backdrop to apply it.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That backdrop could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  const updatePolicy = async (permission: RoomBackgroundPermission) => {
    if (!onSetPolicy) return;
    setBusy(true);
    setStatus('Updating backdrop permissions…');
    try {
      await onSetPolicy(targetId, permission);
      setStatus(`Backdrop permission changed to ${permission === 'members' ? 'Everyone' : permission === 'decorators' ? 'Decorators' : 'Room managers only'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Backdrop permissions could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const updateDecorator = async (userId: string, displayName: string, enabled: boolean) => {
    if (!onSetMemberPower) return;
    setBusy(true);
    setStatus(`${enabled ? 'Assigning' : 'Removing'} Decorator for ${displayName}…`);
    try {
      await onSetMemberPower(targetId, userId, enabled ? 25 : 0);
      setStatus(`${displayName} is ${enabled ? 'now a Decorator' : 'now a Member'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That role could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="room-background-panel">
      <div className="room-background-heading">
        <div><span className="eyebrow">Conversation backdrop</span><h3>{personal ? 'My DM background' : targetSpace ? `${targetSpace.name} space background` : 'Shared room background'}</h3></div>
        <Paintbrush size={19} />
      </div>
      {!personal && space ? (
        <div className="room-background-target aqua-segmented" aria-label="Backdrop scope">
          <button type="button" className={target === 'room' ? 'is-active' : ''} aria-pressed={target === 'room'} onClick={() => chooseTarget('room')}>This room</button>
          <button type="button" className={target === 'space' ? 'is-active' : ''} aria-pressed={target === 'space'} onClick={() => chooseTarget('space')}>{space.name} space</button>
        </div>
      ) : null}
      <p className="room-background-copy">
        {personal
          ? 'Only you see this choice. Everyone in the DM can set their own view.'
          : targetSpace
            ? `This shared backdrop is inherited by rooms viewed inside ${targetSpace.name}, unless a room sets its own.`
            : 'This is shared Matrix room state. Your room role decides whether you can change it.'}
      </p>
      <div
        className={`room-background-preview room-backdrop--${draft.preset}${customSource ? ' has-custom-backdrop' : ''}`}
        style={previewStyle}
        aria-label="Backdrop preview"
      ><span>Messages stay on a calm reading surface.</span></div>
      <div className="room-background-choices">
        {roomBackgroundPresetNames.map((preset) => (
          <button
            type="button"
            className={`room-background-choice room-backdrop--${preset}${draft.preset === preset && !draft.mxcUrl ? ' is-active' : ''}`}
            aria-pressed={draft.preset === preset && !draft.mxcUrl}
            disabled={!canChange || busy}
            key={preset}
            onClick={() => setDraft({
              preset,
              ...(preset === 'none' && !personal && !targetSpace ? { blockSpaceInheritance: true } : {}),
            })}
          ><i /> <span>{backgroundLabels[preset]}</span></button>
        ))}
      </div>
      <div className="room-background-actions">
        <label className={`aqua-button${!onUpload || !canChange || busy ? ' is-disabled' : ''}`}>
          <Images size={13} /> Upload image
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={!onUpload || !canChange || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
        </label>
        <button className="aqua-button aqua-button--primary" type="button" disabled={!canChange || busy || !onSetBackground} onClick={() => void save()}>Save backdrop</button>
      </div>
      {draft.mxcUrl && dataSaver ? <p className="room-background-note">Data saver is hiding the custom-image preview.</p> : null}
      {!onUpload && demo ? <p className="room-background-note">Sign in to upload custom images. Presets work in the demo.</p> : null}
      <p className="room-background-note">Artwork is always dimmed behind protected message surfaces. Uploaded room media and state are not end-to-end encrypted; keep images non-sensitive.</p>

      {!personal ? (
        <div className="room-background-permissions">
          <label>
            <span><strong>Who can decorate?</strong><small>Enforced by the Matrix power level for Aimtrix backdrop state.</small></span>
            <select
              aria-label={`Who can change the ${targetSpace ? 'space' : 'room'} background`}
              value={targetPolicy?.mode ?? 'admins'}
              disabled={!targetPolicy?.canManage || busy || !onSetPolicy}
              onChange={(event) => void updatePolicy(event.target.value as RoomBackgroundPermission)}
            >
              <option value="admins">Room managers only</option>
              <option value="decorators">Decorators and moderators</option>
              <option value="members">Everyone</option>
            </select>
          </label>
          {targetPolicy?.mode === 'decorators' ? (
            <>
              <p>The <strong>Decorator</strong> role uses power level {thresholdForBackgroundPermission('decorators')}, below moderators.</p>
              {targetPolicy.canManage && onSetMemberPower ? (
                <div className="decorator-role-list" aria-label={`Decorators for ${targetName}`}>
                  {targetMembers
                    .filter((member) => member.membership !== 'ban' && member.membership !== 'invite' && (member.powerLevel ?? 0) < 50)
                    .slice(0, 50)
                    .map((member) => (
                      <label key={member.id}>
                        <span><strong>{member.displayName}</strong><small>{(member.powerLevel ?? 0) >= 25 ? 'Decorator' : 'Member'}</small></span>
                        <input
                          type="checkbox"
                          aria-label={`Decorator role for ${member.displayName}`}
                          checked={(member.powerLevel ?? 0) >= 25}
                          disabled={busy}
                          onChange={(event) => void updateDecorator(member.id, member.displayName, event.target.checked)}
                        />
                      </label>
                    ))}
                </div>
              ) : null}
              <p>Matrix power levels are room-wide. Before assigning level 25, administrators should confirm no unrelated moderation action uses a threshold at or below 25.</p>
            </>
          ) : null}
          {!targetPolicy?.canChange ? <p className="room-background-denied">Your current role cannot change this shared backdrop.</p> : null}
        </div>
      ) : null}
      {status ? <p className="room-background-status" role="status">{status}</p> : null}
    </div>
  );
}

function DetailsPanel({
  workspace,
  room,
  scopeSpace,
  dataSaver,
  onUpdateRoom,
  onUpdateAvatar,
  onUploadBackground,
  onSetBackground,
  onSetBackgroundPolicy,
  onEnableEncryption,
  onSetMuted,
  onInvite,
  onRemoveMember,
  onSetMemberPower,
  onLeave,
}: {
  workspace: WorkspaceSnapshot;
  room?: RoomSummary;
  scopeSpace?: SpaceSummary;
  dataSaver: boolean;
  onUpdateRoom?: (roomId: string, update: { name?: string; topic?: string }) => Promise<void>;
  onUpdateAvatar?: (roomId: string, file: File) => Promise<void>;
  onUploadBackground?: (file: File) => Promise<string>;
  onSetBackground?: (roomId: string, background: RoomBackground, personal: boolean) => Promise<void>;
  onSetBackgroundPolicy?: (roomId: string, permission: RoomBackgroundPermission) => Promise<void>;
  onEnableEncryption?: (roomId: string) => Promise<void>;
  onSetMuted?: (roomId: string, muted: boolean) => Promise<void>;
  onInvite?: (roomId: string, userId: string) => Promise<void>;
  onRemoveMember?: (roomId: string, userId: string, action: 'kick' | 'ban' | 'unban') => Promise<void>;
  onSetMemberPower?: (roomId: string, userId: string, level: number) => Promise<void>;
  onLeave?: (roomId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<'people' | 'moments' | 'about' | 'backdrop' | 'settings'>('people');
  const [copied, setCopied] = useState(false);
  const [invitee, setInvitee] = useState('');
  const [roomName, setRoomName] = useState(room?.name ?? '');
  const [roomTopicValue, setRoomTopicValue] = useState(room?.topic ?? '');
  const [actionStatus, setActionStatus] = useState<string>();
  const members = room ? workspace.membersByRoom[room.id] ?? [] : [];
  const messages = room ? workspace.messagesByRoom[room.id] ?? [] : [];
  const mediaMessages = messages
    .filter((message) => message.kind === 'media' || message.kind === 'sticker')
    .slice(-6)
    .reverse();
  const presenceOrder = { online: 0, away: 1, busy: 2, offline: 3 } as const;
  const sortedMembers = members
    .slice()
    .sort((left, right) => presenceOrder[left.presence] - presenceOrder[right.presence]);
  const onlineCount = members.filter((member) => member.presence === 'online').length;
  const moodSymbols = ['✦', '☁', '♫', '★', '☕', '☻'];
  const mood = room ? moodSymbols[Math.abs(room.id.charCodeAt(1) || 0) % moodSymbols.length] : '✦';

  const runRoomAction = async (label: string, action: () => Promise<void>) => {
    setActionStatus(`${label}…`);
    try {
      await action();
      setActionStatus(`${label} complete.`);
    } catch {
      setActionStatus(`${label} failed. Check your room permissions.`);
    }
  };

  const copyRoomId = () => {
    if (!room || !navigator.clipboard) return;
    void navigator.clipboard.writeText(room.id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <aside className="details-panel buddy-drawer" aria-label="Buddy and room drawer">
      <div className="details-panel__banner">
        <Sparkles size={16} />
        <span>{room?.kind === 'direct' ? 'Buddy Card' : 'Room Lounge'}</span>
        {room ? <b>{mood}</b> : null}
      </div>
      {room ? (
        <>
          <div
            className="drawer-profile"
            style={{ '--drawer-color': colorForId(room.id) } as CSSProperties}
          >
            <div className="drawer-profile__sky"><i /><i /><i /></div>
            <Avatar
              name={room.name}
              src={room.avatarUrl}
              color={colorForId(room.id)}
              presence={room.presence}
              size="large"
            />
            <h2>{room.name}</h2>
            <p>{room.statusMessage || room.lastMessage}</p>
            <div className="drawer-profile__badges">
              {room.encrypted ? <span><Lock size={11} /> Encrypted</span> : <span>Open history</span>}
              {room.kind === 'direct' && room.presence ? (
                <span><i className={`presence-swatch presence-swatch--${room.presence}`} /> {room.presence}</span>
              ) : null}
            </div>
            <button className="drawer-copy-button" type="button" onClick={copyRoomId}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied room address' : 'Copy room address'}
            </button>
          </div>

          <div className={`drawer-tabs${workspace.mode === 'matrix' ? ' drawer-tabs--five' : ''}`} role="tablist" aria-label="Drawer sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'people'}
              className={tab === 'people' ? 'is-active' : ''}
              onClick={() => setTab('people')}
            ><Users size={14} /> People</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'moments'}
              className={tab === 'moments' ? 'is-active' : ''}
              onClick={() => setTab('moments')}
            ><Images size={14} /> Moments</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'about'}
              className={tab === 'about' ? 'is-active' : ''}
              onClick={() => setTab('about')}
            ><Info size={14} /> About</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'backdrop'}
              className={tab === 'backdrop' ? 'is-active' : ''}
              onClick={() => setTab('backdrop')}
            ><Paintbrush size={14} /> Backdrop</button>
            {workspace.mode === 'matrix' ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'settings'}
                className={tab === 'settings' ? 'is-active' : ''}
                onClick={() => setTab('settings')}
              ><Settings size={14} /> Manage</button>
            ) : null}
          </div>

          {tab === 'people' ? (
            <div className="drawer-tab-panel">
              <div className="member-heading">
                <Users size={14} /> {onlineCount} online <span>{members.length} total</span>
              </div>
              {workspace.mode === 'matrix' ? (
                <form className="drawer-invite" onSubmit={(event) => {
                  event.preventDefault();
                  if (!room || !invitee.trim() || !onInvite) return;
                  void runRoomAction('Invite', () => onInvite(room.id, invitee.trim())).then(() => setInvitee(''));
                }}>
                  <input value={invitee} onChange={(event) => setInvitee(event.target.value)} placeholder="@buddy:server" aria-label="Matrix ID to invite" />
                  <button type="submit" aria-label="Invite to room"><UserPlus size={14} /></button>
                </form>
              ) : null}
              <div className="member-list">
                {sortedMembers.length ? sortedMembers.map((member) => (
                  <div className="member-row" key={member.id}>
                    <Avatar
                      name={member.displayName}
                      src={member.avatarUrl}
                      color={colorForId(member.id)}
                      presence={member.presence}
                      size="small"
                    />
                    <span><strong>{member.displayName}</strong><small>{member.membership === 'ban' ? 'Banned' : member.membership === 'invite' ? 'Invited' : member.role || member.presence}</small></span>
                    {room.canManage && member.id !== workspace.user.id && (member.powerLevel ?? 0) < (room.ownPowerLevel ?? 0) ? (
                      <span className="member-moderation">
                        {member.membership === 'ban' ? (
                          <button type="button" title="Unban member" aria-label={`Unban ${member.displayName}`} onClick={() => void runRoomAction('Unban member', () => onRemoveMember?.(room.id, member.id, 'unban') ?? Promise.resolve())}><Check size={12} /></button>
                        ) : (
                          <>
                            {(room.ownPowerLevel ?? 0) >= 100 ? <select aria-label={`Role for ${member.displayName}`} value={(member.powerLevel ?? 0) >= 50 ? 50 : (member.powerLevel ?? 0) >= 25 ? 25 : 0} onChange={(event) => void runRoomAction('Update role', () => onSetMemberPower?.(room.id, member.id, Number(event.target.value)) ?? Promise.resolve())}><option value="0">Member</option><option value="25">Decorator</option><option value="50">Moderator</option></select> : null}
                            {member.membership === 'join' ? <button type="button" title="Remove member" aria-label={`Remove ${member.displayName}`} onClick={() => void runRoomAction('Remove member', () => onRemoveMember?.(room.id, member.id, 'kick') ?? Promise.resolve())}><UserMinus size={12} /></button> : null}
                            <button type="button" title="Ban member" aria-label={`Ban ${member.displayName}`} onClick={() => void runRoomAction('Ban member', () => onRemoveMember?.(room.id, member.id, 'ban') ?? Promise.resolve())}><Ban size={12} /></button>
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                )) : <p className="drawer-empty">No buddy details have arrived yet.</p>}
              </div>
            </div>
          ) : null}

          {tab === 'moments' ? (
            <div className="drawer-tab-panel drawer-moments">
              <span className="eyebrow">Recent shared media</span>
              {mediaMessages.length ? mediaMessages.map((message) => (
                <div className="drawer-moment" key={message.id}>
                  <MomentPreview message={message} />
                  <span><strong>{message.body}</strong><small>shared by {message.senderName}</small></span>
                </div>
              )) : (
                <div className="drawer-empty drawer-empty--illustrated">
                  <span>◫</span>
                  <strong>No moments yet</strong>
                  <p>Pictures, stickers, and shared files will collect here.</p>
                </div>
              )}
            </div>
          ) : null}

          {tab === 'about' ? (
            <div className="drawer-tab-panel drawer-about">
              <span className="eyebrow">Room details</span>
              <dl>
                <div><dt>Kind</dt><dd>{room.kind === 'direct' ? 'Direct message' : 'Group room'}</dd></div>
                <div><dt>Messages loaded</dt><dd>{messages.length}</dd></div>
                <div><dt>Encryption</dt><dd>{room.encrypted ? 'Enabled' : 'Not enabled'}</dd></div>
                <div><dt>Address</dt><dd title={room.id}>{room.id}</dd></div>
              </dl>
            </div>
          ) : null}

          {tab === 'backdrop' ? (
            <div className="drawer-tab-panel">
              <RoomBackgroundPanel
                room={room}
                space={scopeSpace}
                membersByRoom={workspace.membersByRoom}
                demo={workspace.mode === 'demo'}
                dataSaver={dataSaver}
                onSetBackground={onSetBackground}
                onUpload={onUploadBackground}
                onSetPolicy={onSetBackgroundPolicy}
                onSetMemberPower={onSetMemberPower}
              />
            </div>
          ) : null}

          {tab === 'settings' ? (
            <div className="drawer-tab-panel drawer-manage">
              <span className="eyebrow">Room management</span>
              {room.canManage ? (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  if (onUpdateRoom) void runRoomAction('Save room details', () => onUpdateRoom(room.id, { name: roomName, topic: roomTopicValue }));
                }}>
                  <label>Name<input value={roomName} onChange={(event) => setRoomName(event.target.value)} /></label>
                  <label>Topic<textarea rows={3} value={roomTopicValue} onChange={(event) => setRoomTopicValue(event.target.value)} /></label>
                  <label>Room picture<input type="file" accept="image/*" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file && onUpdateAvatar) void runRoomAction('Update room picture', () => onUpdateAvatar(room.id, file));
                    event.target.value = '';
                  }} /></label>
                  <button className="aqua-button aqua-button--primary" type="submit">Save room details</button>
                  {!room.encrypted ? <button className="aqua-button" type="button" onClick={() => void runRoomAction('Enable encryption', () => onEnableEncryption?.(room.id) ?? Promise.resolve())}><Lock size={13} /> Enable encryption forever</button> : null}
                </form>
              ) : <p className="drawer-empty">You can view this room, but only its moderators can change room state.</p>}
              <label className="settings-toggle-row drawer-notification-toggle"><span><strong>Mute room notifications</strong><small>Saved as a Matrix push rule.</small></span><input type="checkbox" checked={Boolean(room.muted)} onChange={(event) => void runRoomAction(event.target.checked ? 'Mute room' : 'Unmute room', () => onSetMuted?.(room.id, event.target.checked) ?? Promise.resolve())} /></label>
              <button className="aqua-button drawer-leave" type="button" onClick={() => {
                if (window.confirm(`Leave ${room.name}?`)) void runRoomAction('Leave room', () => onLeave?.(room.id) ?? Promise.resolve());
              }}><DoorOpen size={13} /> Leave room</button>
              {actionStatus ? <p className="drawer-action-status" role="status">{actionStatus}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}

export function Workspace({
  workspace,
  config,
  theme,
  preferences,
  profilePersonalization = defaultProfilePersonalization,
  onThemeChange,
  onPreferencesChange,
  onProfilePersonalizationChange,
  onUploadProfileBanner,
  onUpdateProfile,
  matrixSettingsActions,
  onSendMessage,
  onRoomSelected,
  onSpaceSelected,
  onReorganizeSpaceChildren,
  onReorderRootSpaces,
  onSendReply,
  onEditMessage,
  onRedactMessage,
  onTogglePinnedMessage,
  onToggleReaction,
  onSendTyping,
  onSendSticker,
  onUploadAttachment,
  onCancelUpload,
  onSendGif,
  onMarkRoomRead,
  onJoinRoom,
  onSearchPublicRooms,
  onCreateDirectRoom,
  onCreateRoom,
  onRejectInvite,
  onStartCall,
  onAnswerCall,
  onRejectCall,
  onHangupCall,
  onCallMicrophone,
  onCallVideo,
  onScreenshare,
  onUpdateRoom,
  onUpdateRoomAvatar,
  onUploadRoomBackground,
  onSetRoomBackground,
  onSetRoomBackgroundPolicy,
  onEnableRoomEncryption,
  onSetRoomMuted,
  onInviteToRoom,
  onRemoveRoomMember,
  onSetRoomMemberPower,
  onLeaveRoom,
  onSignOut,
}: WorkspaceProps) {
  const locationKey = `aimtrix.location.v2:${workspace.user.id}`;
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(locationKey) || '{}') as { roomId?: string };
      return stored.roomId ?? workspace.rooms[0]?.id;
    } catch {
      return workspace.rooms[0]?.id;
    }
  });
  const [activeSpace, setActiveSpace] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(locationKey) || '{}') as { spaceId?: string };
      return stored.spaceId && workspace.spaces.some((space) => space.id === stored.spaceId)
        ? stored.spaceId
        : workspace.spaces[0]?.id ?? 'home';
    } catch {
      return workspace.spaces[0]?.id ?? 'home';
    }
  });
  const [query, setQuery] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(preferences.detailsOpenByDefault);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [backgroundDialogOpen, setBackgroundDialogOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [demoMessages, setDemoMessages] = useState(workspace.messagesByRoom);
  const [sending, setSending] = useState(false);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [failedUpload, setFailedUpload] = useState<File>();
  const [notice, setNotice] = useState<string>();
  const [roomOverrides, setRoomOverrides] = useState<Record<string, Partial<RoomSummary>>>({});
  const [spaceOverrides, setSpaceOverrides] = useState<Record<string, Partial<SpaceSummary>>>({});

  const [prunedRooms, setPrunedRooms] = useState(workspace.rooms);
  if (prunedRooms !== workspace.rooms) {
    setPrunedRooms(workspace.rooms);
    setRoomOverrides((current) => {
      let changed = false;
      const next = { ...current };
      for (const [roomId, override] of Object.entries(current)) {
        const room = workspace.rooms.find((candidate) => candidate.id === roomId);
        if (override.background && backgroundsMatch(room?.background, override.background)) {
          delete next[roomId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }

  const [prunedSpaces, setPrunedSpaces] = useState(workspace.spaces);
  if (prunedSpaces !== workspace.spaces) {
    setPrunedSpaces(workspace.spaces);
    setSpaceOverrides((current) => {
      let changed = false;
      const next = { ...current };
      for (const [spaceId, override] of Object.entries(current)) {
        const space = workspace.spaces.find((candidate) => candidate.id === spaceId);
        if (override.background && backgroundsMatch(space?.background, override.background)) {
          delete next[spaceId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }
  const [memberPowerOverrides, setMemberPowerOverrides] = useState<Record<string, Record<string, number>>>({});
  const [replyTarget, setReplyTarget] = useState<MessageSummary>();
  const [editingMessage, setEditingMessage] = useState<MessageSummary>();
  const typingTimer = useRef<number | undefined>(undefined);
  const lastTypingSentAt = useRef(0);
  const requestedRoomHistory = useRef(new Set<string>());
  const historyRequests = useRef(new Map<string, Promise<void>>());

  const activeSpaceSummary = useMemo(() => {
    const base = workspace.spaces.find((space) => space.id === activeSpace) ?? workspace.spaces[0];
    return base ? { ...base, ...spaceOverrides[base.id] } : undefined;
  }, [activeSpace, spaceOverrides, workspace.spaces]);
  const visibleRooms = useMemo(() => {
    if (!activeSpaceSummary) return workspace.rooms;
    const roomIds = new Set(activeSpaceSummary.roomIds);
    return workspace.rooms.filter((room) => roomIds.has(room.id));
  }, [activeSpaceSummary, workspace.rooms]);
  const effectiveMembersByRoom = useMemo(() => Object.fromEntries(
    Object.entries(workspace.membersByRoom).map(([roomId, members]) => [
      roomId,
      members.map((member) => {
        const powerLevel = memberPowerOverrides[roomId]?.[member.id];
        if (powerLevel === undefined) return member;
        return {
          ...member,
          powerLevel,
          role: powerLevel >= 100 ? 'Admin' : powerLevel >= 50 ? 'Moderator' : powerLevel >= 25 ? 'Decorator' : undefined,
        };
      }),
    ]),
  ), [memberPowerOverrides, workspace.membersByRoom]);
  const scopedWorkspace = useMemo(
    () => ({ ...workspace, rooms: visibleRooms, membersByRoom: effectiveMembersByRoom }),
    [effectiveMembersByRoom, visibleRooms, workspace],
  );
  const effectiveRoomId = visibleRooms.some((room) => room.id === selectedRoomId)
    ? selectedRoomId
    : visibleRooms[0]?.id;
  const selectedRoomBase = visibleRooms.find((room) => room.id === effectiveRoomId);
  const scopeSpace = activeSpaceSummary?.kind === 'matrix' && effectiveRoomId && activeSpaceSummary.roomIds.includes(effectiveRoomId)
    ? activeSpaceSummary
    : undefined;
  const selectedRoomConfigured = selectedRoomBase
    ? { ...selectedRoomBase, ...roomOverrides[selectedRoomBase.id] }
    : undefined;
  const roomHasBackdrop = Boolean(
    selectedRoomConfigured?.background?.mxcUrl ||
    selectedRoomConfigured?.background?.blockSpaceInheritance ||
    (selectedRoomConfigured?.background?.preset && selectedRoomConfigured.background.preset !== 'none'),
  );
  const selectedRoom = selectedRoomConfigured
    ? {
        ...selectedRoomConfigured,
        background: selectedRoomConfigured.kind === 'room' && !roomHasBackdrop && scopeSpace?.background
          ? scopeSpace.background
          : selectedRoomConfigured.background,
      }
    : undefined;
  const messagesByRoom = workspace.mode === 'demo' ? demoMessages : workspace.messagesByRoom;
  const messages = effectiveRoomId ? messagesByRoom[effectiveRoomId] ?? [] : [];
  const draft = effectiveRoomId ? drafts[effectiveRoomId] ?? '' : '';

  const loadEarlier = useCallback((roomId: string): Promise<void> => {
    const existing = historyRequests.current.get(roomId);
    if (existing) return existing;
    const request = Promise.resolve(onRoomSelected?.(roomId)).finally(() => {
      historyRequests.current.delete(roomId);
    });
    historyRequests.current.set(roomId, request);
    return request;
  }, [onRoomSelected]);

  useEffect(() => {
    if (
      workspace.mode !== 'matrix' ||
      !effectiveRoomId ||
      !onRoomSelected ||
      requestedRoomHistory.current.has(effectiveRoomId)
    ) {
      return;
    }
    requestedRoomHistory.current.add(effectiveRoomId);
    void loadEarlier(effectiveRoomId).catch(() => {
      requestedRoomHistory.current.delete(effectiveRoomId);
      setNotice('Aimtrix could not load earlier messages for this room.');
    });
  }, [effectiveRoomId, loadEarlier, onRoomSelected, workspace.mode]);

  useEffect(() => {
    if (
      workspace.mode === 'matrix' &&
      effectiveRoomId &&
      preferences.sendReadReceipts
    ) {
      void onMarkRoomRead?.(effectiveRoomId);
    }
  }, [effectiveRoomId, onMarkRoomRead, preferences.sendReadReceipts, workspace.mode]);

  const unreadTotal = useMemo(
    () => workspace.rooms.reduce((total, room) => total + room.unreadCount, 0),
    [workspace.rooms],
  );
  const availableStickerPacks = useMemo(
    () => mergeStickerPacks(config.stickerPacks, profilePersonalization.installedStickerPacks),
    [config.stickerPacks, profilePersonalization.installedStickerPacks],
  );

  const selectRoom = useCallback((roomId: string) => {
    setSelectedRoomId(roomId);
    setMobileChatOpen(true);
    setNotice(undefined);
    setReplyTarget(undefined);
    setEditingMessage(undefined);
    if (preferences.sendReadReceipts) void onMarkRoomRead?.(roomId);
  }, [preferences.sendReadReceipts, onMarkRoomRead]);

  useEffect(() => {
    try {
      localStorage.setItem(locationKey, JSON.stringify({ roomId: selectedRoomId, spaceId: activeSpace }));
    } catch {
      // Remembering the last location is best-effort.
    }
  }, [locationKey, selectedRoomId, activeSpace]);

  const selectSpace = (spaceId: string) => {
    const space = workspace.spaces.find((candidate) => candidate.id === spaceId);
    setActiveSpace(spaceId);
    setQuery('');
    setMobileChatOpen(false);
    if (workspace.mode === 'matrix') void onSpaceSelected?.(spaceId).catch(() => undefined);
    if (space && !space.roomIds.includes(selectedRoomId ?? '')) {
      setSelectedRoomId(space.roomIds.find((roomId) => workspace.rooms.some((room) => room.id === roomId)));
    }
  };

  useEffect(() => () => {
    if (typingTimer.current !== undefined) window.clearTimeout(typingTimer.current);
  }, []);

  const uploadAttachment = async (file: File) => {
    if (!effectiveRoomId || workspace.mode !== 'matrix' || !onUploadAttachment) return;
    setSending(true);
    setUploadInProgress(true);
    setFailedUpload(undefined);
    setNotice(`Encrypting ${file.name}…`);
    try {
      await onUploadAttachment(effectiveRoomId, file, (loaded, total) => {
        const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        setNotice(`Uploading ${file.name} — ${percent}%`);
      });
      setNotice(undefined);
    } catch {
      setFailedUpload(file);
      setNotice('That attachment could not be encrypted and uploaded.');
    } finally {
      setUploadInProgress(false);
      setSending(false);
    }
  };

  const sendGif = async (gif: GifChoice) => {
    if (!effectiveRoomId) return;
    setSending(true);
    setNotice(`Uploading ${gif.title}…`);
    try {
      if (workspace.mode === 'matrix') {
        await onSendGif?.(effectiveRoomId, gif);
      } else {
        const message: MessageSummary = {
          id: `demo-gif-${Date.now()}`,
          roomId: effectiveRoomId,
          senderId: workspace.user.id,
          senderName: workspace.user.displayName,
          body: gif.title,
          timestamp: Date.now(),
          kind: 'media',
          mediaKind: 'image',
          mediaUrl: gif.mediaUrl,
          isOwn: true,
        };
        setDemoMessages((current) => ({ ...current, [effectiveRoomId]: [...(current[effectiveRoomId] ?? []), message] }));
      }
      setNotice(undefined);
    } catch {
      setNotice('That GIF could not be downloaded and uploaded to Matrix.');
    } finally {
      setSending(false);
    }
  };

  const sendSticker = async (sticker: { id: string; name: string; src: string }) => {
    if (!effectiveRoomId) return;
    try {
      if (workspace.mode === 'demo') {
        const message: MessageSummary = {
          id: `demo-sticker-${Date.now()}`,
          roomId: effectiveRoomId,
          senderId: workspace.user.id,
          senderName: workspace.user.displayName,
          senderAvatarUrl: workspace.user.avatarUrl,
          body: sticker.name,
          timestamp: Date.now(),
          kind: 'sticker',
          mediaUrl: sticker.src,
          isOwn: true,
        };
        setDemoMessages((current) => ({
          ...current,
          [effectiveRoomId]: [...(current[effectiveRoomId] ?? []), message],
        }));
      } else {
        await onSendSticker?.(effectiveRoomId, sticker);
      }
    } catch {
      setNotice('That sticker could not be uploaded to Matrix.');
    }
  };

  const setConversationBackground = async (
    roomId: string,
    background: RoomBackground,
    personal: boolean,
  ) => {
    const isSpace = workspace.spaces.some((space) => space.id === roomId);
    const applyOverride = (value?: RoomBackground) => {
      if (isSpace) {
        setSpaceOverrides((current) => {
          const next = { ...current };
          if (value === undefined) delete next[roomId];
          else next[roomId] = { ...next[roomId], background: value };
          return next;
        });
      } else {
        setRoomOverrides((current) => {
          const next = { ...current };
          if (value === undefined) delete next[roomId];
          else next[roomId] = { ...next[roomId], background: value };
          return next;
        });
      }
    };
    applyOverride(background);
    if (workspace.mode === 'demo') return;
    try {
      await onSetRoomBackground?.(roomId, background, personal);
    } catch (error) {
      applyOverride(undefined);
      throw error;
    }
  };

  const setConversationBackgroundPolicy = async (
    roomId: string,
    permission: RoomBackgroundPermission,
  ) => {
    if (workspace.mode === 'demo') {
      const backgroundPolicy = {
        mode: permission,
        requiredPowerLevel: thresholdForBackgroundPermission(permission),
        canChange: true,
        canManage: true,
      };
      if (workspace.spaces.some((space) => space.id === roomId)) {
        setSpaceOverrides((current) => ({
          ...current,
          [roomId]: { ...current[roomId], backgroundPolicy },
        }));
      } else {
        setRoomOverrides((current) => ({
          ...current,
          [roomId]: { ...current[roomId], backgroundPolicy },
        }));
      }
      return;
    }
    await onSetRoomBackgroundPolicy?.(roomId, permission);
  };

  const setMemberPower = async (roomId: string, userId: string, level: number) => {
    if (workspace.mode === 'demo') {
      setMemberPowerOverrides((current) => ({
        ...current,
        [roomId]: { ...current[roomId], [userId]: level },
      }));
      return;
    }
    await onSetRoomMemberPower?.(roomId, userId, level);
  };

  const handleStartReply = useCallback((message: MessageSummary) => {
    setReplyTarget(message);
    setEditingMessage(undefined);
  }, []);

  const handleStartEdit = useCallback((message: MessageSummary) => {
    setEditingMessage(message);
    setReplyTarget(undefined);
    if (effectiveRoomId) {
      setDrafts((current) => ({ ...current, [effectiveRoomId]: message.body }));
    }
  }, [effectiveRoomId]);

  const handleTogglePin = useCallback((message: MessageSummary) => {
    if (workspace.mode === 'matrix') {
      void onTogglePinnedMessage?.(message.roomId, message.id, !message.pinned).catch(() =>
        setNotice('Pinned messages could not be updated.'),
      );
    }
  }, [workspace.mode, onTogglePinnedMessage]);

  const handleDeleteMessage = useCallback((message: MessageSummary) => {
    if (workspace.mode === 'matrix' && window.confirm('Delete this message for everyone in the room?')) {
      void onRedactMessage?.(message.roomId, message.id).catch(() =>
        setNotice('That message could not be deleted.'),
      );
    }
  }, [workspace.mode, onRedactMessage]);

  const handleReact = useCallback((message: MessageSummary, key: string, ownReactionEventId?: string) => {
    if (workspace.mode === 'matrix') {
      void onToggleReaction?.(message.roomId, message.id, key, ownReactionEventId);
    }
  }, [workspace.mode, onToggleReaction]);

  const applyPreferences = (nextPreferences: UserPreferences) => {
    if (nextPreferences.detailsOpenByDefault !== preferences.detailsOpenByDefault) {
      setDetailsOpen(nextPreferences.detailsOpenByDefault);
    }
    onPreferencesChange(nextPreferences);
  };

  const submitMessage = async () => {
    if (!effectiveRoomId || !draft.trim() || sending) return;
    const body = draft.trim();
    setDrafts((current) => ({ ...current, [effectiveRoomId]: '' }));
    setSending(true);
    setNotice(undefined);

    try {
      if (workspace.mode === 'demo') {
        const message: MessageSummary = {
          id: `demo-${Date.now()}`,
          roomId: effectiveRoomId,
          senderId: workspace.user.id,
          senderName: workspace.user.displayName,
          senderAvatarUrl: workspace.user.avatarUrl,
          body,
          timestamp: Date.now(),
          kind: 'text',
          isOwn: true,
        };
        setDemoMessages((current) => ({
          ...current,
          [effectiveRoomId]: [...(current[effectiveRoomId] ?? []), message],
        }));
      } else if (editingMessage && onEditMessage) {
        await onEditMessage(effectiveRoomId, editingMessage.id, body);
      } else if (replyTarget && onSendReply) {
        await onSendReply(effectiveRoomId, body, {
          id: replyTarget.id,
          senderId: replyTarget.senderId,
          body: replyTarget.body,
        });
      } else if (onSendMessage) {
        await onSendMessage(effectiveRoomId, body);
      }
      setReplyTarget(undefined);
      setEditingMessage(undefined);
      if (preferences.sendTypingNotifications) void onSendTyping?.(effectiveRoomId, false);
    } catch {
      setDrafts((current) => ({ ...current, [effectiveRoomId]: body }));
      setNotice('That message did not send. Your draft has been restored.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`app-stage${mobileChatOpen ? ' mobile-chat-open' : ''}`}>
      <section className={`aimtrix-window${detailsOpen ? ' details-open' : ''}`}>
        <header className="app-titlebar">
          <div className="app-titlebar__identity">
            <BrandMark compact />
            <strong>{config.brandName}</strong>
            {workspace.mode === 'demo' ? <span className="demo-pill">Demo</span> : null}
          </div>
          <div className={`connection-pill connection-pill--${workspace.connection}`}>
            {workspace.connection === 'offline' ? <WifiOff size={12} /> : <i />}
            {connectionCopy(workspace.connection)}
          </div>
          <div className="theme-switcher" aria-label="Appearance">
            {themes.map((option) => (
              <button
                type="button"
                className={theme === option.id ? 'is-active' : ''}
                aria-pressed={theme === option.id}
                onClick={() => onThemeChange(option.id)}
                key={option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
          {unreadTotal ? <span className="titlebar-unread">{unreadTotal} unread</span> : null}
        </header>

        <div className="workspace-grid">
          <SpaceRail
            workspace={workspace}
            activeSpace={activeSpaceSummary?.id ?? 'home'}
            onSelect={selectSpace}
            onReorder={onReorderRootSpaces}
          />
          <BuddyPanel
            workspace={scopedWorkspace}
            selectedRoomId={effectiveRoomId}
            scopeName={activeSpaceSummary?.name ?? 'Conversations'}
            scopeSpace={activeSpaceSummary}
            query={query}
            onQueryChange={setQuery}
            onSelectRoom={selectRoom}
            onOpenProfile={() => setProfileOpen((open) => !open)}
            onOpenSettings={() => {
              setProfileOpen(false);
              setSettingsOpen(true);
            }}
            onAddRoom={() => setRoomDialogOpen(true)}
            onAcceptInvite={onJoinRoom}
            onRejectInvite={onRejectInvite}
            onReorganize={onReorganizeSpaceChildren}
          />
          <Conversation
            room={selectedRoom}
            messages={messages}
            draft={draft}
            sending={sending}
            notice={notice}
            uploadInProgress={uploadInProgress}
            failedUploadName={failedUpload?.name}
            onBack={() => setMobileChatOpen(false)}
            replyTarget={replyTarget}
            editingMessage={editingMessage}
            onDraftChange={(nextDraft) => {
              if (!effectiveRoomId) return;
              setDrafts((current) => ({ ...current, [effectiveRoomId]: nextDraft }));
              if (workspace.mode === 'matrix' && preferences.sendTypingNotifications) {
                const now = Date.now();
                if (nextDraft && now - lastTypingSentAt.current > 4000) {
                  lastTypingSentAt.current = now;
                  void onSendTyping?.(effectiveRoomId, true);
                } else if (!nextDraft) {
                  lastTypingSentAt.current = 0;
                  void onSendTyping?.(effectiveRoomId, false);
                }
                if (typingTimer.current !== undefined) window.clearTimeout(typingTimer.current);
                typingTimer.current = window.setTimeout(() => {
                  lastTypingSentAt.current = 0;
                  void onSendTyping?.(effectiveRoomId, false);
                }, 5000);
              }
            }}
            onSubmit={() => void submitMessage()}
            onToggleDetails={() => setDetailsOpen((open) => !open)}
            onOpenBackground={() => setBackgroundDialogOpen(true)}
            onStartReply={handleStartReply}
            onStartEdit={handleStartEdit}
            onTogglePin={handleTogglePin}
            onDeleteMessage={handleDeleteMessage}
            onCancelContext={() => {
              setReplyTarget(undefined);
              setEditingMessage(undefined);
            }}
            onReact={handleReact}
            onSendSticker={(sticker) => void sendSticker(sticker)}
            onUploadAttachment={(file) => void uploadAttachment(file)}
            onCancelUpload={() => onCancelUpload?.()}
            onRetryUpload={() => { if (failedUpload) void uploadAttachment(failedUpload); }}
            onLoadMore={async () => {
              if (workspace.mode === 'matrix' && effectiveRoomId && onRoomSelected) {
                await loadEarlier(effectiveRoomId);
              }
            }}
            gifEndpoint={config.features.gifs ? config.gifProvider?.searchEndpoint : undefined}
            stickerPacks={availableStickerPacks}
            onSendGif={(gif) => void sendGif(gif)}
            callsEnabled={config.features.calls}
            onStartCall={(video) => {
              if (selectedRoom) void onStartCall?.(selectedRoom.id, video);
            }}
            dataSaver={preferences.dataSaver}
            autoplayMedia={preferences.autoplayMedia}
          />
          {detailsOpen ? (
            <DetailsPanel
              key={selectedRoomConfigured?.id}
              workspace={{ ...workspace, membersByRoom: effectiveMembersByRoom }}
              room={selectedRoomConfigured}
              scopeSpace={scopeSpace}
              dataSaver={preferences.dataSaver}
              onUpdateRoom={onUpdateRoom}
              onUpdateAvatar={onUpdateRoomAvatar}
              onUploadBackground={workspace.mode === 'matrix' ? onUploadRoomBackground : undefined}
              onSetBackground={setConversationBackground}
              onSetBackgroundPolicy={setConversationBackgroundPolicy}
              onEnableEncryption={onEnableRoomEncryption}
              onSetMuted={onSetRoomMuted}
              onInvite={onInviteToRoom}
              onRemoveMember={onRemoveRoomMember}
              onSetMemberPower={setMemberPower}
              onLeave={onLeaveRoom}
            />
          ) : null}
        </div>

        {workspace.call ? (
          <CallShelf
            call={workspace.call}
            room={workspace.rooms.find((room) => room.id === workspace.call?.roomId)}
            speakerId={preferences.speakerId}
            onAnswer={(video) => void onAnswerCall?.(video)}
            onReject={() => onRejectCall?.()}
            onHangup={() => onHangupCall?.()}
            onMicrophone={(muted) => void onCallMicrophone?.(muted)}
            onVideo={(muted) => void onCallVideo?.(muted)}
            onScreenshare={(enabled) => void onScreenshare?.(enabled)}
          />
        ) : null}

        {roomDialogOpen ? (
          <RoomDialog
            onJoin={onJoinRoom}
            onSearch={onSearchPublicRooms}
            onCreateDirect={onCreateDirectRoom}
            onCreate={onCreateRoom}
            onClose={() => setRoomDialogOpen(false)}
          />
        ) : null}

        {backgroundDialogOpen && selectedRoomConfigured ? (
          <div className="room-background-dialog-backdrop" role="presentation" onMouseDown={() => setBackgroundDialogOpen(false)}>
            <section className="room-background-dialog" role="dialog" aria-modal="true" aria-labelledby="room-background-title" onMouseDown={(event) => event.stopPropagation()}>
              <header><div><Paintbrush size={16} /><strong id="room-background-title">Decorate {selectedRoomConfigured.name}</strong></div><button type="button" aria-label="Close background decorator" onClick={() => setBackgroundDialogOpen(false)}><X size={17} /></button></header>
              <RoomBackgroundPanel
                room={selectedRoomConfigured}
                space={scopeSpace}
                membersByRoom={effectiveMembersByRoom}
                demo={workspace.mode === 'demo'}
                dataSaver={preferences.dataSaver}
                onSetBackground={setConversationBackground}
                onUpload={workspace.mode === 'matrix' ? onUploadRoomBackground : undefined}
                onSetPolicy={setConversationBackgroundPolicy}
                onSetMemberPower={setMemberPower}
              />
            </section>
          </div>
        ) : null}

        {settingsOpen ? (
          <SettingsDialog
            user={workspace.user}
            theme={theme}
            preferences={preferences}
            canEditProfile={workspace.mode === 'matrix'}
            onThemeChange={onThemeChange}
            onPreferencesChange={applyPreferences}
            onSaveProfile={onUpdateProfile}
            onOpenProfilePage={() => {
              setSettingsOpen(false);
              setProfileOpen(true);
            }}
            matrixActions={matrixSettingsActions}
            onSignOut={onSignOut}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}

        {profileOpen ? (
          <ProfileDialog
            user={workspace.user}
            personalization={profilePersonalization}
            stickerPacks={availableStickerPacks}
            canUpload={workspace.mode === 'matrix'}
            dataSaver={preferences.dataSaver}
            onChange={(nextProfile) => onProfilePersonalizationChange?.(nextProfile)}
            onUploadBanner={onUploadProfileBanner}
            onSignOut={onSignOut}
            onClose={() => setProfileOpen(false)}
          />
        ) : null}
      </section>
    </div>
  );
}
