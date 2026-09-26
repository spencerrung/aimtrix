import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, MessageCircle, RefreshCw, Sparkles } from 'lucide-react';
import type { ActivitySnapshot } from '../../matrix/activity';
import type { WorkspaceSnapshot } from '../../matrix/viewModels';
import type { MatrixNavigationTarget } from '../../matrix/matrixLinks';
import './homeActivity.css';

export interface ActivityActions {
  refresh(): Promise<void>;
  loadOlder(): Promise<void>;
  loadMoreThreads(): Promise<void>;
  setThreadFollow(roomId: string, rootId: string, following: boolean): Promise<void>;
}
export interface HomePosition { filter: 'all' | 'unread' | 'mentions' | 'threads'; scroll: number; outerScroll?: number; initialized: boolean }
export default function HomeActivity({ workspace, activity, actions, position, onPosition, onOpen, onBack, onSettings, onDrafts, draftCount, onMarkRead }: {
  workspace: WorkspaceSnapshot; activity?: ActivitySnapshot; actions?: ActivityActions; position: HomePosition; onPosition: (patch: Partial<HomePosition>) => void;
  onOpen: (target: MatrixNavigationTarget) => Promise<void>; onBack: () => void; onSettings: () => void; onDrafts: () => void; draftCount: number;
  onMarkRead?: (roomId: string) => Promise<void>;
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
      <div><button className="icon-button" type="button" aria-label="Back from Home" onClick={onBack}><ArrowLeft size={18} /></button><Sparkles size={24} /><h1>Hey, welcome back.</h1></div>
      <p>A little catch-up, then back to your people.</p>
      <div className="home-activity__tools">
        {actions ? <button className="aqua-button" type="button" disabled={busy || activity?.loading} onClick={() => void run(actions.refresh)}><RefreshCw size={15} /> Refresh activity</button> : null}
        <button className="aqua-button" type="button" onClick={onDrafts}>Drafts ({draftCount})</button>
        <button className="aqua-button" type="button" onClick={onSettings}><Bell size={15} /> Notification settings</button>
      </div>
    </header>
    <nav className="home-activity__filters" aria-label="Activity filters">{(['all', 'unread', 'mentions', 'threads'] as const).map((value) => <button type="button" className="aqua-button" aria-pressed={filter === value} key={value} onClick={() => { onPosition({ filter: value, scroll: 0, outerScroll: 0 }); if (list.current) list.current.scrollTop = 0; }}>{({ all: 'All activity', unread: 'Unread', mentions: 'Mentions', threads: 'My threads' })[value]}</button>)}</nav>
    <div className="home-activity__list" ref={list} onScroll={() => { if (list.current) onPosition({ scroll: list.current.scrollTop }); }}>
      {error ? <p role="alert">{error}</p> : null}
      {(filter === 'all' || filter === 'unread') ? <section aria-label="Unread conversations"><h2>{unread.length ? `${unread.length} conversations to catch up on` : 'Your conversation badges are clear'}</h2>
        {unread.map((room) => <article className="home-activity__card" key={room.id}>
          <button className="home-activity__open" type="button" disabled={busy} onClick={() => void run(() => onOpen({ roomId: room.id, ...(room.unreadEventId ? { eventId: room.unreadEventId } : {}) }))}><MessageCircle size={18} /><span><strong>{room.name}</strong><span>{room.lastMessage || 'Open conversation'}</span></span><b>{room.badgeCount ?? room.unreadCount}</b></button>
          {onMarkRead ? <button type="button" className="aqua-button" disabled={busy} onClick={() => void run(() => onMarkRead(room.id))}>Mark loaded timeline read</button> : null}
        </article>)}
        <p className="home-activity__hint">Badges use the same read and mute rules as your room list. Opening Home sends no read receipts. Thread unread counts remain separate.</p>
      </section> : null}
      <section aria-label="Recent activity"><h2>{filter === 'threads' ? 'Threads you follow or joined' : filter === 'mentions' ? 'Mentions and highlighted messages' : 'Recent activity'}</h2>
        {activity?.loading ? <p role="status">Fetching your activity…</p> : null}
        {activity?.error ? <p role="alert">{activity.error} Use Refresh activity to retry.</p> : null}
        {items.map((item) => <article className="home-activity__card" key={item.id}>
          <button className="home-activity__open" type="button" disabled={busy} onClick={() => void run(() => onOpen({ roomId: item.roomId, eventId: item.eventId }))}><span><strong>{workspace.rooms.find((room) => room.id === item.roomId)?.name ?? 'Conversation'}{item.kind === 'thread' ? ' · Thread' : ''}</strong><span>{item.body || 'Message unavailable'}</span><small>{new Date(item.timestamp).toLocaleString()} · {item.read === 'unknown' ? 'Read position not known' : item.read === 'read' ? 'Read' : 'Unread'}{item.highlighted ? ' · Highlighted' : ''}</small></span></button>
          {item.threadRootId && actions ? <button className="aqua-button" type="button" disabled={busy} onClick={() => void run(() => actions.setThreadFollow(item.roomId, item.threadRootId!, !(item.followed ?? item.participated)))}>{(item.followed ?? item.participated) ? 'Hide from Home' : 'Follow in Home'}</button> : null}
        </article>)}
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
