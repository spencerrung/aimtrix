// Synthetic browser fixture; built separately by the test, never shipped with Aimtrix.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig, type ThemeName } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { MessageSummary } from '../../src/matrix/viewModels';
import '../../src/styles.css';

const failed: MessageSummary = { id: '$synthetic-local', transactionId: 'synthetic-transaction', roomId: 'welcome', senderId: demoWorkspace.user.id, senderName: demoWorkspace.user.displayName, body: 'This synthetic message needs another try.', timestamp: 1000, kind: 'text', isOwn: true, delivery: 'failed' };
export function Fixture() {
  const [message, setMessage] = useState<MessageSummary | undefined>(failed);
  const [theme, setTheme] = useState<ThemeName>('aqua');
  const [preferences, setPreferences] = useState(defaultUserPreferences);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const workspace = { ...demoWorkspace, mode: 'matrix' as const, messagesByRoom: { ...demoWorkspace.messagesByRoom, welcome: [...demoWorkspace.messagesByRoom.welcome, ...(message ? [message] : [])] } };
  return <Workspace workspace={workspace} config={defaultRuntimeConfig} theme={theme} preferences={preferences} onPreferencesChange={setPreferences} onThemeChange={setTheme} onSignOut={() => {}} onRetryMessage={async () => { setMessage((current) => current ? { ...current, delivery: 'sending' } : current); await new Promise((resolve) => setTimeout(resolve, 100)); setMessage((current) => current ? { ...current, id: '$synthetic-remote', delivery: 'accepted' } : current); }} onCancelMessage={async () => setMessage(undefined)} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
