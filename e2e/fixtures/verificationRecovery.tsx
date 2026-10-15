import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IncomingVerification } from '../../src/features/workspace/IncomingVerification';
import type { IncomingVerificationSummary } from '../../src/matrix/settingsTypes';
import '../../src/styles.css';

export function Fixture() {
  const [requests, setRequests] = useState<IncomingVerificationSummary[]>([{ id: 'synthetic', userId: '@synthetic:example.test', deviceId: 'SYNTHETIC-NEW-DEVICE', selfVerification: true, sasAvailable: false, qrShowAvailable: false, qrScanAvailable: false, qrConfirmAvailable: false, recovery: 'waiting' }]);
  return <div className="app-stage"><section className="aimtrix-window"><header className="app-titlebar"><h1 style={{ fontSize: 15, margin: 0 }}>Aimtrix</h1></header><main aria-label="Synthetic workspace" /><IncomingVerification requests={requests} actions={{
    checkDevice: async () => setRequests((previous) => previous.map((request) => ({ ...request, recovery: 'retry' }))),
    dismissRecovery: () => setRequests([]),
    accept: async () => { throw new Error('Unexpected verification'); }, decline: async () => undefined,
    showQr: async () => new Uint8ClampedArray(), scanQr: async () => undefined, confirmQr: async () => undefined,
  }} /></section></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
