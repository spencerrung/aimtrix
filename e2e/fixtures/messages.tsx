// Every identifier/body is synthetic; this fixture never connects to Matrix.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { TimelineMessage } from '../../src/features/workspace/TimelineMessage';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { parseIncomingFormatting } from '../../src/matrix/incomingFormatting';
import type { MessageSummary } from '../../src/matrix/viewModels';
import '../../src/styles.css';

declare global { interface Window { messageFixture: { copied: string[]; deleted: string[] } } }
window.messageFixture = { copied: [], deleted: [] };
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { window.messageFixture.copied.push(value); } } });
const code = Array.from({ length: 32 }, (_, index) => `const synthetic_${index} = "A long but entirely synthetic string ${'x'.repeat(75)}";`).join('\n');
const formatted = parseIncomingFormatting(`<mx-reply><blockquote>Discard duplicated reply</blockquote></mx-reply><p><strong>Shared rich formatting</strong> with <a href="https://matrix.to/#/@buddy:test">Buddy</a>.</p><blockquote>A quote from another Matrix client</blockquote><ol start="2"><li>Second item</li><li>Third item</li></ol><p><span data-mx-spoiler="plot">The synthetic secret <span data-mx-spoiler="ending">is a surprise.</span></span></p><pre><code class="language-javascript">${code}</code></pre><img src="https://tracker.invalid/pixel" alt="Tracking image suppressed"><a href="javascript:alert(1)">Unsafe link made readable</a><iframe src="https://tracker.invalid/frame"></iframe>`, ['@buddy:test']);
const base: MessageSummary = { id: '$synthetic', roomId: '!synthetic:test', senderId: '@buddy:test', senderName: 'Buddy', timestamp: 1700000000000, body: 'Synthetic plaintext fallback', formatted, kind: 'text', isOwn: true,
  actions: { reply: true, thread: true, react: true, pin: true, edit: true, redact: true } };

export function Fixture() {
  const [deleteTarget, setDeleteTarget] = useState<MessageSummary>();
  const [notice, setNotice] = useState('');
  return <main aria-label="Message presentation" style={{ minHeight: '100dvh', padding: 12, background: 'var(--surface)', color: 'var(--text)' }}>
    <style>{`.message-fixture-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.message-fixture-grid>section{min-width:0}.message-fixture-grid .thread-panel{position:static;width:auto;display:block;background:var(--surface-raised);border:1px solid var(--border);border-radius:8px;padding:8px}@media(max-width:767px){.message-fixture-grid{grid-template-columns:minmax(0,1fr)}}`}</style>
    <h1 style={{ fontSize: '1.1rem' }}>Shared message presentation</h1>
    {notice ? <p role="status">{notice}</p> : null}
    <div className="message-fixture-grid">
      {['Room', 'Thread reply', 'Thread root'].map((label, index) => <section aria-label={label} key={label}>
        <h2 style={{ fontSize: '1rem' }}>{label}</h2>
        <div className="thread-panel"><TimelineMessage message={{ ...base, id: `$synthetic-${index}` }} hideThreadControls={index === 2}
          dataSaver autoplayMedia={false} emojiCatalog={[]} recentEmojis={[]} onLoadEmojiCatalog={() => {}} onEmojiUsed={() => {}} onMediaLoad={() => {}}
          onReply={() => setNotice('Reply action reached the conversation')} onOpenThread={() => setNotice('Thread opened')} onStartThread={() => setNotice('Thread composition opened')}
          onEdit={() => setNotice('Edit action reached the composer')} onDelete={setDeleteTarget}
          onPin={async () => { throw new Error('Synthetic rejected mutation'); }} canPin
          onMarkUnread={index === 1 ? undefined : async () => {}} onReact={async () => { throw new Error('Synthetic rejected reaction'); }} />
        </div>
      </section>)}
    </div>
    {deleteTarget ? <ConfirmDialog title="Delete this message?" description="Synthetic confirmation preserves the real interaction path." actionLabel="Delete message" onClose={() => setDeleteTarget(undefined)} onConfirm={async () => { window.messageFixture.deleted.push(deleteTarget.id); }} /> : null}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
