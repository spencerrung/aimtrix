import { Hash, Search, Star, UserRound, Users, X } from 'lucide-react';
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Dialog, DialogClose } from '../../components/Dialog';
import type { WorkspaceSnapshot } from '../../matrix/viewModels';
import { QUICK_NAVIGATION_LIMIT, rankNavigationTargets, type NavigationTarget } from './quickNavigation';

export interface QuickSwitcherProps {
  workspace: WorkspaceSnapshot;
  recents: string[];
  onSelect: (target: NavigationTarget) => void;
  onClose: () => void;
  children?: ReactNode;
}

export function QuickSwitcher({ workspace, recents, onSelect, onClose, children }: QuickSwitcherProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>();
  const composing = useRef(false);
  const results = useMemo(() => rankNavigationTargets(workspace, query, recents), [workspace, query, recents]);
  const active = results.find((result) => result.key === selectedKey) ?? results[0];
  if (selectedKey !== active?.key) setSelectedKey(active?.key);
  const optionId = (key: string) => `${id}-${encodeURIComponent(key)}`;
  const activeId = active ? optionId(active.key) : undefined;
  useLayoutEffect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' }); }, [activeId, results]);
  const select = (target: NavigationTarget) => { onSelect(target); onClose(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (event.key === 'Escape') event.preventDefault(); event.stopPropagation(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    const currentIndex = active ? results.indexOf(active) : -1;
    const index = event.key === 'ArrowDown' ? (currentIndex + 1) % results.length
      : event.key === 'ArrowUp' ? (currentIndex - 1 + results.length) % results.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1 : undefined;
    if (index !== undefined && results.length) { event.preventDefault(); setSelectedKey(results[index].key); }
    if (event.key === 'Enter') { event.preventDefault(); if (active) select(active.target); }
  };

  return <Dialog className="room-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
    <header style={{ height: 44 }}><h2 id={`${id}-title`} style={{ margin: 0, fontSize: '1rem' }}>Quick switcher</h2><DialogClose aria-label="Close quick switcher" style={{ width: 44, height: 44 }}><X size={18} /></DialogClose></header>
    <div style={{ display: 'grid', gridTemplateRows: 'auto auto minmax(110px, 1fr) auto', maxHeight: 'min(560px, calc(100dvh - 86px))', overflowY: 'auto' }}>
      <label className="message-search" style={{ height: 56 }}><Search aria-hidden="true" size={18} /><input data-initial-focus type="text" role="combobox" aria-label="Search rooms, people, and spaces" aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-results`} aria-activedescendant={activeId} aria-describedby={`${id}-count ${id}-hint`} placeholder="Room, person, or space" autoComplete="off" spellCheck={false} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedKey(undefined); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={onKeyDown} style={{ height: 36, fontSize: 16 }} /></label>
      <p className="search-scope" id={`${id}-count`} role="status" aria-live="polite" style={{ margin: '8px 12px', padding: 0 }}>{results.length === QUICK_NAVIGATION_LIMIT ? 'Showing 50 destinations. Keep typing to narrow your search.' : `${results.length} ${results.length === 1 ? 'destination' : 'destinations'}`}</p>
      <div className="search-results" role="listbox" id={`${id}-results`} aria-label="Destinations" style={{ minHeight: 0, overscrollBehavior: 'contain' }}>
        {results.map((result) => <button type="button" role="option" key={result.key} id={optionId(result.key)} aria-selected={active?.key === result.key} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSelectedKey(result.key)} onClick={() => select(result.target)} style={{ minHeight: 54, marginBottom: 6, outline: active?.key === result.key ? '2px solid var(--focus)' : undefined, outlineOffset: -2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{result.category === 'person' ? <UserRound aria-hidden="true" size={17} /> : result.category === 'space' ? <Users aria-hidden="true" size={17} /> : <Hash aria-hidden="true" size={17} />}<strong style={{ flex: 1 }}>{result.label}</strong>{result.favorite ? <Star size={14} aria-label="Favorite" /> : null}{result.attention > 0 ? <small aria-label={`${result.attention} unread`}>{result.attention}</small> : null}</span>
          <small style={{ color: 'var(--text-soft)', overflowWrap: 'anywhere' }}>{result.category === 'person' ? 'Person · direct message' : result.category === 'space' ? 'Space' : 'Room'} · {result.detail}</small>
        </button>)}
        {!results.length ? <p style={{ margin: 0, color: 'var(--text-soft)' }}>No destinations match. Search joined rooms, existing chats, or spaces by name or address.</p> : null}
      </div>
      <footer>
      <p className="search-scope" id={`${id}-hint`} style={{ margin: '8px 12px 12px', padding: 0, lineHeight: 1.4 }}>↑ ↓ to choose · Enter to open · Esc to close<br /># for rooms · @ for people in your existing chats</p>
      {children}
      </footer>
    </div>
  </Dialog>;
}
