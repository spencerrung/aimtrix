// Synthetic activity adapter: real Workspace navigation, no homeserver credentials.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig, type ThemeName } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { WorkspaceSnapshot } from '../../src/matrix/viewModels';
import type { MatrixSettingsActions } from '../../src/features/settings/MatrixSettingsPanel';
import type { AttentionSettingsSnapshot } from '../../src/features/settings/AttentionSettings';
import type { ActivitySnapshot } from '../../src/matrix/activity';
import '../../src/styles.css';

declare global { interface Window { attentionFixture: { reads: string[]; contexts: string[]; refreshes: number; older: number; threads: number; rejectRoom: boolean; localTests: number } } }
window.attentionFixture = { reads: [], contexts: [], refreshes: 0, older: 0, threads: 0, rejectRoom: false, localTests: 0 };
const activity: ActivitySnapshot = {
  items: Array.from({ length: 24 }, (_, index) => ({ id: `activity-${index}`, kind: index % 2 ? 'thread' : 'notification', roomId: 'welcome', roomName: 'Welcome Lounge', eventId: `$activity-${index}`, body: `Synthetic activity item ${index}`, timestamp: 1000 + index, read: 'unknown', highlighted: index % 2 === 0, encrypted: false, unavailable: false, ...(index % 2 ? { threadRootId: '$root', participated: true, followed: true } : {}) })),
  loading: false, loadingThreads: false, canLoadOlder: true, canLoadMoreThreads: true,
  coverage: { notifications: 'server', limited: false, encryptedPending: false, roomsLoaded: 1, roomsTotal: 2, threadsUnsupported: false },
};
const notificationState: AttentionSettingsSnapshot = {
  rooms: [{ id: 'welcome', name: 'Welcome Lounge', mode: 'all' }, { id: 'custom', name: 'Custom Room', mode: 'custom' }],
  keywords: [{ id: 'own-keyword', pattern: 'synthetic*', enabled: true, editable: true }, { id: 'other-keyword', pattern: 'shared?', enabled: true, editable: false }],
  doNotDisturb: false, threadRulesSupported: true,
  localPolicy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 1320, endMinute: 420 } },
  health: { permission: 'granted', background: 'Browser push configured; delivery unverified', subscription: 'Present', pusher: 'Present; delivery unverified' },
};
const unusedAction = async (): Promise<never> => { throw new Error('Outside this synthetic fixture.'); };
const matrixActions: MatrixSettingsActions = {
  load: async () => ({ server: { userId: '@synthetic:test', homeserverUrl: 'https://synthetic.test', serverName: 'synthetic.test', deviceId: 'SYNTHETIC', versions: ['v1.12'], rtcFoci: [] }, security: { encryptionReady: true, crossSigningReady: true, secretStorageReady: true, keyBackupEnabled: true }, devices: [], ignoredUsers: [] }),
  verifyDevice: unusedAction, renameDevice: unusedAction, removeDevice: unusedAction, setIgnoredUsers: unusedAction, uploadAvatar: unusedAction,
  setupRecovery: unusedAction, restoreRecovery: unusedAction, changePassword: unusedAction, deactivateAccount: unusedAction,
  attention: {
    load: async () => structuredClone(notificationState),
    setRoom: async (id, mode) => { if (window.attentionFixture.rejectRoom) { window.attentionFixture.rejectRoom = false; throw new Error('Synthetic rejection'); } notificationState.rooms = notificationState.rooms.map((room) => room.id === id ? { ...room, mode } : room); },
    setDoNotDisturb: async (enabled) => { notificationState.doNotDisturb = enabled; },
    addKeyword: async (pattern) => { notificationState.keywords.push({ id: pattern, pattern, enabled: true, editable: true }); },
    removeKeyword: async (id) => { notificationState.keywords = notificationState.keywords.filter((rule) => rule.id !== id); },
    setLocalPolicy: async (policy) => { notificationState.localPolicy = structuredClone(policy); },
    testNotification: async () => { window.attentionFixture.localTests++; },
  },
};
export function Fixture() {
  const [theme, setTheme] = useState<ThemeName>('aqua');
  const [preferences, setPreferences] = useState(defaultUserPreferences);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(() => ({ ...structuredClone(demoWorkspace), mode: 'matrix', activity: structuredClone(activity), historyByRoom: { welcome: { mode: 'live', revision: 1, canLoadOlder: false, canLoadNewer: false } } }));
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <Workspace workspace={workspace} config={defaultRuntimeConfig} theme={theme} preferences={preferences} onPreferencesChange={setPreferences} onThemeChange={setTheme} onSignOut={() => {}}
    matrixSettingsActions={matrixActions}
    draftScope={{ homeserver: 'https://synthetic.test', userId: '@synthetic:test' }}
    onMarkRoomRead={async (roomId) => { window.attentionFixture.reads.push(roomId); }}
    onResolveNavigationTarget={async (target) => ({ roomId: target.roomId!, eventId: target.eventId })}
    onOpenEventContext={async (roomId, eventId) => {
      window.attentionFixture.contexts.push(eventId);
      setWorkspace((current) => ({ ...current, messagesByRoom: { ...current.messagesByRoom, [roomId]: [{ ...current.messagesByRoom[roomId][0], id: eventId, body: `Opened exact context ${eventId}` }] }, historyByRoom: { ...current.historyByRoom, [roomId]: { mode: 'context', revision: (current.historyByRoom?.[roomId]?.revision ?? 0) + 1, canLoadOlder: false, canLoadNewer: true, targetEventId: eventId, targetStatus: 'found' } } }));
    }}
    activityActions={{ refresh: async () => { window.attentionFixture.refreshes++; }, loadOlder: async () => { window.attentionFixture.older++; }, loadMoreThreads: async () => { window.attentionFixture.threads++; }, setThreadFollow: async (_, rootId, following) => {
      setWorkspace((current) => ({ ...current, activity: { ...current.activity!, items: current.activity!.items.filter((item) => following || item.threadRootId !== rootId) } }));
    } }}
  />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
