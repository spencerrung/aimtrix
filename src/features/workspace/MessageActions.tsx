import { useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Copy, Link, MessageCircle, MoreHorizontal, Pencil, Pin, Reply, SmilePlus, Trash2, Mail } from 'lucide-react';
import { useAnchoredPopover } from '../../components/useAnchoredPopover';
import { Popover } from '../../components/Popover';
import type { MessageSummary } from '../../matrix/viewModels';
import { copyMessageText } from './messageClipboard';
import { useMessageGeneration } from './useMessageGeneration';

type Action = (message: MessageSummary) => void | Promise<void>;
export interface MessageActionsProps {
  message: MessageSummary;
  onReply?: Action;
  onOpenThread?: Action;
  onStartThread?: Action;
  onEdit?: Action;
  onDelete?: Action;
  onPin?: Action;
  onSave?: Action;
  saved?: boolean;
  onMarkUnread?: Action;
  canPin?: boolean;
  hideThreadControls?: boolean;
  onOpenReaction?: () => void;
  reactionTrigger?: RefObject<HTMLButtonElement | null>;
  reactionPickerOpen?: boolean;
}

/** All mutation feedback stays alongside the message, including mobile threads. */
export function MessageActions({ message, onReply, onOpenThread, onStartThread, onEdit, onDelete, onPin, onSave, saved = false, onMarkUnread, canPin = false, hideThreadControls = false, onOpenReaction, reactionTrigger, reactionPickerOpen }: MessageActionsProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string>();
  const [feedback, setFeedback] = useState<{ text: string; failed: boolean }>();
  const busy = useRef(false);
  const generation = useMessageGeneration(message.id);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useAnchoredPopover(open, trigger, menu);
  const run = (label: string, action: () => void | Promise<void>, success?: string) => {
    if (busy.current) return;
    busy.current = true;
    const version = generation.current;
    if (open) trigger.current?.focus({ preventScroll: true });
    setOpen(false); setPending(label); setFeedback(undefined);
    let result: void | Promise<void>;
    try { result = action(); } catch { result = Promise.reject(new Error('Message action failed')); }
    void Promise.resolve(result).then(() => {
      if (version === generation.current && success) setFeedback({ text: success, failed: false });
    }).catch(() => {
      if (version === generation.current) setFeedback({ text: `${label} failed. Try again.`, failed: true });
    }).finally(() => {
      busy.current = false;
      if (version === generation.current) setPending(undefined);
    });
  };
  const allowed = message.actions;
  const accepted = (!message.delivery || message.delivery === 'accepted') && !message.pending && !message.pendingEdit;
  if (!accepted) return null;
  const actions = [
    onReply && (allowed?.reply ?? true) && { label: 'Reply', icon: Reply, action: () => onReply(message) },
    !hideThreadControls && onStartThread && (allowed?.thread ?? true) && { label: 'Reply in thread', icon: MessageCircle, action: () => onStartThread(message) },
    !hideThreadControls && onOpenThread && message.isThreadRoot && (allowed?.thread ?? true) && { label: 'Open thread', icon: MessageCircle, action: () => onOpenThread(message) },
    onPin && (allowed?.pin ?? canPin) && { label: message.pinned ? 'Unpin message' : 'Pin message', icon: Pin, action: () => onPin(message) },
    onEdit && (allowed?.edit ?? (message.isOwn && message.kind === 'text')) && { label: 'Edit message', icon: Pencil, action: () => onEdit(message) },
    onDelete && (allowed?.redact ?? (message.isOwn && message.kind === 'text')) && { label: 'Delete message', icon: Trash2, action: () => onDelete(message) },
  ].filter((action): action is { label: string; icon: typeof Reply; action: () => void | Promise<void> } => Boolean(action));
  const canReact = Boolean(onOpenReaction) && (allowed?.react ?? true);
  const copy = (value: string) => async () => { if (!await copyMessageText(value)) throw new Error('Clipboard unavailable'); };
  return <>
    <div className="message-actions">
      {actions.filter(({ label }) => label === 'Reply').map(({ label, icon: Icon, action }) => <button className="message-actions__quick" key={label} type="button" aria-label={label} title={label} aria-disabled={Boolean(pending)} onClick={() => run(label, action)}><Icon size={14} /></button>)}
      {canReact ? <button className="message-actions__quick" ref={reactionTrigger} type="button" aria-label="Add reaction" aria-haspopup="dialog" aria-expanded={reactionPickerOpen} title="React" onClick={(event) => { if (!pending) { if (reactionTrigger) reactionTrigger.current = event.currentTarget; onOpenReaction?.(); } }} aria-disabled={Boolean(pending)}><SmilePlus size={14} /></button> : null}
      <button className="message-actions__more" ref={trigger} type="button" aria-label="More message actions" aria-haspopup="menu" aria-expanded={open} aria-disabled={Boolean(pending)} onClick={() => { if (!pending) setOpen((value) => !value); }}><MoreHorizontal size={16} /><span className="message-actions__more-label">More</span></button>
    </div>
    {pending ? <span className="message-action-feedback" role="status">{pending}…</span> : null}
    {feedback ? <span className="message-action-feedback" role={feedback.failed ? 'alert' : 'status'}>{feedback.text}</span> : null}
    {open ? createPortal(<Popover menu trigger={trigger} surfaceRef={menu} label="Message actions" className="message-action-menu" onClose={() => setOpen(false)}>
      <button type="button" role="menuitem" onClick={() => run('Copy text', copy(message.body), 'Message text copied.')}><Copy size={15} /> Copy text</button>
      {message.roomId.startsWith('!') && message.id.startsWith('$') ? <button type="button" role="menuitem" onClick={() => run('Copy message link', copy(`https://matrix.to/#/${encodeURIComponent(message.roomId)}/${encodeURIComponent(message.id)}`), 'Message link copied.')}><Link size={15} /> Copy message link</button> : null}
      {onSave && (!message.roomId.startsWith('!') || message.id.startsWith('$')) ? <button type="button" role="menuitem" onClick={() => run(saved ? 'Remove saved message' : 'Save message', () => onSave(message), saved ? 'Removed from saved messages.' : 'Message saved.')}><Bookmark size={15} /> {saved ? 'Remove saved message' : 'Save message'}</button> : null}
      {actions.map(({ label, icon: Icon, action }) => <button key={label} type="button" role="menuitem" onClick={() => run(label, action)}><Icon size={15} /> {label}</button>)}
      {canReact ? <button type="button" role="menuitem" onClick={() => { if (reactionTrigger) reactionTrigger.current = trigger.current; setOpen(false); requestAnimationFrame(() => onOpenReaction?.()); }}><SmilePlus size={15} /> Add reaction</button> : null}
      {onMarkUnread ? <button type="button" role="menuitem" onClick={() => run('Mark unread', () => onMarkUnread(message), 'Conversation marked unread.')}><Mail size={15} /> Mark unread</button> : null}
    </Popover>, document.body) : null}
  </>;
}
