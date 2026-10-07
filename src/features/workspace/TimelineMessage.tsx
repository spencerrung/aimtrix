import { memo, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Pin, Search } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { useAnchoredPopover } from '../../components/useAnchoredPopover';
import { Popover } from '../../components/Popover';
import { colorForId, type MessageSummary } from '../../matrix/viewModels';
import { emojiReactionKey, isMxcEmoji, type ReactionImage, type EmojiPackEntry } from '../media/emojiPacks';
import { MessageDeliveryStatus, type MessageDeliveryActions } from './MessageDeliveryStatus';
import { EmojiAsset, MessageContent, LinkPreviewCard, type LinkPreview } from './MessageContent';
import { MessageActions } from './MessageActions';
import { useMessageGeneration } from './useMessageGeneration';

const reactionFallback = ['👍', '❤️', '😂', '🎉', '😮', '😢'];
const MAX_VISIBLE_EMOJI_RESULTS = 240;
const formatTime = (timestamp: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);

export const TimelineMessage = memo(function TimelineMessage({
  message,
  dataSaver,
  autoplayMedia,
  onLoadLinkPreview,
  onReply,
  onOpenThread,
  onStartThread,
  onEdit,
  onDelete,
  onRetryMessage,
  onCancelMessage,
  onPin,
  onSave,
  saved,
  canPin,
  onReact,
  emojiCatalog,
  recentEmojis,
  onLoadEmojiCatalog,
  onEmojiUsed,
  onMediaLoad,
  onJumpToEvent,
  highlighted = false,
  hideThreadControls = false,
  onMarkUnread,
}: {
  message: MessageSummary;
  dataSaver: boolean;
  autoplayMedia: boolean;
  onLoadLinkPreview?: (url: string) => Promise<LinkPreview | undefined>;
  onReply: (message: MessageSummary) => void | Promise<void>;
  onOpenThread: (message: MessageSummary) => void | Promise<void>;
  onStartThread: (message: MessageSummary) => void | Promise<void>;
  onEdit: (message: MessageSummary) => void | Promise<void>;
  onDelete: (message: MessageSummary) => void | Promise<void>;
  onRetryMessage?: MessageDeliveryActions['onRetryMessage'];
  onCancelMessage?: MessageDeliveryActions['onCancelMessage'];
  onPin: (message: MessageSummary) => void | Promise<void>;
  onSave?: (message: MessageSummary) => void | Promise<void>;
  saved?: boolean;
  canPin: boolean;
  onReact: (message: MessageSummary, key: string, ownReactionEventId?: string, image?: ReactionImage) => void | Promise<void>;
  emojiCatalog: EmojiPackEntry[];
  recentEmojis: string[];
  onLoadEmojiCatalog: () => void;
  onEmojiUsed: (emoji: string) => void;
  onMediaLoad: () => void;
  onJumpToEvent?: (eventId: string) => void;
  highlighted?: boolean;
  hideThreadControls?: boolean;
  onMarkUnread?: (message: MessageSummary) => void | Promise<void>;
}) {
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionFeedback, setReactionFeedback] = useState<'pending' | 'failed'>();
  const reactionBusy = useRef(false);
  const reactionGeneration = useMessageGeneration(message.id);
  const [reactionQuery, setReactionQuery] = useState('');
  const reactionTrigger = useRef<HTMLButtonElement>(null);
  const reactionPicker = useRef<HTMLDivElement>(null);
  const reactionEmojis = useMemo(() => {
    const fallback = reactionFallback.map<EmojiPackEntry>((emoji) => ({ id: `fallback-${emoji}`, emoji, name: emoji }));
    const portableCatalog = emojiCatalog;
    const source = portableCatalog.length
      ? [...portableCatalog, ...fallback.filter((fallbackEntry) => !portableCatalog.some((entry) => entry.emoji === fallbackEntry.emoji))]
      : fallback;
    const query = reactionQuery.trim().toLowerCase().replace(/^:/, '').replace(/:$/, '').replace(/[_-]+/g, ' ');
    const matches = source.filter((entry) =>
      !query || `${entry.id} ${entry.name} ${entry.emoji ?? ''} ${entry.aliases?.join(' ') ?? ''}`.toLowerCase().replace(/[_-]+/g, ' ').includes(query),
    );
    if (query) return { quick: [], matches: matches.slice(0, MAX_VISIBLE_EMOJI_RESULTS) };
    const quick = [...recentEmojis, ...reactionFallback]
      .map((emoji) => source.find((entry) => emojiReactionKey(entry) === emoji))
      .filter((entry): entry is EmojiPackEntry => Boolean(entry));
    const uniqueQuick = quick.filter((entry, index) => quick.findIndex((candidate) => candidate.id === entry.id) === index);
    const quickEmojis = new Set(uniqueQuick.map((entry) => emojiReactionKey(entry)));
    return {
      quick: uniqueQuick,
      matches: (uniqueQuick.length ? matches.filter((entry) => !quickEmojis.has(emojiReactionKey(entry))) : matches)
        .slice(0, MAX_VISIBLE_EMOJI_RESULTS),
    };
  }, [emojiCatalog, reactionQuery, recentEmojis]);
  useAnchoredPopover(reactionPickerOpen, reactionTrigger, reactionPicker, 8);

  const react = (reaction: string, ownEventId?: string, image?: ReactionImage) => {
    const existing = ownEventId ? message.reactions?.find((reaction) => reaction.ownEventId === ownEventId) : undefined;
    if (reactionBusy.current || (existing ? existing.canRemove === false : message.actions?.react === false)) return;
    reactionBusy.current = true;
    const generation = reactionGeneration.current;
    setReactionFeedback('pending');
    let result: void | Promise<void>;
    try { result = image ? onReact(message, reaction, ownEventId, image) : onReact(message, reaction, ownEventId); } catch { result = Promise.reject(new Error('Reaction failed')); }
    void Promise.resolve(result).then(() => {
      if (generation === reactionGeneration.current) setReactionFeedback(undefined);
    }).catch(() => {
      if (generation === reactionGeneration.current) setReactionFeedback('failed');
    }).finally(() => { reactionBusy.current = false; });
  };
  const chooseReaction = (reaction: string) => {
    onEmojiUsed(reaction);
    const entry = emojiCatalog.find((entry) => emojiReactionKey(entry) === reaction);
    react(reaction, undefined, entry?.src && !entry.emoji ? { id: entry.id, name: entry.name, src: entry.src } : undefined);
    setReactionPickerOpen(false);
    setReactionQuery('');
  };
  const renderReactionEmoji = (entry: Pick<EmojiPackEntry, 'name' | 'src' | 'previewSrc' | 'emoji'>, alt = '') =>
    entry.src && (dataSaver || !autoplayMedia)
      ? <span className="reaction-image-label" title={entry.name}>{entry.name}</span>
      : <EmojiAsset entry={entry} alt={alt} />;
  return (
    <article className={`timeline-message${hideThreadControls ? ' timeline-message--root' : ''}${message.isOwn ? ' timeline-message--own' : ''}${highlighted ? ' timeline-message--target' : ''}`} data-keyboard-message data-event-id={message.id} data-message-key={message.transactionId ?? message.id} tabIndex={-1}>
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
          {message.edited ? <span className="sending-label edited-label" aria-label="Edited message">edited</span> : null}
          {message.pinned ? <span className="sending-label pinned-label"><Pin size={10} /> pinned</span> : null}

          <MessageActions key={message.id} message={message} onReply={onReply} onOpenThread={onOpenThread} onStartThread={onStartThread}
            onEdit={onEdit} onDelete={onDelete} onPin={onPin} onSave={onSave} saved={saved} canPin={canPin} onMarkUnread={onMarkUnread}
            hideThreadControls={hideThreadControls} reactionTrigger={reactionTrigger} reactionPickerOpen={reactionPickerOpen}
            onOpenReaction={() => { setReactionPickerOpen((open) => !open); if (!reactionPickerOpen) onLoadEmojiCatalog(); }} />
        </header>
        {message.replyTo ? (
          <button type="button" className="message-reply-context" aria-label={`Jump to replied message from ${message.replyTo.senderName}`} onClick={() => onJumpToEvent?.(message.replyTo!.eventId)}>
            <strong>{message.replyTo.senderName}</strong>
            <span>{message.replyTo.body}</span>
          </button>
        ) : null}
        <MessageContent message={message} dataSaver={dataSaver} autoplayMedia={autoplayMedia} emojiCatalog={emojiCatalog} onMediaLoad={onMediaLoad} />
        {reactionFeedback ? <p className="message-action-feedback" role={reactionFeedback === 'failed' ? 'alert' : 'status'}>{reactionFeedback === 'failed' ? 'Reaction could not be updated. Try again.' : 'Updating reaction…'}</p> : null}
        <MessageDeliveryStatus message={message} onRetryMessage={onRetryMessage} onCancelMessage={onCancelMessage} />
        <LinkPreviewCard key={message.id} message={message} onLoad={onLoadLinkPreview} dataSaver={dataSaver} />
        {message.reactions?.length ? (
          <div className="reaction-row" aria-label="Message reactions">
            {message.reactions.map((reaction) => (
              <button
                type="button"
                className={reaction.reacted ? 'reaction reaction--mine' : 'reaction'}
                key={reaction.key}
                aria-label={`${reaction.name ?? (isMxcEmoji(reaction.key) ? 'Custom emoji' : reaction.key)}, ${reaction.count} reactions`}
                disabled={(reaction.ownEventId ? reaction.canRemove === false : message.actions?.react === false) || reactionFeedback === 'pending'}
                onClick={() => react(reaction.key, reaction.ownEventId, !reaction.ownEventId && isMxcEmoji(reaction.key) && reaction.name
                  ? { id: reaction.key, name: reaction.name, src: reaction.key } : undefined)}
              >
                {emojiCatalog.find((entry) => emojiReactionKey(entry) === reaction.key) ? (
                  renderReactionEmoji(emojiCatalog.find((entry) => emojiReactionKey(entry) === reaction.key)!)
                ) : isMxcEmoji(reaction.key) ? renderReactionEmoji({ src: reaction.key, name: reaction.name ?? 'Custom emoji' }, reaction.name ?? 'Custom emoji') : reaction.key} <span>{reaction.count}</span>
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
        {message.thread && !hideThreadControls ? (
          <button
            className="thread-summary"
            type="button"
            onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onOpenThread(message); }}
          >
            <MessageCircle size={14} />
            <strong>{message.thread.replyCount}{message.thread.replyCountIsLowerBound ? '+' : ''} {message.thread.replyCount === 1 && !message.thread.replyCountIsLowerBound ? 'reply' : 'replies'}</strong>
            {message.thread.unreadCount ? <b aria-label={`${message.thread.unreadCount} unread thread notifications`}>{message.thread.unreadCount} unread</b> : null}
            {message.thread.latestReply ? <span>Latest from {message.thread.latestReply.senderName}</span> : null}
          </button>
        ) : null}
      </div>

        {reactionPickerOpen ? createPortal(<Popover surfaceRef={reactionPicker} trigger={reactionTrigger} onClose={() => setReactionPickerOpen(false)} className="reaction-picker emoji-tray" label="Choose a reaction">
          <header><strong>React</strong><span>{recentEmojis.length ? 'Recents first' : 'Search by name'}</span></header>
          <label className="emoji-search"><Search size={13} /><span className="sr-only">Search reaction emoji</span><input value={reactionQuery} placeholder="Search emoji" onChange={(event) => setReactionQuery(event.target.value)} /></label>
          {reactionEmojis.quick.length ? <>
            <span className="reaction-picker__section">{recentEmojis.length ? 'Recent' : 'Quick picks'}</span>
            <div className="reaction-picker__grid reaction-picker__grid--quick">
              {reactionEmojis.quick.map((entry) => <button type="button" key={emojiReactionKey(entry)} aria-label={`React with ${emojiReactionKey(entry)}`} title={entry.name} onClick={() => chooseReaction(emojiReactionKey(entry))}>{renderReactionEmoji(entry)}</button>)}
            </div>
          </> : null}
          <div className="reaction-picker__grid">
            {reactionEmojis.matches.map((entry) => <button type="button" key={entry.id} aria-label={`React with ${emojiReactionKey(entry)}`} title={entry.name} onClick={() => chooseReaction(emojiReactionKey(entry))}>{renderReactionEmoji(entry)}</button>)}
          </div>
          {!reactionEmojis.quick.length && !reactionEmojis.matches.length ? <p className="reaction-picker__empty">No emoji match that search.</p> : null}
        </Popover>, document.body) : null}
    </article>
  );
});
