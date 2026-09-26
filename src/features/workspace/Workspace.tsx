import type { ThreadAttentionActions } from './ThreadAttention';
import type { ActivityActions, HomePosition } from './HomeActivity';
import { MemberActions } from './MemberActions';
import '../auth/sessionRecovery.css';
import { useShellNavigation, type ShellReadingPosition } from './useShellNavigation';
import { useThreadViewport } from './useThreadViewport';
import { QuickSwitcher } from './QuickSwitcher';
import { NavigationDialogs } from './NavigationDialogs';
import { getNavigationShortcut, type NavigationTarget } from './quickNavigation';
import { parseMatrixLink, type MatrixNavigationTarget } from '../../matrix/matrixLinks';
import type { VolatileDrafts } from './volatileDrafts';
import type { MessageDeliveryActions } from './MessageDeliveryStatus';
import { TimelineMessage } from './TimelineMessage';
import { type LinkPreview } from './MessageContent';
import { SharedComposer, type SharedComposerHandle } from './SharedComposer';
import { AttachmentTray } from './AttachmentTray';
import { DraftList } from './DraftList';
import { useWorkspaceDrafts } from './useWorkspaceDrafts';
import { StagedAttachments } from './stagedAttachments';
import type { StructuredDraft, DraftContext, DraftMention, DraftInlineEmoji, DraftScope, StructuredDraftStore, DraftStateSummary } from './structuredDrafts';
import type { AttachmentSendOptions } from '../../matrix/AttachmentSender';
import { useDialogBusy } from '../../components/dialogContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Popover } from '../../components/Popover';
import { Dialog, DialogClose } from '../../components/Dialog';
import { MessageSendError } from '../../matrix/messageDelivery';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Star,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DoorOpen,
  Folder,
  FolderOpen,
  GripVertical,
  Images,
  Info,
  Lock,
  MessageCircle,
  Paintbrush,
  PanelRight,
  Phone,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Video,
  WifiOff,
  X,
} from 'lucide-react';
import {
  Fragment,
  lazy,
  Suspense,
  createContext,
  useContext,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '../../components/Avatar';
import { captureTimelineAnchor, historyRows, restoreTimelineAnchor, type TimelineAnchor } from './timelineAnchors';
import type { HistorySummary } from '../../matrix/viewModels';
import { CallShelf } from '../calls/CallShelf';
import {
  loadEmojiPacks,
  selectEmojiPacks,
  type EmojiPackDefinition,
  type EmojiPackEntry,
} from '../media/emojiPacks';
import { type GifChoice } from '../media/GifPicker';
import { mergeStickerPacks } from '../media/stickerPacks';
import { LazyProfileDialog as ProfileDialog } from '../profile/LazyProfileDialog';
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
import type { PushRoute } from '../../pwa/pushRouting';
import type { InstallAndUpdate } from '../../platform/platform';
import { deriveTimelineDaySeparators } from './timelineGrouping';
import {
  defaultProfilePersonalization,
  type ProfilePersonalization,
} from '../../settings/profilePersonalization';
import {
  colorForId,
  type MemberSummary,
  type MessageSummary,
  type RoomSummary,
  type SpaceRoomPreview,
  type SpaceSummary,
  type ThreadSummary,
  type WorkspaceSnapshot,
} from '../../matrix/viewModels';

const ThreadAttention = lazy(() => import('./ThreadAttention'));
const HomeActivity = lazy(() => import('./HomeActivity'));

type ComposerMention = DraftMention;
type ComposerInlineEmoji = DraftInlineEmoji;

interface WorkspaceProps extends MessageDeliveryActions {
  activityActions?: ActivityActions;
  threadAttentionActions?: ThreadAttentionActions;
  workspace: WorkspaceSnapshot;
  draftStore?: VolatileDrafts;
  structuredDraftStore?: StructuredDraftStore;
  draftScope?: DraftScope;
  onDraftStateChange?: (state: DraftStateSummary) => void;
  connectionNotice?: ReactNode;
  config: RuntimeConfig;
  theme: ThemeName;
  preferences: UserPreferences;
  profilePersonalization?: ProfilePersonalization;
  onThemeChange: (theme: ThemeName) => void;
  onPreferencesChange: (preferences: UserPreferences) => void;
  onProfilePersonalizationChange?: (personalization: ProfilePersonalization) => void | Promise<void>;
  onUploadProfileBanner?: (file: File) => Promise<string>;
  onUpdateProfile?: (update: ProfileUpdate) => Promise<void>;
  matrixSettingsActions?: MatrixSettingsActions;
  install?: InstallAndUpdate;
  pushRoute?: PushRoute;
  onSendMessage?: (roomId: string, body: string, mentions?: ComposerMention[], inlineEmojis?: ComposerInlineEmoji[]) => Promise<void>;
  onSendNudge?: (roomId: string) => Promise<void>;
  onLoadLinkPreview?: (url: string) => Promise<LinkPreview | undefined>;
  onRoomSelected?: (roomId: string) => Promise<void>;
  onLoadRoomHistory?: (roomId: string, direction: 'backward' | 'forward') => Promise<void>;
  onOpenEventContext?: (roomId: string, eventId: string) => Promise<void>;
  onReturnToLive?: (roomId: string) => Promise<void>;
  onHistoryDetached?: (roomId: string, detached: boolean) => void;
  onThreadSelected?: (roomId: string, rootId: string, eventId?: string) => Promise<void>;
  onLoadThreadHistory?: (roomId: string, rootId: string, direction: 'backward' | 'forward') => Promise<void>;
  onReturnThreadToLive?: (roomId: string, rootId: string) => Promise<void>;
  onThreadHistoryDetached?: (roomId: string, rootId: string, detached: boolean) => void;
  onCloseThreadHistory?: () => void;
  onSendThreadMessage?: (roomId: string, rootId: string, body: string, mentions?: ComposerMention[], inlineEmojis?: ComposerInlineEmoji[]) => Promise<void>;
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
    target: { id: string; senderId: string; body: string; threadRootId?: string },
    mentions?: ComposerMention[],
    inlineEmojis?: ComposerInlineEmoji[],
  ) => Promise<void>;
  onEditMessage?: (roomId: string, eventId: string, body: string, mentions?: ComposerMention[], inlineEmojis?: ComposerInlineEmoji[]) => Promise<void>;
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
    threadRootId?: string,
  ) => Promise<void>;
  onUploadAttachment?: (roomId: string, file: File, onProgress?: (loaded: number, total: number) => void, threadRootId?: string, codeLanguage?: string, options?: AttachmentSendOptions) => Promise<void>;
  onCancelUpload?: (id?: string) => void;
  onSendGif?: (roomId: string, gif: GifChoice, threadRootId?: string) => Promise<void>;
  onMarkRoomRead?: (roomId: string, options?: { eventId?: string; explicit?: boolean }) => Promise<void>;
  onSetRoomFavorite?: (roomId: string, favorite: boolean) => Promise<void>;
  onResolveNavigationTarget?: (target: MatrixNavigationTarget) => Promise<{ roomId: string; eventId?: string; threadRootId?: string }>;
  onMarkRoomUnread?: (roomId: string, eventId?: string) => Promise<void>;
  onMarkThreadRead?: (roomId: string, rootId: string, options?: { eventId?: string }) => Promise<void>;
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
  className,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  const isDisabled = disabled ?? onClick === undefined;
  return (
    <button
      className={`icon-button${active ? ' icon-button--active' : ''}${className ? ` ${className}` : ''}`}
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
  onDragEnd,
  onDrop,
  onMove,
}: {
  space: WorkspaceSnapshot['spaces'][number];
  active: boolean;
  reorderable: boolean;
  onSelect: () => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
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
      title={reorderable ? `${space.name} · drag or press Alt+Arrow keys to reorder` : space.name}
      draggable={reorderable}
      aria-keyshortcuts={reorderable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      onClick={onSelect}
      onDragStart={(event) => {
        if (!reorderable) return;
        event.dataTransfer.effectAllowed = 'move';
        onDragStart?.(event);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (reorderable) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!reorderable) return;
        event.preventDefault();
        onDrop?.(event);
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
          draggable={false}
          loading="lazy"
          onError={() => setFailedSrc(mediaSrc)}
        />
      ) : (
        <span draggable={false} style={{ '--space-color': space.color } as CSSProperties}>{space.initials}</span>
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
  const draggedSpaceIdRef = useRef<string | undefined>(undefined);
  const [localOrder, setLocalOrder] = useState<string[]>();
  const [reorderStatus, setReorderStatus] = useState('');
  const [reordering, setReordering] = useState(false);
  const systemSpaces = workspace.spaces.filter((space) => space.kind !== 'matrix');
  const matrixRoots = workspace.spaces.filter(
    (space) => space.kind === 'matrix' && space.parentSpaceIds.length === 0,
  );
  const workspaceJoinedIds = matrixRoots
    .filter((space) => space.membership === 'join')
    .map((space) => space.id);
  const orderedJoinedIds = [
    ...(localOrder ?? []).filter((spaceId) => workspaceJoinedIds.includes(spaceId)),
    ...workspaceJoinedIds.filter((spaceId) => !localOrder?.includes(spaceId)),
  ];
  const orderedRoots = matrixRoots.map((space, index) => {
    if (space.membership !== 'join') return space;
    const joinedIndex = matrixRoots.slice(0, index).filter((candidate) => candidate.membership === 'join').length;
    const ordered = matrixRoots.find((candidate) => candidate.id === orderedJoinedIds[joinedIndex]);
    return ordered ?? space;
  });
  const reorder = async (spaceId: string, targetIndex: number) => {
    if (reordering) return;
    const sourceIndex = orderedJoinedIds.indexOf(spaceId);
    if (sourceIndex < 0) return;
    const next = [...orderedJoinedIds];
    next.splice(sourceIndex, 1);
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, spaceId);
    if (next.every((id, index) => id === orderedJoinedIds[index])) return;
    setLocalOrder(next);
    setReordering(true);
    const movedName = matrixRoots.find((space) => space.id === spaceId)?.name ?? 'Space';
    setReorderStatus(`Saving ${movedName} at position ${next.indexOf(spaceId) + 1} of ${next.length}.`);
    try {
      await onReorder?.(next);
      setReorderStatus(`${movedName} moved to position ${next.indexOf(spaceId) + 1} of ${next.length}.`);
      if (workspace.mode === 'matrix') setLocalOrder(undefined);
    } catch {
      setLocalOrder(undefined);
      setReorderStatus(`Aimtrix could not save the new position for ${movedName}. The previous order was restored.`);
    } finally {
      setReordering(false);
    }
  };

  return (
    <nav className="space-rail" aria-label="Spaces">
      {reorderStatus ? (
        <span className="sr-only" role="status" aria-label="Space reorder status" aria-live="polite">
          {reorderStatus}
        </span>
      ) : null}
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
        {orderedRoots.map((space) => {
          const reorderable = !reordering && space.membership === 'join' && (workspace.mode === 'demo' || Boolean(onReorder));
          const rootIndex = orderedJoinedIds.indexOf(space.id);
          return (
            <SpaceButton
              key={space.id}
              space={space}
              active={activeSpace === space.id}
              reorderable={reorderable}
              onSelect={() => onSelect(space.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-aimtrix-space', space.id);
                event.dataTransfer.setData('text/plain', space.id);
                draggedSpaceIdRef.current = space.id;
              }}
              onDragEnd={() => {
                draggedSpaceIdRef.current = undefined;
              }}
              onDrop={(event) => {
                const sourceId = event.dataTransfer.getData('application/x-aimtrix-space')
                  || event.dataTransfer.getData('text/plain')
                  || draggedSpaceIdRef.current;
                if (sourceId) void reorder(sourceId, rootIndex);
                draggedSpaceIdRef.current = undefined;
              }}
              onMove={(offset) => void reorder(space.id, rootIndex + offset)}
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
    left.badgeCount === right.badgeCount &&
    left.markedUnread === right.markedUnread &&
    left.muted === right.muted &&
    left.highlightCount === right.highlightCount &&
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

const DraftRoomsContext = createContext<ReadonlySet<string>>(new Set());

const BuddyRoomRow = memo(function BuddyRoomRow({
  room,
  selected,
  depth = 0,
  onSelect,
  onAcceptInvite,
  onRejectInvite,
  arrangement,
}: BuddyRoomRowProps) {
  const hasDraft = useContext(DraftRoomsContext).has(room.id);
  const style = { '--space-depth': depth } as CSSProperties;
  const reminderOnly = room.markedUnread && !(room.muted ? room.highlightCount : room.unreadCount);
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
        <span>{hasDraft ? <strong>Draft · </strong> : null}{room.statusMessage || room.lastMessage}</span>
      </span>
      <span className="buddy-row__meta">
        {room.encrypted ? <Lock size={10} aria-label="Encrypted" /> : null}
        {(room.badgeCount ?? room.unreadCount) > 0 ? (
          <b aria-label={reminderOnly ? 'Marked unread' : `${room.badgeCount ?? room.unreadCount} unread notifications`} className={room.highlighted ? 'is-highlighted' : ''}>{reminderOnly ? '•' : room.badgeCount ?? room.unreadCount}</b>
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
  draftRoomIds,
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
  filter,
  onFilterChange,
}: {
  workspace: WorkspaceSnapshot;
  draftRoomIds?: ReadonlySet<string>;
  selectedRoomId?: string;
  filter: 'all' | 'unread' | 'favorites';
  onFilterChange: (filter: 'all' | 'unread' | 'favorites') => void;
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
  const showSpaceTree = scopeSpace?.kind === 'matrix' && filter === 'all';
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
    <DraftRoomsContext.Provider value={draftRoomIds ?? new Set()}><aside className="buddy-panel" aria-label="Buddy list">
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

      <label className="buddy-search"><span className="sr-only">Conversation filter</span><select aria-label="Conversation filter" value={filter} onChange={(event) => onFilterChange(event.target.value as typeof filter)} style={{ width: '100%', minHeight: 44, color: 'var(--text)', background: 'var(--surface-raised)', border: 0 }}><option value="all">All conversations</option><option value="unread">Unread conversations</option><option value="favorites">Favorite conversations</option></select></label>
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
              (room) => room.group === group && room.name.toLowerCase().includes(normalizedQuery) && (filter === 'all' || (filter === 'favorites' ? room.favorite : (room.badgeCount ?? room.unreadCount) > 0)),
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
        {filter !== 'all' && !workspace.rooms.some((room) => room.name.toLowerCase().includes(normalizedQuery) && (filter === 'favorites' ? room.favorite : (room.badgeCount ?? room.unreadCount) > 0)) ? <p className="space-tree__empty">No {filter === 'favorites' ? 'favorite' : 'unread'} conversations in this space.</p> : null}
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
          data-focus-fallback
          aria-label="Open settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={17} />
        </button>
      </div>
    </aside></DraftRoomsContext.Provider>
  );
}

interface EntryUnreadMarker {
  roomId: string;
  count: number;
  firstUnreadMessageId?: string;
  loadedFirstMessageId?: string;
  resolvedFromReceipt: boolean;
}

function resolveEntryUnreadMarker(
  room: RoomSummary | undefined,
  messages: MessageSummary[],
  unreadCountOverride?: number,
): EntryUnreadMarker | undefined {
  if (!room) return undefined;
  const count = unreadCountOverride ?? room.timelineUnreadCount ?? room.unreadCount;
  if (count <= 0) return undefined;
  if (!messages.length) {
    return { roomId: room.id, count, resolvedFromReceipt: false };
  }
  const readIndex = room.readUpToMessageId
    ? messages.findIndex((message) => message.id === room.readUpToMessageId)
    : -1;
  if (readIndex >= 0) {
    const firstUnreadIndex = readIndex + 1;
    if (firstUnreadIndex >= messages.length) return undefined;
    return {
      roomId: room.id,
      count: messages.length - firstUnreadIndex,
      firstUnreadMessageId: messages[firstUnreadIndex].id,
      loadedFirstMessageId: messages[0].id,
      resolvedFromReceipt: true,
    };
  }
  const firstUnreadIndex = Math.max(0, messages.length - count);
  return {
    roomId: room.id,
    count,
    firstUnreadMessageId: messages[firstUnreadIndex]?.id,
    loadedFirstMessageId: messages[0]?.id,
    resolvedFromReceipt: false,
  };
}

type TimelineViewportMode = 'unread' | 'bottom' | 'detached';

type WorkspacePanelId = 'buddies' | 'conversation' | 'thread';

type ComposerSubmitResult = 'sent' | 'edited' | 'retained' | false;

function Conversation({
  threadAttentionActions,
  contextHost, contextPanel, conversationVisible, contextWidth, contextMaximum, onContextResize, onSearch, onCloseContext, onRevealConversation,
  room,
  history,
  members,
  messages,
  activeThread,
  threadRoot,
  threadCollapsed,
  composition, threadComposition, onCompositionChange, onThreadCompositionChange, attachmentQueue, onStageFiles,
  sending,
  threadSending,
  notice,
  editingMessage,
  editingThreadMessage,
  onBack,
  onSubmit,
  onThreadSubmit,
  onToggleDetails,
  onCollapseConversation,
  onOpenBackground,
  onStartReply,
  onOpenThread,
  onStartThread,
  onCloseThread,
  onToggleThreadCollapsed,
  onStartEdit,
  onStartThreadEdit,
  onDeleteMessage,
  onRetryMessage,
  onCancelMessage,
  onTogglePin,
  onCancelContext,
  onCancelThreadEdit,
  onReact,
  emojiPacks,
  emojiAssetBaseUrl,
  onSendSticker,
  onLoadMore,
  onOpenContext,
  onReturnToLive,
  onNavigationLive,
  onDetachedChange,
  onReadLatest,
  onReadThread,
  threadEntry, threadReading, threadEventId, threadRequestId, onRememberThreadReading,
  onOpenThreadHistory, onPageThreadHistory, onLatestThread, onThreadDetached, onCloseThreadHistory, onThreadContext,
  onMarkUnread,
  onMarkRead,
  onToggleFavorite,
  favoritePending,
  navigationEntry,
  navigationReading,
  navigationPending,
  onRememberReading,
  gifEndpoint,
  stickerPacks,
  defaultStickerPack,
  onSendGif,
  callsEnabled,
  onStartCall,
  dataSaver,
  autoplayMedia,
  onLoadLinkPreview,
  onSendNudge,
}: {
  threadAttentionActions?: ThreadAttentionActions;
  contextHost: HTMLDivElement | null;
  contextPanel: 'thread' | 'details' | 'search' | null;
  conversationVisible: boolean;
  contextWidth: number;
  contextMaximum: number;
  onContextResize: (width: number) => void;
  onSearch: () => void;
  onCloseContext: () => void;
  onRevealConversation: () => void;
  room?: RoomSummary;
  history?: HistorySummary;
  members: MemberSummary[];
  messages: MessageSummary[];
  activeThread?: ThreadSummary;
  threadRoot?: MessageSummary;
  threadCollapsed: boolean;
  composition: StructuredDraft;
  threadComposition: StructuredDraft;
  onCompositionChange: (value: StructuredDraft) => void;
  onThreadCompositionChange: (value: StructuredDraft) => void;
  attachmentQueue: StagedAttachments;
  onStageFiles: (files: File[], threadRootId?: string, codeLanguage?: string) => void | Promise<void>;
  sending: boolean;
  threadSending: boolean;
  notice?: string;
  editingMessage?: MessageSummary;
  editingThreadMessage?: MessageSummary;
  onBack: () => void;
  onSubmit: (body?: string, mentions?: ComposerMention[], inlineEmojis?: ComposerInlineEmoji[]) => Promise<ComposerSubmitResult>;
  onThreadSubmit: (body?: string, mentions?: ComposerMention[], inlineEmojis?: ComposerInlineEmoji[]) => Promise<ComposerSubmitResult>;
  onToggleDetails: () => void;
  onCollapseConversation: () => void;
  onOpenBackground: () => void;
  onStartReply: (message: MessageSummary, threadRootId?: string) => void;
  onOpenThread: (message: MessageSummary) => void;
  onStartThread: (message: MessageSummary) => void;
  onCloseThread: () => void;
  onToggleThreadCollapsed: () => void;
  onStartEdit: (message: MessageSummary) => void;
  onStartThreadEdit: (message: MessageSummary) => void;
  onDeleteMessage: (message: MessageSummary) => void;
  onRetryMessage?: MessageDeliveryActions['onRetryMessage'];
  onCancelMessage?: MessageDeliveryActions['onCancelMessage'];
  onTogglePin: (message: MessageSummary) => void | Promise<void>;
  onCancelContext: () => void;
  onCancelThreadEdit: () => void;
  onReact: (message: MessageSummary, key: string, ownReactionEventId?: string) => void | Promise<void>;
  emojiPacks: EmojiPackDefinition[];
  emojiAssetBaseUrl?: string;
  onSendSticker: (sticker: { id: string; name: string; src: string }, threadRootId?: string) => Promise<unknown>;
  onLoadMore?: (direction: 'backward' | 'forward') => Promise<void>;
  onOpenContext?: (eventId: string) => Promise<void>;
  onReturnToLive?: () => Promise<void>;
  onNavigationLive: () => void;
  onDetachedChange?: (detached: boolean) => void;
  onReadLatest?: (eventId: string) => Promise<void>;
  onReadThread?: (eventId: string) => Promise<void>;
  threadEntry: number;
  threadReading?: ShellReadingPosition;
  threadEventId?: string;
  threadRequestId: number;
  onRememberThreadReading: (reading: ShellReadingPosition, entryId: number) => void;
  onOpenThreadHistory?: (eventId?: string) => Promise<void>;
  onPageThreadHistory?: (direction: 'backward' | 'forward') => Promise<void>;
  onLatestThread?: () => Promise<void>;
  onThreadDetached?: (detached: boolean) => void;
  onCloseThreadHistory?: () => void;
  onThreadContext: (eventId: string) => void;
  onMarkUnread?: (eventId?: string) => Promise<void>;
  onMarkRead?: (eventId?: string) => Promise<void>;
  onToggleFavorite?: () => void;
  favoritePending?: boolean;
  navigationEntry: number;
  navigationReading?: ShellReadingPosition;
  navigationPending: boolean;
  onRememberReading: (reading: ShellReadingPosition, entryId: number) => void;
  gifEndpoint?: string;
  stickerPacks: Array<{ name: string; manifestUrl: string }>;
  defaultStickerPack?: string;
  onSendGif: (gif: GifChoice, threadRootId?: string) => void | Promise<unknown>;
  callsEnabled: boolean;
  onStartCall: (video: boolean) => void;
  dataSaver: boolean;
  autoplayMedia: boolean;
  onLoadLinkPreview?: (url: string) => Promise<LinkPreview | undefined>;
  onSendNudge?: () => void;
}) {
  const timeline = useRef<HTMLElement>(null);
  const timelineContent = useRef<HTMLDivElement>(null);
  const { viewport: threadTimeline, capture: captureThread, restore: restoreThread, load: loadThread, latest: latestThread, retry: retryThread, error: threadHistoryError, busy: threadHistoryBusy, canRead: canReadThread } = useThreadViewport({
    roomId: room?.id, thread: activeThread, active: contextPanel === 'thread' && !threadCollapsed,
    entryId: threadEntry, eventId: threadEventId, requestId: threadRequestId, reading: threadReading,
    remember: onRememberThreadReading, open: onOpenThreadHistory, load: onPageThreadHistory,
    latest: onLatestThread, detached: onThreadDetached, close: onCloseThreadHistory,
  });
  const threadReadRetryHold = useRef(false);
  const reportedThreadRead = useRef<{ roomId: string; rootId: string; eventId: string } | undefined>(undefined);
  const [threadReadError, setThreadReadError] = useState<{ roomId: string; rootId: string; eventId: string }>();
  const readActionsTrigger = useRef<HTMLButtonElement>(null);
  const readActionsSurface = useRef<HTMLDivElement>(null);
  const [readActionsRoom, setReadActionsRoom] = useState<string>();
  const [readPopoverTop, setReadPopoverTop] = useState(68);
  const [readPopoverRight, setReadPopoverRight] = useState(12);
  if (readActionsRoom && (readActionsRoom !== room?.id || !conversationVisible)) setReadActionsRoom(undefined);
  const [readAction, setReadAction] = useState<{ roomId: string; pending?: boolean; error?: string; status?: string }>();
  const readActionRequest = useRef<object | undefined>(undefined);
  const edgeScrollIntent = useRef<{ direction?: 'backward' | 'forward'; roomId?: string; until: number } | undefined>(undefined);
  const touchScrollY = useRef<number | undefined>(undefined);
  const armEdgeScroll = (direction?: 'backward' | 'forward') => { edgeScrollIntent.current = { direction, roomId: room?.id, until: Date.now() + 750 }; };
  useLayoutEffect(() => { edgeScrollIntent.current = undefined; }, [conversationVisible, room?.id]);
  const historyRequestToken = useRef(0);
  const activeHistoryRequest = useRef<number | undefined>(undefined);
  const historyActionRevision = useRef<number | undefined>(undefined);
  const readingAnchor = useRef<TimelineAnchor | undefined>(undefined);
  const readingPositions = useRef(new Map<string, { anchor?: TimelineAnchor; scrollTop: number }>());
  const lastKnownScrollTop = useRef(0);
  const positionedContext = useRef<string | undefined>(undefined);
  const pendingLatest = useRef<{ roomId?: string; afterRevision: number; token: number } | undefined>(undefined);
  const [historyAction, setHistoryAction] = useState<HistorySummary['loading']>();
  const [localHistoryError, setLocalHistoryError] = useState<{ direction: NonNullable<HistorySummary['loading']>; message: string; eventId?: string }>();
  const [localTarget, setLocalTarget] = useState<string>();
  const contextBanner = useRef<HTMLDivElement>(null);
  const viewportMode = useRef<TimelineViewportMode>('bottom');
  const positionedUnreadMarker = useRef<string | undefined>(undefined);
  const unreadAnchorTop = useRef<number | undefined>(undefined);
  const programmaticTimelineScroll = useRef(false);
  const programmaticScrollGeneration = useRef(0);
  const previousTimelineMessages = useRef<MessageSummary[] | undefined>(undefined);
  const previousRoomId = useRef<string | undefined>(undefined);
  const reportedRead = useRef<{ roomId: string; eventId: string } | undefined>(undefined);
  const catalogRequested = useRef(false);
  const [timelineDetached, setTimelineDetached] = useState(false);
  const threadPanelWidth = contextWidth;
  const resizeStart = useRef<{ x: number; width: number } | undefined>(undefined);
  const mainComposer = useRef<SharedComposerHandle>(null);
  const threadComposer = useRef<SharedComposerHandle>(null);
  const [pendingSearchEvent, setPendingSearchEvent] = useState<{ roomId?: string; eventId: string }>();
  const [emojiCatalog, setEmojiCatalog] = useState<EmojiPackEntry[]>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('aimtrix.recent-emoji.v1') || '[]') as string[]; } catch { return []; }
  });
  const rememberEmoji = useCallback((emoji: string) => {
    setRecentEmojis((current) => {
      const next = [emoji, ...current.filter((recent) => recent !== emoji)].slice(0, 18);
      try { localStorage.setItem('aimtrix.recent-emoji.v1', JSON.stringify(next)); } catch { /* Recents can remain in memory. */ }
      return next;
    });
  }, []);
  const searchOpen = contextPanel === 'search';
  const [messageQuery, setMessageQuery] = useState('');
  useEffect(() => {
    if (!room?.id || window.matchMedia?.('(max-width: 767px)').matches) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement?.closest('.buddy-row')) mainComposer.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [room?.id]);
  useEffect(() => {
    if (!editingMessage?.id || !conversationVisible) return;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === previousFocus || document.activeElement === document.body) mainComposer.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingMessage?.id, room?.id, conversationVisible]);
  useEffect(() => {
    if (!editingThreadMessage?.id || contextPanel !== 'thread' || threadCollapsed) return;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === previousFocus || document.activeElement === document.body) threadComposer.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingThreadMessage?.id, room?.id, activeThread?.rootId, contextPanel, threadCollapsed]);
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
  const visibleMessages = messages;
  const searchResults = messageQuery.trim()
    ? messages.filter((message) =>
        `${message.senderName} ${message.body}`.toLowerCase().includes(messageQuery.trim().toLowerCase()),
      )
    : messages;
  const daySeparators = useMemo(() => new Map(
    deriveTimelineDaySeparators(messages).map((separator) => [
      messages[separator.beforeIndex]?.id,
      separator,
    ] as const),
  ), [messages]);
  const [entryUnreadState, setEntryUnreadState] = useState<{
    roomId?: string;
    marker?: EntryUnreadMarker;
  }>(() => ({
    roomId: room?.id,
    marker: resolveEntryUnreadMarker(room, messages),
  }));
  if (entryUnreadState.roomId !== room?.id) {
    setEntryUnreadState({
      roomId: room?.id,
      marker: resolveEntryUnreadMarker(room, messages),
    });
    if (messageQuery) setMessageQuery('');
  } else if (
    entryUnreadState.marker &&
    (!entryUnreadState.marker.firstUnreadMessageId || !entryUnreadState.marker.resolvedFromReceipt)
  ) {
    const refinedMarker = resolveEntryUnreadMarker(
      room,
      messages,
      entryUnreadState.marker.count,
    );
    const historyPrepended = entryUnreadState.marker.loadedFirstMessageId
      ? messages.findIndex(
          (message) => message.id === entryUnreadState.marker?.loadedFirstMessageId,
        ) > 0
      : false;
    if (
      refinedMarker &&
      (
        (!entryUnreadState.marker.firstUnreadMessageId && refinedMarker.firstUnreadMessageId) ||
        (!entryUnreadState.marker.resolvedFromReceipt && refinedMarker.resolvedFromReceipt) ||
        (
          !entryUnreadState.marker.resolvedFromReceipt &&
          historyPrepended &&
          refinedMarker.firstUnreadMessageId !== entryUnreadState.marker.firstUnreadMessageId
        )
      )
    ) {
      setEntryUnreadState({ roomId: room?.id, marker: refinedMarker });
    }
  }
  const activeEntryUnreadMarker = entryUnreadState.marker;
  const startEdit = onStartEdit;
  const startThreadEdit = onStartThreadEdit;

  const runProgrammaticScroll = useCallback((scroll: () => void) => {
    const before = timeline.current?.scrollTop;
    scroll();
    lastKnownScrollTop.current = timeline.current?.scrollTop ?? 0;
    if (timeline.current?.scrollTop === before) return;
    const generation = programmaticScrollGeneration.current + 1;
    programmaticScrollGeneration.current = generation;
    programmaticTimelineScroll.current = true;
    requestAnimationFrame(() => {
      if (programmaticScrollGeneration.current === generation) {
        programmaticTimelineScroll.current = false;
      }
    });
  }, []);

  const historicalWindow = Boolean(history && history.mode !== 'live');
  const historyLoading = historyAction ?? history?.loading;
  const historyError = localHistoryError?.message ?? history?.error;
  const historyErrorDirection = localHistoryError?.direction ?? history?.errorDirection;
  const targetEventId = history?.targetEventId ?? localTarget;

  const restoreTimelineViewport = useCallback(() => {
    const element = timeline.current;
    if (!element || !conversationVisible || element.closest('[hidden]')) return;
    if (viewportMode.current === 'bottom') {
      runProgrammaticScroll(() => { element.scrollTop = element.scrollHeight; });
      return;
    }
    if (viewportMode.current === 'unread' && unreadAnchorTop.current !== undefined) {
      const marker = element.querySelector<HTMLElement>('[data-unread-boundary]');
      if (marker) {
        const delta = marker.getBoundingClientRect().top - element.getBoundingClientRect().top - unreadAnchorTop.current;
        if (Math.abs(delta) >= 0.5) runProgrammaticScroll(() => { element.scrollTop += delta; });
        readingAnchor.current = captureTimelineAnchor(element);
        return;
      }
    }
    runProgrammaticScroll(() => { restoreTimelineAnchor(element, readingAnchor.current); });
    readingAnchor.current = captureTimelineAnchor(element) ?? readingAnchor.current;
  }, [conversationVisible, runProgrammaticScroll]);

  useLayoutEffect(() => {
    const element = timeline.current;
    if (!element || !conversationVisible || element.closest('[hidden]')) return;
    const roomChanged = previousRoomId.current !== room?.id;
    if (roomChanged) {
      if (previousRoomId.current) {
        if (viewportMode.current !== 'bottom') readingPositions.current.set(previousRoomId.current, { anchor: readingAnchor.current, scrollTop: lastKnownScrollTop.current });
        else readingPositions.current.delete(previousRoomId.current);
      }
      previousRoomId.current = room?.id;
      positionedUnreadMarker.current = undefined;
      unreadAnchorTop.current = undefined;
      readingAnchor.current = undefined;
      positionedContext.current = undefined;
      viewportMode.current = historicalWindow ? 'detached' : activeEntryUnreadMarker ? 'unread' : 'bottom';
      setTimelineDetached(historicalWindow || Boolean(activeEntryUnreadMarker));
      previousTimelineMessages.current = undefined;
      historyRequestToken.current += 1;
      activeHistoryRequest.current = undefined;
      pendingLatest.current = undefined;
      setHistoryAction(undefined);
      setLocalHistoryError(undefined);
      setLocalTarget(undefined);
      const saved = room?.id ? readingPositions.current.get(room.id) : undefined;
      if (saved && historicalWindow && history?.mode !== 'context') {
        viewportMode.current = 'detached';
        readingAnchor.current = saved.anchor;
        runProgrammaticScroll(() => {
          if (!restoreTimelineAnchor(element, saved.anchor)) element.scrollTop = saved.scrollTop;
        });
        readingAnchor.current = captureTimelineAnchor(element) ?? saved.anchor;
        previousTimelineMessages.current = messages;
        return;
      }
    }
    // An external route may supersede pagination without settling its network
    // Promise. The controller's newer context owns feedback from this point on.
    if (!roomChanged && historyAction && historyAction !== 'context' && history
      && history.revision > (historyActionRevision.current ?? -1)
      && (history.loading === 'context' || (history.mode === 'context' && !history.loading && history.targetStatus))) {
      historyRequestToken.current += 1;
      activeHistoryRequest.current = undefined;
      pendingLatest.current = undefined;
      setHistoryAction(undefined);
      setLocalHistoryError(undefined);
    }
    if (history?.loading === 'context') positionedContext.current = undefined;
    const returning = pendingLatest.current;
    if (returning && returning.roomId === room?.id && returning.token === historyRequestToken.current
      && history?.mode === 'live' && history.revision > returning.afterRevision && !history.loading) {
      pendingLatest.current = undefined;
      activeHistoryRequest.current = undefined;
      viewportMode.current = 'bottom';
      readingAnchor.current = undefined;
      unreadAnchorTop.current = undefined;
      setHistoryAction(undefined);
      setTimelineDetached(false);
      setLocalTarget(undefined);
      onDetachedChange?.(false);
      runProgrammaticScroll(() => { element.scrollTop = element.scrollHeight; });
      previousTimelineMessages.current = messages;
      return;
    }
    if (historicalWindow && viewportMode.current === 'bottom') {
      viewportMode.current = 'detached';
      setTimelineDetached(true);
    }
    if (history?.mode === 'context' && history.targetEventId && !history.loading && history.targetStatus
      && positionedContext.current !== `${history.targetEventId}:${history.targetStatus}`) {
      const target = historyRows(element).find((row) => row.dataset.eventId === history.targetEventId);
      viewportMode.current = 'detached';
      setTimelineDetached(true);
      if (target) {
        runProgrammaticScroll(() => {
          if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
          else element.scrollTop = target.offsetTop;
          target.focus({ preventScroll: true });
        });
        readingAnchor.current = captureTimelineAnchor(element);
        positionedContext.current = `${history.targetEventId}:${history.targetStatus}`;
      } else if (history.targetStatus === 'unavailable' || history.targetStatus === 'removed') {
        contextBanner.current?.focus({ preventScroll: true });
        positionedContext.current = `${history.targetEventId}:${history.targetStatus}`;
      }
      previousTimelineMessages.current = messages;
      return;
    }
    const marker = element.querySelector<HTMLElement>('[data-unread-boundary]');
    const messagesChanged = previousTimelineMessages.current !== messages;
    const needsFallbackReposition = typeof ResizeObserver === 'undefined' && messagesChanged;
    if (!historicalWindow && marker && activeEntryUnreadMarker?.firstUnreadMessageId && viewportMode.current === 'unread'
      && (positionedUnreadMarker.current !== activeEntryUnreadMarker.firstUnreadMessageId || needsFallbackReposition)) {
      runProgrammaticScroll(() => {
        if (typeof marker.scrollIntoView === 'function') marker.scrollIntoView({ block: 'center' });
        else element.scrollTop = marker.offsetTop;
      });
      positionedUnreadMarker.current = activeEntryUnreadMarker.firstUnreadMessageId;
      unreadAnchorTop.current = marker.getBoundingClientRect().top - element.getBoundingClientRect().top;
      readingAnchor.current = captureTimelineAnchor(element);
      onDetachedChange?.(true);
    } else if (!historicalWindow && !activeEntryUnreadMarker && (roomChanged || viewportMode.current === 'bottom')) {
      viewportMode.current = 'bottom';
      runProgrammaticScroll(() => { element.scrollTop = element.scrollHeight; });
    } else if (!roomChanged && (messagesChanged || historicalWindow)) {
      restoreTimelineViewport();
    }
    if (history?.mode === 'live' && viewportMode.current !== 'bottom') onDetachedChange?.(true);
    previousTimelineMessages.current = messages;
  }, [conversationVisible, activeEntryUnreadMarker, history, historyAction, historicalWindow, messages, onDetachedChange, restoreTimelineViewport, room?.id, runProgrammaticScroll]);

  const restoredNavigationEntry = useRef<number | undefined>(undefined);
  const captureNavigationReading = useCallback(() => {
    const element = timeline.current;
    if (!element || !conversationVisible || navigationPending || history?.loading || restoredNavigationEntry.current !== navigationEntry) return;
    const candidate = captureTimelineAnchor(element)?.candidates[0];
    onRememberReading({ mode: history?.mode ?? 'live', atLatest: !historicalWindow && viewportMode.current === 'bottom', anchor: candidate && { eventId: candidate.eventId, offset: candidate.offset } }, navigationEntry);
  }, [conversationVisible, historicalWindow, history?.loading, history?.mode, navigationEntry, navigationPending, onRememberReading]);
  useEffect(() => {
    const frame = requestAnimationFrame(captureNavigationReading);
    return () => cancelAnimationFrame(frame);
  }, [captureNavigationReading]);
  useLayoutEffect(() => {
    const element = timeline.current;
    if (!element || !conversationVisible || navigationPending || history?.loading) return;
    if (restoredNavigationEntry.current !== navigationEntry) {
      const saved = navigationReading;
      if (saved?.atLatest) {
        viewportMode.current = 'bottom';
        runProgrammaticScroll(() => { element.scrollTop = element.scrollHeight; });
        queueMicrotask(() => setTimelineDetached(false));
      } else if (saved?.anchor) {
        const row = historyRows(element).find((item) => item.dataset.eventId === saved.anchor?.eventId);
        if (!row && history?.targetStatus !== 'unavailable' && history?.targetStatus !== 'removed') return;
        if (row) {
          viewportMode.current = 'detached';
          runProgrammaticScroll(() => { element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.anchor!.offset; });
          row.focus({ preventScroll: true });
          readingAnchor.current = captureTimelineAnchor(element);
          queueMicrotask(() => setTimelineDetached(true));
          onDetachedChange?.(true);
        }
      }
      restoredNavigationEntry.current = navigationEntry;
    }
    captureNavigationReading();
  }, [captureNavigationReading, conversationVisible, history?.loading, history?.targetStatus, messages, navigationEntry, navigationPending, navigationReading, onDetachedChange, runProgrammaticScroll]);

  useLayoutEffect(() => {
    const content = timelineContent.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(restoreTimelineViewport);
    observer.observe(content);
    if (timeline.current) observer.observe(timeline.current);
    // Row observations also cover net-zero content growth above/below the reader.
    for (const row of historyRows(content)) observer.observe(row);
    return () => observer.disconnect();
  }, [messages, restoreTimelineViewport, room?.id]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const preserveTimeline = () => requestAnimationFrame(restoreTimelineViewport);
    viewport.addEventListener('resize', preserveTimeline);
    viewport.addEventListener('scroll', preserveTimeline);
    return () => {
      viewport.removeEventListener('resize', preserveTimeline);
      viewport.removeEventListener('scroll', preserveTimeline);
    };
  }, [restoreTimelineViewport]);

  const latestMessageId = [...messages].reverse().find((message) => !message.pending && (!message.delivery || message.delivery === 'accepted'))?.id;
  const latestThreadMessageId = [...(activeThread?.messages ?? [])].reverse().find((message) => !message.pending && (!message.delivery || message.delivery === 'accepted'))?.id;
  const activeRoomId = room?.id;
  const reportLatestRead = useCallback(() => {
    if (document.visibilityState !== 'visible' || !document.hasFocus() || readActionsRoom === activeRoomId || room?.markedUnread
      || !conversationVisible || !activeRoomId || !latestMessageId || !onReadLatest || historicalWindow || history?.loading || historyAction
      || pendingSearchEvent || searchOpen || viewportMode.current !== 'bottom' || (onReturnToLive && !history)) return;
    const element = timeline.current;
    if (!element || element.closest('main')?.dataset.roomId !== activeRoomId || element.closest('[hidden], [inert]') || !element.closest('main')?.contains(document.activeElement)
      || document.activeElement?.closest('[role=dialog], [role=menu], .context-panel')
      || element.scrollHeight - element.scrollTop - element.clientHeight > 48) return;
    if (reportedRead.current?.roomId === activeRoomId && reportedRead.current.eventId === latestMessageId) return;
    const requested = { roomId: activeRoomId, eventId: latestMessageId };
    reportedRead.current = requested;
    void onReadLatest(latestMessageId).catch(() => {
      if (reportedRead.current === requested) reportedRead.current = undefined;
    });
  }, [conversationVisible, activeRoomId, historicalWindow, history, historyAction, latestMessageId, pendingSearchEvent, readActionsRoom, room?.markedUnread, searchOpen, onReadLatest, onReturnToLive]);

  const reportThreadRead = useCallback((retry = false, observed = false) => {
    if (observed) threadReadRetryHold.current = false;
    if (!retry && threadReadRetryHold.current) return;
    const rootId = activeThread?.rootId;
    const element = threadTimeline.current;
    const failedHere = threadReadError?.roomId === activeRoomId && threadReadError?.rootId === rootId;
    const eventId = retry && failedHere ? threadReadError?.eventId : latestThreadMessageId;
    if (!canReadThread() || (!retry && activeThread?.latestReplyEventId && eventId !== activeThread.latestReplyEventId) || !activeRoomId || !rootId || !eventId || !onReadThread || contextPanel !== 'thread' || threadCollapsed
      || document.visibilityState !== 'visible' || !document.hasFocus() || !element || element.closest('[hidden], [inert]')
      || element.closest('aside')?.dataset.roomId !== activeRoomId || element.closest('aside')?.dataset.threadRoot !== rootId
      || !element.closest('aside')?.contains(document.activeElement) || document.activeElement?.closest('[role=dialog], [role=menu]')
      || (!retry && element.scrollHeight - element.scrollTop - element.clientHeight > 48)) return;
    if (!retry && failedHere) return;
    const previous = reportedThreadRead.current;
    if (previous?.roomId === activeRoomId && previous.rootId === rootId && previous.eventId === eventId) return;
    if (retry) threadReadRetryHold.current = true;
    const requested = { roomId: activeRoomId, rootId, eventId };
    reportedThreadRead.current = requested;
    setThreadReadError(undefined);
    void onReadThread(eventId).catch(() => {
      if (reportedThreadRead.current !== requested) return;
      reportedThreadRead.current = undefined;
      setThreadReadError({ roomId: activeRoomId, rootId, eventId });
    });
  }, [activeRoomId, contextPanel, latestThreadMessageId, onReadThread, threadCollapsed, threadReadError, activeThread, canReadThread, threadTimeline]);

  useEffect(() => {
    const report = (event?: Event) => { reportLatestRead(); reportThreadRead(false, Boolean(event)); };
    report();
    window.addEventListener('focus', report);
    document.addEventListener('focusin', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      window.removeEventListener('focus', report);
      document.removeEventListener('focusin', report);
      document.removeEventListener('visibilitychange', report);
    };
  }, [reportLatestRead, reportThreadRead]);

  const updateReadStatus = async (unread: boolean) => {
    if (!activeRoomId || readAction?.roomId === activeRoomId && readAction.pending) return;
    const operation = unread ? onMarkUnread : onMarkRead;
    if (!operation) return;
    const eventId = unread
      ? (timeline.current && captureTimelineAnchor(timeline.current)?.candidates[0]?.eventId) || latestMessageId
      : undefined;
    const request = {};
    readActionRequest.current = request;
    // Disabling the active button otherwise drops browser focus onto body.
    // Keep Escape and Tab within reach without moving focus after the request.
    if (readActionsSurface.current?.contains(document.activeElement)) readActionsSurface.current.focus({ preventScroll: true });
    setReadAction({ roomId: activeRoomId, pending: true });
    try {
      await operation(eventId);
      if (readActionRequest.current === request) setReadAction({ roomId: activeRoomId, status: unread ? 'Marked unread. Your reminder stays until you mark this conversation read.' : 'Conversation marked read. Unseen threads keep their unread state.' });
    } catch {
      if (readActionRequest.current === request) setReadAction({ roomId: activeRoomId, error: `Could not mark this conversation ${unread ? 'unread' : 'read'}. Try again.` });
    }
  };

  const requestHistory = useCallback(async (direction: 'backward' | 'forward', retry = false) => {
    if (!onLoadMore || activeHistoryRequest.current !== undefined || historyLoading || (!retry && (direction === 'backward' ? !history?.canLoadOlder : !history?.canLoadNewer))) return;
    edgeScrollIntent.current = undefined;
    const element = timeline.current;
    if (element) readingAnchor.current = captureTimelineAnchor(element) ?? readingAnchor.current;
    viewportMode.current = 'detached';
    setTimelineDetached(true);
    onDetachedChange?.(true);
    const token = ++historyRequestToken.current;
    activeHistoryRequest.current = token;
    const roomAtStart = room?.id;
    historyActionRevision.current = history?.revision;
    setHistoryAction(direction);
    setLocalHistoryError(undefined);
    try { await onLoadMore(direction); }
    catch {
      if (token === historyRequestToken.current && previousRoomId.current === roomAtStart) {
        setLocalHistoryError({ direction, message: `Could not load ${direction === 'backward' ? 'older' : 'newer'} messages. Your reading position has been kept.` });
      }
    } finally {
      if (token === historyRequestToken.current && previousRoomId.current === roomAtStart) { activeHistoryRequest.current = undefined; setHistoryAction(undefined); }
    }
  }, [history?.canLoadNewer, history?.canLoadOlder, history?.revision, historyLoading, onDetachedChange, onLoadMore, room?.id]);

  const openContext = useCallback(async (eventId: string) => {
    edgeScrollIntent.current = undefined;
    if (!conversationVisible) { setPendingSearchEvent({ roomId: room?.id, eventId }); onRevealConversation(); return; }
    const element = timeline.current;
    if (element) readingAnchor.current = captureTimelineAnchor(element) ?? readingAnchor.current;
    viewportMode.current = 'detached';
    setTimelineDetached(true);
    if (searchOpen) onRevealConversation();
    setLocalHistoryError(undefined);
    positionedContext.current = undefined;
    pendingLatest.current = undefined;
    onDetachedChange?.(true);
    if (!onOpenContext) {
      const target = element && historyRows(element).find((row) => row.dataset.eventId === eventId);
      if (target) {
        setLocalTarget(eventId);
        runProgrammaticScroll(() => { target.scrollIntoView?.({ block: 'center' }); target.focus({ preventScroll: true }); });
        if (element) readingAnchor.current = captureTimelineAnchor(element);
      } else setLocalHistoryError({ direction: 'context', eventId, message: 'This message is not available in the loaded conversation.' });
      return;
    }
    const token = ++historyRequestToken.current;
    const roomAtStart = room?.id;
    activeHistoryRequest.current = token;
    setHistoryAction('context');
    try { await onOpenContext(eventId); }
    catch {
      if (token === historyRequestToken.current && previousRoomId.current === roomAtStart) setLocalHistoryError({ direction: 'context', eventId, message: 'Could not open this message. Try again or return to latest.' });
    } finally {
      if (token === historyRequestToken.current && previousRoomId.current === roomAtStart) { activeHistoryRequest.current = undefined; setHistoryAction(undefined); }
    }
  }, [conversationVisible, onRevealConversation, onDetachedChange, onOpenContext, room?.id, runProgrammaticScroll, searchOpen]);
  useEffect(() => {
    if (conversationVisible && pendingSearchEvent) {
      queueMicrotask(() => { setPendingSearchEvent(undefined); if (pendingSearchEvent.roomId === room?.id) void openContext(pendingSearchEvent.eventId); });
    }
  }, [conversationVisible, openContext, pendingSearchEvent, room?.id]);

  const returnToLatest = useCallback(() => {
    edgeScrollIntent.current = undefined;
    if (searchOpen) onCloseContext();
    setLocalHistoryError(undefined);
    setLocalTarget(undefined);
    positionedContext.current = undefined;
    const token = ++historyRequestToken.current;
    if (onReturnToLive && history) {
      pendingLatest.current = { roomId: room?.id, afterRevision: history.revision, token };
      activeHistoryRequest.current = token;
      historyActionRevision.current = history.revision;
      setHistoryAction('latest');
      void onReturnToLive().catch(() => {
        if (historyRequestToken.current !== token || previousRoomId.current !== room?.id) return;
        pendingLatest.current = undefined;
        activeHistoryRequest.current = undefined;
        setHistoryAction(undefined);
        setLocalHistoryError({ direction: 'latest', message: 'Could not return to latest messages. Your reading position has been kept.' });
      });
      return;
    }
    onNavigationLive();
    viewportMode.current = 'bottom';
    readingAnchor.current = undefined;
    unreadAnchorTop.current = undefined;
    setTimelineDetached(false);
    onDetachedChange?.(false);
    const roomAtStart = room?.id;
    requestAnimationFrame(() => {
      const element = timeline.current;
      if (!element || previousRoomId.current !== roomAtStart || historyRequestToken.current !== token) return;
      runProgrammaticScroll(() => { element.scrollTop = element.scrollHeight; });
      reportLatestRead();
    });
  }, [history, onCloseContext, onDetachedChange, onNavigationLive, onReturnToLive, reportLatestRead, room?.id, runProgrammaticScroll, searchOpen]);

  useEffect(() => { if (viewportMode.current === 'bottom') reportLatestRead(); }, [history?.revision, latestMessageId, reportLatestRead, timelineDetached]);

  const handleMediaLoad = useCallback(() => { restoreTimelineViewport(); }, [restoreTimelineViewport]);

  const handleTimelineScroll = useCallback(() => {
    const element = timeline.current;
    if (!element || !conversationVisible || programmaticTimelineScroll.current) return;
    const movement = element.scrollTop - lastKnownScrollTop.current;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
    lastKnownScrollTop.current = element.scrollTop;
    const detached = historicalWindow || !atBottom;
    viewportMode.current = detached ? 'detached' : 'bottom';
    setTimelineDetached(detached);
    unreadAnchorTop.current = undefined;
    readingAnchor.current = captureTimelineAnchor(element);
    onDetachedChange?.(detached);
    captureNavigationReading();
    if (!detached) reportLatestRead();
    // Layout, focus and anchor restoration also emit scroll events. Only a
    // fresh user scroll gesture may turn an edge into automatic pagination;
    // otherwise a restored bounded window can immediately page itself away.
    const intent = edgeScrollIntent.current;
    if (!intent || intent.roomId !== activeRoomId || intent.until < Date.now() || historyLoading || historyError) return;
    if (movement < 0 && intent.direction !== 'forward' && element.scrollTop <= 80 && history?.canLoadOlder) void requestHistory('backward');
    else if (movement > 0 && intent.direction !== 'backward' && atBottom && history?.canLoadNewer) void requestHistory('forward');
  }, [activeRoomId, captureNavigationReading, conversationVisible, historicalWindow, history?.canLoadNewer, history?.canLoadOlder, historyError, historyLoading, onDetachedChange, reportLatestRead, requestHistory]);

  const loadEmojiCatalog = useCallback(() => {
    if (catalogRequested.current) return;
    if (!emojiPacks.length) return;
    catalogRequested.current = true;
    void loadEmojiPacks(emojiPacks, emojiAssetBaseUrl)
      .then((catalog) => setEmojiCatalog(catalog))
      .catch(() => {
        catalogRequested.current = false;
      });
  }, [emojiAssetBaseUrl, emojiPacks]);

  useEffect(() => {
    if (messages.some((message) => /:[a-z0-9][a-z0-9_+-]*:/i.test(message.body))) loadEmojiCatalog();
  }, [messages, loadEmojiCatalog]);

  const setPanelWidth = onContextResize;

  const startPanelResize = (event: PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 767px)').matches) return;
    resizeStart.current = { x: event.clientX, width: threadPanelWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizePanel = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    setPanelWidth(resizeStart.current.width + resizeStart.current.x - event.clientX);
  };

  const stopPanelResize = () => { resizeStart.current = undefined; };

  if (!room) {
    return (
      <main data-focus-fallback className="conversation conversation--empty">
        <BrandMark />
        <h2>Your buddy list is quiet</h2>
        <p>Join a room or start a direct conversation to begin chatting.</p>
      </main>
    );
  }

  return (
    <main
      inert={!conversationVisible}
      hidden={!conversationVisible}
      className={`conversation${hasRoomBackground ? ` conversation--backdrop room-backdrop--${room.background?.preset ?? 'none'}${roomBackgroundSource ? ' has-custom-backdrop' : ''}` : ''}`}
      style={{ ...roomBackgroundStyle, '--thread-panel-width': `${threadPanelWidth}px` } as CSSProperties}
      data-room-id={room.id}
      aria-label={`Conversation with ${room.name}`}
    >
      <header className="conversation-header">
        <IconButton className="conversation-back" label="Back to previous view" onClick={onBack}>
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
          <h2 tabIndex={-1} data-room-heading>{room.name}</h2>
          <p>{room.statusMessage || (room.kind === 'direct' ? 'Direct message' : 'Matrix room')}</p>
        </div>
        <div className="conversation-header__actions">
          {onToggleFavorite ? <button className="icon-button" type="button" aria-label={room.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={Boolean(room.favorite)} aria-disabled={favoritePending || undefined} onClick={() => { if (!favoritePending) onToggleFavorite(); }}><Star size={17} fill={room.favorite ? 'currentColor' : 'none'} /></button> : null}
          {onMarkUnread || onMarkRead ? <button ref={readActionsTrigger} className="icon-button" type="button" aria-label="Read status" aria-haspopup="dialog" aria-expanded={readActionsRoom === room.id} onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setReadPopoverTop(Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - 240))); setReadPopoverRight(Math.max(12, Math.min(window.innerWidth - bounds.right, window.innerWidth - 344))); setReadActionsRoom((current) => current === room.id ? undefined : room.id); }}><Check size={17} /></button> : null}
          <IconButton label="Search loaded messages" active={searchOpen} onClick={onSearch}><Search size={17} /></IconButton>
          {room.encrypted ? <span className="encrypted-pill"><ShieldCheck size={13} /> Encrypted</span> : null}
          {callsEnabled && room.kind === 'direct' ? (
            <span className="header-call-actions">
              <IconButton label="Start voice call" onClick={() => onStartCall(false)}><Phone size={17} /></IconButton>
              <IconButton label="Start video call" onClick={() => onStartCall(true)}><Video size={17} /></IconButton>
            </span>
          ) : null}
          <IconButton label="Decorate conversation background" onClick={onOpenBackground}><Paintbrush size={17} /></IconButton>
          <IconButton className="conversation-header__desktop-action" label="Collapse conversation" onClick={onCollapseConversation}><ChevronRight size={17} /></IconButton>
          <IconButton label="Toggle room details" onClick={onToggleDetails}>
            <PanelRight size={18} />
          </IconButton>
        </div>
      </header>
      {readActionsRoom === room.id && conversationVisible ? createPortal(<Popover trigger={readActionsTrigger} surfaceRef={readActionsSurface} className="history-context" label="Conversation read status" onClose={() => setReadActionsRoom(undefined)} style={{ position: 'fixed', zIndex: 60, top: readPopoverTop, right: readPopoverRight, width: 'min(320px, calc(100vw - 24px))', maxHeight: `calc(100dvh - ${readPopoverTop + 12}px)`, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px #0003' }}>
        <p>{room.markedUnread ? 'Marked unread for later.' : 'Keep a reminder or update your read position.'}</p>
        {onMarkRead ? <button type="button" className="aqua-button" disabled={readAction?.roomId === room.id && readAction.pending} onClick={() => void updateReadStatus(false)}>Mark conversation read</button> : null}
        {onMarkUnread ? <button type="button" className="aqua-button" disabled={readAction?.roomId === room.id && readAction.pending} onClick={() => void updateReadStatus(true)}>Mark unread</button> : null}
        {room.markedUnread && room.unreadEventId ? <button type="button" className="aqua-button" disabled={Boolean(historyLoading)} onClick={() => { setReadActionsRoom(undefined); void openContext(room.unreadEventId!); }}>Return to saved message</button> : null}
        {readAction?.roomId === room.id ? readAction.pending ? <p role="status">Saving read status…</p> : readAction.error ? <p role="alert">{readAction.error}</p> : readAction.status ? <p role="status">{readAction.status}</p> : null : null}
      </Popover>, document.body) : null}
      <div className="conversation-history-controls">
      {room.markedUnread ? <div className="history-context"><p>Marked unread for later.</p>{room.unreadEventId ? <button type="button" className="aqua-button" disabled={Boolean(historyLoading)} onClick={() => void openContext(room.unreadEventId!)}>Return to saved message</button> : null}</div> : null}


      {historyLoading ? <p className="history-progress" role="status">{historyLoading === 'backward' ? 'Loading older messages…' : historyLoading === 'forward' ? 'Loading newer messages…' : historyLoading === 'context' ? 'Opening message context…' : 'Returning to latest messages…'}</p> : null}
      {historyError ? <div className="history-feedback"><p role="alert">{historyError}</p>{historyErrorDirection && (historyErrorDirection !== 'context' || (onOpenContext && (localHistoryError?.eventId ?? history?.targetEventId))) ? <button type="button" className="aqua-button" disabled={Boolean(historyLoading)} onClick={() => {
        if (historyErrorDirection === 'backward' || historyErrorDirection === 'forward') void requestHistory(historyErrorDirection, true);
        else if (historyErrorDirection === 'latest') returnToLatest();
        else if (localHistoryError?.eventId ?? history?.targetEventId) void openContext((localHistoryError?.eventId ?? history?.targetEventId)!);
      }}>{historyErrorDirection === 'backward' ? 'Retry older messages' : historyErrorDirection === 'forward' ? 'Retry newer messages' : historyErrorDirection === 'latest' ? 'Retry latest messages' : 'Retry message context'}</button> : null}</div> : null}
      {history?.mode === 'context' && history.targetStatus ? <div ref={contextBanner} className="history-context" tabIndex={-1} aria-label="Message context">
        <p role="status">{history.targetStatus === 'removed' ? 'This message was removed. The available conversation is shown below.' : history.targetStatus === 'unavailable' ? 'This message is unavailable. It may be inaccessible on this server or device.' : 'Showing the selected message and its surrounding conversation.'}</p>
        {history.targetStatus === 'unavailable' && history.targetEventId && onOpenContext ? <button type="button" className="aqua-button" disabled={Boolean(historyLoading)} onClick={() => void openContext(history.targetEventId!)}>Try opening message again</button> : null}
      </div> : null}

      </div>

      <section
        ref={timeline}
        className="timeline"
        aria-label="Messages"
        aria-live="polite"
        onScroll={handleTimelineScroll}
        onWheel={(event) => { if (event.deltaY) armEdgeScroll(event.deltaY < 0 ? 'backward' : 'forward'); }}
        onTouchStart={(event) => { touchScrollY.current = event.touches[0]?.clientY; }}
        onTouchMove={(event) => { const y = event.touches[0]?.clientY; if (y !== undefined && touchScrollY.current !== undefined && y !== touchScrollY.current) armEdgeScroll(y > touchScrollY.current ? 'backward' : 'forward'); touchScrollY.current = y; }}
        onPointerDown={(event) => { if (event.target === event.currentTarget) armEdgeScroll(); }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || (event.target as HTMLElement).closest('button, input, textarea, select, [contenteditable=true]')) return;
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) armEdgeScroll('backward');
          else if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) armEdgeScroll(event.shiftKey && event.key === ' ' ? 'backward' : 'forward');
        }}
      >
        <div ref={timelineContent} className="timeline-content">
          {history && onLoadMore ? <div className="history-edge">{history.canLoadOlder
            ? <button type="button" className="aqua-button" disabled={Boolean(historyLoading)} onClick={() => void requestHistory('backward')}>Load older messages</button>
            : !history.loading ? <p>Beginning of available history.</p> : null}</div> : null}
          <div className="conversation-intro">
            <Avatar
              name={room.name}
              src={room.avatarUrl}
              color={colorForId(room.id)}
              presence={room.presence}
              size="large"
            />
            <h1>{room.name}</h1>
            <p>{room.statusMessage || (history?.canLoadOlder ? `Conversation in ${room.name}. Earlier messages are available.` : `This is the beginning of ${room.name}. Say hello.`)}</p>
            {room.encrypted ? (
              <span className="intro-encryption"><Lock size={12} /> Messages in this room are encrypted.</span>
            ) : null}
          </div>
          {visibleMessages.length ? (
            visibleMessages.map((message) => (
              <Fragment key={message.transactionId ?? message.id}>
                {daySeparators.get(message.id) ? (
                  <div
                    className="unread-divider day-separator"
                    role="separator"
                    aria-label={`Messages from ${daySeparators.get(message.id)!.accessibleLabel}`}
                  >
                    <span>{daySeparators.get(message.id)!.label}</span>
                  </div>
                ) : null}
                {!historicalWindow && activeEntryUnreadMarker?.firstUnreadMessageId === message.id ? (
                  <div
                    className="unread-divider"
                    data-unread-boundary
                    role="separator"
                    aria-label={`${activeEntryUnreadMarker.count} unread ${activeEntryUnreadMarker.count === 1 ? 'message' : 'messages'} below`}
                  >
                    <span>{activeEntryUnreadMarker.count} unread {activeEntryUnreadMarker.count === 1 ? 'message' : 'messages'}</span>
                  </div>
                ) : null}
                <TimelineMessage
                  message={message}
                  dataSaver={dataSaver}
                  autoplayMedia={autoplayMedia}
                  onReply={onStartReply}
                  onOpenThread={onOpenThread}
                  onStartThread={onStartThread}
                  onEdit={startEdit}
                  onDelete={onDeleteMessage}
                  onRetryMessage={onRetryMessage}
                  onCancelMessage={onCancelMessage}
                  onPin={onTogglePin}
                  canPin={Boolean(room.canManage)}
                  onReact={onReact}
                  emojiCatalog={emojiCatalog}
                  recentEmojis={recentEmojis}
                  onLoadEmojiCatalog={loadEmojiCatalog}
                  onEmojiUsed={rememberEmoji}
                  onMarkUnread={onMarkUnread ? (message) => onMarkUnread(message.id) : undefined}
                  onMediaLoad={handleMediaLoad}
                  onJumpToEvent={(eventId) => void openContext(eventId)}
                  highlighted={message.id === targetEventId && (historicalWindow || Boolean(localTarget))}
                  onLoadLinkPreview={onLoadLinkPreview}
                />
              </Fragment>
            ))
          ) : (
            <div className="timeline-empty"><Sparkles size={20} /> {messageQuery ? 'No loaded messages match.' : 'No messages here yet.'}</div>
          )}
          {history && onLoadMore && (history.canLoadNewer || historicalWindow) ? <div className="history-edge">{history.canLoadNewer ? <button type="button" className="aqua-button" disabled={Boolean(historyLoading)} onClick={() => void requestHistory('forward')}>Load newer messages</button> : !historyLoading ? <p>End of available history. Jump to latest to follow new messages.</p> : null}</div> : null}
        </div>
      </section>
      {timelineDetached || historicalWindow ? <button className="jump-to-latest" type="button" disabled={Boolean(historyLoading)} onClick={returnToLatest}>Jump to latest messages</button> : null}

      {contextHost && activeThread ? createPortal(
        <aside hidden={contextPanel !== 'thread' || threadCollapsed} inert={contextPanel !== 'thread' || threadCollapsed} className="thread-panel" data-room-id={room.id} data-thread-root={activeThread.rootId} data-latest-reply-id={activeThread.latestReplyEventId} aria-label="Thread">
          <div
            className="thread-panel__resize"
            role="separator"
            aria-label="Resize thread panel"
            aria-orientation="vertical"
            aria-valuemin={260}
            aria-valuemax={contextMaximum}
            aria-valuenow={Math.round(threadPanelWidth)}
            tabIndex={0}
            onPointerDown={startPanelResize}
            onPointerMove={resizePanel}
            onPointerUp={stopPanelResize}
            onPointerCancel={stopPanelResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') { event.preventDefault(); setPanelWidth(threadPanelWidth + 24); }
              if (event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth(threadPanelWidth - 24); }
              if (event.key === 'Home') { event.preventDefault(); setPanelWidth(260); }
              if (event.key === 'End') { event.preventDefault(); setPanelWidth(contextMaximum); }
            }}
          />
          <header className="thread-panel__header">
            <span><MessageCircle size={16} /><strong tabIndex={-1} data-panel-heading>Thread</strong><small>{activeThread.replyCount}{activeThread.replyCountIsLowerBound ? '+' : ''} {activeThread.replyCount === 1 && !activeThread.replyCountIsLowerBound ? 'reply' : 'replies'}{activeThread.unreadCount ? ` · ${activeThread.unreadCount} unread` : ''}</small></span>
            <span className="thread-panel__actions"><button type="button" aria-label="Collapse thread" onClick={onToggleThreadCollapsed}><ChevronRight size={16} /></button><button type="button" aria-label="Close thread" onClick={onCloseThread}><ArrowLeft size={16} /></button></span>
          </header>
          <div ref={threadTimeline} className="thread-panel__timeline" tabIndex={0} aria-label="Thread replies" aria-busy={threadHistoryBusy} onScroll={() => { captureThread(); reportThreadRead(false, true); }}>
          {threadAttentionActions ? <Suspense fallback={null}><ThreadAttention key={JSON.stringify([room.id, activeThread.rootId])} actions={threadAttentionActions} roomId={room.id} rootId={activeThread.rootId} /></Suspense> : null}
            <div className="thread-panel__root">
              {threadRoot && activeThread.rootStatus !== 'removed' ? <TimelineMessage message={threadRoot} hideThreadControls dataSaver={dataSaver} autoplayMedia={autoplayMedia}
                onReply={(message) => onStartReply(message, activeThread.rootId)} onOpenThread={onOpenThread} onStartThread={onStartThread} onEdit={startThreadEdit} onDelete={onDeleteMessage}
                onRetryMessage={onRetryMessage} onCancelMessage={onCancelMessage} onPin={onTogglePin} canPin={Boolean(room.canManage)} onReact={onReact}
                emojiCatalog={emojiCatalog} recentEmojis={recentEmojis} onLoadEmojiCatalog={loadEmojiCatalog} onEmojiUsed={rememberEmoji}
                onMediaLoad={restoreThread} onJumpToEvent={onThreadContext} onLoadLinkPreview={onLoadLinkPreview} /> : <p role="status">{activeThread.rootStatus === 'removed' ? 'The original message was removed. Replies are still available.' : activeThread.rootStatus === 'unavailable' ? 'The original message is unavailable. Check your access and connection.' : 'Loading the original message…'}</p>}
            </div>
            {threadHistoryError || activeThread.history?.error || activeThread.rootStatus === 'unavailable' || activeThread.history?.targetStatus === 'unavailable' ? <div className="history-feedback"><p role="status">{activeThread.history?.error ?? (activeThread.history?.targetStatus === 'unavailable' ? 'This reply is unavailable. You can still browse the thread.' : 'Thread history could not load.')}</p><button type="button" disabled={threadHistoryBusy} onClick={retryThread}>Retry loading thread replies</button></div> : null}
            {onPageThreadHistory && activeThread.history?.canLoadOlder ? <div className="history-edge"><button type="button" className="aqua-button" disabled={threadHistoryBusy} onClick={() => loadThread('backward')}>Load older thread replies</button></div> : null}
            <div hidden={!threadHistoryBusy} className="history-feedback" role="status">Loading thread replies…
            </div>
            {activeThread.messages.map((message) => (
              <TimelineMessage
                key={message.transactionId ?? message.id}
                message={message}
                dataSaver={dataSaver}
                autoplayMedia={autoplayMedia}
                onReply={(message) => onStartReply(message, activeThread.rootId)}
                onOpenThread={onOpenThread}
                onStartThread={onStartThread}
                onEdit={startThreadEdit}
                onDelete={onDeleteMessage}
                  onRetryMessage={onRetryMessage}
                  onCancelMessage={onCancelMessage}
                onPin={onTogglePin}
                canPin={Boolean(room?.canManage)}
                onReact={onReact}
                emojiCatalog={emojiCatalog}
                recentEmojis={recentEmojis}
                onLoadEmojiCatalog={loadEmojiCatalog}
                onEmojiUsed={rememberEmoji}
                onMediaLoad={restoreThread}
                onJumpToEvent={onThreadContext}
                onLoadLinkPreview={onLoadLinkPreview}
              />
            ))}
            {onPageThreadHistory && activeThread.history?.canLoadNewer ? <div className="history-edge"><button type="button" className="aqua-button" disabled={threadHistoryBusy} onClick={() => loadThread('forward')}>Load newer thread replies</button></div> : null}
          </div>
          <div className="conversation-composition">
            {onLatestThread && activeThread.history?.mode !== 'live' ? <div className="history-feedback" style={{ gridColumn: '1 / -1' }}><button type="button" disabled={threadHistoryBusy} onClick={latestThread}>Jump to latest replies</button></div> : null}
            {threadReadError?.roomId === room.id && threadReadError.rootId === activeThread.rootId ? <div className="history-feedback" style={{ gridColumn: '1 / -1' }}><p role="alert">Thread read status could not sync. Older homeservers may not support private thread tracking.</p><button type="button" disabled={threadHistoryBusy || Boolean(activeThread.history && activeThread.history.mode !== 'live')} title={activeThread.history && activeThread.history.mode !== 'live' ? 'Jump to latest replies to retry this observed read status' : undefined} onClick={() => reportThreadRead(true)}>Retry thread read status</button></div> : null}
          {notice ? <p className="history-feedback" role="status">{notice}</p> : null}
          {!threadComposition.edit ? <AttachmentTray queue={attachmentQueue} context={{ roomId: room.id, threadRootId: activeThread.rootId }} /> : null}
          <SharedComposer ref={threadComposer} key={`${room.id}:${activeThread.rootId}`} contextKey={JSON.stringify([room.id, activeThread.rootId])}
            value={threadComposition} onChange={onThreadCompositionChange} onSubmit={onThreadSubmit}
            thread active={contextPanel === 'thread' && !threadCollapsed} sending={threadSending}
            members={members} roomName={room.name} emojiPacks={emojiPacks} emojiAssetBaseUrl={emojiAssetBaseUrl}
            stickerPacks={stickerPacks} defaultStickerPack={defaultStickerPack} gifEndpoint={gifEndpoint}
            stageFiles={threadComposition.edit ? undefined : (files, language) => onStageFiles(files, activeThread.rootId, language)}
            sendSticker={threadComposition.edit ? undefined : async (sticker) => { await onSendSticker(sticker, activeThread.rootId); }}
            sendGif={threadComposition.edit ? undefined : async (gif) => { await onSendGif(gif, activeThread.rootId); }}
            onCancelContext={onCancelThreadEdit}
            onEditLatest={() => { const message = [...activeThread.messages].reverse().find((item) => item.actions?.edit ?? (item.isOwn && item.kind === 'text' && !item.pending && (!item.delivery || item.delivery === 'accepted') && !item.pendingEdit)); if (message) startThreadEdit(message); }}
            onSubmitted={(result) => { if (result !== 'edited' && activeThread.history?.mode !== 'live') latestThread(); }}
          />
          </div>
        </aside>, contextHost
      ) : null}
      {contextHost && contextPanel === 'thread' && !activeThread ? createPortal(<aside className="search-panel" aria-label="Thread">
        <header className="thread-panel__header"><strong tabIndex={-1} data-panel-heading>Thread</strong><button type="button" aria-label="Close thread" onClick={onCloseThread}><ArrowLeft size={16} /></button></header>
        <p className="search-scope" role="status">This thread is no longer in the loaded conversation. Return to the conversation to find its available context. Your draft is kept for this session.</p>
      </aside>, contextHost) : null}
      {contextHost ? createPortal(<aside hidden={!searchOpen} inert={!searchOpen} className="search-panel" aria-label="Search loaded messages">
        <header className="thread-panel__header"><strong tabIndex={-1} data-panel-heading>Search loaded messages</strong><button type="button" aria-label="Close message search" onClick={onCloseContext}><X size={16} /></button></header>
        <label className="message-search"><Search size={15} /><span className="sr-only">Search loaded messages</span><input value={messageQuery} placeholder="Search loaded messages" onChange={(event) => setMessageQuery(event.target.value)} /></label>
        <p className="search-scope">Search covers messages loaded in this conversation.</p>
        <div className="search-results">{messageQuery.trim() ? <><p role="status">{searchResults.length} found</p>{searchResults.map((message) => <button key={message.id} type="button" onClick={() => void openContext(message.id)}><strong>{message.senderName}</strong><span>{message.body}</span></button>)}</> : <p>Enter a name or phrase to find a message.</p>}</div>
      </aside>, contextHost) : null}
      {activeThread && threadCollapsed ? <button className="thread-panel__restore" type="button" aria-label="Expand thread" onClick={onToggleThreadCollapsed}><MessageCircle size={16} /> Thread</button> : null}

      <div className="typing-strip" aria-live="polite">
        {notice ? <>{notice}</> : room.typingUsers?.length ? <><i /><i /><i /> {room.typingUsers.slice(0, 2).join(' and ')} {room.typingUsers.length === 1 ? 'is' : 'are'} typing</> : room.id === 'welcome' ? <><i /><i /><i /> Mara is typing</> : <>&nbsp;</>}
      </div>
      <div className="conversation-composition">
      {!composition.edit ? <AttachmentTray queue={attachmentQueue} context={{ roomId: room.id }} /> : null}
      <SharedComposer ref={mainComposer} key={room.id} contextKey={JSON.stringify([room.id, null])}
        value={composition} onChange={onCompositionChange} onSubmit={onSubmit}
        active={conversationVisible} sending={sending} members={members} roomName={room.name}
        emojiPacks={emojiPacks} emojiAssetBaseUrl={emojiAssetBaseUrl} stickerPacks={stickerPacks}
        defaultStickerPack={defaultStickerPack} gifEndpoint={gifEndpoint}
        stageFiles={composition.edit ? undefined : (files, language) => onStageFiles(files, undefined, language)}
        sendSticker={composition.edit ? undefined : async (sticker) => { await onSendSticker(sticker); }}
        sendGif={composition.edit ? undefined : async (gif) => { await onSendGif(gif); }}
        onNudge={composition.edit ? undefined : onSendNudge} onCancelContext={onCancelContext}
        onEditLatest={() => { const message = [...messages].reverse().find((item) => item.actions?.edit ?? (item.isOwn && item.kind === 'text' && !item.pending && (!item.delivery || item.delivery === 'accepted') && !item.pendingEdit)); if (message) startEdit(message); }}
        onSubmitted={(result) => { if (result !== 'edited') returnToLatest(); }}
      />
      </div>
    </main>
  );
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
  useDialogBusy(busy);
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
    if (!onSetBackground || busy) return;
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
    if (!onUpload || busy) return;
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
    if (!onSetPolicy || busy) return;
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
    if (!onSetMemberPower || busy) return;
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
          <button type="button" className={target === 'room' ? 'is-active' : ''} aria-pressed={target === 'room'} disabled={busy} onClick={() => chooseTarget('room')}>This room</button>
          <button type="button" className={target === 'space' ? 'is-active' : ''} aria-pressed={target === 'space'} disabled={busy} onClick={() => chooseTarget('space')}>{space.name} space</button>
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
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; label: string; action: () => Promise<void> }>();
  const [actionBusy, setActionBusy] = useState(false);
  const actionRunning = useRef(false);
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
    if (actionRunning.current) return false;
    actionRunning.current = true; setActionBusy(true);
    setActionStatus(`${label}…`);
    try {
      await action();
      setActionStatus(`${label} complete.`);
      return true;
    } catch {
      setActionStatus(`${label} failed. Check your room permissions.`);
      return false;
    } finally { actionRunning.current = false; setActionBusy(false); }
  };

  const copyRoomId = () => {
    if (!room || !navigator.clipboard) return;
    void navigator.clipboard.writeText(room.id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => setActionStatus('The room ID could not be copied. Check clipboard permission.'));
  };

  return (
    <aside className="details-panel buddy-drawer" aria-label="Buddy and room drawer">
      <fieldset className="interaction-fields" disabled={actionBusy}>
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

          <div className={`drawer-tabs${workspace.mode === 'matrix' ? ' drawer-tabs--five' : ''}`} role="tablist" aria-label="Drawer sections" onKeyDown={(event) => {
            const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
            const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
            if (next !== undefined) { event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click(); }
          }}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'people'} tabIndex={tab === 'people' ? 0 : -1} id="drawer-tab-people" aria-controls="drawer-active-panel"
              className={tab === 'people' ? 'is-active' : ''}
              onClick={() => setTab('people')}
            ><Users size={14} /> People</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'moments'} tabIndex={tab === 'moments' ? 0 : -1} id="drawer-tab-moments" aria-controls="drawer-active-panel"
              className={tab === 'moments' ? 'is-active' : ''}
              onClick={() => setTab('moments')}
            ><Images size={14} /> Moments</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'about'} tabIndex={tab === 'about' ? 0 : -1} id="drawer-tab-about" aria-controls="drawer-active-panel"
              className={tab === 'about' ? 'is-active' : ''}
              onClick={() => setTab('about')}
            ><Info size={14} /> About</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'backdrop'} tabIndex={tab === 'backdrop' ? 0 : -1} id="drawer-tab-backdrop" aria-controls="drawer-active-panel"
              className={tab === 'backdrop' ? 'is-active' : ''}
              onClick={() => setTab('backdrop')}
            ><Paintbrush size={14} /> Backdrop</button>
            {workspace.mode === 'matrix' ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'settings'} tabIndex={tab === 'settings' ? 0 : -1} id="drawer-tab-settings" aria-controls="drawer-active-panel"
                className={tab === 'settings' ? 'is-active' : ''}
                onClick={() => setTab('settings')}
              ><Settings size={14} /> Manage</button>
            ) : null}
          </div>

          {tab === 'people' ? (
            <div role="tabpanel" id="drawer-active-panel" aria-labelledby="drawer-tab-people" className="drawer-tab-panel">
              <div className="member-heading">
                <Users size={14} /> {onlineCount} online <span>{members.length} total</span>
              </div>
              {workspace.mode === 'matrix' ? (
                <form className="drawer-invite" onSubmit={(event) => {
                  event.preventDefault();
                  if (!room || !invitee.trim() || !onInvite) return;
                  void runRoomAction('Invite', () => onInvite(room.id, invitee.trim())).then((succeeded) => { if (succeeded) setInvitee(''); });
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
                    <MemberActions room={room} member={member} currentUserId={workspace.user.id} onRemoveMember={onRemoveMember} onSetMemberPower={onSetMemberPower} onRunAction={runRoomAction} onConfirm={setConfirmation} />
                  </div>
                )) : <p className="drawer-empty">No buddy details have arrived yet.</p>}
              </div>
            </div>
          ) : null}

          {tab === 'moments' ? (
            <div role="tabpanel" id="drawer-active-panel" aria-labelledby="drawer-tab-moments" className="drawer-tab-panel drawer-moments">
              <span className="eyebrow">Recent shared media</span>
              {mediaMessages.length ? mediaMessages.map((message) => (
                <div className="drawer-moment" key={message.transactionId ?? message.id}>
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
            <div role="tabpanel" id="drawer-active-panel" aria-labelledby="drawer-tab-about" className="drawer-tab-panel drawer-about">
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
            <div role="tabpanel" id="drawer-active-panel" aria-labelledby="drawer-tab-backdrop" className="drawer-tab-panel">
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
            <div role="tabpanel" id="drawer-active-panel" aria-labelledby="drawer-tab-settings" className="drawer-tab-panel drawer-manage">
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
                  {!room.encrypted ? <button className="aqua-button" type="button" onClick={() => setConfirmation({ title: 'Enable encryption permanently?', description: 'Future messages will be encrypted. This cannot be turned off, and earlier messages remain as they were.', label: 'Enable encryption', action: () => onEnableEncryption?.(room.id) ?? Promise.resolve() })}><Lock size={13} /> Enable encryption forever</button> : null}
                </form>
              ) : <p className="drawer-empty">You can view this room, but only its moderators can change room state.</p>}
              <label className="settings-toggle-row drawer-notification-toggle"><span><strong>Mute room notifications</strong><small>Saved as a Matrix push rule.</small></span><input type="checkbox" checked={Boolean(room.muted)} onChange={(event) => void runRoomAction(event.target.checked ? 'Mute room' : 'Unmute room', () => onSetMuted?.(room.id, event.target.checked) ?? Promise.resolve())} /></label>
              <button className="aqua-button drawer-leave" type="button" onClick={() => {
                setConfirmation({ title: `Leave ${room.name}?`, description: 'You may need another invitation to return to this room.', label: 'Leave room', action: () => onLeave?.(room.id) ?? Promise.resolve() });
              }}><DoorOpen size={13} /> Leave room</button>

            </div>
          ) : null}
        </>
      ) : null}
      </fieldset>
      <p className="drawer-action-status" role="status" aria-atomic="true">{actionStatus || (copied ? 'Room ID copied.' : '')}</p>
      {confirmation ? <ConfirmDialog title={confirmation.title} description={confirmation.description} actionLabel={confirmation.label} onClose={() => setConfirmation(undefined)} onConfirm={async () => { await confirmation.action(); setActionStatus(`${confirmation.label} complete.`); }} /> : null}
    </aside>
  );
}

export function Workspace({
  activityActions,
  threadAttentionActions,
  workspace,
  draftStore,
  structuredDraftStore,
  draftScope,
  onDraftStateChange,
  connectionNotice,
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
  install,
  pushRoute,
  onSendMessage,
  onSendNudge,
  onLoadLinkPreview,
  onRoomSelected,
  onLoadRoomHistory,
  onOpenEventContext,
  onReturnToLive,
  onHistoryDetached,
  onThreadSelected, onLoadThreadHistory, onReturnThreadToLive, onThreadHistoryDetached, onCloseThreadHistory, onSendThreadMessage,
  onSpaceSelected,
  onReorganizeSpaceChildren,
  onReorderRootSpaces,
  onSendReply,
  onEditMessage,
  onRedactMessage,
  onRetryMessage,
  onCancelMessage,
  onTogglePinnedMessage,
  onToggleReaction,
  onSendTyping,
  onSendSticker,
  onUploadAttachment,
  onCancelUpload,
  onSendGif,
  onMarkRoomRead,
  onMarkThreadRead,
  onSetRoomFavorite,
  onResolveNavigationTarget,
  onMarkRoomUnread,
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
  const appStage = useRef<HTMLDivElement>(null);
  const locationKey = `aimtrix.location.v2:${workspace.user.id}`;
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(locationKey) || '{}') as { roomId?: string };
      return pushRoute?.roomId && workspace.rooms.some((room) => room.id === pushRoute.roomId)
        ? pushRoute.roomId
        : stored.roomId ?? workspace.rooms[0]?.id;
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
  const [homePosition, setHomePosition] = useState<HomePosition>({ filter: 'all', scroll: 0, initialized: false });
  const updateHomePosition = useCallback((patch: Partial<HomePosition>) => setHomePosition((current) => ({ ...current, ...patch })), []);
  const [query, setQuery] = useState('');
  const [navigationDialog, setNavigationDialog] = useState<'switcher' | 'link' | 'help'>();
  const [conversationFilter, setConversationFilter] = useState<'all' | 'unread' | 'favorites'>('all');
  const [recents, setRecents] = useState<string[]>([]);
  const [favoritePending, setFavoritePending] = useState<Set<string>>(() => new Set());
  const navigationIntent = useRef(0);
  useEffect(() => () => { navigationIntent.current += 1; }, []);
  const { route: shellRoute, entryId: shellEntry, reading: shellReading, remember: rememberReading, threadReading: shellThreadReading, rememberThread: rememberThreadReading, navigate: navigateShell, back: shellBack, forward: shellForward, canGoBack, canGoForward } = useShellNavigation({
    surface: 'list', roomId: selectedRoomId, spaceId: activeSpace,
    panel: preferences.detailsOpenByDefault ? 'details' : null,
  });
  const [shellWidth, setShellWidth] = useState(window.innerWidth);
  const contextDocked = shellWidth >= 1200;
  const mobileChatOpen = shellRoute.surface !== 'list';
  const showingHome = shellRoute.surface === 'activity';
  const contextPanel = !showingHome && (contextDocked || shellRoute.surface === 'context') ? shellRoute.panel : null;
  const detailsOpen = contextPanel === 'details';
  const conversationVisible = (shellWidth >= 768 || mobileChatOpen) && (contextDocked || !contextPanel);
  const [contextHost, setContextHost] = useState<HTMLDivElement | null>(null);
  const contextOpener = useRef<HTMLElement | null>(null);
  const suppressContextReturnFocus = useRef(false);
  const previousFocusRoute = useRef({ panel: contextPanel, surface: shellRoute.surface, roomId: selectedRoomId });
  const [threadRequestId, setThreadRequestId] = useState(0);
  const openPanel = useCallback((panel: 'thread' | 'details' | 'search', threadRootId?: string, threadEventId?: string) => {
    if (panel === 'thread' && threadEventId) setThreadRequestId((value) => value + 1);
    if (!shellRoute.panel || shellRoute.surface !== 'context') contextOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    navigateShell({ ...shellRoute, surface: 'context', roomId: selectedRoomId, spaceId: activeSpace, panel, threadRootId: threadRootId ?? shellRoute.threadRootId, threadEventId });
  }, [activeSpace, navigateShell, selectedRoomId, shellRoute]);
  const closePanel = useCallback(() => {
    if (shellRoute.surface === 'context') shellBack();
    else navigateShell({ ...shellRoute, panel: null }, { replace: true });
  }, [navigateShell, shellBack, shellRoute]);
  useLayoutEffect(() => {
    const element = appStage.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setShellWidth(element.clientWidth || window.innerWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const previous = previousFocusRoute.current;
    if (previous.panel === contextPanel && previous.surface === shellRoute.surface && previous.roomId === selectedRoomId) return;
    previousFocusRoute.current = { panel: contextPanel, surface: shellRoute.surface, roomId: selectedRoomId };
    if (shellWidth >= 768 && previous.roomId !== selectedRoomId && previous.panel === contextPanel && shellRoute.surface !== 'context') return;
    const scheduledFrom = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== scheduledFrom && active instanceof HTMLElement && active !== document.body && !active.closest('[hidden], [inert]')) return;
      if (contextPanel && (previous.panel !== contextPanel || (shellRoute.surface === 'context' && previous.surface !== 'context'))) contextHost?.querySelector<HTMLElement>(':scope > :not([hidden]) [data-panel-heading]')?.focus({ preventScroll: true });
      else if (shellRoute.surface === 'list' && shellWidth < 768) appStage.current?.querySelector<HTMLElement>('.buddy-row--selected')?.focus({ preventScroll: true });
      else {
        if (suppressContextReturnFocus.current) { suppressContextReturnFocus.current = false; return; }
        const opener = previous.panel && !contextPanel ? contextOpener.current : null;
        if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
        else appStage.current?.querySelector<HTMLElement>('[data-room-heading]')?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [contextHost, contextPanel, selectedRoomId, shellRoute.surface, shellWidth]);
  const [deleteTarget, setDeleteTarget] = useState<MessageSummary>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [backgroundDialogOpen, setBackgroundDialogOpen] = useState(false);
  const [activeThreadRootId, setActiveThreadRootId] = useState<string>();
  const [appliedShellRoute, setAppliedShellRoute] = useState(shellRoute);
  if (appliedShellRoute !== shellRoute) {
    setAppliedShellRoute(shellRoute);
    if (shellRoute.roomId) setSelectedRoomId(shellRoute.roomId);
    if (shellRoute.spaceId) setActiveSpace(shellRoute.spaceId);
    if (shellRoute.threadRootId) setActiveThreadRootId(shellRoute.threadRootId);
  }
  const [threadCollapsed, setThreadCollapsed] = useState(false);
  const [collapsedPanels, setCollapsedPanels] = useState<Record<WorkspacePanelId, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('aimtrix.workspace-panels.v1') || '{}') as Record<WorkspacePanelId, boolean>;
    } catch {
      return {} as Record<WorkspacePanelId, boolean>;
    }
  });
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('aimtrix.workspace-panel-widths.v1') || '{}') as Partial<{ buddies: number; details: number }>;
      return {
        buddies: typeof stored.buddies === 'number' ? Math.max(220, Math.min(stored.buddies, 520)) : 248,
        details: typeof stored.details === 'number' ? Math.max(260, Math.min(stored.details, 560)) : 320,
      };
    } catch {
      return { buddies: 248, details: 320 };
    }
  });
  const buddyWidth = collapsedPanels.buddies ? 48 : contextDocked
    ? Math.min(panelWidths.buddies, Math.max(220, shellWidth - 66 - 16 - 420 - (contextPanel ? 260 : 0))) : 232;
  const contextMaximum = Math.max(260, Math.min(560, shellWidth - 66 - buddyWidth - 16 - 420));
  const contextWidth = Math.min(panelWidths.details, contextMaximum);
  const panelResizeStart = useRef<{ panel: 'buddies' | 'details'; x: number; width: number } | undefined>(undefined);
  const [legacyDrafts] = useState(() => draftStore?.read(workspace.user.id));
  const draftsState = useWorkspaceDrafts({ store: workspace.mode === 'matrix' ? structuredDraftStore : undefined, scope: workspace.mode === 'matrix' ? draftScope : undefined, userId: workspace.user.id,
    initialRooms: legacyDrafts?.rooms, initialThreads: legacyDrafts?.threads,
    threadRooms: Object.fromEntries(Object.entries(workspace.threadsByRoot).flatMap(([rootId, thread]) => {
      const roomId = thread.roomId ?? thread.root?.roomId ?? thread.messages[0]?.roomId
        ?? Object.entries(workspace.messagesByRoom).find(([, events]) => events.some((event) => event.id === rootId))?.[0];
      return roomId ? [[rootId, roomId]] : [];
    })),
  });
  const composerNavigation = useRef(0);
  const sendsInFlight = useRef(new Set<string>());
  useLayoutEffect(() => {
    const rooms: Record<string, string> = {}, threads: Record<string, string> = {};
    for (const record of draftsState.list) {
      if (record.context.threadRootId) threads[record.context.threadRootId] = record.value.body;
      else rooms[record.context.roomId] = record.value.body;
    }
    draftStore?.write(workspace.user.id, rooms, threads);
  }, [draftStore, draftsState.list, workspace.user.id]);
  const [demoMessages, setDemoMessages] = useState(workspace.messagesByRoom);
  const [demoMessageOverrides, setDemoMessageOverrides] = useState<Record<string, Partial<MessageSummary> | null>>({});
  const [demoThreadMessages, setDemoThreadMessages] = useState<Record<string, MessageSummary[]>>({});
  const [mediaSends, setMediaSends] = useState<Record<string, number>>({});
  const [sendingContexts, setSendingContexts] = useState(new Set<string>());
  const [notice, setNotice] = useState<string>();
  const [draftListOpen, setDraftListOpen] = useState(false);
  const [nudgeActive, setNudgeActive] = useState(false);
  const latestNudgeId = useRef<string | undefined>(undefined);
  const lastNudgeSentAt = useRef(0);
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
  const typingTimer = useRef<number | undefined>(undefined);
  const lastTypingSentAt = useRef(0);
  const handledPushRoute = useRef<PushRoute | undefined>(undefined);
  const missingPushRoom = useRef<PushRoute | undefined>(undefined);
  const currentHistoryRoom = useRef<string | undefined>(undefined);
  const historyHandlers = useRef({ onRoomSelected, onLoadRoomHistory, onOpenEventContext, onReturnToLive, onHistoryDetached });
  useLayoutEffect(() => { historyHandlers.current = { onRoomSelected, onLoadRoomHistory, onOpenEventContext, onReturnToLive, onHistoryDetached }; });

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
    () => ({ ...workspace, rooms: visibleRooms.map((room) => ({ ...room, ...roomOverrides[room.id] })), membersByRoom: effectiveMembersByRoom }),
    [effectiveMembersByRoom, roomOverrides, visibleRooms, workspace],
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
  const messagesByRoom = useMemo(() => workspace.mode === 'demo' ? Object.fromEntries(Object.entries(demoMessages).map(([roomId, items]) => [roomId, items.filter((item) => demoMessageOverrides[item.id] !== null).map((item) => ({ ...item, ...demoMessageOverrides[item.id] }))])) : workspace.messagesByRoom, [workspace.mode, workspace.messagesByRoom, demoMessages, demoMessageOverrides]);
  const messages = useMemo(() => effectiveRoomId ? messagesByRoom[effectiveRoomId] ?? [] : [], [effectiveRoomId, messagesByRoom]);
  const canReceiveLiveNudges = workspace.mode === 'demo' || Boolean(effectiveRoomId && workspace.historyByRoom?.[effectiveRoomId]?.mode === 'live');
  useEffect(() => {
    if (!canReceiveLiveNudges) return;
    const latest = messages.filter((message) => message.nudge && !message.isOwn).at(-1);
    if (!latest || latestNudgeId.current === latest.id) return;
    latestNudgeId.current = latest.id;
    if (!preferences.nudgeEffects || preferences.motion === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const start = window.setTimeout(() => setNudgeActive(true), 0);
    const stop = window.setTimeout(() => setNudgeActive(false), 520);
    return () => { window.clearTimeout(start); window.clearTimeout(stop); setNudgeActive(false); };
  }, [canReceiveLiveNudges, messages, preferences.motion, preferences.nudgeEffects]);
  const loadedThreadRoot = activeThreadRootId ? messages.find((item) => item.id === activeThreadRootId && !item.pending && (!item.delivery || item.delivery === 'accepted')) : undefined;
  const activeThreadBase: ThreadSummary | undefined = activeThreadRootId ? workspace.threadsByRoot[activeThreadRootId] ?? (loadedThreadRoot ? {
    rootId: activeThreadRootId, roomId: loadedThreadRoot.roomId, root: loadedThreadRoot, rootStatus: 'found', messages: [], replyCount: 0,
  } : undefined) : undefined;
  const activeThread = activeThreadBase && activeThreadRootId
    ? {
        ...activeThreadBase,
        messages: [...activeThreadBase.messages, ...(demoThreadMessages[activeThreadRootId] ?? [])].filter((item) => demoMessageOverrides[item.id] !== null).map((item) => ({ ...item, ...demoMessageOverrides[item.id] })),
        replyCount: activeThreadBase.replyCount + (demoThreadMessages[activeThreadRootId]?.length ?? 0),
      }
    : undefined;
  const originalThreadRoot = activeThreadBase?.root ?? (!activeThreadBase?.rootStatus && activeThreadRootId
    ? messages.find((message) => message.id === activeThreadRootId)
    : undefined);
  const activeThreadRoot = originalThreadRoot && demoMessageOverrides[originalThreadRoot.id] !== null ? { ...originalThreadRoot, ...demoMessageOverrides[originalThreadRoot.id] } : undefined;
  const composition: StructuredDraft = effectiveRoomId ? draftsState.get({ roomId: effectiveRoomId }) : { body: '' };
  const threadComposition: StructuredDraft = effectiveRoomId && activeThreadRootId ? draftsState.get({ roomId: effectiveRoomId, threadRootId: activeThreadRootId }) : { body: '' };
  const editingMessage = composition.edit ? messages.find((message) => message.id === composition.edit!.id) : undefined;
  const editingThreadMessage = threadComposition.edit ? activeThreadRoot?.id === threadComposition.edit.id ? activeThreadRoot : activeThread?.messages.find((message) => message.id === threadComposition.edit!.id) : undefined;
  useLayoutEffect(() => { composerNavigation.current += 1; }, [effectiveRoomId, activeThreadRootId, contextPanel, conversationVisible]);
  useLayoutEffect(() => { currentHistoryRoom.current = effectiveRoomId; }, [effectiveRoomId]);
  const selectedHistory = effectiveRoomId ? workspace.historyByRoom?.[effectiveRoomId] : undefined;
  const pendingRouteRoom = pushRoute?.roomId ?? (pushRoute?.eventId
    ? Object.entries(workspace.messagesByRoom).find(([, roomMessages]) => roomMessages.some((message) => message.id === pushRoute.eventId))?.[0]
      ?? Object.values(workspace.threadsByRoot).flatMap((thread) => thread.messages).find((message) => message.id === pushRoute.eventId)?.roomId
    : undefined);
  const [pendingContextSnapshot, setPendingContextSnapshot] = useState<{ roomId: string; routeEventId?: string; eventId: string; previousRevision?: number }>();
  const [restoration, setRestoration] = useState({ roomId: shellRoute.roomId, eventId: shellRoute.eventId, entryId: shellEntry, reading: shellReading, restorePosition: false });
  if (restoration.entryId !== shellEntry) {
    const restorePosition = restoration.roomId !== shellRoute.roomId || restoration.eventId !== shellRoute.eventId;
    const retainPendingReading = pendingContextSnapshot?.roomId === shellRoute.roomId
      && pendingContextSnapshot !== undefined && pendingContextSnapshot.routeEventId === shellRoute.eventId;
    // Panel transitions share the visible timeline but still own a fresh entry
    // for subsequent reading updates. Only destination changes restore it.
    setRestoration({ roomId: shellRoute.roomId, eventId: shellRoute.eventId, entryId: shellEntry, reading: restorePosition ? shellReading : retainPendingReading ? restoration.reading : undefined, restorePosition });
  }
  const routeContextTarget = restoration.reading?.atLatest ? undefined : restoration.reading?.anchor?.eventId ?? restoration.eventId;
  const [settledNavigationEntry, setSettledNavigationEntry] = useState(shellEntry);
  const [settledIncomingRoute, setSettledIncomingRoute] = useState<PushRoute>();
  // Opening a docked panel changes the entry, but its still-visible timeline
  // must keep waiting for the same destination's requested context snapshot.
  const awaitingDestinationSnapshot = pendingContextSnapshot?.roomId === restoration.roomId
    && pendingContextSnapshot !== undefined && pendingContextSnapshot.routeEventId === restoration.eventId;
  const contextSnapshotCommitted = awaitingDestinationSnapshot
    && selectedHistory?.targetEventId === pendingContextSnapshot.eventId
    && !selectedHistory.loading && selectedHistory.revision !== pendingContextSnapshot.previousRevision;
  if (contextSnapshotCommitted) setPendingContextSnapshot(undefined);
  const pendingRouteContext = Boolean((pushRoute?.eventId && settledIncomingRoute !== pushRoute && (!pendingRouteRoom || pendingRouteRoom === effectiveRoomId)) || (restoration.restorePosition && settledNavigationEntry !== restoration.entryId) || (awaitingDestinationSnapshot && !contextSnapshotCommitted));
  useLayoutEffect(() => { navigationIntent.current += 1; }, [shellEntry, pushRoute]);
  useEffect(() => {
    if (shellRoute.roomId !== effectiveRoomId) return;
    let active = true;
    const restore = async () => {
      try {
        if (effectiveRoomId && restoration.restorePosition && restoration.entryId !== settledNavigationEntry) {
          // A revisited entry follows its observed anchor, which may have moved
          // beyond the original link's context window. Explicit links always
          // request their context, including a retry of an unavailable target.
          if (routeContextTarget && (!restoration.reading || !messages.some((message) => message.id === routeContextTarget) || (restoration.eventId && selectedHistory?.mode !== 'context'))) {
            if (!historyHandlers.current.onOpenEventContext) {
              if (workspace.mode !== 'demo') throw new Error('Message context is not available in this session.');
            } else {
              // The controller can resolve before its batched snapshot arrives.
              // An overlapping old window must not consume the saved offset.
              setPendingContextSnapshot({ roomId: effectiveRoomId, routeEventId: restoration.eventId, eventId: routeContextTarget, previousRevision: selectedHistory?.revision });
              await historyHandlers.current.onOpenEventContext(effectiveRoomId, routeContextTarget);
            }
          } else if (restoration.reading?.atLatest && selectedHistory?.mode !== 'live') {
            await historyHandlers.current.onReturnToLive?.(effectiveRoomId);
          }
        }
      } catch {
        if (active) {
          setPendingContextSnapshot(undefined);
          setNotice('This message or reading position could not be opened. Check your access and try the link again.');
        }
      } finally { if (active) setSettledNavigationEntry(restoration.entryId); }
    };
    queueMicrotask(() => { if (active) void restore(); });
    return () => { active = false; };
    // Each entry owns one restoration. Snapshot updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRoomId, restoration]);
  const paginateCurrentRoom = useCallback(async (direction: 'backward' | 'forward') => {
    if (effectiveRoomId) await historyHandlers.current.onLoadRoomHistory?.(effectiveRoomId, direction);
  }, [effectiveRoomId]);
  const openCurrentEventContext = useCallback(async (eventId: string) => {
    if (effectiveRoomId) {
      if (shellRoute.eventId === eventId) { await historyHandlers.current.onOpenEventContext?.(effectiveRoomId, eventId); return; }
      navigationIntent.current += 1; navigateShell({ ...shellRoute, roomId: effectiveRoomId, eventId, surface: 'conversation', panel: null }); }
  }, [effectiveRoomId, navigateShell, shellRoute]);
  const returnCurrentRoomToLive = useCallback(async () => {
    if (effectiveRoomId) {
      const intent = ++navigationIntent.current;
      await historyHandlers.current.onReturnToLive?.(effectiveRoomId);
      if (intent !== navigationIntent.current) return;
      navigateShell({ ...shellRoute, eventId: undefined }, { replace: true });
    }
  }, [effectiveRoomId, navigateShell, shellRoute]);
  const changeHistoryDetached = useCallback((detached: boolean) => {
    if (effectiveRoomId) historyHandlers.current.onHistoryDetached?.(effectiveRoomId, detached);
  }, [effectiveRoomId]);

  useEffect(() => {
    if (workspace.mode !== 'matrix' || !effectiveRoomId || !historyHandlers.current.onRoomSelected) return;
    let active = true;
    void historyHandlers.current.onRoomSelected(effectiveRoomId).catch(() => {
      if (active && currentHistoryRoom.current === effectiveRoomId) setNotice('Aimtrix could not open this room’s history. Try selecting the room again.');
    });
    return () => { active = false; };
  }, [effectiveRoomId, workspace.mode]);

  const markEffectiveRoomRead = useCallback((eventId: string): Promise<void> => {
    if (
      workspace.mode !== 'matrix' ||
      !effectiveRoomId ||
      pendingRouteContext ||
      (selectedHistory && selectedHistory.mode !== 'live') ||
      selectedHistory?.loading ||
      !onMarkRoomRead
    ) {
      return Promise.resolve();
    }
    return onMarkRoomRead(effectiveRoomId, { eventId });
  }, [effectiveRoomId, onMarkRoomRead, pendingRouteContext, selectedHistory, workspace.mode]);

  const unreadTotal = useMemo(
    () => workspace.rooms.reduce((total, room) => total + (room.badgeCount ?? room.unreadCount), 0),
    [workspace.rooms],
  );
  const availableStickerPacks = useMemo(
    () => mergeStickerPacks(config.stickerPacks, profilePersonalization.installedStickerPacks),
    [config.stickerPacks, profilePersonalization.installedStickerPacks],
  );
  const availableEmojiPacks = useMemo(
    () => selectEmojiPacks(config.emojiPacks),
    [config.emojiPacks],
  );

  const selectRoom = useCallback((roomId: string, spaceId = activeSpace, eventId?: string) => {
    navigationIntent.current += 1;
    setRecents((current) => [`room:${roomId}`, ...current.filter((key) => key !== `room:${roomId}`)].slice(0, 30));
    setActiveSpace(spaceId);
    setSelectedRoomId(roomId);
    navigateShell({ surface: 'conversation', roomId, spaceId, eventId, panel: contextDocked && shellRoute.panel === 'details' ? 'details' : null });
    setNotice(undefined);
    setActiveThreadRootId(undefined);
  }, [activeSpace, contextDocked, navigateShell, shellRoute.panel]);


  useEffect(() => {
    try {
      localStorage.setItem(locationKey, JSON.stringify({ roomId: selectedRoomId, spaceId: activeSpace }));
    } catch {
      // Remembering the last location is best-effort.
    }
  }, [locationKey, selectedRoomId, activeSpace]);

  useEffect(() => {
    if (workspace.mode === 'matrix') void onSpaceSelected?.(activeSpace).catch(() => undefined);
  }, [activeSpace, onSpaceSelected, workspace.mode]);

  const selectSpace = (spaceId: string) => {
    navigationIntent.current += 1;
    setRecents((current) => [`space:${spaceId}`, ...current.filter((key) => key !== `space:${spaceId}`)].slice(0, 30));
    const space = workspace.spaces.find((candidate) => candidate.id === spaceId);
    setActiveSpace(spaceId);
    setQuery('');
    if (space?.kind === 'home') { navigateShell({ surface: 'activity', panel: null, spaceId, roomId: selectedRoomId }); return; }
    navigateShell({ surface: 'list', spaceId, roomId: space?.roomIds.includes(selectedRoomId ?? '') ? selectedRoomId : space?.roomIds[0], panel: contextDocked && shellRoute.panel === 'details' ? 'details' : null });
    if (space && !space.roomIds.includes(selectedRoomId ?? '')) {
      setSelectedRoomId(space.roomIds.find((roomId) => workspace.rooms.some((room) => room.id === roomId)));
    }
  };

  useEffect(() => () => {
    if (typingTimer.current !== undefined) window.clearTimeout(typingTimer.current);
  }, []);

  const chooseDestination = (target: NavigationTarget) => {
    setPanelCollapsed('conversation', false);
    if (target.kind === 'space') selectSpace(target.id);
    else selectRoom(target.id, workspace.spaces.find((space) => space.roomIds.includes(target.id))?.id ?? activeSpace);
    // Let Dialog restore its opener, then hand focus to the chosen destination.
    // A later interaction or navigation always takes precedence.
    queueMicrotask(() => queueMicrotask(() => {
      const previous = document.activeElement;
      const intent = navigationIntent.current;
      requestAnimationFrame(() => {
        if (navigationIntent.current !== intent || document.activeElement !== previous || document.querySelector('dialog[open]')) return;
        const stage = appStage.current;
        const destination = target.kind === 'space'
          ? stage?.querySelector<HTMLElement>('.buddy-row--selected') ?? stage?.querySelector<HTMLElement>('.buddy-search input')
          : [...(stage?.querySelectorAll<HTMLElement>('[data-room-id]') ?? [])].find((element) => element.dataset.roomId === target.id)?.querySelector<HTMLElement>('[data-room-heading]');
        if (destination && !destination.closest('[hidden], [inert]')) destination.focus({ preventScroll: true });
      });
    }));
  };
  const goUnread = useCallback((direction: -1 | 1) => {
    const rooms = workspace.rooms.filter((room) => room.membership === 'join' && room.kind !== 'space');
    const current = rooms.findIndex((room) => room.id === effectiveRoomId);
    for (let step = 1; step <= rooms.length; step += 1) {
      const room = rooms[(current + direction * step + rooms.length * 2) % rooms.length];
      if (room.id !== effectiveRoomId && (room.badgeCount ?? room.unreadCount) > 0) {
        selectRoom(room.id, workspace.spaces.find((space) => space.roomIds.includes(room.id))?.id ?? activeSpace);
        return true;
      }
    }
    setNotice('No other unread conversations. You’re all caught up!');
    return false;
  }, [activeSpace, effectiveRoomId, selectRoom, workspace.rooms, workspace.spaces]);
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('dialog,[role="dialog"]')) return;
      const shortcut = getNavigationShortcut(event, navigator.platform);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'switcher') setNavigationDialog('switcher');
      else if (shortcut === 'help') setNavigationDialog('help');
      else if (!goUnread(shortcut === 'previous-unread' ? -1 : 1)) setNavigationDialog('switcher');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goUnread]);
  const openMatrixTarget = useCallback(async (target: MatrixNavigationTarget) => {
    const intent = ++navigationIntent.current;
    const result: { roomId: string; eventId?: string; threadRootId?: string } = onResolveNavigationTarget ? await onResolveNavigationTarget(target) : (() => {
      const room = workspace.rooms.find((candidate) => candidate.membership === 'join' && (target.roomId === candidate.id || target.roomAlias && target.roomAlias === candidate.canonicalAlias || target.userId && target.userId === candidate.directUserId));
      if (!room) throw new Error('This destination is not available in your joined conversations. Join the room or start a conversation first.');
      return { roomId: room.id, eventId: target.eventId };
    })();
    if (intent !== navigationIntent.current) return;
    if (result.threadRootId) {
      setThreadRequestId((value) => value + 1);
      const spaceId = workspace.spaces.find((space) => space.roomIds.includes(result.roomId))?.id ?? activeSpace;
      setActiveThreadRootId(result.threadRootId);
      setThreadCollapsed(false);
      navigateShell({ surface: 'context', panel: 'thread', roomId: result.roomId, spaceId,
        eventId: result.roomId === effectiveRoomId ? shellRoute.eventId : undefined,
        threadRootId: result.threadRootId, threadEventId: result.eventId });
      return;
    }
    if (shellRoute.surface !== 'activity' && result.roomId === effectiveRoomId && result.eventId && result.eventId === shellRoute.eventId) {
      await historyHandlers.current.onOpenEventContext?.(result.roomId, result.eventId);
      return;
    }
    selectRoom(result.roomId, workspace.spaces.find((space) => space.roomIds.includes(result.roomId))?.id ?? activeSpace, result.eventId);
  }, [activeSpace, effectiveRoomId, onResolveNavigationTarget, navigateShell, selectRoom, shellRoute.eventId, shellRoute.surface, workspace.rooms, workspace.spaces]);
  const matrixTargetHandler = useRef(openMatrixTarget);
  useLayoutEffect(() => { matrixTargetHandler.current = openMatrixTarget; });
  useEffect(() => {
    if (!pushRoute || pushRoute.roomAlias || pushRoute.userId || handledPushRoute.current === pushRoute) return;
    const eventRoomId = pushRoute.eventId && !pushRoute.roomId
      ? Object.entries(workspace.messagesByRoom).find(([, roomMessages]) => roomMessages.some((message) => message.id === pushRoute.eventId))?.[0]
        ?? Object.values(workspace.threadsByRoot).flatMap((thread) => thread.messages).find((message) => message.id === pushRoute.eventId)?.roomId
      : undefined;
    const roomId = pushRoute.roomId ?? eventRoomId;
    if (!roomId) {
      handledPushRoute.current = pushRoute;
      queueMicrotask(() => { setSettledIncomingRoute(pushRoute); setNotice('This notification does not include a room, and its message is not loaded. Open the conversation to find it.'); });
      return;
    }
    if (!workspace.rooms.some((room) => room.id === roomId)) {
      if (missingPushRoom.current !== pushRoute) {
        missingPushRoom.current = pushRoute;
        queueMicrotask(() => setNotice('The notification’s room is not available in this account yet.'));
      }
      return;
    }
    handledPushRoute.current = pushRoute;
    const targetSpace = workspace.spaces.find((space) => space.roomIds.includes(roomId));
    queueMicrotask(() => {
      if (handledPushRoute.current !== pushRoute) return;
      if (targetSpace && targetSpace.id !== activeSpace) {
        setActiveSpace(targetSpace.id);
      }
      if (pushRoute.eventId && onResolveNavigationTarget) {
        void matrixTargetHandler.current({ ...pushRoute, roomId }).catch(() => setNotice('This Matrix message is unavailable.')).finally(() => setSettledIncomingRoute(pushRoute));
      } else {
        selectRoom(roomId, targetSpace?.id ?? activeSpace, pushRoute.eventId);
        setSettledIncomingRoute(pushRoute);
      }

    });
  }, [activeSpace, onSpaceSelected, onResolveNavigationTarget, pushRoute, selectRoom, workspace.messagesByRoom, workspace.rooms, workspace.spaces, workspace.threadsByRoot]);

  useEffect(() => {
    if (!pushRoute || (!pushRoute.roomAlias && !pushRoute.userId) || handledPushRoute.current === pushRoute) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      handledPushRoute.current = pushRoute;
      void matrixTargetHandler.current(pushRoute).catch(() => {
        if (active) setNotice('This Matrix destination is not available. Use Open Matrix link to check access or start a conversation.');
      }).finally(() => { if (active) setSettledIncomingRoute(pushRoute); });
    });
    return () => { active = false; };
  }, [pushRoute]);
  const openMatrixLink = async (value: string) => {
    const target = parseMatrixLink(value);
    if (!target) throw new Error('Enter a complete Matrix room, message, or person link.');
    await openMatrixTarget(target);
  };
  const toggleFavorite = async () => {
    if (!selectedRoom || favoritePending.has(selectedRoom.id)) return;
    const roomId = selectedRoom.id;
    const favorite = !selectedRoom.favorite;
    setFavoritePending((current) => new Set([...current, roomId]));
    try {
      if (workspace.mode === 'demo') setRoomOverrides((current) => ({ ...current, [roomId]: { ...current[roomId], favorite } }));
      else if (onSetRoomFavorite) await onSetRoomFavorite(roomId, favorite);
      if (currentHistoryRoom.current === roomId) setNotice(workspace.mode === 'demo' ? (favorite ? 'Favorite saved for this demo.' : 'Favorite removed for this demo.') : favorite ? 'Favorite saved. Your room list will update when it syncs.' : 'Favorite removed. Your room list will update when it syncs.');
    } catch { if (currentHistoryRoom.current === roomId) setNotice('Could not update your favorite. Try the star again.'); }
    finally { setFavoritePending((current) => { const next = new Set(current); next.delete(roomId); return next; }); }
  };

  const [attachmentActions] = useState(() => new Map([['current', { onUploadAttachment, onCancelUpload, draftsState, workspace }]]));
  useLayoutEffect(() => { attachmentActions.set('current', { onUploadAttachment, onCancelUpload, draftsState, workspace }); });
  const [demoAttachmentUrls] = useState(() => new Set<string>());
  const [attachmentQueue] = useState(() => new StagedAttachments({
    maxBytes: config.media.maxUploadBytes,
    send: async (context, file, progress, codeLanguage, options) => {
      const actions = attachmentActions.get('current')!;
      if (!actions.draftsState.isActive()) throw new Error('This draft account is no longer active.');
      if (actions.workspace.mode === 'matrix') {
        if (!actions.onUploadAttachment) throw new Error('Attachment sending is unavailable.');
        await actions.onUploadAttachment(context.roomId, file, progress, context.threadRootId, codeLanguage, options);
      } else {
        options.onPhase?.('uploading');
        const mediaUrl = URL.createObjectURL(file); demoAttachmentUrls.add(mediaUrl);
        const message: MessageSummary = { id: `demo-file-${crypto.randomUUID()}`, roomId: context.roomId, threadRootId: context.threadRootId,
          senderId: actions.workspace.user.id, senderName: actions.workspace.user.displayName, body: options.caption || file.name, fileName: file.name,
          timestamp: Date.now(), kind: 'media', mediaKind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file',
          mediaUrl, mimeType: file.type, codeFile: Boolean(codeLanguage), codeLanguage, isOwn: true };
        if (context.threadRootId) setDemoThreadMessages((current) => ({ ...current, [context.threadRootId!]: [...(current[context.threadRootId!] ?? []), message] }));
        else setDemoMessages((current) => ({ ...current, [context.roomId]: [...(current[context.roomId] ?? []), message] }));
        progress(file.size, file.size);
      }
    },
    cancel: (id) => attachmentActions.get('current')!.onCancelUpload?.(id),
    persist: (context, attachments) => {
      const state = attachmentActions.get('current')!.draftsState;
      if (state.isActive()) state.update(context, { ...state.get(context), attachments });
    },
  }));
  const restoredAttachmentIds = useRef(new Set<string>());
  useEffect(() => {
    if (!draftsState.active) { attachmentQueue.clear(); restoredAttachmentIds.current.clear(); return; }
    for (const record of draftsState.list) {
      const descriptors = (record.value.attachments ?? []).filter((item) => !restoredAttachmentIds.current.has(item.id));
      if (descriptors.length) { for (const item of descriptors) restoredAttachmentIds.current.add(item.id); attachmentQueue.restore(record.context, descriptors); }
    }
  }, [attachmentQueue, draftsState.active, draftsState.list]);
  useEffect(() => () => { attachmentQueue.clear(); for (const url of demoAttachmentUrls) URL.revokeObjectURL(url); }, [attachmentQueue, demoAttachmentUrls]);
  const hasSavedDrafts = draftsState.list.length > 0;
  const hasStagedFiles = draftsState.list.some((record) => Boolean(record.value.attachments?.length));
  const filesSending = draftsState.list.some((record) => attachmentQueue.list(record.context).some((item) => ['queued', 'encrypting', 'uploading', 'sending'].includes(item.phase)));
  const draftsVolatile = draftsState.status.mode === 'volatile' || Boolean(draftsState.writeIssue);
  const anySending = Object.values(mediaSends).some(Boolean) || sendingContexts.size > 0 || filesSending;
  useEffect(() => { onDraftStateChange?.({ hasDrafts: hasSavedDrafts, volatile: draftsVolatile, hasAttachments: hasStagedFiles, sending: anySending }); }, [onDraftStateChange, hasSavedDrafts, draftsVolatile, hasStagedFiles, anySending]);
  const stageFiles = (files: File[], threadRootId?: string, codeLanguage?: string) => {
    if (!effectiveRoomId || !draftsState.isActive()) return;
    const errors = attachmentQueue.stage({ roomId: effectiveRoomId, ...(threadRootId ? { threadRootId } : {}) }, files, codeLanguage);
    if (errors.length) setNotice(errors.join(' '));
  };

  const sendGif = async (gif: GifChoice, threadRootId?: string) => {
    if (!effectiveRoomId || !draftsState.isActive()) throw new Error('This conversation is unavailable.');
    const mediaKey = JSON.stringify({ roomId: effectiveRoomId, threadRootId });
    setMediaSends((current) => ({ ...current, [mediaKey]: (current[mediaKey] ?? 0) + 1 }));
    try {
      if (workspace.mode === 'matrix') {
        if (!onSendGif) throw new Error('GIF sending is unavailable.');
        await onSendGif(effectiveRoomId, gif, threadRootId);
      } else {
        const message: MessageSummary = {
          id: `demo-gif-${Date.now()}`,
          roomId: effectiveRoomId,
          threadRootId,
          senderId: workspace.user.id,
          senderName: workspace.user.displayName,
          body: gif.title,
          timestamp: Date.now(),
          kind: 'media',
          mediaKind: 'image',
          mediaUrl: gif.mediaUrl,
          isOwn: true,
        };
        if (threadRootId) setDemoThreadMessages((current) => ({ ...current, [threadRootId]: [...(current[threadRootId] ?? []), message] }));
        else setDemoMessages((current) => ({ ...current, [effectiveRoomId]: [...(current[effectiveRoomId] ?? []), message] }));
      }
    } finally {
      setMediaSends((current) => ({ ...current, [mediaKey]: Math.max(0, (current[mediaKey] ?? 1) - 1) }));
    }
  };

  const sendSticker = async (sticker: { id: string; name: string; src: string }, threadRootId?: string) => {
    if (!effectiveRoomId || !draftsState.isActive()) throw new Error('This conversation is unavailable.');
    const mediaKey = JSON.stringify({ roomId: effectiveRoomId, threadRootId });
    setMediaSends((current) => ({ ...current, [mediaKey]: (current[mediaKey] ?? 0) + 1 }));
    try {
      if (workspace.mode === 'demo') {
        const message: MessageSummary = {
          id: `demo-sticker-${Date.now()}`,
          roomId: effectiveRoomId,
          threadRootId,
          senderId: workspace.user.id,
          senderName: workspace.user.displayName,
          senderAvatarUrl: workspace.user.avatarUrl,
          body: sticker.name,
          timestamp: Date.now(),
          kind: 'sticker',
          mediaUrl: sticker.src,
          isOwn: true,
        };
        if (threadRootId) setDemoThreadMessages((current) => ({ ...current, [threadRootId]: [...(current[threadRootId] ?? []), message] }));
        else setDemoMessages((current) => ({ ...current, [effectiveRoomId]: [...(current[effectiveRoomId] ?? []), message] }));
      } else {
        if (!onSendSticker) throw new Error('Sticker sending is unavailable.');
        await onSendSticker(effectiveRoomId, sticker, threadRootId);
      }
      return true;
    } finally {
      setMediaSends((current) => ({ ...current, [mediaKey]: Math.max(0, (current[mediaKey] ?? 1) - 1) }));
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

  const replyDescriptor = (message: MessageSummary, threadRootId?: string) => ({ id: message.id, senderId: message.senderId, senderName: message.senderName, body: message.body, ...(threadRootId ? { threadRootId } : {}) });
  const handleStartReply = (message: MessageSummary, sourceThreadRootId?: string) => {
    const threadRootId = sourceThreadRootId ?? message.threadRootId;
    const context: DraftContext = { roomId: message.roomId, ...(threadRootId ? { threadRootId } : {}) };
    const previous = draftsState.get(context);
    draftsState.update(context, { ...(previous.edit?.originalDraft ?? previous), edit: undefined, reply: replyDescriptor(message, threadRootId) });
    if (threadRootId) openPanel('thread', threadRootId); else if (!conversationVisible) closePanel();
  };
  const handleStartThread = (message: MessageSummary) => {
    const rootId = message.threadRootId ?? message.id;
    setActiveThreadRootId(rootId); setThreadCollapsed(false); openPanel('thread', rootId);
  };
  const startCompositionEdit = (message: MessageSummary, threadRootId?: string) => {
    const context: DraftContext = { roomId: message.roomId, ...(threadRootId ? { threadRootId } : {}) };
    const previous = draftsState.get(context);
    const mentions = message.mentions?.map((mention) => ({ userId: mention.userId, label: mention.label.replace(/^@/, '') }));
    draftsState.update(context, { body: message.body, mentions, attachments: previous.attachments,
      edit: { id: message.id, body: message.body, mentions, originalDraft: previous.edit?.originalDraft ?? previous } });
  };
  const handleStartEdit = (message: MessageSummary) => startCompositionEdit(message);
  const handleStartThreadEdit = (message: MessageSummary) => { if (activeThreadRootId) startCompositionEdit(message, activeThreadRootId); };
  const cancelCompositionContext = (context: DraftContext) => {
    const previous = draftsState.get(context);
    draftsState.update(context, previous.edit?.originalDraft ?? { ...previous, reply: undefined, edit: undefined });
  };

  const handleTogglePin = useCallback(async (message: MessageSummary) => {
    if (workspace.mode === 'matrix') {
      if (!onTogglePinnedMessage) throw new Error('Pinning is unavailable.');
      await onTogglePinnedMessage(message.roomId, message.id, !message.pinned);
    } else setDemoMessageOverrides((current) => ({ ...current, [message.id]: { ...current[message.id], pinned: !message.pinned } }));
  }, [workspace.mode, onTogglePinnedMessage]);

  const handleDeleteMessage = useCallback((message: MessageSummary) => { setDeleteTarget(message); }, []);

  const handleReact = useCallback(async (message: MessageSummary, key: string, ownReactionEventId?: string) => {
    if (workspace.mode === 'matrix') {
      if (!onToggleReaction) throw new Error('Reactions are unavailable.');
      await onToggleReaction(message.roomId, message.id, key, ownReactionEventId);
    } else setDemoMessageOverrides((current) => {
      const reactions = [...(current[message.id]?.reactions ?? message.reactions ?? [])];
      const previous = reactions.find((item) => item.key === key);
      const next = previous ? { ...previous, reacted: !previous.reacted, count: previous.count + (previous.reacted ? -1 : 1) } : { key, count: 1, reacted: true };
      return { ...current, [message.id]: { ...current[message.id], reactions: [...reactions.filter((item) => item.key !== key), next].filter((item) => item.count > 0) } };
    });
  }, [workspace.mode, onToggleReaction]);

  const applyPreferences = (nextPreferences: UserPreferences) => {
    if (nextPreferences.detailsOpenByDefault !== preferences.detailsOpenByDefault && shellRoute.surface !== 'context') {
      navigateShell({ ...shellRoute, panel: nextPreferences.detailsOpenByDefault ? 'details' : null }, { replace: true });
    }
    onPreferencesChange(nextPreferences);
  };

  const submitComposition = async (context: DraftContext, bodyOverride?: string, mentions: ComposerMention[] = [], inlineEmojis: ComposerInlineEmoji[] = []): Promise<ComposerSubmitResult> => {
    const submitted = draftsState.capture(context);
    const body = (bodyOverride ?? submitted.value.body).trim();
    const key = JSON.stringify(context);
    if (!body || !draftsState.isActive() || sendsInFlight.current.has(key)) return false;
    sendsInFlight.current.add(key);
    const navigation = composerNavigation.current;
    const setPending = (pending: boolean) => setSendingContexts((current) => { const next = new Set(current); if (pending) next.add(key); else next.delete(key); return next; });
    setPending(true); setNotice(undefined);
    const edit = submitted.value.edit, reply = submitted.value.reply;
    const finish = () => draftsState.finish(submitted, edit?.originalDraft);
    try {
      if (workspace.mode === 'demo') {
        if (edit) setDemoMessageOverrides((current) => ({ ...current, [edit.id]: { ...current[edit.id], body, edited: true, mentions, mentionUserIds: mentions.map((mention) => mention.userId) } }));
        const apply = (current: Record<string, MessageSummary[]>, id: string) => ({ ...current, [id]: edit
          ? current[id] ?? []
          : [...(current[id] ?? []), { id: `demo-${crypto.randomUUID()}`, roomId: context.roomId, threadRootId: context.threadRootId,
            senderId: workspace.user.id, senderName: workspace.user.displayName, senderAvatarUrl: workspace.user.avatarUrl,
            body, timestamp: Date.now(), kind: 'text' as const, isOwn: true, mentions, mentionUserIds: mentions.map((mention) => mention.userId),
            ...(reply ? { replyTo: { eventId: reply.id, senderName: reply.senderName, body: reply.body } } : {}) }] });
        if (context.threadRootId) setDemoThreadMessages((current) => apply(current, context.threadRootId!)); else setDemoMessages((current) => apply(current, context.roomId));
      } else if (edit) {
        if (!onEditMessage) throw new Error('Editing is unavailable.');
        if (inlineEmojis.length) await onEditMessage(context.roomId, edit.id, body, mentions, inlineEmojis); else await onEditMessage(context.roomId, edit.id, body, mentions);
      } else if (reply) {
        if (!onSendReply) throw new Error('Replies are unavailable.');
        const target = { id: reply.id, senderId: reply.senderId, body: reply.body, threadRootId: context.threadRootId ?? reply.threadRootId };
        if (inlineEmojis.length) await onSendReply(context.roomId, body, target, mentions, inlineEmojis); else await onSendReply(context.roomId, body, target, mentions);
      } else if (context.threadRootId) {
        if (onSendThreadMessage) {
          if (inlineEmojis.length) await onSendThreadMessage(context.roomId, context.threadRootId, body, mentions, inlineEmojis); else await onSendThreadMessage(context.roomId, context.threadRootId, body, mentions);
        } else if (onSendReply && activeThreadRoot) {
          const target = { id: context.threadRootId, senderId: activeThreadRoot.senderId, body: activeThreadRoot.body, threadRootId: context.threadRootId };
          if (inlineEmojis.length) await onSendReply(context.roomId, body, target, mentions, inlineEmojis); else await onSendReply(context.roomId, body, target, mentions);
        }
        else throw new Error('Thread replies are unavailable.');
      } else {
        if (!onSendMessage) throw new Error('Sending is unavailable.');
        if (inlineEmojis.length) await onSendMessage(context.roomId, body, mentions, inlineEmojis); else if (mentions.length) await onSendMessage(context.roomId, body, mentions); else await onSendMessage(context.roomId, body);
      }
      const cleared = finish();
      if (cleared && !context.threadRootId && preferences.sendTypingNotifications) void onSendTyping?.(context.roomId, false);
      return cleared ? edit ? 'edited' : 'sent' : false;
    } catch (error) {
      const retained = error instanceof MessageSendError && error.localEchoRetained;
      const cleared = retained && finish();
      if (composerNavigation.current === navigation) setNotice(retained ? 'That message did not send. Use Retry on the failed message. Any newer draft stays here.' : 'That message did not send. Your draft is still here.');
      return cleared ? 'retained' : false;
    } finally { sendsInFlight.current.delete(key); setPending(false); }
  };
  const submitMessage = (body?: string, mentions?: ComposerMention[], inlineEmojis?: ComposerInlineEmoji[]) => effectiveRoomId
    ? submitComposition({ roomId: effectiveRoomId }, body, mentions, inlineEmojis) : Promise.resolve(false as const);
  const submitThreadMessage = (body?: string, mentions?: ComposerMention[], inlineEmojis?: ComposerInlineEmoji[]) => effectiveRoomId && activeThreadRootId
    ? submitComposition({ roomId: effectiveRoomId, threadRootId: activeThreadRootId }, body, mentions, inlineEmojis) : Promise.resolve(false as const);

  const setPanelCollapsed = (panel: WorkspacePanelId, collapsed: boolean) => {
    setCollapsedPanels((current) => {
      const next = { ...current, [panel]: collapsed };
      try { localStorage.setItem('aimtrix.workspace-panels.v1', JSON.stringify(next)); } catch { /* best-effort */ }
      return next;
    });
  };

  const startPanelResize = (panel: 'buddies' | 'details', event: PointerEvent<HTMLDivElement>) => {
    panelResizeStart.current = { panel, x: event.clientX, width: panelWidths[panel] };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const setPanelWidth = (panel: 'buddies' | 'details', width: number) => {
    const minimum = panel === 'buddies' ? 220 : 260;
    const maximum = panel === 'buddies' ? Math.min(520, shellWidth - 66 - 16 - 420 - (contextPanel ? 260 : 0)) : contextMaximum;
    const next = Math.max(minimum, Math.min(maximum, width));
    if (panel === 'buddies') setPanelCollapsed(panel, false);
    setPanelWidths((current) => {
      const updated = { ...current, [panel]: next };
      try { localStorage.setItem('aimtrix.workspace-panel-widths.v1', JSON.stringify(updated)); } catch { /* best-effort */ }
      return updated;
    });
  };

  const resizePanel = (event: PointerEvent<HTMLDivElement>) => {
    const start = panelResizeStart.current;
    if (!start) return;
    const minimum = start.panel === 'buddies' ? 220 : 260;
    const maximum = start.panel === 'buddies' ? 520 : 560;
    const delta = event.clientX - start.x;
    const width = Math.max(0, Math.min(maximum, start.width + (start.panel === 'details' ? -delta : delta)));
    if (start.panel === 'buddies' && width < minimum - 48) {
      setPanelCollapsed(start.panel, true);
      return;
    }
    setPanelWidth(start.panel, width);
  };

  const stopPanelResize = (event?: PointerEvent<HTMLDivElement>) => {
    const start = panelResizeStart.current;
    if (start && event) {
      const minimum = start.panel === 'buddies' ? 220 : 260;
      if (start.panel === 'buddies' && start.width + event.clientX - start.x < minimum - 48) setPanelCollapsed(start.panel, true);
    }
    panelResizeStart.current = undefined;
  };

  useEffect(() => {
    const viewport = window.visualViewport;
    const syncViewportHeight = () => {
      const height = viewport?.height ?? window.innerHeight;
      appStage.current?.style.setProperty('--aimtrix-viewport-height', `${Math.round(height)}px`);
    };
    syncViewportHeight();
    viewport?.addEventListener('resize', syncViewportHeight);
    viewport?.addEventListener('scroll', syncViewportHeight);
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', syncViewportHeight);
    return () => {
      viewport?.removeEventListener('resize', syncViewportHeight);
      viewport?.removeEventListener('scroll', syncViewportHeight);
      window.removeEventListener('resize', syncViewportHeight);
      window.removeEventListener('orientationchange', syncViewportHeight);
    };
  }, []);

  return (
    <div ref={appStage} onClickCapture={(event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a');
      if (!anchor) return;
      const value = anchor.getAttribute('href') ?? '';
      let matrixLink = value.toLowerCase().startsWith('matrix:');
      try { matrixLink ||= new URL(value).hostname === 'matrix.to'; } catch { /* Other links use ordinary browser navigation. */ }
      if (!matrixLink) return;
      event.preventDefault();
      void openMatrixLink(value).catch(() => { setNotice('This Matrix link could not be opened. Use Open Matrix link in the quick switcher to check access or start a conversation.'); });
    }} className={`app-stage${mobileChatOpen ? ' mobile-chat-open' : ''}${contextPanel ? ' context-open' : ''}`} onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented && contextPanel && !(event.target as HTMLElement).closest('dialog,[role=dialog]')) { event.preventDefault(); closePanel(); } }}>
      {draftListOpen ? <DraftList durable={!draftsVolatile} drafts={draftsState.list} rooms={workspace.rooms} onClose={() => setDraftListOpen(false)} onOpen={(context) => {
        setDraftListOpen(false);
        const space = workspace.spaces.find((candidate) => candidate.roomIds.includes(context.roomId));
        selectRoom(context.roomId, space?.id ?? activeSpace);
        if (context.threadRootId) {
          setActiveThreadRootId(context.threadRootId); setThreadCollapsed(false);
          navigateShell({ spaceId: space?.id ?? activeSpace, roomId: context.roomId, surface: 'context', panel: 'thread', threadRootId: context.threadRootId });
        }
      }} /> : null}
      {navigationDialog === 'switcher' ? <QuickSwitcher workspace={{ ...workspace, rooms: workspace.rooms.map((room) => ({ ...room, ...roomOverrides[room.id] })) }} recents={recents} onSelect={chooseDestination} onClose={() => setNavigationDialog(undefined)}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12 }}>
          <button className="aqua-button" style={{ minHeight: 44 }} type="button" disabled={!canGoBack} onClick={() => { setNavigationDialog(undefined); shellBack(); }}><ArrowLeft size={14} /> Back</button>
          <button className="aqua-button" style={{ minHeight: 44 }} type="button" disabled={!canGoForward} onClick={() => { setNavigationDialog(undefined); shellForward(); }}><ArrowRight size={14} /> Forward</button>
          <button className="aqua-button" style={{ minHeight: 44 }} type="button" onClick={() => { if (goUnread(1)) setNavigationDialog(undefined); }}>Next unread</button>
          <button className="aqua-button" style={{ minHeight: 44 }} type="button" onClick={() => setNavigationDialog('link')}>Open Matrix link</button>
          <button className="aqua-button" style={{ minHeight: 44 }} type="button" onClick={() => setNavigationDialog('help')}>Keyboard shortcuts</button>
          {notice === 'No other unread conversations. You’re all caught up!' ? <p role="status" style={{ margin: 0 }}>{notice}</p> : null}
        </div>
      </QuickSwitcher> : navigationDialog ? <NavigationDialogs kind={navigationDialog} onClose={() => setNavigationDialog(undefined)} onOpenLink={openMatrixLink} onStartConversation={onCreateDirectRoom ? async (userId) => { const id = await onCreateDirectRoom(userId); selectRoom(id, workspace.spaces.find((space) => space.kind === 'home')?.id ?? activeSpace); } : undefined} /> : null}
      <section className={`aimtrix-window${connectionNotice || structuredDraftStore || draftsState.list.length ? ' has-connection-notice' : ''}${detailsOpen ? ' details-open' : ''}${nudgeActive ? ' is-nudging' : ''}`}>
        <header className="app-titlebar">
          <button className="icon-button" type="button" aria-label="Home activity" title="Home activity" style={{ minWidth: 44, minHeight: 44 }} onClick={() => { setPanelCollapsed('conversation', false); navigateShell({ surface: 'activity', panel: null, spaceId: workspace.spaces.find((space) => space.kind === 'home')?.id, roomId: selectedRoomId }); }}><Sparkles size={18} /></button>
          <button className="icon-button" type="button" aria-label="Quick switcher" title="Quick switcher" style={{ minWidth: 44, minHeight: 44 }} onClick={() => setNavigationDialog('switcher')}><Search size={18} /></button>
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

        {(connectionNotice || structuredDraftStore || draftsState.list.length > 0) ? <div className="workspace-notices">{connectionNotice}
        {(structuredDraftStore || draftsState.list.length > 0) ? <div className="session-connection-banner" role="status">
          <button className="aqua-button" type="button" onClick={() => setDraftListOpen(true)}>Drafts ({draftsState.list.length})</button>
          <span>{!draftsState.active ? 'Draft access ended. Sign in again to continue.' : draftsState.writeIssue === 'conflict' ? 'Another tab changed this draft. Your unsaved version stays in this tab.' : draftsState.writeIssue ? 'This draft could not be saved. Your text stays in this tab.' : draftsState.status.mode === 'persistent' ? 'Drafts saved on this device.' : 'Drafts stay in this tab. Reloading or closing it can lose changes.'}</span>
        </div> : null}
        </div> : null}
        <div
          className={`workspace-grid${collapsedPanels.conversation ? ' workspace-grid--conversation-collapsed' : ''}`}
          style={{
            gridTemplateColumns: `66px 0px ${collapsedPanels.buddies ? '48px' : `${buddyWidth}px`} ${collapsedPanels.buddies ? '0px' : '8px'} ${collapsedPanels.conversation && !showingHome ? '48px' : 'minmax(420px, 1fr)'} 0px 0px ${contextPanel ? '8px' : '0px'} ${contextPanel ? `${contextWidth}px` : '0px'}`,
          }}
        >
          <SpaceRail
            workspace={workspace}
            activeSpace={activeSpaceSummary?.id ?? 'home'}
            onSelect={selectSpace}
            onReorder={onReorderRootSpaces}
          />
          {collapsedPanels.buddies ? <button className="workspace-collapsed-panel workspace-collapsed-panel--buddies" type="button" aria-label="Expand rooms" title="Expand rooms" onClick={() => setPanelCollapsed('buddies', false)}><Users size={18} /></button> : <BuddyPanel
            workspace={scopedWorkspace}
            draftRoomIds={new Set(draftsState.list.map((record) => record.context.roomId))}
            selectedRoomId={effectiveRoomId}
            scopeName={activeSpaceSummary?.name ?? 'Conversations'}
            scopeSpace={activeSpaceSummary}
            query={query}
            onQueryChange={setQuery}
            filter={conversationFilter}
            onFilterChange={setConversationFilter}
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
          />}
          {!collapsedPanels.buddies ? <div className="workspace-panel-resize workspace-panel-resize--buddies" role="separator" aria-label="Resize rooms and conversation" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={520} aria-valuenow={Math.round(buddyWidth)} tabIndex={0} onPointerDown={(event) => startPanelResize('buddies', event)} onPointerMove={resizePanel} onPointerUp={stopPanelResize} onPointerCancel={stopPanelResize} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); setPanelWidth('buddies', buddyWidth - 24); } if (event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth('buddies', buddyWidth + 24); } if (event.key === 'Home') { event.preventDefault(); setPanelWidth('buddies', 220); } if (event.key === 'End') { event.preventDefault(); setPanelWidth('buddies', 520); } }} /> : null}
          {showingHome ? <Suspense fallback={<main style={{ gridColumn: '5 / span 3' }} role="status">Loading Home…</main>}><HomeActivity workspace={workspace} activity={workspace.activity} actions={activityActions} position={homePosition} onPosition={updateHomePosition} onOpen={openMatrixTarget} onBack={shellBack} onSettings={() => setSettingsOpen(true)} onDrafts={() => setDraftListOpen(true)} draftCount={draftsState.list.length} onMarkRead={onMarkRoomRead ? (roomId) => onMarkRoomRead(roomId, { explicit: true }) : undefined} /></Suspense> : <Conversation
            threadAttentionActions={threadAttentionActions}
            contextHost={contextHost}
            contextPanel={contextPanel}
            conversationVisible={conversationVisible && (!contextDocked || !collapsedPanels.conversation)}
            contextWidth={contextWidth}
            contextMaximum={contextMaximum}
            onContextResize={(width) => setPanelWidth('details', width)}
            onSearch={() => contextPanel === 'search' ? closePanel() : openPanel('search')}
            onCloseContext={closePanel}
            onRevealConversation={() => { suppressContextReturnFocus.current = true; closePanel(); }}
            room={selectedRoom}
            history={selectedHistory}
            navigationEntry={restoration.entryId}
            navigationReading={restoration.reading}
            navigationPending={pendingRouteContext}
            onRememberReading={rememberReading}
            onNavigationLive={() => navigateShell({ ...shellRoute, eventId: undefined }, { replace: true })}
            onToggleFavorite={selectedRoom?.membership === 'join' && (workspace.mode === 'demo' || onSetRoomFavorite) ? () => { void toggleFavorite(); } : undefined}
            favoritePending={Boolean(effectiveRoomId && favoritePending.has(effectiveRoomId))}
            members={effectiveMembersByRoom[effectiveRoomId ?? ''] ?? []}
            messages={messages}
            activeThread={activeThread ?? (activeThreadRootId ? { rootId: activeThreadRootId, roomId: effectiveRoomId, rootStatus: 'loading', replyCount: 0, messages: [] } : undefined)}
            threadRoot={activeThreadRoot}
            threadEntry={shellEntry}
            threadReading={shellThreadReading}
            threadEventId={shellRoute.threadEventId}
            threadRequestId={threadRequestId}
            onRememberThreadReading={rememberThreadReading}
            onOpenThreadHistory={onThreadSelected && effectiveRoomId && activeThreadRootId ? (eventId) => onThreadSelected(effectiveRoomId, activeThreadRootId, eventId) : undefined}
            onPageThreadHistory={onLoadThreadHistory && effectiveRoomId && activeThreadRootId ? (direction) => onLoadThreadHistory(effectiveRoomId, activeThreadRootId, direction) : undefined}
            onLatestThread={onReturnThreadToLive && effectiveRoomId && activeThreadRootId ? () => onReturnThreadToLive(effectiveRoomId, activeThreadRootId) : undefined}
            onThreadDetached={onThreadHistoryDetached && effectiveRoomId && activeThreadRootId ? (detached) => onThreadHistoryDetached(effectiveRoomId, activeThreadRootId, detached) : undefined}
            onCloseThreadHistory={onCloseThreadHistory}
            onThreadContext={(eventId) => openPanel('thread', activeThreadRootId, eventId)}
            threadCollapsed={threadCollapsed}
            composition={composition}
            threadComposition={threadComposition}
            attachmentQueue={attachmentQueue}
            onStageFiles={stageFiles}
            sending={Boolean(mediaSends[JSON.stringify({ roomId: effectiveRoomId })]) || sendingContexts.has(JSON.stringify({ roomId: effectiveRoomId }))}
            threadSending={Boolean(mediaSends[JSON.stringify({ roomId: effectiveRoomId, threadRootId: activeThreadRootId })]) || sendingContexts.has(JSON.stringify({ roomId: effectiveRoomId, threadRootId: activeThreadRootId }))}
            notice={notice}
            onBack={shellBack}
            editingMessage={editingMessage}
            editingThreadMessage={editingThreadMessage}
            onCompositionChange={(next) => {
              if (!effectiveRoomId) return;
              draftsState.update({ roomId: effectiveRoomId }, next);
              if (workspace.mode === 'matrix' && preferences.sendTypingNotifications) {
                const now = Date.now();
                if (next.body && now - lastTypingSentAt.current > 4000) { lastTypingSentAt.current = now; void onSendTyping?.(effectiveRoomId, true); }
                else if (!next.body) { lastTypingSentAt.current = 0; void onSendTyping?.(effectiveRoomId, false); }
                if (typingTimer.current !== undefined) window.clearTimeout(typingTimer.current);
                typingTimer.current = window.setTimeout(() => { lastTypingSentAt.current = 0; void onSendTyping?.(effectiveRoomId, false); }, 5000);
              }
            }}
            onThreadCompositionChange={(next) => { if (effectiveRoomId && activeThreadRootId) draftsState.update({ roomId: effectiveRoomId, threadRootId: activeThreadRootId }, next); }}
            onSubmit={submitMessage}
            onThreadSubmit={submitThreadMessage}
            onToggleDetails={() => detailsOpen ? closePanel() : openPanel('details')}
            onCollapseConversation={() => setPanelCollapsed('conversation', true)}
            onOpenBackground={() => setBackgroundDialogOpen(true)}
            onStartReply={handleStartReply}
            onStartThread={handleStartThread}
            onOpenThread={(message) => {
              setActiveThreadRootId(message.threadRootId ?? message.id);
              openPanel('thread', message.threadRootId ?? message.id);
              setThreadCollapsed(false);
            }}
            onCloseThread={closePanel}
            onToggleThreadCollapsed={() => { setThreadCollapsed((collapsed) => !collapsed); if (threadCollapsed) openPanel('thread', activeThreadRootId); else closePanel(); }}
            onStartEdit={handleStartEdit}
            onStartThreadEdit={handleStartThreadEdit}
            onTogglePin={handleTogglePin}
            onDeleteMessage={handleDeleteMessage}
            onRetryMessage={onRetryMessage}
            onCancelMessage={onCancelMessage}
            onCancelContext={() => { if (effectiveRoomId) cancelCompositionContext({ roomId: effectiveRoomId }); }}
            onCancelThreadEdit={() => { if (effectiveRoomId && activeThreadRootId) cancelCompositionContext({ roomId: effectiveRoomId, threadRootId: activeThreadRootId }); }}
            onReact={handleReact}
            emojiPacks={availableEmojiPacks}
            emojiAssetBaseUrl={config.emojiPacks.assetBaseUrl}
            onSendSticker={sendSticker}
            onLoadMore={onLoadRoomHistory ? paginateCurrentRoom : undefined}
            onOpenContext={onOpenEventContext ? openCurrentEventContext : undefined}
            onReturnToLive={onReturnToLive ? returnCurrentRoomToLive : undefined}
            onDetachedChange={onHistoryDetached ? changeHistoryDetached : undefined}
            onReadLatest={pendingRouteContext ? undefined : markEffectiveRoomRead}
            onReadThread={workspace.mode === 'matrix' && onMarkThreadRead && effectiveRoomId && activeThreadRootId ? (eventId) => onMarkThreadRead(effectiveRoomId, activeThreadRootId, { eventId }) : undefined}
            onMarkUnread={workspace.mode === 'matrix' && onMarkRoomUnread && effectiveRoomId ? (eventId) => onMarkRoomUnread(effectiveRoomId, eventId) : undefined}
            onMarkRead={workspace.mode === 'matrix' && onMarkRoomRead && effectiveRoomId ? (eventId) => onMarkRoomRead(effectiveRoomId, { eventId, explicit: true }) : undefined}
            onSendNudge={onSendNudge ? () => {
              if (!effectiveRoomId || !onSendNudge) return;
              if (Date.now() - lastNudgeSentAt.current < 5_000) {
                setNotice('Please wait a few seconds before sending another nudge.');
                return;
              }
              lastNudgeSentAt.current = Date.now();
              return onSendNudge(effectiveRoomId);
            } : undefined}
            gifEndpoint={config.features.gifs ? config.gifProvider?.searchEndpoint : undefined}
            stickerPacks={availableStickerPacks}
            defaultStickerPack={profilePersonalization.defaultStickerPack}
            onSendGif={(gif, threadRootId) => sendGif(gif, threadRootId)}
            callsEnabled={config.features.calls}
            onStartCall={(video) => {
              if (selectedRoom) void onStartCall?.(selectedRoom.id, video);
            }}
            dataSaver={preferences.dataSaver}
            autoplayMedia={preferences.autoplayMedia}
            onLoadLinkPreview={onLoadLinkPreview}
          />}
          {!showingHome && collapsedPanels.conversation ? <button className="workspace-collapsed-panel workspace-collapsed-panel--conversation" type="button" aria-label="Expand conversation" title="Expand conversation" onClick={() => setPanelCollapsed('conversation', false)}><MessageCircle size={18} /></button> : null}
          {contextPanel ? <div className="workspace-panel-resize workspace-panel-resize--details" role="separator" aria-label="Resize conversation and details" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={contextMaximum} aria-valuenow={Math.round(contextWidth)} tabIndex={0} onPointerDown={(event) => startPanelResize('details', event)} onPointerMove={resizePanel} onPointerUp={stopPanelResize} onPointerCancel={stopPanelResize} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); setPanelWidth('details', contextWidth + 24); } if (event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth('details', contextWidth - 24); } if (event.key === 'Home') { event.preventDefault(); setPanelWidth('details', 260); } if (event.key === 'End') { event.preventDefault(); setPanelWidth('details', 560); } }} /> : null}
          <div ref={setContextHost} className="context-panel" hidden={!contextPanel} role={contextDocked ? undefined : 'main'} aria-label={contextDocked ? undefined : 'Conversation context'}>
            <div hidden={!detailsOpen} inert={!detailsOpen} className="details-surface">
            <header className="thread-panel__header"><strong tabIndex={-1} data-panel-heading>Room details</strong><button type="button" aria-label="Close room details" onClick={closePanel}><ArrowLeft size={16} /> Back</button></header>
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
            </div>
          </div>
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
            onComplete={setNotice}
            onClose={() => setRoomDialogOpen(false)}
          />
        ) : null}

        {backgroundDialogOpen && selectedRoomConfigured ? (
          <Dialog className="room-background-dialog" backdropClassName="room-background-dialog-backdrop" aria-labelledby="room-background-title" onClose={() => setBackgroundDialogOpen(false)}>
              <header><div><Paintbrush size={16} /><strong id="room-background-title">Decorate {selectedRoomConfigured.name}</strong></div><DialogClose aria-label="Close background decorator"><X size={17} /></DialogClose></header>
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
          </Dialog>
        ) : null}

        {deleteTarget ? <ConfirmDialog title="Delete this message?" description="This removes the message for everyone in the room. This cannot be undone." actionLabel="Delete message" onClose={() => setDeleteTarget(undefined)} onConfirm={async () => { if (workspace.mode === 'demo') setDemoMessageOverrides((current) => ({ ...current, [deleteTarget.id]: null })); else { if (!onRedactMessage) throw new Error('Deletion is unavailable.'); await onRedactMessage(deleteTarget.roomId, deleteTarget.id); } setNotice('Message deleted.'); }} /> : null}
        {settingsOpen ? (
          <SettingsDialog
            initialSection={showingHome ? 'matrix' : 'profile'}
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
            install={install}
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
