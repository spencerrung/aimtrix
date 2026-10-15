import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { MatrixController } from '../../src/matrix/MatrixController';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { StartupScreen } from '../../src/features/auth/StartupScreen';
import { SessionRecoveryScreen } from '../../src/features/auth/SessionRecovery';
import { clients } from './startupSdk';
import '../../src/styles.css';
import '../../src/features/auth/sessionRecovery.css';

localStorage.setItem('aimtrix.matrix-session.v1', JSON.stringify({ baseUrl: 'https://matrix.example.test',
  serverName: 'example.test', userId: '@synthetic:example.test', deviceId: 'SYNTHETIC', accessToken: 'synthetic-only' }));
const controller = new MatrixController({ ...defaultRuntimeConfig, features: { ...defaultRuntimeConfig.features, groupCalls: false } });
Object.assign(window, { startupFixture: { controller, clients } });

export function Fixture() {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.initialize(); return () => controller.shutdown(); }, []);
  if (snapshot.status === 'syncing' || snapshot.status === 'sync-paused') return <StartupScreen
    syncing={snapshot.status === 'syncing'} paused={snapshot.status === 'sync-paused'}
    issue={snapshot.status === 'syncing' ? snapshot.issue : undefined}
    onRetry={() => controller.retry()} onCancel={() => controller.cancelInitialSync()} />;
  if (snapshot.status === 'reauthentication-required') return <SessionRecoveryScreen recovery={snapshot.recovery}
    onSignIn={() => controller.reauthenticate()} onForget={() => controller.forgetSession()} />;
  if (snapshot.status === 'ready') return <main><h1>Conversations ready</h1><p role="status">{snapshot.workspace.connection}</p></main>;
  return <StartupScreen />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
