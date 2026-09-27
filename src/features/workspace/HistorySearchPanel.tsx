import { useEffect, useRef, useState } from 'react';
import type { HistorySearchFilters, HistorySearchHit, HistorySearchPage } from '../../matrix/historySearch';
import type { MessageSummary, RoomSummary } from '../../matrix/viewModels';

interface Props {
  open: boolean;
  rooms: RoomSummary[];
  loadedMessages: MessageSummary[];
  initialRoomId?: string;
  onSearch?: (filters: HistorySearchFilters, nextBatch?: string, signal?: AbortSignal) => Promise<HistorySearchPage>;
  onOpen: (roomId: string, eventId: string) => Promise<void>;
  onClose: () => void;
}

function dateBoundary(value: string, end = false): number | undefined {
  if (!value) return undefined;
  const time = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function loadedHits(messages: MessageSummary[], filters: HistorySearchFilters): HistorySearchHit[] {
  const term = filters.term.trim().toLowerCase();
  if (!term) return [];
  return messages.filter((message) =>
    (!filters.roomId || message.roomId === filters.roomId) &&
    (!filters.senderId || message.senderId === filters.senderId) &&
    (!filters.after || message.timestamp >= filters.after) &&
    (!filters.before || message.timestamp <= filters.before) &&
    !message.pending && message.kind !== 'encrypted' && message.kind !== 'unsupported' &&
    (filters.kind !== 'media' || message.kind === 'media' || message.kind === 'sticker') &&
    (filters.kind !== 'links' || /https?:\/\/\S+/i.test(message.body)) &&
    `${message.senderName} ${message.body}`.toLowerCase().includes(term),
  ).map((message) => ({
    roomId: message.roomId, eventId: message.id, senderId: message.senderId,
    body: message.body.slice(0, 500), timestamp: message.timestamp,
    kind: message.kind === 'media' || message.kind === 'sticker' ? 'media' : /https?:\/\/\S+/i.test(message.body) ? 'link' : 'message',
  }));
}

export function HistorySearchPanel({ open: isOpen, rooms, loadedMessages, initialRoomId, onSearch, onOpen, onClose }: Props) {
  const [term, setTerm] = useState('');
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [senderId, setSenderId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'messages' | 'media' | 'links'>('messages');
  const [page, setPage] = useState<HistorySearchPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const filters: HistorySearchFilters = { term, roomId: roomId || undefined, senderId: senderId.trim() || undefined,
    after: dateBoundary(from), before: dateBoundary(to, true), kind };
  const selected = rooms.find((room) => room.id === roomId);
  const eligible = rooms.filter((room) => room.membership === 'join' && !room.encrypted);
  const local = loadedHits(loadedMessages.filter((message) => rooms.some((room) => room.id === message.roomId && room.membership === 'join')), filters);
  const serverHits = (page?.hits ?? []).filter((hit) => rooms.some((room) => room.id === hit.roomId && room.membership === 'join' && !room.encrypted));
  const seen = new Set<string>();
  const hits = [...serverHits, ...local].filter((hit) => {
    const key = `${hit.roomId}:${hit.eventId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  useEffect(() => () => { request.current?.abort(); generation.current += 1; }, []);
  useEffect(() => {
    if (isOpen) return;
    request.current?.abort();
    generation.current += 1;
    queueMicrotask(() => setLoading(false));
  }, [isOpen]);
  const invalidate = () => { request.current?.abort(); generation.current += 1; setLoading(false); setPage(undefined); setError(''); };
  const search = async (more = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      if (!onSearch) { setPage({ hits: [], searchedRoomIds: [] }); return; }
      const result = await onSearch(filters, more ? page?.nextBatch : undefined, controller.signal);
      if (controller.signal.aborted || current !== generation.current) return;
      setPage(more && page ? { ...result, hits: [...page.hits, ...result.hits] } : result);
    } catch (cause) {
      if (!controller.signal.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : 'Search failed. Try again.');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  const open = async (hit: HistorySearchHit) => {
    setOpening(hit.eventId); setError('');
    try { await onOpen(hit.roomId, hit.eventId); }
    catch { setError('This message is unavailable or you no longer have access. Refresh search or choose another result.'); }
    finally { setOpening(undefined); }
  };

  return <aside hidden={!isOpen} inert={!isOpen} className="search-panel" aria-label="Message search">
    <header className="thread-panel__header"><strong tabIndex={-1} data-panel-heading>Find messages</strong><button type="button" aria-label="Close message search" onClick={onClose}>×</button></header>
    <form className="history-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <label>Words<input aria-label="Search words" type="search" value={term} onChange={(event) => { invalidate(); setTerm(event.target.value); }} placeholder="Find a message" /></label>
      <label>Conversation<select aria-label="Search conversation" value={roomId} onChange={(event) => { invalidate(); setRoomId(event.target.value); }}><option value="">All joined conversations</option>{rooms.filter((room) => room.membership === 'join').map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
      <label>From person<input aria-label="Search sender Matrix ID" value={senderId} onChange={(event) => { invalidate(); setSenderId(event.target.value); }} placeholder="@person:server" /></label>
      <label>Type<select aria-label="Search type" value={kind} onChange={(event) => { invalidate(); setKind(event.target.value as typeof kind); }}><option value="messages">Messages</option><option value="media">Media</option><option value="links">Links</option></select></label>
      <div className="history-search-dates"><label>After<input aria-label="Search after date" type="date" value={from} onChange={(event) => { invalidate(); setFrom(event.target.value); }} /></label><label>Before<input aria-label="Search before date" type="date" value={to} onChange={(event) => { invalidate(); setTo(event.target.value); }} /></label></div>
      <button className="aqua-button" type="submit" disabled={!term.trim() || loading}>{loading ? 'Searching…' : 'Search history'}</button>
    </form>
    <p className="search-scope">{selected?.encrypted ? 'Encrypted conversation: only messages loaded on this device are searched.' : eligible.length ? `Homeserver search covers ${roomId ? 'this unencrypted conversation' : `${eligible.length} joined unencrypted conversations`}. Encrypted history is limited to loaded messages.` : 'Only loaded messages can be searched.'} Date and link filters apply to returned pages; keep loading pages for older matches.</p>
    {error ? <p role="alert" className="history-feedback">{error} <button type="button" onClick={() => void search(Boolean(page?.nextBatch))}>Retry</button></p> : null}
    <div className="search-results" aria-live="polite">
      {term.trim() ? <><p role="status">{hits.length} shown{page?.count ? ` · about ${page.count} server matches before local filters` : ''}</p>{hits.map((hit) => <button key={`${hit.roomId}:${hit.eventId}`} type="button" disabled={Boolean(opening)} onClick={() => void open(hit)}><strong>{rooms.find((room) => room.id === hit.roomId)?.name ?? 'Conversation'} · {hit.senderId}</strong><span>{hit.body}</span><small>{new Date(hit.timestamp).toLocaleString()}</small></button>)}{!hits.length && !loading ? <p>No matches in the searched coverage.</p> : null}</> : <p>Enter words to search message history.</p>}
      {page?.nextBatch ? <button className="aqua-button" type="button" disabled={loading} onClick={() => void search(true)}>Load more results</button> : null}
    </div>
  </aside>;
}
