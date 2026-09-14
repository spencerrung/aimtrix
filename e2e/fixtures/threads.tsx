// Synthetic thread history adapter; every message and identifier is generated here.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig, type ThemeName } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { HistorySummary, MessageSummary, ThreadSummary } from '../../src/matrix/viewModels';
import '../../src/styles.css';

const rootId = '$old-thread-root';
const removedRootId = '$removed-thread-root';
function message(id: string, body: string, index = 0, threadRootId?: string): MessageSummary {
  return { id, roomId: 'welcome', senderId: '@synthetic:test', senderName: 'Thread Buddy', body,
    timestamp: 1700000000000 + index * 60000, kind: 'text', isOwn: false,
    ...(threadRootId ? { threadRootId } : {}) };
}
const root = message(rootId, 'An old synthetic root outside the loaded room timeline');
const seed = Array.from({ length: 160 }, (_, index) => message(`$reply-${index}`, `Synthetic thread reply ${index}`, index + 1, rootId));
const main = Array.from({ length: 60 }, (_, index) => message(`$main-${index}`, `Synthetic main conversation ${index}`, index + 300));
const initialHistory: HistorySummary = { mode: 'live', revision: 1, canLoadOlder: true, canLoadNewer: false };

declare global {
  interface Window {
    threadFixture: {
      reads: Array<{ rootId: string; eventId?: string }>;
      mainReads: number;
      contexts: Array<{ rootId: string; eventId?: string }>;
      pages: string[];
    };
  }
}
window.threadFixture = { reads: [], mainReads: 0, contexts: [], pages: [] };

export function Fixture() {
  const [theme, setTheme] = useState<ThemeName>('aqua');
  const [preferences, setPreferences] = useState({ ...defaultUserPreferences, sendReadReceipts: false });
  const [all, setAll] = useState(seed);
  const allRef = useRef(seed);
  const [range, setRange] = useState({ start: 110, end: 160 });
  const [history, setHistory] = useState<HistorySummary>(initialHistory);
  const [removedRevision, setRemovedRevision] = useState(1);
  const generation = useRef(0);
  const failNext = useRef(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const incoming = () => {
      const current = allRef.current;
      allRef.current = [...current, message(`$reply-${current.length}`, `Synthetic thread reply ${current.length}`, current.length + 1, rootId)];
      setAll(allRef.current);
    };
    const failure = () => { failNext.current = true; };
    window.addEventListener('thread-fixture-incoming', incoming);
    window.addEventListener('thread-fixture-fail-next', failure);
    return () => { window.removeEventListener('thread-fixture-incoming', incoming); window.removeEventListener('thread-fixture-fail-next', failure); };
  }, []);

  const navigate = async (operation: 'context' | 'backward' | 'forward' | 'latest', eventId?: string) => {
    const request = ++generation.current;
    setHistory((current) => ({ ...current, loading: operation, error: undefined, errorDirection: undefined }));
    await new Promise((resolve) => setTimeout(resolve, 90));
    if (request !== generation.current) return;
    if (failNext.current) {
      failNext.current = false;
      setHistory((current) => ({ ...current, loading: undefined, error: 'Synthetic thread history could not be loaded.', errorDirection: operation }));
      throw new Error('Synthetic thread history failure');
    }
    const available = allRef.current;
    let start = range.start, end = range.end;
    const index = eventId ? available.findIndex((item) => item.id === eventId) : -1;
    if (operation === 'latest') { end = available.length; start = Math.max(0, end - 50); }
    else if (operation === 'context' && index >= 0) { start = Math.max(0, index - 8); end = Math.min(available.length, index + 12); }
    else if (operation === 'backward') { start = Math.max(0, start - 50); end = Math.min(end, start + 100); }
    else if (operation === 'forward') { end = Math.min(available.length, end + 50); start = Math.max(start, end - 100); }
    setRange({ start, end });
    setHistory((current) => ({ mode: operation === 'latest' ? 'live' : operation === 'context' ? 'context' : 'history',
      revision: current.revision + 1, canLoadOlder: start > 0, canLoadNewer: end < available.length,
      ...(operation === 'context' ? { targetEventId: eventId, targetStatus: index >= 0 ? 'found' as const : 'unavailable' as const } : {}) }));
  };
  const replies = all.slice(range.start, history.mode === 'live' ? all.length : range.end);
  const threads: Record<string, ThreadSummary> = {
    [rootId]: { rootId, roomId: 'welcome', root, rootStatus: 'found', messages: replies,
      replyCount: all.length, unreadCount: 4, history: { ...history, canLoadNewer: history.mode !== 'live' && range.end < all.length },
      latestReply: all.at(-1), participated: true, latestActivity: all.at(-1)?.timestamp },
    [removedRootId]: { rootId: removedRootId, roomId: 'welcome', rootStatus: 'removed',
      messages: [message('$removed-reply', 'Reply survives a removed synthetic root', 1, removedRootId)], replyCount: 1,
      history: { mode: 'live', revision: removedRevision, canLoadOlder: false, canLoadNewer: false } },
  };
  const workspace = { ...demoWorkspace, mode: 'matrix' as const,
    rooms: demoWorkspace.rooms.map((room) => ({ ...room, unreadCount: 0, timelineUnreadCount: 0, badgeCount: 0, highlighted: false })),
    messagesByRoom: { ...demoWorkspace.messagesByRoom, welcome: main },
    historyByRoom: { welcome: { mode: 'live' as const, revision: 1, canLoadOlder: false, canLoadNewer: false } },
    threadsByRoot: threads,
  };
  return <Workspace workspace={workspace} config={defaultRuntimeConfig} theme={theme} preferences={preferences}
    onPreferencesChange={setPreferences} onThemeChange={setTheme} onSignOut={() => {}} onRoomSelected={async () => {}}
    onResolveNavigationTarget={async (target) => {
      if (target.roomId !== '!synthetic:test' || !target.eventId) throw new Error('Synthetic unavailable destination');
      return { roomId: 'welcome', eventId: target.eventId, threadRootId: target.eventId === removedRootId || target.eventId === '$removed-reply' ? removedRootId : rootId };
    }}
    onThreadSelected={async (_roomId: string, selectedRoot: string, eventId?: string) => {
      window.threadFixture.contexts.push({ rootId: selectedRoot, eventId });
      if (selectedRoot === rootId && eventId && eventId !== rootId) await navigate('context', eventId);
      else if (selectedRoot === rootId) setHistory((current) => ({ ...current, revision: current.revision + 1 }));
      else setRemovedRevision((current) => current + 1);
    }}
    onLoadThreadHistory={async (_roomId: string, selectedRoot: string, direction: 'backward' | 'forward') => {
      window.threadFixture.pages.push(direction);
      if (selectedRoot === rootId) await navigate(direction);
    }}
    onReturnThreadToLive={async () => navigate('latest')}
    onThreadHistoryDetached={(_roomId: string, _rootId: string, detached: boolean) => {
      if (detached) setHistory((current) => current.mode === 'live' ? { ...current, mode: 'history' } : current);
    }}
    onCloseThreadHistory={() => { generation.current += 1; }}
    onMarkThreadRead={async (_roomId: string, selectedRoot: string, options?: { eventId?: string }) => { window.threadFixture.reads.push({ rootId: selectedRoot, eventId: options?.eventId }); }}
    onMarkRoomRead={async () => { window.threadFixture.mainReads += 1; }}
    onSendThreadMessage={async (_roomId, selectedRoot, body) => {
      const accepted = { ...message('$sent-reply', body, allRef.current.length + 1, selectedRoot), isOwn: true };
      allRef.current = [...allRef.current, accepted];
      setAll(allRef.current);
    }}
  />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
