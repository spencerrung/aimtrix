// Synthetic history fixture: the real Workspace with an in-memory navigation adapter.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig, type ThemeName } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { HistorySummary, MessageSummary } from '../../src/matrix/viewModels';
import '../../src/styles.css';

const seed: MessageSummary[] = Array.from({ length: 400 }, (_, index) => ({ id: `$history-${index}`, roomId: 'welcome', senderId: '@synthetic:test', senderName: 'History Buddy', body: `Synthetic history message ${index}`, timestamp: 1700000000000 + index * 60000, kind: 'text', isOwn: false, ...(index === 399 ? { replyTo: { eventId: '$history-10', senderName: 'History Buddy', body: 'Open the earlier conversation' } } : {}) }));
export function Fixture() {
  const [all, setAll] = useState(seed);
  const [windowRange, setWindowRange] = useState({ start: 300, end: 400 });
  const [state, setState] = useState<HistorySummary>({ mode: 'live', revision: 0, canLoadOlder: true, canLoadNewer: false });
  const [theme, setTheme] = useState<ThemeName>('aqua');
  const [preferences, setPreferences] = useState(defaultUserPreferences);
  const generation = useRef(0);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const incoming = () => setAll((current) => [...current, { ...seed[0], id: '$incoming', body: 'A new synthetic arrival', timestamp: 1700100000000 }]);
    globalThis.addEventListener('history-fixture-incoming', incoming);
    return () => globalThis.removeEventListener('history-fixture-incoming', incoming);
  }, []);
  const navigate = async (operation: 'backward' | 'forward' | 'latest' | 'context', eventId?: string) => {
    const request = ++generation.current;
    setState((current) => ({ ...current, loading: operation }));
    await new Promise((resolve) => setTimeout(resolve, 70));
    if (generation.current !== request) return;
    let start = windowRange.start, end = windowRange.end;
    if (operation === 'latest') { end = all.length; start = Math.max(0, end - 250); }
    else if (operation === 'context') { const index = all.findIndex((message) => message.id === eventId); start = Math.max(0, index - 25); end = Math.min(all.length, index + 26); }
    else if (operation === 'backward') { start = Math.max(0, start - 50); end = Math.min(end, start + 250); }
    else { end = Math.min(all.length, end + 50); start = Math.max(start, end - 250); }
    setWindowRange({ start, end });
    setState((current) => ({ mode: operation === 'latest' ? 'live' : operation === 'context' ? 'context' : 'history', revision: current.revision + 1, canLoadOlder: start > 0, canLoadNewer: end < all.length, ...(operation === 'context' ? { targetEventId: eventId, targetStatus: 'found' } : {}) }));
  };
  const messages = all.slice(windowRange.start, state.mode === 'live' ? all.length : windowRange.end);
  const workspace = { ...demoWorkspace, mode: 'matrix' as const, rooms: demoWorkspace.rooms.map((room) => room.id === 'welcome' ? { ...room, unreadCount: 0, timelineUnreadCount: 0 } : room), messagesByRoom: { ...demoWorkspace.messagesByRoom, welcome: messages }, historyByRoom: { welcome: { ...state, canLoadNewer: windowRange.end < all.length } } };
  return <Workspace workspace={workspace} config={defaultRuntimeConfig} theme={theme} preferences={preferences} onPreferencesChange={setPreferences} onThemeChange={setTheme} onSignOut={() => {}} onRoomSelected={async () => {}} onLoadRoomHistory={async (_, direction) => navigate(direction)} onOpenEventContext={async (_, eventId) => navigate('context', eventId)} onReturnToLive={async () => navigate('latest')} onHistoryDetached={(_, detached) => { if (detached) setState((current) => current.mode === 'live' ? { ...current, mode: 'history' } : current); }} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
