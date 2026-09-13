import { useRef, useState } from 'react';
import { Dialog, DialogClose } from './Dialog';
import { ActionFeedback } from './ActionFeedback';

export function ConfirmDialog({ title, description, actionLabel, onConfirm, onClose }: {
  title: string; description: string; actionLabel: string; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const running = useRef(false);
  const confirm = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(undefined);
    try { await onConfirm(); onClose(); }
    catch { setError('That action could not be completed. Your changes have been kept so you can try again.'); }
    finally { running.current = false; setBusy(false); }
  };
  return <Dialog className="confirmation-dialog" aria-labelledby="confirmation-title" aria-describedby="confirmation-description" busy={busy} onClose={onClose}>
    <h2 id="confirmation-title">{title}</h2><p id="confirmation-description">{description}</p>
    <ActionFeedback busy={busy ? `${actionLabel}…` : undefined} error={error} />
    <footer><DialogClose className="aqua-button" data-initial-focus>Cancel</DialogClose><button className="aqua-button is-danger" disabled={busy} onClick={() => void confirm()}>{actionLabel}</button></footer>
  </Dialog>;
}
