import { createRoot } from 'react-dom/client';
import { Workspace } from '../../src/features/workspace/Workspace';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { WorkspaceSnapshot } from '../../src/matrix/viewModels';
import '../../src/styles.css';

const initial: WorkspaceSnapshot = {
  ...demoWorkspace,
  messagesByRoom: {
    ...demoWorkspace.messagesByRoom,
    welcome: [...demoWorkspace.messagesByRoom.welcome,
      ...['first', 'second'].map((name, index) => ({
        id: `$image-${name}`, roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
        body: `${name}.svg`, timestamp: Date.now() + index, kind: 'media' as const,
        mediaKind: 'image' as const, mediaUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"%3E%3Crect width="320" height="180" fill="%23267fc2"/%3E%3Ccircle cx="160" cy="90" r="55" fill="%23bce5ff"/%3E%3C/svg%3E', mimeType: 'image/svg+xml', isOwn: false,
      }))],
  },
};

createRoot(document.getElementById('root')!).render(<Workspace workspace={initial} config={defaultRuntimeConfig} theme="aqua" preferences={defaultUserPreferences} onSignOut={() => {}} />);
