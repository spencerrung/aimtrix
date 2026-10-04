import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, Bell, RefreshCw, Sparkles } from 'lucide-react';
import type { ActivitySnapshot } from '../../matrix/activity';
import { colorForId, type WorkspaceSnapshot } from '../../matrix/viewModels';
import type { FormattedMessageNode } from '../../matrix/incomingFormatting';
import type { MatrixNavigationTarget } from '../../matrix/matrixLinks';
import { Avatar } from '../../components/Avatar';
import './homeActivity.css';

/** Compact, inert preview: interactive links and spoilers stay in the conversation. */
function ActivityPreview({ body, formatted }: { body: string; formatted?: FormattedMessageNode[] }) {
  const render = (nodes: FormattedMessageNode[]): ReactNode => nodes.map((node, index) => {
    if (node.type === 'text') return node.text;
    if (node.type === 'emoticon') return node.alt;
    if (node.type === 'spoiler') return <span className="home-activity__spoiler" key={index}>Spoiler hidden</span>;
    const children = render(node.children);
    if (node.type === 'link') return <span className="home-activity__link" key={index}>{children}</span>;
    if (node.tag === 'br') return <br key={index} />;
    if (node.tag === 'hr') return <span className="home-activity__rule" key={index} />;
    if (node.tag === 'pre') return <span className="home-activity__code-block" key={index}><code>{node.children.length === 1 && node.children[0].type === 'element' && node.children[0].tag === 'code' ? render(node.children[0].children) : children}</code></span>;
    if (node.tag === 'code') return <code key={index}>{children}</code>;
    if (node.tag === 'strong') return <strong key={index}>{children}</strong>;
    if (node.tag === 'em') return <em key={index}>{children}</em>;
    if (node.tag === 'u') return <u key={index}>{children}</u>;
    if (node.tag === 's') return <s key={index}>{children}</s>;
    return <span className={`home-activity__${node.tag}`} key={index}>{children}</span>;
  });
  return <span className="home-activity__body">{formatted?.length ? render(formatted) : body}</span>;
}

export interface ActivityActions {
  refresh(): Promise<void>;
  loadOlder(): Promise<void>;
  loadMoreThreads(): Promise<void>;
  setThreadFollow(roomId: string, rootId: string, following: boolean): Promise<void>;
}
export interface HomePosition { filter: 'all' | 'unread' | 'mentions' | 'threads'; scroll: number; outerScroll?: number; initialized: boolean }
export default function HomeActivity({ workspace, activity, actions, position, onPosition, onOpen, onBack, onBrowse, onSettings, onDrafts, draftCount, onMarkRead, firstUse }: {
  workspace: WorkspaceSnapshot; activity?: ActivitySnapshot; actions?: ActivityActions; position: HomePosition; onPosition: (patch: Partial<HomePosition>) => void;
  onOpen: (target: MatrixNavigationTarget) => Promise<void>; onBack: () => void; onBrowse?: () => void; onSettings: () => void; onDrafts: () => void; draftCount: number;
  onMarkRead?: (roomId: string) => Promise<void>;
  firstUse?: ReactNode;
}) {
  const filter = position.filter;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const surface = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (position.initialized || !actions) return;
    onPosition({ initialized: true });
    void actions.refresh().catch(() => undefined);
  }, [actions, position.initialized, onPosition]);
  useLayoutEffect(() => {
    const node = list.current;
    if (node) node.scrollTop = position.scroll;

  }, [position.scroll]);
  useLayoutEffect(() => { if (surface.current) surface.current.scrollTop = position.outerScroll ?? 0; }, [position.outerScroll]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await action(); } catch { setError('That action could not finish. Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  const unread = workspace.rooms.filter((room) => room.membership === 'join' && (room.badgeCount ?? room.unreadCount) > 0);
  const items = (activity?.items ?? []).filter((item) => filter === 'threads' ? item.kind === 'thread' : filter === 'mentions' ? item.highlighted : filter === 'unread' ? item.read !== 'read' : true);
  return <main className="home-activity" aria-label="Home activity" ref={surface} onScroll={(event) => { if (event.target === surface.current) onPosition({ outerScroll: surface.current?.scrollTop ?? 0 }); }}>
    <header className="home-activity__header">
      <div><button className="icon-button" type="button" aria-label="Back from Home" onClick={onBack}><ArrowLeft size={18} /></button><Sparkles size={24} /><h1>{firstUse ? 'Welcome to Aimtrix.' : 'Hey, welcome back.'}</h1></div>
      <p>{firstUse ? 'Start your first private conversation.' : 'A little catch-up, then back to your people.'}</p>
      <div className="home-activity__tools">
        {onBrowse ? <button className="aqua-button" type="button" onClick={onBrowse}>Browse conversations</button> : null}
        {actions ? <button className="aqua-button" type="button" disabled={busy || activity?.loading} onClick={() => void run(actions.refresh)}><RefreshCw size={15} /> Refresh activity</button> : null}
        <button className="aqua-button" type="button" onClick={onDrafts}>Drafts ({draftCount})</button>
        <button className="aqua-button" type="button" onClick={onSettings}><Bell size={15} /> Notification settings</button>
      </div>
    </header>
    <nav className="home-activity__filters" aria-label="Activity filters">{(['all', 'unread', 'mentions', 'threads'] as const).map((value) => <button type="button" className="aqua-button" aria-pressed={filter === value} key={value} onClick={() => { onPosition({ filter: value, scroll: 0, outerScroll: 0 }); if (list.current) list.current.scrollTop = 0; }}>{({ all: 'All activity', unread: 'Unread', mentions: 'Mentions', threads: 'My threads' })[value]}</button>)}</nav>
    <div className="home-activity__list" ref={list} onScroll={() => { if (list.current) onPosition({ scroll: list.current.scrollTop }); }}>
      {firstUse}
      {error ? <p role="alert">{error}</p> : null}
      {(filter === 'all' || filter === 'unread') ? <section aria-label="Unread conversations"><h2>{unread.length ? `${unread.length} conversations to catch up on` : 'Your conversation badges are clear'}</h2>
        {unread.map((room) => <article className="home-activity__card" key={room.id} style={{ '--activity-room-color': colorForId(room.id) } as CSSProperties}>
          <button className="home-activity__open" type="button" disabled={busy} onClick={() => void run(() => onOpen({ roomId: room.id, ...(room.unreadEventId ? { eventId: room.unreadEventId } : {}) }))}><Avatar name={room.name} src={room.avatarUrl} color={colorForId(room.id)} size="small" /><span className="home-activity__copy"><strong>{room.name}</strong><span className="home-activity__body">{room.lastMessage || 'Open conversation'}</span></span><b>{room.badgeCount ?? room.unreadCount}</b></button>
          {onMarkRead ? <button type="button" className="aqua-button" disabled={busy} onClick={() => void run(() => onMarkRead(room.id))}>Mark loaded timeline read</button> : null}
        </article>)}
        <p className="home-activity__hint">Badges use the same read and mute rules as your room list. Opening Home sends no read receipts. Thread unread counts remain separate.</p>
      </section> : null}
      <section aria-label="Recent activity"><h2>{filter === 'threads' ? 'Threads you follow or joined' : filter === 'mentions' ? 'Mentions and highlighted messages' : 'Recent activity'}</h2>
        {activity?.loading ? <p role="status">Fetching your activity…</p> : null}
        {activity?.error ? <p role="alert">{activity.error} Use Refresh activity to retry.</p> : null}
        {items.map((item) => {
          const room = workspace.rooms.find((entry) => entry.id === item.roomId);
          const roomName = room?.name ?? item.roomName ?? 'Conversation';
          return <article className="home-activity__card" key={item.id} style={{ '--activity-room-color': colorForId(item.roomId) } as CSSProperties}>
          <button className="home-activity__open" type="button" disabled={busy} onClick={() => void run(() => onOpen({ roomId: item.roomId, eventId: item.eventId }))}><Avatar name={roomName} src={room?.avatarUrl} color={colorForId(item.roomId)} size="small" /><span className="home-activity__copy"><strong>{roomName}{item.kind === 'thread' ? ' · Thread' : ''}</strong>{item.senderName ? <small>{item.senderName}</small> : null}<ActivityPreview body={item.body || 'Message unavailable'} formatted={item.formatted} /><small>{new Date(item.timestamp).toLocaleString()} · {item.read === 'unknown' ? 'Read position not known' : item.read === 'read' ? 'Read' : 'Unread'}{item.highlighted ? ' · Highlighted' : ''}</small></span></button>
          {item.threadRootId && actions ? <button className="aqua-button" type="button" disabled={busy} onClick={() => void run(() => actions.setThreadFollow(item.roomId, item.threadRootId!, !(item.followed ?? item.participated)))}>{(item.followed ?? item.participated) ? 'Hide from Home' : 'Follow in Home'}</button> : null}
        </article>; })}
        {!items.length && !activity?.loading ? <p>No matching activity in the history checked so far.</p> : null}
        {activity?.canLoadOlder && actions ? <button className="aqua-button" type="button" disabled={busy || activity.loading} onClick={() => void run(actions.loadOlder)}>Load older activity</button> : null}
      </section>
      <aside className="home-activity__coverage" aria-label="Activity coverage">
        <strong>What’s included</strong>
        <p>{actions ? 'Homeserver notification history is not a complete message archive. Muted messages may be absent, and encrypted mentions need available keys.' : 'This preview shows loaded conversations. Connect to Matrix for notification history and thread discovery.'}</p>
        {activity ? <><p>Thread discovery: {activity.coverage.roomsLoaded} of {activity.coverage.roomsTotal} rooms checked.{activity.coverage.threadsUnsupported ? ' This homeserver does not support thread discovery; loaded threads are shown.' : ''}</p>
          {activity.coverage.limited ? <p>The retained activity limit has been reached. Open a conversation for more history.</p> : null}
          {activity.coverage.encryptedPending ? <p>Some encrypted activity is waiting for keys.</p> : null}
          {activity.threadError ? <p role="alert">{activity.threadError}</p> : null}
          {activity.loadingThreads ? <p role="status">Checking more threads…</p> : null}
          {activity.canLoadMoreThreads && actions ? <button className="aqua-button" type="button" disabled={busy || activity.loadingThreads} onClick={() => void run(actions.loadMoreThreads)}>Check more threads</button> : null}
        </> : null}
        <p>Follow in Home is an Aimtrix catch-up preference shared with your other Aimtrix sessions. It does not subscribe you to server push alerts.</p>
      </aside>
    </div>
  </main>;
}
