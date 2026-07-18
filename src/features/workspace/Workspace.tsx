import {
  ArrowLeft,
  Ban,
  Check,
  ChevronDown,
  Copy,
  DoorOpen,
  Film,
  Images,
  Info,
  Lock,
  LogOut,
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
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Avatar } from '../../components/Avatar';
import { CallShelf } from '../calls/CallShelf';
import { GifPicker, type GifChoice } from '../media/GifPicker';
import { BrandMark } from '../../components/BrandMark';
import { RoomDialog, type PublicRoomChoice } from '../rooms/RoomDialog';
import type { MatrixSettingsActions } from '../settings/MatrixSettingsPanel';
import {
  SettingsDialog,
  type ProfileUpdate,
} from '../settings/SettingsDialog';
import type { RuntimeConfig, ThemeName } from '../../config/runtimeConfig';
import { useMediaSource } from '../../matrix/useMediaSource';
import type { UserPreferences } from '../../settings/preferences';
import {
  colorForId,
  type MessageSummary,
  type RoomSummary,
  type WorkspaceSnapshot,
} from '../../matrix/viewModels';

interface WorkspaceProps {
  workspace: WorkspaceSnapshot;
  config: RuntimeConfig;
  theme: ThemeName;
  preferences: UserPreferences;
  onThemeChange: (theme: ThemeName) => void;
  onPreferencesChange: (preferences: UserPreferences) => void;
  onUpdateProfile?: (update: ProfileUpdate) => Promise<void>;
  matrixSettingsActions?: MatrixSettingsActions;
  onSendMessage?: (roomId: string, body: string) => Promise<void>;
  onRoomSelected?: (roomId: string) => Promise<void>;
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
  onSelect,
}: {
  space: WorkspaceSnapshot['spaces'][number];
  active: boolean;
  onSelect: () => void;
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
      title={space.name}
      onClick={onSelect}
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
    </button>
  );
}

function SpaceRail({
  workspace,
  activeSpace,
  onSelect,
}: {
  workspace: WorkspaceSnapshot;
  activeSpace: string;
  onSelect: (spaceId: string) => void;
}) {
  return (
    <nav className="space-rail" aria-label="Spaces">
      <div className="space-rail__brand"><BrandMark compact /></div>
      <div className="space-rail__items">
        {workspace.spaces.map((space) => (
          <SpaceButton
            key={space.id}
            space={space}
            active={activeSpace === space.id}
            onSelect={() => onSelect(space.id)}
          />
        ))}
      </div>
    </nav>
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
  scopeName,
}: {
  workspace: WorkspaceSnapshot;
  selectedRoomId?: string;
  scopeName: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectRoom: (roomId: string) => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onAddRoom: () => void;
  onAcceptInvite?: (roomId: string) => Promise<void>;
  onRejectInvite?: (roomId: string) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const normalizedQuery = query.trim().toLowerCase();

  return (
    <aside className="buddy-panel" aria-label="Buddy list">
      <div className="buddy-panel__heading">
        <div>
          <p className="eyebrow">Buddy List</p>
          <h2>{scopeName}</h2>
        </div>
        <IconButton label="Join or create room" onClick={onAddRoom}><Plus size={17} /></IconButton>
      </div>
      <label className="buddy-search">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">Search conversations</span>
        <input
          type="search"
          placeholder="Find a buddy or room"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <div className="buddy-groups">
        {roomGroups.map((group) => {
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
                  {rooms.map((room) => room.membership === 'invite' ? (
                    <div className="buddy-row buddy-row--invite" key={room.id}>
                      <Avatar
                        name={room.name}
                        src={room.avatarUrl}
                        color={colorForId(room.id)}
                        size="small"
                      />
                      <span className="buddy-row__copy">
                        <strong>{room.name}</strong>
                        <span>Invited you to chat</span>
                      </span>
                      <span className="invite-actions">
                        <button type="button" onClick={() => void onAcceptInvite?.(room.id)}>Join</button>
                        <button type="button" onClick={() => void onRejectInvite?.(room.id)}>Decline</button>
                      </span>
                    </div>
                  ) : (
                    <button
                      className={`buddy-row${selectedRoomId === room.id ? ' buddy-row--selected' : ''}`}
                      type="button"
                      key={room.id}
                      onClick={() => onSelectRoom(room.id)}
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
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
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

function TimelineMessage({
  message,
  dataSaver,
  autoplayMedia,
  onReply,
  onEdit,
  onDelete,
  onPin,
  canPin,
  onReact,
}: {
  message: MessageSummary;
  dataSaver: boolean;
  autoplayMedia: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  canPin: boolean;
  onReact: (key: string, ownReactionEventId?: string) => void;
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
          <video className="message-media" src={mediaSrc} controls preload="metadata" />
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
                onClick={() => onReact(reaction.key, reaction.ownEventId)}
              >
                {reaction.key} <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="message-actions">
        <button type="button" aria-label="Reply" title="Reply" onClick={onReply}><Reply size={14} /></button>
        <button type="button" aria-label="React with thumbs up" title="React" onClick={() => onReact('👍')}><SmilePlus size={14} /></button>
        {canPin ? <button type="button" aria-label={message.pinned ? 'Unpin message' : 'Pin message'} title={message.pinned ? 'Unpin' : 'Pin'} onClick={onPin}><Pin size={14} /></button> : null}
        {message.isOwn && message.kind === 'text' ? (
          <><button type="button" aria-label="Edit message" title="Edit" onClick={onEdit}><Pencil size={14} /></button><button type="button" aria-label="Delete message" title="Delete" onClick={onDelete}><Trash2 size={14} /></button></>
        ) : null}
      </div>
    </article>
  );
}

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
  const timelineEnd = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLElement>(null);
  const lastTimelineRoom = useRef<string | undefined>(undefined);
  const loadingHistory = useRef(false);
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
  const [stickerManifest, setStickerManifest] = useState('/stickers/aqua/manifest.json');
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
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  useEffect(() => {
    const element = timeline.current;
    const roomChanged = lastTimelineRoom.current !== room?.id;
    lastTimelineRoom.current = room?.id;
    if (
      roomChanged ||
      !element ||
      element.scrollHeight - element.scrollTop - element.clientHeight < 180
    ) {
      timelineEnd.current?.scrollIntoView?.({ block: 'end' });
    }
  }, [room?.id, messages.length]);

  useEffect(() => {
    if (!emojiOpen || emojiCatalog.length) return;
    let active = true;
    void fetch('/emoji/catalog.json')
      .then((response) => response.json())
      .then((catalog: Array<{ emoji: string; name: string }>) => {
        if (active && Array.isArray(catalog)) setEmojiCatalog(catalog);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [emojiCatalog.length, emojiOpen]);

  useEffect(() => {
    if (!stickerOpen || stickerPack.length) return;
    let active = true;
    void fetch(stickerManifest)
      .then((response) => response.json())
      .then((manifest: { stickers?: Array<{ id: string; name: string; src: string }> }) => {
        if (active) setStickerPack(manifest.stickers ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [stickerManifest, stickerOpen, stickerPack.length]);

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
    <main className="conversation" aria-label={`Conversation with ${room.name}`}>
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
        if (!element || element.scrollTop > 80 || loadingHistory.current) return;
        loadingHistory.current = true;
        const previousHeight = element.scrollHeight;
        void onLoadMore().finally(() => {
          requestAnimationFrame(() => {
            if (timeline.current) timeline.current.scrollTop += timeline.current.scrollHeight - previousHeight;
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
              onReply={() => onStartReply(message)}
              onEdit={() => onStartEdit(message)}
              onDelete={() => onDeleteMessage(message)}
              onPin={() => onTogglePin(message)}
              canPin={Boolean(room.canManage)}
              onReact={(key, ownReactionEventId) => onReact(message, key, ownReactionEventId)}
            />
          ))
        ) : (
          <div className="timeline-empty"><Sparkles size={20} /> {messageQuery ? 'No loaded messages match.' : 'No messages here yet.'}</div>
        )}
        <div ref={timelineEnd} />
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
        <div className="sticker-tray" aria-label="Aqua Starter stickers">
          <header><strong>Sticker packs</strong><select aria-label="Sticker pack" value={stickerManifest} onChange={(event) => { setStickerManifest(event.target.value); setStickerPack([]); }}><option value="/stickers/aqua/manifest.json">Aqua Starter</option>{stickerPacks.map((pack) => <option value={pack.manifestUrl} key={pack.manifestUrl}>{pack.name}</option>)}</select></header>
          <div>
            {stickerPack.map((sticker) => (
              <button
                type="button"
                key={sticker.id}
                aria-label={`Send ${sticker.name}`}
                onClick={() => {
                  onSendSticker(sticker);
                  setStickerOpen(false);
                }}
              ><img src={sticker.src} alt="" /></button>
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
            onChange={(event) => onDraftChange(event.target.value)}
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

function DetailsPanel({
  workspace,
  room,
  onUpdateRoom,
  onUpdateAvatar,
  onEnableEncryption,
  onSetMuted,
  onInvite,
  onRemoveMember,
  onSetMemberPower,
  onLeave,
}: {
  workspace: WorkspaceSnapshot;
  room?: RoomSummary;
  onUpdateRoom?: (roomId: string, update: { name?: string; topic?: string }) => Promise<void>;
  onUpdateAvatar?: (roomId: string, file: File) => Promise<void>;
  onEnableEncryption?: (roomId: string) => Promise<void>;
  onSetMuted?: (roomId: string, muted: boolean) => Promise<void>;
  onInvite?: (roomId: string, userId: string) => Promise<void>;
  onRemoveMember?: (roomId: string, userId: string, action: 'kick' | 'ban' | 'unban') => Promise<void>;
  onSetMemberPower?: (roomId: string, userId: string, level: number) => Promise<void>;
  onLeave?: (roomId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<'people' | 'moments' | 'about' | 'settings'>('people');
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

          <div className="drawer-tabs" role="tablist" aria-label="Drawer sections">
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
                            {(room.ownPowerLevel ?? 0) >= 100 ? <select aria-label={`Role for ${member.displayName}`} value={(member.powerLevel ?? 0) >= 50 ? 50 : 0} onChange={(event) => void runRoomAction('Update role', () => onSetMemberPower?.(room.id, member.id, Number(event.target.value)) ?? Promise.resolve())}><option value="0">Member</option><option value="50">Moderator</option></select> : null}
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
  onThemeChange,
  onPreferencesChange,
  onUpdateProfile,
  matrixSettingsActions,
  onSendMessage,
  onRoomSelected,
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
  onEnableRoomEncryption,
  onSetRoomMuted,
  onInviteToRoom,
  onRemoveRoomMember,
  onSetRoomMemberPower,
  onLeaveRoom,
  onSignOut,
}: WorkspaceProps) {
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(workspace.rooms[0]?.id);
  const [activeSpace, setActiveSpace] = useState(workspace.spaces[0]?.id ?? 'home');
  const [query, setQuery] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(preferences.detailsOpenByDefault);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [demoMessages, setDemoMessages] = useState(workspace.messagesByRoom);
  const [sending, setSending] = useState(false);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [failedUpload, setFailedUpload] = useState<File>();
  const [notice, setNotice] = useState<string>();
  const [replyTarget, setReplyTarget] = useState<MessageSummary>();
  const [editingMessage, setEditingMessage] = useState<MessageSummary>();
  const typingTimer = useRef<number | undefined>(undefined);
  const requestedRoomHistory = useRef(new Set<string>());

  const activeSpaceSummary =
    workspace.spaces.find((space) => space.id === activeSpace) ?? workspace.spaces[0];
  const visibleRooms = useMemo(() => {
    if (!activeSpaceSummary) return workspace.rooms;
    const roomIds = new Set(activeSpaceSummary.roomIds);
    return workspace.rooms.filter((room) => roomIds.has(room.id));
  }, [activeSpaceSummary, workspace.rooms]);
  const scopedWorkspace = useMemo(
    () => ({ ...workspace, rooms: visibleRooms }),
    [visibleRooms, workspace],
  );
  const effectiveRoomId = visibleRooms.some((room) => room.id === selectedRoomId)
    ? selectedRoomId
    : visibleRooms[0]?.id;
  const selectedRoom = visibleRooms.find((room) => room.id === effectiveRoomId);
  const messagesByRoom = workspace.mode === 'demo' ? demoMessages : workspace.messagesByRoom;
  const messages = effectiveRoomId ? messagesByRoom[effectiveRoomId] ?? [] : [];
  const draft = effectiveRoomId ? drafts[effectiveRoomId] ?? '' : '';

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
    void onRoomSelected(effectiveRoomId).catch(() => {
      requestedRoomHistory.current.delete(effectiveRoomId);
      setNotice('Aimtrix could not load earlier messages for this room.');
    });
  }, [effectiveRoomId, onRoomSelected, workspace.mode]);

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

  const selectRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
    setMobileChatOpen(true);
    setNotice(undefined);
    setReplyTarget(undefined);
    setEditingMessage(undefined);
    if (preferences.sendReadReceipts) void onMarkRoomRead?.(roomId);
  };

  const selectSpace = (spaceId: string) => {
    const space = workspace.spaces.find((candidate) => candidate.id === spaceId);
    setActiveSpace(spaceId);
    setQuery('');
    setMobileChatOpen(false);
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
          />
          <BuddyPanel
            workspace={scopedWorkspace}
            selectedRoomId={effectiveRoomId}
            scopeName={activeSpaceSummary?.name ?? 'Conversations'}
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
                void onSendTyping?.(effectiveRoomId, Boolean(nextDraft));
                if (typingTimer.current !== undefined) window.clearTimeout(typingTimer.current);
                typingTimer.current = window.setTimeout(() => {
                  void onSendTyping?.(effectiveRoomId, false);
                }, 5000);
              }
            }}
            onSubmit={() => void submitMessage()}
            onToggleDetails={() => setDetailsOpen((open) => !open)}
            onStartReply={(message) => {
              setReplyTarget(message);
              setEditingMessage(undefined);
            }}
            onStartEdit={(message) => {
              setEditingMessage(message);
              setReplyTarget(undefined);
              if (effectiveRoomId) {
                setDrafts((current) => ({ ...current, [effectiveRoomId]: message.body }));
              }
            }}
            onTogglePin={(message) => {
              if (workspace.mode === 'matrix') {
                void onTogglePinnedMessage?.(message.roomId, message.id, !message.pinned).catch(() => setNotice('Pinned messages could not be updated.'));
              }
            }}
            onDeleteMessage={(message) => {
              if (workspace.mode === 'matrix' && window.confirm('Delete this message for everyone in the room?')) {
                void onRedactMessage?.(message.roomId, message.id).catch(() => setNotice('That message could not be deleted.'));
              }
            }}
            onCancelContext={() => {
              setReplyTarget(undefined);
              setEditingMessage(undefined);
            }}
            onReact={(message, key, ownReactionEventId) => {
              if (workspace.mode === 'matrix') {
                void onToggleReaction?.(message.roomId, message.id, key, ownReactionEventId);
              }
            }}
            onSendSticker={(sticker) => void sendSticker(sticker)}
            onUploadAttachment={(file) => void uploadAttachment(file)}
            onCancelUpload={() => onCancelUpload?.()}
            onRetryUpload={() => { if (failedUpload) void uploadAttachment(failedUpload); }}
            onLoadMore={async () => {
              if (workspace.mode === 'matrix' && effectiveRoomId && onRoomSelected) {
                await onRoomSelected(effectiveRoomId);
              }
            }}
            gifEndpoint={config.features.gifs ? config.gifProvider?.searchEndpoint : undefined}
            stickerPacks={config.stickerPacks}
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
              key={selectedRoom?.id}
              workspace={workspace}
              room={selectedRoom}
              onUpdateRoom={onUpdateRoom}
              onUpdateAvatar={onUpdateRoomAvatar}
              onEnableEncryption={onEnableRoomEncryption}
              onSetMuted={onSetRoomMuted}
              onInvite={onInviteToRoom}
              onRemoveMember={onRemoveRoomMember}
              onSetMemberPower={onSetRoomMemberPower}
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

        {settingsOpen ? (
          <SettingsDialog
            user={workspace.user}
            theme={theme}
            preferences={preferences}
            canEditProfile={workspace.mode === 'matrix'}
            onThemeChange={onThemeChange}
            onPreferencesChange={applyPreferences}
            onSaveProfile={onUpdateProfile}
            matrixActions={matrixSettingsActions}
            onSignOut={onSignOut}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}

        {profileOpen ? (
          <div className="profile-popover">
            <div className="profile-popover__banner" />
            <Avatar
              name={workspace.user.displayName}
              src={workspace.user.avatarUrl}
              color={colorForId(workspace.user.id)}
              presence={workspace.user.presence}
              size="large"
            />
            <h3>{workspace.user.displayName}</h3>
            <code>{workspace.user.id}</code>
            <p>{workspace.user.statusMessage}</p>
            <button className="aqua-button" type="button" onClick={onSignOut}>
              <LogOut size={15} /> {workspace.mode === 'demo' ? 'Leave demo' : 'Sign out'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
