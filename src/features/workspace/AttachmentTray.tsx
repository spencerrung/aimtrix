import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StagedAttachments, attachmentContextKey, type StagedAttachment } from './stagedAttachments';
import type { DraftContext } from './structuredDrafts';
import './attachments.css';

function AttachmentPreview({ item }: { item: StagedAttachment }) {
  const [requested, setRequested] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!requested || !item.file || !item.type.startsWith('image/') || item.type === 'image/svg+xml') return;
    const url = URL.createObjectURL(item.file);
    if (image.current) image.current.src = url;
    return () => { URL.revokeObjectURL(url); };
  }, [requested, item.file, item.type]);
  if (!item.file || !item.type.startsWith('image/') || item.type === 'image/svg+xml') return null;
  return requested ? <img ref={image} className="attachment-tray__preview" alt={`Preview of ${item.name}`} />
    : <button type="button" onClick={() => setRequested(true)}>Preview {item.name}</button>;
}

export function AttachmentTray({ queue, context }: { queue: StagedAttachments; context: DraftContext }) {
  useSyncExternalStore(queue.subscribe, queue.getVersion, queue.getVersion);
  const [error, setError] = useState<{ context: string; message?: string }>();
  const contextKey = attachmentContextKey(context);
  const items = queue.list(context);
  if (!items.length) return null;
  return <section className="attachment-tray" aria-label={context.threadRootId ? 'Thread attachments' : 'Attachments'}>
    <header><strong>Attachments</strong><small>Review files before sending</small></header>
    {error?.context === contextKey && error.message ? <p role="alert">{error.message}</p> : null}
    <ol>{items.map((item, index) => {
      const active = ['queued', 'encrypting', 'uploading', 'sending'].includes(item.phase);
      return <li key={item.id}>
        <div className="attachment-tray__details"><strong>{item.name}</strong><small>{Math.ceil(item.size / 1024)} KB</small>
          <span role="status">{({ staged: 'Ready to send', reattach: 'Reattach file', queued: 'Queued', encrypting: 'Encrypting…', uploading: `Uploading ${item.progress}%`, sending: 'Sending…', failed: 'Not confirmed', sent: 'Sent', cancelled: 'Cancelled' })[item.phase]}</span>
        </div>
        <AttachmentPreview item={item} />
        {!['sent', 'cancelled'].includes(item.phase) ? <label>Caption for {item.name}<input aria-label={`Caption for ${item.name}`} maxLength={16_384} value={item.caption ?? ''} disabled={!['staged', 'reattach'].includes(item.phase)} onChange={(event) => queue.caption(item.id, event.target.value)} /></label> : null}
        {item.phase === 'reattach' ? <>
          <p>{item.interrupted ? 'A send was interrupted. Check the conversation before reattaching to avoid sending a second copy.' : 'File bytes are not saved with drafts. Choose the file again.'}</p>
          <label className="aqua-button">Reattach {item.name}<input className="sr-only" type="file" aria-label={`Reattach ${item.name}`} onChange={(event) => {
            const file = event.target.files?.[0]; if (file) setError({ context: contextKey, message: queue.reattach(item.id, file) }); event.target.value = '';
          }} /></label>
        </> : null}
        {item.error ? <p role="alert">{item.error}</p> : null}
        <div className="attachment-tray__actions">
          <button type="button" aria-label={`Move ${item.name} earlier`} disabled={active || index === 0 || ['queued', 'encrypting', 'uploading', 'sending'].includes(items[index - 1]?.phase)} onClick={() => queue.move(item.id, -1)}>Earlier</button>
          <button type="button" aria-label={`Move ${item.name} later`} disabled={active || index === items.length - 1 || ['queued', 'encrypting', 'uploading', 'sending'].includes(items[index + 1]?.phase)} onClick={() => queue.move(item.id, 1)}>Later</button>
          {item.phase === 'failed' ? <button type="button" onClick={() => queue.retry(item.id)}>Retry {item.name}</button> : null}
          <button type="button" disabled={item.phase === 'sending'} title={item.phase === 'sending' ? 'A send already in progress cannot be safely cancelled.' : undefined} onClick={() => queue.remove(item.id)}>{active ? 'Cancel' : 'Remove'} {item.name}</button>
        </div>
      </li>;
    })}</ol>
    <button type="button" className="aqua-button" disabled={!items.some((item) => item.phase === 'staged')} onClick={() => queue.send(context)}>Send {context.threadRootId ? 'thread ' : ''}attachments</button>
  </section>;
}
