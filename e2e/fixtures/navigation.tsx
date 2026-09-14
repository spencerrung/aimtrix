// Synthetic in-memory adapter around the real shell; no Matrix credentials or network.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig, type ThemeName } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { HistorySummary, MessageSummary } from '../../src/matrix/viewModels';
import '../../src/styles.css';

declare global { interface Window { navigationFixture: { contextRequests: string[]; liveRequests: number } } }
window.navigationFixture = { contextRequests: [], liveRequests: 0 };
const messages: MessageSummary[] = Array.from({ length: 100 }, (_, index) => ({
  id: `$navigation-${index}`, roomId: 'welcome', senderId: '@synthetic:test', senderName: 'Navigation Buddy',
  body: `Synthetic navigation message ${index}`, timestamp: 1700000000000 + index * 60000, kind: 'text', isOwn: false,
}));

export function Fixture() {
  const [theme, setTheme] = useState<ThemeName>('aqua');
  const [preferences, setPreferences] = useState(defaultUserPreferences);
  const [range, setRange] = useState({ start: 60, end: 100 });
  const [history, setHistory] = useState<HistorySummary>({ mode: 'live', revision: 0, canLoadOlder: false, canLoadNewer: false });
  const generation = useRef(0);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const context = async (eventId: string) => {
    window.navigationFixture.contextRequests.push(eventId);
    const request = ++generation.current;
    setHistory((current) => ({ ...current, loading: 'context' }));
    await new Promise((resolve) => setTimeout(resolve, 70));
    if (request !== generation.current) return;
    const index = messages.findIndex((message) => message.id === eventId);
    if (index >= 0) setRange({ start: Math.max(0, index - 4), end: Math.min(100, index + 8) });
    setHistory((current) => ({ mode: 'context', revision: current.revision + 1, canLoadOlder: false, canLoadNewer: true, targetEventId: eventId, targetStatus: index < 0 ? 'unavailable' : 'found' }));
  };
  const workspace = {
    ...demoWorkspace, mode: 'matrix' as const,
    rooms: demoWorkspace.rooms.map((room) => ({ ...room, unreadCount: 0, timelineUnreadCount: 0, badgeCount: 0, highlighted: false })),
    messagesByRoom: { ...demoWorkspace.messagesByRoom, welcome: messages.slice(range.start, range.end) },
    historyByRoom: { welcome: history },
  };
  return <Workspace workspace={workspace} config={defaultRuntimeConfig} theme={theme} preferences={preferences}
    onPreferencesChange={setPreferences} onThemeChange={setTheme} onSignOut={() => {}} onRoomSelected={async () => {}}
    onResolveNavigationTarget={async (target) => {
      if (target.roomId !== '!synthetic:test') throw new Error('Synthetic unavailable destination');
      return { roomId: 'welcome', eventId: target.eventId };
    }}
    onOpenEventContext={async (_, eventId) => context(eventId)}
    onLoadRoomHistory={async (_, direction) => {
      if (direction !== 'forward') return;
      setHistory((current) => ({ ...current, loading: 'forward' }));
      await new Promise((resolve) => setTimeout(resolve, 70));
      setRange((current) => ({ ...current, end: Math.min(100, current.end + 25) }));
      setHistory((current) => ({ mode: 'history', revision: current.revision + 1, canLoadOlder: false, canLoadNewer: true }));
    }}
    onReturnToLive={async () => {
      ++generation.current;
      window.navigationFixture.liveRequests += 1;
      setRange({ start: 60, end: 100 });
      setHistory((current) => ({ mode: 'live', revision: current.revision + 1, canLoadOlder: false, canLoadNewer: false }));
    }}
    onHistoryDetached={(_, detached) => { if (detached) setHistory((current) => current.mode === 'live' ? { ...current, mode: 'history' } : current); }}
  />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
