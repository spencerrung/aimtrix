import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixController } from '../../src/matrix/MatrixController';
import { MediaProvider } from '../../src/matrix/MediaProvider';
import { LinkPreviewCard } from '../../src/features/workspace/MessageContent';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import type { MessageSummary } from '../../src/matrix/viewModels';
import '../../src/styles.css';

const controller = new MatrixController(defaultRuntimeConfig);
const lifecycle = controller as unknown as { client?: MatrixClient; stopCurrentClient: () => Promise<void> };
function activate(account: string) {
  lifecycle.client = { getAccessToken: () => `synthetic-${account}`,
    getUrlPreview: async () => ({ 'og:title': 'Synthetic article', 'og:description': 'A protected Matrix preview image.', 'og:image': `mxc://example.test/${account}` }),
    mxcUrlToHttp: () => new URL(`/synthetic-protected-preview/${account}`, location.origin).href,
    stopClient: () => {},
  } as unknown as MatrixClient;
}
activate('first');
const load = (url: string) => controller.getLinkPreview(url);
const message: MessageSummary = { id: '$preview', roomId: '!room:example.test', senderId: '@buddy:example.test', senderName: 'Buddy',
  body: 'https://example.test/article', kind: 'text', timestamp: 1, isOwn: false };

export function Fixture() {
  const [account, setAccount] = useState('first');
  const [dataSaver, setDataSaver] = useState(true);
  return <main style={{ padding: 16, maxWidth: 720 }}><h1>Protected preview fixture</h1>
    <label><input type="checkbox" checked={dataSaver} onChange={(event) => setDataSaver(event.target.checked)} />Data saver</label>
    <button type="button" onClick={async () => { await lifecycle.stopCurrentClient(); activate('second'); setAccount('second'); }}>Simulate account switch</button>
    <button type="button" onClick={async () => { await lifecycle.stopCurrentClient(); setAccount(''); }}>Simulate sign-out</button>
    {account ? <MediaProvider resolver={controller.resolveMedia}><LinkPreviewCard key={account} message={message} onLoad={load} dataSaver={dataSaver} /></MediaProvider>
      : <p role="status">Signed out</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
