import { createRoot } from 'react-dom/client';
import { FirstUseGuide } from '../../src/features/workspace/FirstUseGuide';
import '../../src/styles.css';
import '../../src/features/workspace/homeActivity.css';

const health = {
  server: { userId: '@first:example.test', homeserverUrl: 'https://example.test', serverName: 'example.test', deviceId: 'FIRST', versions: [], rtcFoci: [] },
  security: { encryptionReady: true, crossSigningReady: false, secretStorageReady: false, keyBackupEnabled: false },
  devices: [], ignoredUsers: [],
};
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 800, padding: 20, margin: '0 auto' }}><h1>Aimtrix</h1><FirstUseGuide loadHealth={async () => health} onStartChat={() => undefined} onCreateRoom={() => undefined} onRecovery={() => undefined} /></main>);
