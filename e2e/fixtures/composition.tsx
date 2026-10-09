// Synthetic account and messages only. No homeserver is contacted by this fixture.
import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { StructuredDraftStore } from '../../src/features/workspace/structuredDrafts';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { AttachmentSendOptions } from '../../src/matrix/AttachmentSender';
import '../../src/styles.css';
import { useAppViewport } from '../../src/features/pwa/useAppViewport';
import '../../src/features/pwa/appFrame.css';

const uploads: string[] = [];
const sends: Array<{ kind: string; body: string; target?: string }> = [];
const attempts = new Map<string, number>();
Object.assign(window, { compositionFixture: { uploads, sends } });
export function Fixture() {
  const notices = useRef<HTMLDivElement>(null);
  useAppViewport(notices);
  const [store] = useState(() => new StructuredDraftStore(new URLSearchParams(location.search).has('volatile')
    ? { storage: () => { throw new Error('Synthetic unavailable storage'); } } : undefined));
  const [preferences, setPreferences] = useState(defaultUserPreferences);
  return <div className="app-frame"><div ref={notices} className="app-notices" /><div className="app-content"><Workspace workspace={{ ...demoWorkspace, mode: 'matrix' }} config={defaultRuntimeConfig}
    theme="aqua" onThemeChange={() => {}} preferences={preferences} onPreferencesChange={setPreferences}
    draftScope={{ userId: demoWorkspace.user.id, homeserver: 'https://synthetic.test' }} structuredDraftStore={store}
    onSendMessage={async (_room, body) => { sends.push({ kind: 'room', body }); }}
    onSendReply={async (_room, body, target) => { sends.push({ kind: 'reply', body, target: target.id }); }}
    onSendThreadMessage={async (_room, root, body) => { sends.push({ kind: 'thread', body, target: root }); }}
    onEditMessage={async (_room, target, body) => { sends.push({ kind: 'edit', body, target }); }}
    onUploadAttachment={async (_room, file, progress, _thread, _language, options?: AttachmentSendOptions) => {
      options?.onPhase?.('encrypting');
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (options?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      options?.onPhase?.('uploading'); progress?.(file.size, file.size);
      const attempt = (attempts.get(file.name) ?? 0) + 1; attempts.set(file.name, attempt);
      if (file.name === 'retry.txt' && attempt === 1) throw new Error('Synthetic failure');
      options?.onPhase?.('sending'); uploads.push(file.name);
    }} onSignOut={() => { store.clear(); }} /></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
