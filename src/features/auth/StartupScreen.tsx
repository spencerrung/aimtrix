import { BrandMark } from '../../components/BrandMark';
import { useRef, useState } from 'react';
import type { ConnectionIssue } from '../../matrix/sessionRecovery';

export function StartupScreen({ message = 'Starting Aimtrix…', syncing = false, paused = false, issue, onRetry, onCancel }: {
  message?: string;
  syncing?: boolean;
  paused?: boolean;
  issue?: ConnectionIssue;
  onRetry?: () => Promise<void>;
  onCancel?: () => Promise<void>;
}) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (active.current) return;
    active.current = true;
    setBusy(true); setError(false);
    try { await action(); } catch { setError(true); }
    finally { active.current = false; setBusy(false); }
  };
  return (
    <main className="startup-screen">
      <BrandMark />
      {!paused && <span className="spinner spinner--large" aria-hidden="true" />}
      {syncing || paused ? <>
        <h1>{paused ? 'Conversation loading paused' : 'Loading your conversations'}</h1>
        <p role="status">{paused ? 'Your sign-in and encryption keys are kept on this device.'
          : issue === 'consent' ? 'Your homeserver requires consent. Complete it in your account page or another client, then retry.'
            : issue === 'storage' ? 'Encrypted storage needs attention. Check browser storage permissions and available space, then retry.'
              : issue ? 'The first sync has not completed. Aimtrix will keep trying automatically.'
                : 'Waiting for the first sync from your homeserver. Large accounts can take several minutes.'}</p>
        <div className="connection-error__actions">
          {onRetry && (paused || issue) && <button className="aqua-button aqua-button--primary" type="button" disabled={busy} onClick={() => void run(onRetry)}>{paused ? 'Resume loading' : 'Retry now'}</button>}
          {onCancel && !paused && <button className="aqua-button" type="button" disabled={busy} onClick={() => void run(onCancel)}>Cancel loading</button>}
        </div>
        {error && <p role="alert">The loading action could not finish. Try again.</p>}
      </> : <p role="status">{message}</p>}
    </main>
  );
}
