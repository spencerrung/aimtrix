// Synthetic read-status adapter; this exercises the real shell without a homeserver.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig, type ThemeName } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { WorkspaceSnapshot } from '../../src/matrix/viewModels';
import '../../src/styles.css';

export function Fixture() {
  const [theme, setTheme] = useState<ThemeName>('aqua');
  const [preferences, setPreferences] = useState({ ...defaultUserPreferences, sendReadReceipts: false });
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(() => {
    const seed = structuredClone(demoWorkspace);
    seed.mode = 'matrix';
    seed.rooms = seed.rooms.map((room) => ({ ...room, unreadCount: room.id === 'welcome' ? 2 : 0, timelineUnreadCount: 0, badgeCount: room.id === 'welcome' ? 2 : 0, highlighted: false, markedUnread: room.id === 'welcome', ...(room.id === 'welcome' ? { unreadEventId: '$saved-unloaded' } : {}) }));
    seed.historyByRoom = { welcome: { mode: 'live', revision: 1, canLoadOlder: false, canLoadNewer: false } };
    seed.threadsByRoot!.m2.unreadCount = 2;
    return seed;
  });
  const threadAttempts = useRef(0);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const mark = async (unread: boolean, eventId?: string) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    setWorkspace((current) => ({ ...current, rooms: current.rooms.map((room) => room.id === 'welcome' ? { ...room, markedUnread: unread, badgeCount: Math.max(room.unreadCount, unread ? 1 : 0), unreadEventId: unread ? eventId : undefined } : room) }));
  };
  const displayWorkspace = { ...workspace, spaces: workspace.spaces.map((space) => ({ ...space, unreadCount: workspace.rooms.filter((room) => space.roomIds.includes(room.id)).reduce((total, room) => total + (room.badgeCount ?? room.unreadCount), 0), highlighted: false })) };
  return <Workspace workspace={displayWorkspace} config={defaultRuntimeConfig} theme={theme} preferences={preferences} onPreferencesChange={setPreferences} onThemeChange={setTheme} onSignOut={() => {}}
    onMarkRoomRead={async (_, options) => { if (options?.explicit) await mark(false); }}
    onMarkRoomUnread={async (_, eventId) => mark(true, eventId)}
    onMarkThreadRead={async () => { if (++threadAttempts.current === 1) throw new Error('Synthetic private thread failure'); setWorkspace((current) => ({ ...current, rooms: current.rooms.map((room) => room.id === 'welcome' ? { ...room, unreadCount: 0, badgeCount: room.markedUnread ? 1 : 0 } : room), threadsByRoot: { ...current.threadsByRoot, m2: { ...current.threadsByRoot!.m2, unreadCount: 0 } } })); }}
    onOpenEventContext={async (_, eventId) => { setWorkspace((current) => ({ ...current, messagesByRoom: { ...current.messagesByRoom, welcome: [{ ...current.messagesByRoom.welcome[0], id: eventId, body: 'A saved synthetic message returned from outside the loaded window.' }, ...current.messagesByRoom.welcome] }, historyByRoom: { welcome: { mode: 'context', revision: (current.historyByRoom?.welcome.revision ?? 0) + 1, canLoadOlder: false, canLoadNewer: true, targetEventId: eventId, targetStatus: 'found' } } })); }}
  />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
