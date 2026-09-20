// Synthetic account and messages only. No homeserver is contacted by this fixture.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Workspace } from '../../src/features/workspace/Workspace';
import { StructuredDraftStore } from '../../src/features/workspace/structuredDrafts';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import { defaultUserPreferences } from '../../src/settings/preferences';
import type { AttachmentSendOptions } from '../../src/matrix/AttachmentSender';
import '../../src/styles.css';

const uploads: string[] = [];
const attempts = new Map<string, number>();
Object.assign(window, { compositionFixture: { uploads } });
export function Fixture() {
  const [store] = useState(() => new StructuredDraftStore());
  const [preferences, setPreferences] = useState(defaultUserPreferences);
  return <Workspace workspace={{ ...demoWorkspace, mode: 'matrix' }} config={defaultRuntimeConfig}
    theme="aqua" onThemeChange={() => {}} preferences={preferences} onPreferencesChange={setPreferences}
    draftScope={{ userId: demoWorkspace.user.id, homeserver: 'https://synthetic.test' }} structuredDraftStore={store}
    onSendMessage={async () => {}} onSendReply={async () => {}} onSendThreadMessage={async () => {}}
    onUploadAttachment={async (_room, file, progress, _thread, _language, options?: AttachmentSendOptions) => {
      options?.onPhase?.('encrypting');
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (options?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      options?.onPhase?.('uploading'); progress?.(file.size, file.size);
      const attempt = (attempts.get(file.name) ?? 0) + 1; attempts.set(file.name, attempt);
      if (file.name === 'retry.txt' && attempt === 1) throw new Error('Synthetic failure');
      options?.onPhase?.('sending'); uploads.push(file.name);
    }} onSignOut={() => { store.clear(); }} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
