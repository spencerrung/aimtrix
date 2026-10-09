import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { MatrixController } from '../../src/matrix/MatrixController';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { CryptoOwnershipScreen } from '../../src/features/auth/CryptoOwnershipScreen';
import { counts } from './cryptoSdk';
import '../../src/styles.css';
import '../../src/features/auth/sessionRecovery.css';

const account = new URLSearchParams(location.search).get('account') ?? 'one';
localStorage.setItem('aimtrix.matrix-session.v1', JSON.stringify({ baseUrl: 'https://matrix.example.test',
  serverName: 'example.test', userId: `@${account}:example.test`, deviceId: 'SYNTHETIC', accessToken: 'synthetic-only' }));
const controller = new MatrixController({ ...defaultRuntimeConfig, features: { ...defaultRuntimeConfig.features, groupCalls: false } });
Object.assign(window, { cryptoFixture: { counts, controller } });

export function Fixture() {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [started, setStarted] = useState(0);
  useEffect(() => {
    const update = () => setStarted(counts.started);
    window.addEventListener('crypto-started', update);
    void controller.initialize();
    return () => window.removeEventListener('crypto-started', update);
  }, []);
  if (snapshot.status === 'crypto-in-use' || snapshot.status === 'crypto-unavailable') return <CryptoOwnershipScreen
    unavailable={snapshot.status === 'crypto-unavailable'} canTakeover={snapshot.status === 'crypto-in-use' && snapshot.canTakeover}
    error={snapshot.status === 'crypto-in-use' ? snapshot.error : undefined}
    onRetry={() => controller.retry()} onTakeover={() => controller.retry(true)} />;
  return <main><h1>Synthetic encrypted storage owner</h1><p role="status">Started clients: {started}</p><p>{JSON.stringify(snapshot)}</p></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
