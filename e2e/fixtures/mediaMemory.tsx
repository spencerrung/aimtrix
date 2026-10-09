import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixController } from '../../src/matrix/MatrixController';
import { MediaProvider } from '../../src/matrix/MediaProvider';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { MessageSummary, WorkspaceSnapshot } from '../../src/matrix/viewModels';
import '../../src/styles.css';

const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
(controller as unknown as { client: MatrixClient }).client = {
  getAccessToken: () => 'synthetic-token',
  mxcUrlToHttp: (source: string) => new URL(`/synthetic-media/${source.split('/').at(-1)}`, location.origin).href,
} as unknown as MatrixClient;

function messages(page: number): MessageSummary[] {
  return (['image', 'audio'] as const).map((kind, index) => ({
    id: `$synthetic-${page}-${kind}`, roomId: 'welcome', senderId: '@synthetic:example.test', senderName: 'Synthetic',
    body: `${kind}-${page}.${kind === 'image' ? 'svg' : 'wav'}`, timestamp: 1000 + page * 2 + index,
    kind: 'media', mediaKind: kind, mediaUrl: `mxc://example.test/${kind}-${page}`,
    mimeType: kind === 'image' ? 'image/svg+xml' : 'audio/wav', isOwn: false,
  }));
}
export function Fixture() {
  const [page, setPage] = useState(0);
  const roomIds = ['welcome', 'quiet'];
  const workspace: WorkspaceSnapshot = {
    ...demoWorkspace,
    mode: 'matrix',
    spaces: [{ ...demoWorkspace.spaces[0], childIds: roomIds, directRoomIds: roomIds, roomIds, childSpaceIds: [] }],
    rooms: roomIds.map((id) => ({ ...demoWorkspace.rooms[0], id, name: id === 'quiet' ? 'Quiet room' : 'Welcome Lounge', unreadCount: 0, highlighted: false })),
    messagesByRoom: { welcome: messages(page), quiet: [] }, membersByRoom: { welcome: [], quiet: [] }, threadsByRoot: {},
    historyByRoom: { welcome: { mode: 'history', revision: page, canLoadOlder: page < 39, canLoadNewer: false } },
  };
  return <MediaProvider resolver={controller.resolveMedia}><Workspace workspace={workspace} config={defaultRuntimeConfig} theme="aqua" preferences={defaultUserPreferences} onSignOut={() => {}}
    onLoadRoomHistory={async () => { setPage((current) => current + 1); }} /></MediaProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
